// src/lib/client/sync-manager.ts
"use client";

import { EventEmitter } from "eventemitter3";
import type { Operation, VectorClock, DocumentContent } from "@/types/document";
import { mergeClock } from "@/types/document";
import {
  saveDocumentLocally,
  getLocalDocument,
  enqueuePendingOp,
  getPendingOps,
  clearSyncedOps,
  updateSyncMeta,
  getSyncMeta,
} from "./offline-store";
import type { SyncResponse } from "@/types/sync";

export type SyncStatus =
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

interface SyncManagerEvents {
  "status:change": (status: SyncStatus) => void;
  "remote:text": (text: string) => void;
  "revision:update": (revision: number) => void;
  "error": (err: Error) => void;
}

const MAX_RETRIES = 3;

export class SyncManager extends EventEmitter<SyncManagerEvents> {
  private documentId: string;
  private userId: string;
  private status: SyncStatus = "idle";
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private isSyncing = false;
  private isOnline =
    typeof navigator !== "undefined" ? navigator.onLine : true;

  private localRevision = 0;
  private localClock: VectorClock = {};

  // The text currently in the editor (set by editor on every keystroke)
  private localText = "";

  // IDs of ops WE created — never re-apply these from server
  private myOpIds = new Set<string>();

  constructor(documentId: string, userId: string) {
    super();
    this.documentId = documentId;
    this.userId = userId;
    this.setupNetworkListeners();
  }

  async init(
    serverContent: DocumentContent,
    serverRevision: number,
    serverClock: VectorClock
  ) {
    const local = await getLocalDocument(this.documentId);

    if (local && local.revision >= serverRevision) {
      this.localRevision = local.revision;
      this.localClock = local.vectorClock;
      this.localText = local.content.text ?? "";
    } else {
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

    const pending = await getPendingOps(this.documentId);
    if (pending.length > 0 && this.isOnline) {
      this.scheduleSyncFlush(2000);
    }

    this.setStatus(pending.length > 0 ? "offline" : "synced");
    this.emit("revision:update", this.localRevision);
    return this.localText;
  }

  // Editor calls this on every keystroke to keep us in sync
  setLocalText(text: string) {
    this.localText = text;
  }

  // Queue op for background HTTP sync — never modifies text
  async queueOp(op: Operation): Promise<void> {
    this.myOpIds.add(op.clientOpId);
    await enqueuePendingOp(this.documentId, op);
    this.setStatus("offline");
    if (this.isOnline) {
      // Long debounce — wait for user to pause typing
      this.scheduleSyncFlush(2000);
    }
  }

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
        throw new Error(error.error ?? "Sync failed");
      }

      const result: SyncResponse = await response.json();

      this.localRevision = result.newRevision;
      this.localClock = mergeClock(this.localClock, result.vectorClock);

      // Only process ops from OTHER users
      const remoteOnlyOps = result.missingOps.filter(
        (op) => !this.myOpIds.has(op.clientOpId)
      );

      if (remoteOnlyOps.length > 0) {
        // Another user edited while we were offline — apply their changes
        // We need to merge their text with ours
        // Simple approach: apply their ops on top of current local text
        let mergedText = this.localText;
        for (const op of remoteOnlyOps) {
          if (op.type === "INSERT") {
            const pos = Math.min(op.position, mergedText.length);
            mergedText = mergedText.slice(0, pos) + op.content + mergedText.slice(pos);
          } else if (op.type === "DELETE") {
            const pos = Math.min(op.position, mergedText.length);
            const end = Math.min(pos + op.length, mergedText.length);
            mergedText = mergedText.slice(0, pos) + mergedText.slice(end);
          } else if (op.type === "REPLACE") {
            const pos = Math.min(op.position, mergedText.length);
            const end = Math.min(pos + op.length, mergedText.length);
            mergedText = mergedText.slice(0, pos) + op.content + mergedText.slice(end);
          }
        }
        this.localText = mergedText;
        // Tell editor to update its DOM with merged text
        this.emit("remote:text", mergedText);
      }

      // Clear synced ops
      const syncedIds = ops.map((op) => op.clientOpId);
      await clearSyncedOps(this.documentId, syncedIds);
      await updateSyncMeta(this.documentId, result.newRevision);

      // Save to local cache
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
      if (retryCount < MAX_RETRIES) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 15000);
        setTimeout(() => this.flushToServer(retryCount + 1), delay);
      } else {
        this.setStatus("error");
        this.emit(
          "error",
          err instanceof Error ? err : new Error(String(err))
        );
      }
    } finally {
      this.isSyncing = false;
    }
  }

  // Called when WebSocket broadcasts ops from OTHER users
  applyRemoteOps(ops: Operation[], revision: number, clock: VectorClock): void {
    const remoteOps = ops.filter((op) => !this.myOpIds.has(op.clientOpId));
    if (remoteOps.length > 0) {
      let text = this.localText;
      for (const op of remoteOps) {
        if (op.type === "INSERT") {
          const pos = Math.min(op.position, text.length);
          text = text.slice(0, pos) + op.content + text.slice(pos);
        } else if (op.type === "DELETE") {
          const pos = Math.min(op.position, text.length);
          const end = Math.min(pos + op.length, text.length);
          text = text.slice(0, pos) + text.slice(end);
        } else if (op.type === "REPLACE") {
          const pos = Math.min(op.position, text.length);
          const end = Math.min(pos + op.length, text.length);
          text = text.slice(0, pos) + op.content + text.slice(end);
        }
      }
      this.localText = text;
      this.emit("remote:text", text);
    }
    this.localRevision = revision;
    this.localClock = mergeClock(this.localClock, clock);
    this.emit("revision:update", revision);
  }

  private setupNetworkListeners() {
    if (typeof window === "undefined") return;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
  }

  private handleOnline = () => {
    this.isOnline = true;
    this.setStatus("syncing");
    this.flushToServer();
  };

  private handleOffline = () => {
    this.isOnline = false;
    this.setStatus("offline");
    if (this.syncTimer) clearTimeout(this.syncTimer);
  };

  getStatus(): SyncStatus { return this.status; }
  getRevision(): number { return this.localRevision; }
  getClock(): VectorClock { return this.localClock; }
  getText(): string { return this.localText; }
  getOnline(): boolean { return this.isOnline; }

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