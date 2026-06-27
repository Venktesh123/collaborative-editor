// src/__tests__/ot.test.ts
// Unit tests for the Operational Transform engine.
// These tests verify the core convergence guarantee:
// "Given the same set of ops applied in any order, all clients converge to the same state."

import {
  applyOperation,
  applyOperations,
  transform,
  rebaseOps,
  deduplicateOps,
} from "@/lib/sync-engine/ot";
import type { InsertOperation, DeleteOperation, Operation } from "@/types/document";

// ─────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────

function makeInsert(
  position: number,
  content: string,
  authorId = "user-a",
  clientOpId = crypto.randomUUID()
): InsertOperation {
  return {
    type: "INSERT",
    position,
    content,
    authorId,
    clientOpId,
    baseRevision: 0,
    timestamp: Date.now(),
  };
}

function makeDelete(
  position: number,
  length: number,
  authorId = "user-a",
  clientOpId = crypto.randomUUID()
): DeleteOperation {
  return {
    type: "DELETE",
    position,
    length,
    authorId,
    clientOpId,
    baseRevision: 0,
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────
// applyOperation
// ─────────────────────────────────────────────

describe("applyOperation", () => {
  test("INSERT at beginning", () => {
    expect(applyOperation("world", makeInsert(0, "Hello "))).toBe("Hello world");
  });

  test("INSERT at end", () => {
    expect(applyOperation("Hello", makeInsert(5, " world"))).toBe("Hello world");
  });

  test("INSERT in middle", () => {
    expect(applyOperation("Helloworld", makeInsert(5, " "))).toBe("Hello world");
  });

  test("INSERT with position beyond length clamps to end", () => {
    expect(applyOperation("Hello", makeInsert(100, "!"))).toBe("Hello!");
  });

  test("DELETE from beginning", () => {
    expect(applyOperation("Hello world", makeDelete(0, 6))).toBe("world");
  });

  test("DELETE from middle", () => {
    expect(applyOperation("Hello world", makeDelete(5, 6))).toBe("Hello");
  });

  test("DELETE that exceeds length is clamped", () => {
    expect(applyOperation("Hello", makeDelete(3, 100))).toBe("Hel");
  });

  test("REPLACE replaces a range", () => {
    const op = {
      type: "REPLACE" as const,
      position: 6,
      length: 5,
      content: "there",
      authorId: "user-a",
      clientOpId: "op-1",
      baseRevision: 0,
      timestamp: Date.now(),
    };
    expect(applyOperation("Hello world", op)).toBe("Hello there");
  });
});

// ─────────────────────────────────────────────
// transform: INSERT vs INSERT
// ─────────────────────────────────────────────

describe("transform: INSERT vs INSERT", () => {
  test("A inserts before B — A position shifts right", () => {
    const opA = makeInsert(5, "XXX", "user-a");
    const opB = makeInsert(2, "YY", "user-b");

    // opB inserts "YY" at position 2, before opA's position 5
    const opA_prime = transform(opA, opB, "right");

    expect(opA_prime.position).toBe(7); // 5 + 2 (length of "YY")
  });

  test("A inserts after B — A position unchanged", () => {
    const opA = makeInsert(2, "XXX", "user-a");
    const opB = makeInsert(5, "YY", "user-b");

    const opA_prime = transform(opA, opB, "right");
    expect(opA_prime.position).toBe(2);
  });

  test("Convergence: two concurrent inserts at same position", () => {
    const text = "Hello world";
    const opA = makeInsert(5, "AAA", "user-a");
    const opB = makeInsert(5, "BBB", "user-b");

    // Client A perspective: apply opA then opB (transformed)
    const textAfterA = applyOperation(text, opA);
    const opB_transformed = transform(opB, opA, "left");
    const textAB = applyOperation(textAfterA, opB_transformed);

    // Client B perspective: apply opB then opA (transformed)
    const textAfterB = applyOperation(text, opB);
    const opA_transformed = transform(opA, opB, "right");
    const textBA = applyOperation(textAfterB, opA_transformed);

    // Both clients must converge to the same text (order may differ based on tiebreak)
    expect(textAB).toBe(textBA);
  });
});

// ─────────────────────────────────────────────
// transform: DELETE vs INSERT
// ─────────────────────────────────────────────

describe("transform: DELETE vs INSERT", () => {
  test("DELETE after INSERT — DELETE position shifts right", () => {
    const opA = makeDelete(5, 3, "user-a"); // delete chars 5-7
    const opB = makeInsert(2, "XX", "user-b"); // insert 2 chars at pos 2

    const opA_prime = transform(opA, opB, "right");
    expect((opA_prime as DeleteOperation).position).toBe(7); // 5 + 2
    expect((opA_prime as DeleteOperation).length).toBe(3);
  });

  test("INSERT in the middle of DELETE range — DELETE range expands", () => {
    const opA = makeDelete(3, 5, "user-a"); // delete chars 3-7
    const opB = makeInsert(5, "XX", "user-b"); // insert in middle of range

    const opA_prime = transform(opA, opB, "right");
    expect((opA_prime as DeleteOperation).length).toBe(7); // 5 + 2
  });
});

// ─────────────────────────────────────────────
// transform: DELETE vs DELETE
// ─────────────────────────────────────────────

describe("transform: DELETE vs DELETE", () => {
  test("Non-overlapping DELETEs — shift position", () => {
    const opA = makeDelete(5, 3, "user-a"); // delete chars 5-7
    const opB = makeDelete(0, 2, "user-b"); // delete chars 0-1 (before opA)

    const opA_prime = transform(opA, opB, "right");
    expect((opA_prime as DeleteOperation).position).toBe(3); // 5 - 2
    expect((opA_prime as DeleteOperation).length).toBe(3);
  });

  test("Fully overlapping DELETEs — opA becomes no-op (length 0)", () => {
    const opA = makeDelete(2, 3, "user-a"); // delete chars 2-4
    const opB = makeDelete(1, 5, "user-b"); // delete chars 1-5 (covers opA entirely)

    const opA_prime = transform(opA, opB, "right");
    expect((opA_prime as DeleteOperation).length).toBe(0); // nothing left to delete
  });

  test("Partially overlapping DELETEs — opA shrinks", () => {
    const opA = makeDelete(3, 4, "user-a"); // delete chars 3-6
    const opB = makeDelete(5, 4, "user-b"); // delete chars 5-8 (partial overlap)

    const opA_prime = transform(opA, opB, "right");
    // opA now only needs to delete chars 3-4 (chars 5-6 already deleted by opB)
    expect((opA_prime as DeleteOperation).length).toBe(2);
  });
});

// ─────────────────────────────────────────────
// rebaseOps
// ─────────────────────────────────────────────

describe("rebaseOps", () => {
  test("Rebasing against empty server ops returns client ops unchanged", () => {
    const clientOps = [makeInsert(0, "Hello")];
    expect(rebaseOps(clientOps, [])).toEqual(clientOps);
  });

  test("Full offline scenario: client and server both insert, must converge", () => {
    const initialText = "The quick brown fox";

    // Server applied this while client was offline
    const serverOp = makeInsert(4, "very ", "server-user");

    // Client made this edit while offline (same baseRevision)
    const clientOp = makeInsert(10, "lazy ", "client-user");

    // Server state after serverOp:
    const serverText = applyOperation(initialText, serverOp);
    expect(serverText).toBe("The very quick brown fox");

    // Rebase clientOp against serverOp
    const [rebasedClientOp] = rebaseOps([clientOp], [serverOp]);

    // Apply rebased client op to server state
    const finalText = applyOperation(serverText, rebasedClientOp);

    // Client state: first apply server op (as server would have broadcast it)
    const transformedServerOp = transform(serverOp, clientOp, "left");
    const clientSideServerText = applyOperation(
      applyOperation(initialText, clientOp),
      transformedServerOp
    );

    // Both must converge
    expect(finalText).toBe(clientSideServerText);
  });
});

// ─────────────────────────────────────────────
// deduplicateOps
// ─────────────────────────────────────────────

describe("deduplicateOps", () => {
  test("Removes ops with IDs already in existingIds", () => {
    const op1 = makeInsert(0, "A", "user", "op-uuid-1");
    const op2 = makeInsert(1, "B", "user", "op-uuid-2");
    const op3 = makeInsert(2, "C", "user", "op-uuid-3");

    const existing = new Set(["op-uuid-2"]);
    const result = deduplicateOps([op1, op2, op3], existing);

    expect(result).toHaveLength(2);
    expect(result.map((o) => o.clientOpId)).toEqual(["op-uuid-1", "op-uuid-3"]);
  });

  test("Returns all ops when existingIds is empty", () => {
    const ops = [makeInsert(0, "A"), makeInsert(1, "B")];
    expect(deduplicateOps(ops, new Set())).toHaveLength(2);
  });
});
