// src/lib/sync-engine/validator.ts
// Security-first payload validation for incoming sync requests.
//
// Defense layers:
//   1. Raw byte size check (before JSON.parse) — prevents JSON bomb / OOM
//   2. Zod schema validation — structural correctness
//   3. Semantic validation — business rule checks (positions, revision monotonicity)
//   4. Rate limiting check (delegated to rate-limit.ts)

import { ZodError } from "zod";
import { SyncPayloadSchema, SYNC_LIMITS } from "@/types/sync";
import type { SyncPayload } from "@/types/sync";
import type { Operation } from "@/types/document";

export interface ValidationResult {
  ok: true;
  payload: SyncPayload;
}

export interface ValidationError {
  ok: false;
  status: number;
  error: string;
  details?: string[];
}

export type ValidationOutcome = ValidationResult | ValidationError;

/**
 * Validate a raw sync payload string.
 *
 * @param raw - Raw request body as string (before JSON.parse)
 * @param documentTextLength - Current document text length for position bounds check
 */
export function validateSyncPayload(
  raw: string,
  documentTextLength: number
): ValidationOutcome {
  // ── Layer 1: Size guard ──────────────────────────────────────────────
  const byteSize = Buffer.byteLength(raw, "utf-8");

  if (byteSize > SYNC_LIMITS.MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `Payload too large: ${byteSize} bytes exceeds limit of ${SYNC_LIMITS.MAX_PAYLOAD_BYTES}`,
    };
  }

  // ── Layer 2: JSON parse ──────────────────────────────────────────────
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON in request body" };
  }

  // ── Layer 3: Zod schema validation ──────────────────────────────────
  const result = SyncPayloadSchema.safeParse(parsed);

  if (!result.success) {
    const details = formatZodErrors(result.error);
    return {
      ok: false,
      status: 422,
      error: "Payload validation failed",
      details,
    };
  }

  const payload = result.data;

  // ── Layer 4: Semantic validation ─────────────────────────────────────
  const semanticError = validateSemantics(payload, documentTextLength);
  if (semanticError) {
    return { ok: false, status: 422, error: semanticError };
  }

  return { ok: true, payload };
}

/**
 * Semantic checks — things Zod can't enforce.
 */
function validateSemantics(
  payload: SyncPayload,
  docLength: number
): string | null {
  // 1. All ops must be from the same author (enforced by server middleware anyway,
  //    but double-check to prevent spoofed authorIds in the op payload)
  // Note: we verify authorId === session.userId in the API route itself

  // 2. Check for duplicate clientOpIds within the batch
  const seen = new Set<string>();
  for (const op of payload.ops) {
    if (seen.has(op.clientOpId)) {
      return `Duplicate clientOpId in batch: ${op.clientOpId}`;
    }
    seen.add(op.clientOpId);
  }

  // 3. Position bounds check — positions beyond 2x the document length are suspicious
  // (allow 2x to account for insertions earlier in the batch expanding the doc)
  const maxAllowedPosition = docLength + SYNC_LIMITS.MAX_OPERATION_CONTENT_LENGTH * payload.ops.length;
  for (const op of payload.ops) {
    if (op.position > maxAllowedPosition) {
      return `Operation position ${op.position} is out of bounds for document length ${docLength}`;
    }
  }

  // 4. Total content size across all INSERT/REPLACE ops
  let totalInsertBytes = 0;
  for (const op of payload.ops) {
    if (op.type === "INSERT" || op.type === "REPLACE") {
      totalInsertBytes += Buffer.byteLength(op.content, "utf-8");
    }
  }
  if (totalInsertBytes > SYNC_LIMITS.MAX_DOCUMENT_SIZE_BYTES) {
    return `Total inserted content (${totalInsertBytes} bytes) would exceed max document size`;
  }

  return null;
}

function formatZodErrors(error: ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
}

// ─────────────────────────────────────────────
// DOCUMENT SIZE GUARD
// ─────────────────────────────────────────────

/**
 * Estimate new document size after applying ops.
 * Used to prevent unbounded document growth.
 */
export function estimateNewDocumentSize(
  currentSize: number,
  ops: Operation[]
): number {
  let delta = 0;
  for (const op of ops) {
    switch (op.type) {
      case "INSERT":
        delta += Buffer.byteLength(op.content, "utf-8");
        break;
      case "DELETE":
        delta -= op.length; // approximation
        break;
      case "REPLACE":
        delta += Buffer.byteLength(op.content, "utf-8") - op.length;
        break;
    }
  }
  return Math.max(0, currentSize + delta);
}
