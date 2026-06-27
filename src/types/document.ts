// src/types/document.ts
// Core document and operation types shared across frontend and backend

export interface DocumentContent {
  ops: Operation[];
  text: string;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  wordCount: number;
  charCount: number;
  lastEditedBy?: string;
}

// ─────────────────────────────────────────────
// OPERATION TRANSFORM TYPES
// ─────────────────────────────────────────────

export type OperationType = "INSERT" | "DELETE" | "REPLACE" | "FORMAT";

export interface BaseOperation {
  type: OperationType;
  position: number;
  // Client-generated UUID for idempotency
  clientOpId: string;
  // Revision the client was at when this op was created
  baseRevision: number;
  authorId: string;
  timestamp: number;
}

export interface InsertOperation extends BaseOperation {
  type: "INSERT";
  content: string;
}

export interface DeleteOperation extends BaseOperation {
  type: "DELETE";
  length: number;
}

export interface ReplaceOperation extends BaseOperation {
  type: "REPLACE";
  length: number;
  content: string;
}

export interface FormatOperation extends BaseOperation {
  type: "FORMAT";
  length: number;
  attributes: Record<string, unknown>;
}

export type Operation =
  | InsertOperation
  | DeleteOperation
  | ReplaceOperation
  | FormatOperation;

// ─────────────────────────────────────────────
// VECTOR CLOCK
// ─────────────────────────────────────────────

// Maps userId -> logical clock value
export type VectorClock = Record<string, number>;

export function incrementClock(clock: VectorClock, userId: string): VectorClock {
  return { ...clock, [userId]: (clock[userId] ?? 0) + 1 };
}

export function mergeClock(a: VectorClock, b: VectorClock): VectorClock {
  const merged: VectorClock = { ...a };
  for (const [userId, ts] of Object.entries(b)) {
    merged[userId] = Math.max(merged[userId] ?? 0, ts);
  }
  return merged;
}

// Returns true if a happened-before b
export function happenedBefore(a: VectorClock, b: VectorClock): boolean {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let atLeastOneLess = false;
  for (const k of allKeys) {
    const av = a[k] ?? 0;
    const bv = b[k] ?? 0;
    if (av > bv) return false;
    if (av < bv) atLeastOneLess = true;
  }
  return atLeastOneLess;
}

// ─────────────────────────────────────────────
// DOCUMENT DTO (what the API returns)
// ─────────────────────────────────────────────

export interface DocumentDTO {
  id: string;
  title: string;
  content: DocumentContent;
  revision: number;
  vectorClock: VectorClock;
  ownerId: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  userRole: "OWNER" | "EDITOR" | "VIEWER";
}

export interface DocumentVersionDTO {
  id: string;
  documentId: string;
  label?: string;
  revision: number;
  snapshot: DocumentContent;
  createdById: string;
  createdAt: string;
}

export interface CollaboratorDTO {
  id: string;
  userId: string;
  documentId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
}
