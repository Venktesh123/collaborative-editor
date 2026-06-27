// src/types/sync.ts
// Sync engine types — shared between client and server

import { z } from "zod";
import type { Operation, VectorClock } from "./document";

// ─────────────────────────────────────────────
// ZOD SCHEMAS (server-side validation of sync payloads)
// These are the FIRST line of defense against malformed/malicious payloads
// ─────────────────────────────────────────────

// Max payload limits — tunable via env
export const SYNC_LIMITS = {
  MAX_PAYLOAD_BYTES: 512 * 1024,        // 512KB total payload
  MAX_OPS_PER_BATCH: 500,               // Max operations per sync
  MAX_OPERATION_CONTENT_LENGTH: 10_000, // Max chars per INSERT/REPLACE
  MAX_DOCUMENT_SIZE_BYTES: 5 * 1024 * 1024, // 5MB max document
} as const;

const BaseOperationSchema = z.object({
  clientOpId: z.string().uuid("clientOpId must be a valid UUID"),
  position: z.number().int().nonnegative("position must be >= 0"),
  baseRevision: z.number().int().nonnegative(),
  authorId: z.string().cuid("authorId must be a valid CUID"),
  timestamp: z.number().int().positive(),
});

const InsertOperationSchema = BaseOperationSchema.extend({
  type: z.literal("INSERT"),
  content: z
    .string()
    .min(1, "INSERT content cannot be empty")
    .max(
      SYNC_LIMITS.MAX_OPERATION_CONTENT_LENGTH,
      `INSERT content exceeds ${SYNC_LIMITS.MAX_OPERATION_CONTENT_LENGTH} chars`
    ),
});

const DeleteOperationSchema = BaseOperationSchema.extend({
  type: z.literal("DELETE"),
  length: z.number().int().positive("DELETE length must be > 0").max(100_000),
});

const ReplaceOperationSchema = BaseOperationSchema.extend({
  type: z.literal("REPLACE"),
  length: z.number().int().positive().max(100_000),
  content: z
    .string()
    .min(1)
    .max(SYNC_LIMITS.MAX_OPERATION_CONTENT_LENGTH),
});

const FormatOperationSchema = BaseOperationSchema.extend({
  type: z.literal("FORMAT"),
  length: z.number().int().positive().max(100_000),
  // Restrict attribute keys/values to prevent prototype pollution
  attributes: z.record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/),
    z.union([z.string().max(256), z.number(), z.boolean()])
  ),
});

export const OperationSchema = z.discriminatedUnion("type", [
  InsertOperationSchema,
  DeleteOperationSchema,
  ReplaceOperationSchema,
  FormatOperationSchema,
]);

// The VectorClock coming from the client
const VectorClockSchema = z.record(
  z.string().cuid(),
  z.number().int().nonnegative()
);

// ─────────────────────────────────────────────
// TOP-LEVEL SYNC PAYLOAD SCHEMA
// This is what POST /api/documents/[id]/sync receives
// ─────────────────────────────────────────────

export const SyncPayloadSchema = z.object({
  // The revision the client was at before these ops
  baseRevision: z.number().int().nonnegative(),

  // Client's vector clock
  vectorClock: VectorClockSchema,

  // Batched operations
  ops: z
    .array(OperationSchema)
    .min(1, "ops cannot be empty")
    .max(SYNC_LIMITS.MAX_OPS_PER_BATCH, `Too many ops in single batch`),

  // If the client wants a full-content resync after applying
  requestResync: z.boolean().optional().default(false),
});

export type SyncPayload = z.infer<typeof SyncPayloadSchema>;

// ─────────────────────────────────────────────
// SERVER SYNC RESPONSE
// ─────────────────────────────────────────────

export interface SyncResponse {
  ok: boolean;

  // New server revision after applying ops
  newRevision: number;

  // Any ops the server applied that the client doesn't have yet
  // (from other collaborators while client was offline)
  missingOps: Operation[];

  // Updated vector clock
  vectorClock: VectorClock;

  // Full resync content (only if requestResync=true or severe conflict)
  fullContent?: unknown;

  // Per-op results (some may be rejected)
  opResults: Array<{
    clientOpId: string;
    status: "APPLIED" | "REJECTED" | "ALREADY_APPLIED";
    reason?: string;
  }>;
}

// ─────────────────────────────────────────────
// SOCKET.IO EVENTS (typed)
// ─────────────────────────────────────────────

export interface ServerToClientEvents {
  "ops:broadcast": (data: {
    ops: Operation[];
    authorId: string;
    revision: number;
    vectorClock: VectorClock;
  }) => void;
  "presence:update": (data: {
    userId: string;
    name: string;
    cursor?: { position: number };
    status: "online" | "offline" | "idle";
  }) => void;
  "document:locked": (data: { reason: string }) => void;
  "sync:conflict": (data: { message: string; serverRevision: number }) => void;
}

export interface ClientToServerEvents {
  "ops:submit": (
    data: {
      documentId: string;
      ops: Operation[];
      baseRevision: number;
      vectorClock: VectorClock;
    },
    ack: (result: { ok: boolean; revision?: number; error?: string }) => void
  ) => void;
  "presence:cursor": (data: {
    documentId: string;
    position: number;
  }) => void;
  "room:join": (documentId: string) => void;
  "room:leave": (documentId: string) => void;
}
