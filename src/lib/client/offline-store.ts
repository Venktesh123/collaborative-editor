// src/lib/client/offline-store.ts
// IndexedDB-backed local-first store using the 'idb' library.
//
// This is the CLIENT's primary source of truth when offline.
// Every edit goes here first, then gets synced to the server.
//
// Structure:
//   - documents store: cached document state
//   - pending_ops store: ops queued for server sync
//   - sync_meta store: revision / clock tracking per document

import { openDB, IDBPDatabase } from "idb";
import type { Operation, DocumentContent, VectorClock } from "@/types/document";

const DB_NAME = "collab-editor";
const DB_VERSION = 1;

interface DocumentRecord {
  id: string;
  title: string;
  content: DocumentContent;
  revision: number;
  vectorClock: VectorClock;
  updatedAt: number;
  syncedAt: number;
}

interface PendingOp {
  id: string; // clientOpId (UUID)
  documentId: string;
  op: Operation;
  createdAt: number;
  retryCount: number;
}

interface SyncMeta {
  documentId: string;
  lastSyncedRevision: number;
  lastSyncedAt: number;
  pendingCount: number;
}

type EditorDB = IDBPDatabase<{
  documents: {
    key: string;
    value: DocumentRecord;
  };
  pending_ops: {
    key: string;
    value: PendingOp;
    indexes: { "by-document": string };
  };
  sync_meta: {
    key: string;
    value: SyncMeta;
  };
}>;

let dbPromise: Promise<EditorDB> | null = null;

export function getDB(): Promise<EditorDB> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Documents cache
        if (!db.objectStoreNames.contains("documents")) {
          db.createObjectStore("documents", { keyPath: "id" });
        }

        // Pending ops queue
        if (!db.objectStoreNames.contains("pending_ops")) {
          const store = db.createObjectStore("pending_ops", { keyPath: "id" });
          store.createIndex("by-document", "documentId");
        }

        // Sync metadata
        if (!db.objectStoreNames.contains("sync_meta")) {
          db.createObjectStore("sync_meta", { keyPath: "documentId" });
        }
      },
    });
  }
  return dbPromise;
}

// ─────────────────────────────────────────────
// DOCUMENT CACHE
// ─────────────────────────────────────────────

export async function saveDocumentLocally(doc: DocumentRecord): Promise<void> {
  const db = await getDB();
  await db.put("documents", doc);
}

export async function getLocalDocument(id: string): Promise<DocumentRecord | undefined> {
  const db = await getDB();
  return db.get("documents", id);
}

export async function getAllLocalDocuments(): Promise<DocumentRecord[]> {
  const db = await getDB();
  return db.getAll("documents");
}

// ─────────────────────────────────────────────
// PENDING OPS QUEUE
// ─────────────────────────────────────────────

export async function enqueuePendingOp(
  documentId: string,
  op: Operation
): Promise<void> {
  const db = await getDB();
  await db.put("pending_ops", {
    id: op.clientOpId,
    documentId,
    op,
    createdAt: Date.now(),
    retryCount: 0,
  });

  // Update pending count in meta
  const meta = await db.get("sync_meta", documentId);
  await db.put("sync_meta", {
    documentId,
    lastSyncedRevision: meta?.lastSyncedRevision ?? 0,
    lastSyncedAt: meta?.lastSyncedAt ?? 0,
    pendingCount: (meta?.pendingCount ?? 0) + 1,
  });
}

export async function getPendingOps(documentId: string): Promise<PendingOp[]> {
  const db = await getDB();
  return db.getAllFromIndex("pending_ops", "by-document", documentId);
}

export async function clearSyncedOps(
  documentId: string,
  syncedOpIds: string[]
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(["pending_ops", "sync_meta"], "readwrite");

  for (const id of syncedOpIds) {
    await tx.objectStore("pending_ops").delete(id);
  }

  const meta = await tx.objectStore("sync_meta").get(documentId);
  if (meta) {
    await tx.objectStore("sync_meta").put({
      ...meta,
      pendingCount: Math.max(0, meta.pendingCount - syncedOpIds.length),
    });
  }

  await tx.done;
}

export async function incrementRetryCount(opId: string): Promise<void> {
  const db = await getDB();
  const op = await db.get("pending_ops", opId);
  if (op) {
    await db.put("pending_ops", { ...op, retryCount: op.retryCount + 1 });
  }
}

// ─────────────────────────────────────────────
// SYNC METADATA
// ─────────────────────────────────────────────

export async function getSyncMeta(documentId: string): Promise<SyncMeta | undefined> {
  const db = await getDB();
  return db.get("sync_meta", documentId);
}

export async function updateSyncMeta(
  documentId: string,
  revision: number
): Promise<void> {
  const db = await getDB();
  const existing = await db.get("sync_meta", documentId);
  await db.put("sync_meta", {
    documentId,
    lastSyncedRevision: revision,
    lastSyncedAt: Date.now(),
    pendingCount: existing?.pendingCount ?? 0,
  });
}

// ─────────────────────────────────────────────
// CLEAR (for logout / document deletion)
// ─────────────────────────────────────────────

export async function clearDocumentData(documentId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["documents", "pending_ops", "sync_meta"],
    "readwrite"
  );

  await tx.objectStore("documents").delete(documentId);

  const pendingKeys = await tx
    .objectStore("pending_ops")
    .index("by-document")
    .getAllKeys(documentId);
  for (const key of pendingKeys) {
    await tx.objectStore("pending_ops").delete(key);
  }

  await tx.objectStore("sync_meta").delete(documentId);
  await tx.done;
}

export type { DocumentRecord, PendingOp, SyncMeta };
