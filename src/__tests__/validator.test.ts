// src/__tests__/validator.test.ts
// Tests for the sync payload validator — the security boundary.

import { validateSyncPayload, SYNC_LIMITS } from "@/lib/sync-engine/validator";
import { SYNC_LIMITS as PAYLOAD_LIMITS } from "@/types/sync";

function makeValidPayload(overrides = {}): string {
  return JSON.stringify({
    baseRevision: 0,
    vectorClock: {},
    ops: [
      {
        type: "INSERT",
        position: 0,
        content: "Hello world",
        clientOpId: "550e8400-e29b-41d4-a716-446655440000",
        baseRevision: 0,
        authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
        timestamp: Date.now(),
      },
    ],
    ...overrides,
  });
}

describe("validateSyncPayload", () => {
  // ── Size guard ─────────────────────────────────────────────────────

  test("rejects payload exceeding MAX_PAYLOAD_BYTES", () => {
    const giant = "x".repeat(PAYLOAD_LIMITS.MAX_PAYLOAD_BYTES + 1);
    const payload = JSON.stringify({ data: giant });
    const result = validateSyncPayload(payload, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  test("rejects invalid JSON", () => {
    const result = validateSyncPayload("not json{{", 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  // ── Schema validation ──────────────────────────────────────────────

  test("accepts a valid payload", () => {
    const result = validateSyncPayload(makeValidPayload(), 1000);
    expect(result.ok).toBe(true);
  });

  test("rejects empty ops array", () => {
    const result = validateSyncPayload(makeValidPayload({ ops: [] }), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  test("rejects ops count exceeding MAX_OPS_PER_BATCH", () => {
    const ops = Array.from({ length: PAYLOAD_LIMITS.MAX_OPS_PER_BATCH + 1 }, (_, i) => ({
      type: "INSERT",
      position: i,
      content: "x",
      clientOpId: `550e8400-e29b-41d4-a716-${String(i).padStart(12, "0")}`,
      baseRevision: 0,
      authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
      timestamp: Date.now(),
    }));
    const result = validateSyncPayload(makeValidPayload({ ops }), 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(422);
  });

  test("rejects INSERT content exceeding max length", () => {
    const longContent = "x".repeat(PAYLOAD_LIMITS.MAX_OPERATION_CONTENT_LENGTH + 1);
    const payload = makeValidPayload({
      ops: [
        {
          type: "INSERT",
          position: 0,
          content: longContent,
          clientOpId: "550e8400-e29b-41d4-a716-446655440001",
          baseRevision: 0,
          authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
          timestamp: Date.now(),
        },
      ],
    });
    const result = validateSyncPayload(payload, 0);
    expect(result.ok).toBe(false);
  });

  // ── Semantic validation ────────────────────────────────────────────

  test("rejects duplicate clientOpIds within a batch", () => {
    const sameId = "550e8400-e29b-41d4-a716-446655440000";
    const payload = makeValidPayload({
      ops: [
        {
          type: "INSERT",
          position: 0,
          content: "A",
          clientOpId: sameId,
          baseRevision: 0,
          authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
          timestamp: Date.now(),
        },
        {
          type: "INSERT",
          position: 1,
          content: "B",
          clientOpId: sameId, // duplicate!
          baseRevision: 0,
          authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
          timestamp: Date.now(),
        },
      ],
    });
    const result = validateSyncPayload(payload, 100);
    expect(result.ok).toBe(false);
  });

  test("rejects operation position that is wildly out of bounds", () => {
    const payload = makeValidPayload({
      ops: [
        {
          type: "INSERT",
          position: 999_999_999, // WAY beyond doc length
          content: "x",
          clientOpId: "550e8400-e29b-41d4-a716-446655440002",
          baseRevision: 0,
          authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
          timestamp: Date.now(),
        },
      ],
    });
    const result = validateSyncPayload(payload, 10); // doc only 10 chars
    expect(result.ok).toBe(false);
  });

  test("rejects FORMAT op with invalid attribute key", () => {
    const payload = makeValidPayload({
      ops: [
        {
          type: "FORMAT",
          position: 0,
          length: 5,
          attributes: {
            "__proto__": "evil", // prototype pollution attempt
          },
          clientOpId: "550e8400-e29b-41d4-a716-446655440003",
          baseRevision: 0,
          authorId: "clxxxxxxxxxxxxxxxxxxxxxxxx",
          timestamp: Date.now(),
        },
      ],
    });
    const result = validateSyncPayload(payload, 100);
    expect(result.ok).toBe(false);
  });
});
