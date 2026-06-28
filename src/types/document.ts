// src/types/document.ts

export interface DocumentMetadata {
  wordCount: number;
  charCount: number;
  lastEditedBy?: string;
  [key: string]: unknown;
}

export interface DocumentContent {
  ops: Operation[];
  text: string;
  metadata: DocumentMetadata;
  [key: string]: unknown;  // Allows Prisma JsonValue assignment
}

// ── OPERATION TYPES ──────────────────────────────────────────────

export type OperationType = "INSERT" | "DELETE" | "REPLACE" | "FORMAT";

export interface BaseOperation {
  type: OperationType;
  position: number;
  clientOpId: string;
  baseRevision: number;
  authorId: string;
  timestamp: number;
  [key: string]: unknown;  // Allows Prisma JsonValue assignment
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

// ── VECTOR CLOCK ─────────────────────────────────────────────────

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

// ── DTOs ─────────────────────────────────────────────────────────

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