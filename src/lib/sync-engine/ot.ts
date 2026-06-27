// src/lib/sync-engine/ot.ts
// Operational Transform (OT) Engine
//
// Implements the classic OT "transform" function:
//   transform(op_a, op_b) -> op_a'
// such that applying op_a' after op_b produces the same result
// as applying op_b' after op_a (convergence guarantee).
//
// This handles the core distributed systems problem:
// Two clients both edit the same document while offline and both
// submit changes — how do we merge them without data loss?

import type {
  Operation,
  InsertOperation,
  DeleteOperation,
  ReplaceOperation,
  FormatOperation,
} from "@/types/document";

// ─────────────────────────────────────────────
// APPLY: apply an op to a string of text
// ─────────────────────────────────────────────

/**
 * Apply a single operation to document text.
 * Returns the new text string.
 */
export function applyOperation(text: string, op: Operation): string {
  // Clamp position to valid range
  const pos = Math.min(Math.max(0, op.position), text.length);

  switch (op.type) {
    case "INSERT": {
      return text.slice(0, pos) + op.content + text.slice(pos);
    }

    case "DELETE": {
      const end = Math.min(pos + op.length, text.length);
      return text.slice(0, pos) + text.slice(end);
    }

    case "REPLACE": {
      const end = Math.min(pos + op.length, text.length);
      return text.slice(0, pos) + op.content + text.slice(end);
    }

    case "FORMAT": {
      // FORMAT ops don't change text content — applied to rich-text attrs layer
      return text;
    }

    default:
      return text;
  }
}

/**
 * Apply a sequence of operations in order to text.
 */
export function applyOperations(text: string, ops: Operation[]): string {
  return ops.reduce((t, op) => applyOperation(t, op), text);
}

// ─────────────────────────────────────────────
// TRANSFORM: the core OT function
// ─────────────────────────────────────────────

/**
 * Transform op_a against op_b.
 *
 * Returns op_a' — a version of op_a adjusted so it can be applied
 * *after* op_b has already been applied, still achieving the
 * original intent of op_a.
 *
 * tie_break: when two ops are at the same position, whose INSERT wins?
 * "left" = op_a goes before op_b; "right" = op_b goes before op_a.
 * For determinism, we use authorId lexicographic comparison.
 */
export function transform(
  opA: Operation,
  opB: Operation,
  tieBreak: "left" | "right" = "right"
): Operation {
  switch (opA.type) {
    case "INSERT":
      return transformInsert(opA, opB, tieBreak);
    case "DELETE":
      return transformDelete(opA, opB);
    case "REPLACE":
      return transformReplace(opA, opB, tieBreak);
    case "FORMAT":
      // FORMAT ops are position/range based — same logic as delete for range transform
      return transformFormat(opA, opB);
    default:
      return opA;
  }
}

function transformInsert(
  opA: InsertOperation,
  opB: Operation,
  tieBreak: "left" | "right"
): InsertOperation {
  switch (opB.type) {
    case "INSERT": {
      if (
        opB.position < opA.position ||
        (opB.position === opA.position && tieBreak === "right")
      ) {
        // opB inserted before opA's position — shift opA right
        return { ...opA, position: opA.position + opB.content.length };
      }
      return opA;
    }

    case "DELETE": {
      if (opB.position + opB.length <= opA.position) {
        // opB deleted entirely before opA — shift opA left
        return {
          ...opA,
          position: opA.position - Math.min(opB.length, opA.position - opB.position),
        };
      }
      if (opB.position <= opA.position) {
        // opB deletion overlaps or is at opA's position
        return { ...opA, position: opB.position };
      }
      return opA;
    }

    case "REPLACE": {
      // Treat REPLACE as DELETE+INSERT for transform purposes
      const afterDelete = transformInsert(
        opA,
        { ...opB, type: "DELETE", length: opB.length } as DeleteOperation,
        tieBreak
      );
      return transformInsert(
        afterDelete,
        {
          ...opB,
          type: "INSERT",
          content: opB.content,
          position: opB.position,
        } as InsertOperation,
        tieBreak
      );
    }

    case "FORMAT":
      // FORMAT doesn't change positions
      return opA;

    default:
      return opA;
  }
}

function transformDelete(
  opA: DeleteOperation,
  opB: Operation
): DeleteOperation {
  switch (opB.type) {
    case "INSERT": {
      if (opB.position <= opA.position) {
        // Insertion before our delete — shift position
        return { ...opA, position: opA.position + opB.content.length };
      }
      if (opB.position < opA.position + opA.length) {
        // Insertion in the middle of our delete range — expand length
        return { ...opA, length: opA.length + opB.content.length };
      }
      return opA;
    }

    case "DELETE": {
      const aStart = opA.position;
      const aEnd = opA.position + opA.length;
      const bStart = opB.position;
      const bEnd = opB.position + opB.length;

      if (bEnd <= aStart) {
        // opB entirely before opA — shift left
        return { ...opA, position: opA.position - opB.length };
      }

      if (bStart >= aEnd) {
        // opB entirely after opA — no change
        return opA;
      }

      // Overlapping deletes — shrink opA by the overlap
      const overlapStart = Math.max(aStart, bStart);
      const overlapEnd = Math.min(aEnd, bEnd);
      const overlap = overlapEnd - overlapStart;

      const newPosition = bStart <= aStart ? bStart : aStart;
      const newLength = opA.length - overlap;

      if (newLength <= 0) {
        // opA is entirely covered by opB — it's a no-op now
        return { ...opA, position: newPosition, length: 0 };
      }

      return { ...opA, position: newPosition, length: newLength };
    }

    case "REPLACE": {
      const afterDelete = transformDelete(
        opA,
        { ...opB, type: "DELETE", length: opB.length } as DeleteOperation
      );
      return transformDelete(afterDelete, {
        ...opB,
        type: "INSERT",
        content: opB.content,
        position: opB.position,
      } as InsertOperation);
    }

    case "FORMAT":
      return opA;

    default:
      return opA;
  }
}

function transformReplace(
  opA: ReplaceOperation,
  opB: Operation,
  tieBreak: "left" | "right"
): ReplaceOperation {
  // REPLACE = DELETE(length) + INSERT(content)
  // Transform each component independently
  const asDelete: DeleteOperation = {
    ...opA,
    type: "DELETE",
    length: opA.length,
  };
  const transformedDelete = transformDelete(asDelete, opB);

  const asInsert: InsertOperation = {
    ...opA,
    type: "INSERT",
    content: opA.content,
    position: transformedDelete.position,
  };
  const transformedInsert = transformInsert(asInsert, opB, tieBreak);

  return {
    ...opA,
    position: transformedInsert.position,
    length: transformedDelete.length,
  };
}

function transformFormat(
  opA: FormatOperation,
  opB: Operation
): FormatOperation {
  switch (opB.type) {
    case "INSERT": {
      if (opB.position <= opA.position) {
        return { ...opA, position: opA.position + opB.content.length };
      }
      if (opB.position < opA.position + opA.length) {
        return { ...opA, length: opA.length + opB.content.length };
      }
      return opA;
    }
    case "DELETE": {
      const overlap = Math.min(opA.position + opA.length, opB.position + opB.length) -
        Math.max(opA.position, opB.position);
      const clampedOverlap = Math.max(0, overlap);
      const shift = opB.position < opA.position
        ? Math.min(opB.length, opA.position - opB.position)
        : 0;
      return {
        ...opA,
        position: opA.position - shift,
        length: Math.max(0, opA.length - clampedOverlap),
      };
    }
    default:
      return opA;
  }
}

// ─────────────────────────────────────────────
// SERVER-SIDE REBASE
// Transform a batch of incoming client ops against all ops
// committed to the server since the client's baseRevision.
// ─────────────────────────────────────────────

/**
 * Rebase clientOps on top of serverOps.
 *
 * serverOps: operations committed since clientBaseRevision (in order)
 * clientOps: operations from the client (all have same baseRevision)
 *
 * Returns clientOps transformed so they apply cleanly after serverOps.
 */
export function rebaseOps(
  clientOps: Operation[],
  serverOps: Operation[]
): Operation[] {
  let rebased = [...clientOps];

  for (const serverOp of serverOps) {
    rebased = rebased.map((clientOp) => {
      // Tie-break: use authorId lexicographic order for determinism
      const tieBreak: "left" | "right" =
        clientOp.authorId < serverOp.authorId ? "left" : "right";
      return transform(clientOp, serverOp, tieBreak);
    });
  }

  return rebased;
}

// ─────────────────────────────────────────────
// UTILITY: deduplicate ops by clientOpId
// Ensures idempotent resubmission is safe
// ─────────────────────────────────────────────

export function deduplicateOps(ops: Operation[], existingIds: Set<string>): Operation[] {
  return ops.filter((op) => !existingIds.has(op.clientOpId));
}
