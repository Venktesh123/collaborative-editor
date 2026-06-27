// src/lib/client/sync-manager.ts
// The client-side sync engine.
//
// Responsibilities:
//   1. Accept local ops → apply to local store immediately (optimistic)
//   2. Queue ops for server sync
//   3. When online: flush queue to server, apply missing ops from server
//   4. Handle conflicts returned by the server (missing ops = rebase)
//   5. Retry with exponential backoff on failure
//   6. Emit events so the UI can show sync status

import { EventEmitter } from "eventemitter3";
import type { Operation, VectorClock, DocumentContent } from "@/types/document";
import { applyOperations } from "@/lib/sync-engine/ot";
import { incrementClock, mergeClock } from "@/types/document";
import {
  saveDocumentLocally,
  getLocalDocument,
  enqueuePendingOp,
  getPendingOps,
  clearSyncedOps,
  updateSyncMeta,
  getSyncMeta,
  incrementRetryCount,
} from "./offline-store";
import type { SyncResponse } from "@/types/sync";

export type SyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error"
  | "conflict";

interface SyncManagerEvents {
  "status:change": (status: SyncStatus) => void;
  "ops:applied": (ops: Operation[]) => void;
  "revision:update": (revision: number) => void;
  "error": (err: Error) => void;
}

const MAX_RETRIES = 5;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;

export class SyncManager extends EventEmitter<SyncManagerEvents> {
  private documentId: string;
  private userId: string;
  private status: SyncStatus = "idle";
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;

  // In-memory state (mirrors IndexedDB, updated optimistically)
  private localRevision = 0;
  private localClock: VectorClock = {};
  private localText = "";

  constructor(documentId: string, userId: string) {
    super();
    this.documentId = documentId;
    this.userId = userId;
    this.setupNetworkListeners();
  }

  // ─────────────────────────────────────────────
  // INITIALIZATION
  // ─────────────────────────────────────────────

  async init(serverContent: DocumentContent, serverRevision: number, serverClock: VectorClock) {
    const local = await getLocalDocument(this.documentId);

    if (local && local.revision >= serverRevision) {
      // Local state is at least as fresh — use it
      this.localRevision = local.revision;
      this.localClock = local.vectorClock;
      this.localText = local.content.text ?? "";
    } else {
      // Server is ahead — use server state and persist it
      this.localRevision = serverRevision;
      this.localClock = serverClock;
      this.localText = serverContent.text ?? "";

      await saveDocumentLocally({
        id: this.documentId,
        title: "",
        content: serverContent,
        revision: serverRevision,
        vectorClock: serverClock,
        updatedAt: Date.now(),
        syncedAt: Date.now(),
      });
    }

    // If there are pending ops, kick off a sync
    const pending = await getPendingOps(this.documentId);
    if (pending.length > 0 && this.isOnline) {
      this.scheduleSyncFlush(500);
    }

    this.setStatus(pending.length > 0 ? "offline" : "synced");
    this.emit("revision:update", this.localRevision);
  }

  // ─────────────────────────────────────────────
  // APPLY LOCAL OP (optimistic, no network call)
  // ─────────────────────────────────────────────

  async applyLocalOp(op: Operation): Promise<void> {
    // 1. Update in-memory state optimistically
    this.localText = applyOperations(this.localText, [op]);
    this.localClock = incrementClock(this.localClock, this.userId);

    // 2. Persist to IndexedDB immediately
    await enqueuePendingOp(this.documentId, op);

    const local = await getLocalDocument(this.documentId);
    if (local) {
      await saveDocumentLocally({
        ...local,
        content: {
          ...local.content,
          text: this.localText,
          ops: [op],
          metadata: {
            wordCount: this.localText.split(/\s+/).filter(Boolean).length,
            charCount: this.localText.length,
            lastEditedBy: this.userId,
          },
        },
        vectorClock: this.localClock,
        updatedAt: Date.now(),
      });
    }

    this.setStatus("offline");

    // 3. Schedule a debounced sync if online
    if (this.isOnline) {
      this.scheduleSyncFlush(800); // debounce rapid typing
    }
  }

  // ─────────────────────────────────────────────
  // FLUSH PENDING OPS TO SERVER
  // ─────────────────────────────────────────────

  private scheduleSyncFlush(delayMs: number) {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.flushToServer(), delayMs);
  }

  async flushToServer(retryCount = 0): Promise<void> {
    if (this.isSyncing || !this.isOnline) return;

    const pending = await getPendingOps(this.documentId);
    if (pending.length === 0) {
      this.setStatus("synced");
      return;
    }

    this.isSyncing = true;
    this.setStatus("syncing");

    try {
      const ops = pending.map((p) => p.op);
      const meta = await getSyncMeta(this.documentId);
      const baseRevision = meta?.lastSyncedRevision ?? 0;

      const response = await fetch(
        `/api/documents/${this.documentId}/sync`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ops,
            baseRevision,
            vectorClock: this.localClock,
            requestResync: false,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new SyncError(error.error ?? "Sync failed", response.status);
      }

      const result: SyncResponse = await response.json();

      // 1. Update local revision and clock
      this.localRevision = result.newRevision;
      this.localClock = mergeClock(this.localClock, result.vectorClock);

      // 2. Apply any missing ops from the server (other users' changes)
      if (result.missingOps.length > 0) {
        // The server has already done OT rebase, so these apply cleanly
        this.localText = applyOperations(this.localText, result.missingOps);
        this.emit("ops:applied", result.missingOps);
      }

      // 3. Clear synced ops from the queue
      const syncedIds = ops.map((op) => op.clientOpId);
      await clearSyncedOps(this.documentId, syncedIds);
      await updateSyncMeta(this.documentId, result.newRevision);

      // 4. Update local document cache
      const local = await getLocalDocument(this.documentId);
      if (local) {
        await saveDocumentLocally({
          ...local,
          content: {
            ops: [],
            text: this.localText,
            metadata: {
              wordCount: this.localText.split(/\s+/).filter(Boolean).length,
              charCount: this.localText.length,
              lastEditedBy: this.userId,
            },
          },
          revision: result.newRevision,
          vectorClock: this.localClock,
          syncedAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      this.emit("revision:update", result.newRevision);
      this.setStatus("synced");
    } catch (err) {
      if (err instanceof SyncError && err.statusCode === 403) {
        // Permission error — don't retry
        this.setStatus("error");
        this.emit("error", err);
        return;
      }

      // Exponential backoff retry
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(
          BASE_RETRY_DELAY_MS * Math.pow(2, retryCount),
          MAX_RETRY_DELAY_MS
        );
        setTimeout(() => this.flushToServer(retryCount + 1), delay);
      } else {
        this.setStatus("error");
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      this.isSyncing = false;
    }
  }

  // ─────────────────────────────────────────────
  // RECEIVE REMOTE OPS (from WebSocket broadcast)
  // ─────────────────────────────────────────────

  applyRemoteOps(ops: Operation[], revision: number, clock: VectorClock): void {
    // These ops have already been OT-transformed by the server
    this.localText = applyOperations(this.localText, ops);
    this.localRevision = revision;
    this.localClock = mergeClock(this.localClock, clock);

    this.emit("ops:applied", ops);
    this.emit("revision:update", revision);
  }

  // ─────────────────────────────────────────────
  // NETWORK LISTENERS
  // ─────────────────────────────────────────────

  private setupNetworkListeners() {
    if (typeof window === "undefined") return;

    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  private handleOnline = () => {
    this.isOnline = true;
    this.setStatus("syncing");
    // Flush any accumulated offline ops
    this.flushToServer();
  };

  private handleOffline = () => {
    this.isOnline = false;
    this.setStatus("offline");
    if (this.syncTimer) clearTimeout(this.syncTimer);
  };

  // ─────────────────────────────────────────────
  // GETTERS
  // ─────────────────────────────────────────────

  getStatus(): SyncStatus { return this.status; }
  getRevision(): number { return this.localRevision; }
  getClock(): VectorClock { return this.localClock; }
  getText(): string { return this.localText; }
  getOnline(): boolean { return this.isOnline; }

  // ─────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────

  destroy() {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline);
      window.removeEventListener("offline", this.handleOffline);
    }
    this.removeAllListeners();
  }

  private setStatus(status: SyncStatus) {
    if (this.status !== status) {
      this.status = status;
      this.emit("status:change", status);
    }
  }
}

class SyncError extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
    this.name = "SyncError";
  }
}
