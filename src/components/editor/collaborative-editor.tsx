// src/components/editor/collaborative-editor.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { SyncManager } from "@/lib/client/sync-manager";
import { useCollabSocket } from "@/lib/client/use-socket";
import { SyncStatusBadge } from "@/components/editor/sync-status-badge";
import { PresenceAvatars } from "@/components/editor/presence-avatars";
import { VersionHistoryPanel } from "@/components/editor/version-history-panel";
import { CollaboratorsPanel } from "@/components/editor/collaborators-panel";
import { AiAssistButton } from "@/components/editor/ai-assist-button";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import type { DocumentDTO } from "@/types/document";
import type { Operation } from "@/types/document";
import type { SyncStatus } from "@/lib/client/sync-manager";

interface CollaborativeEditorProps {
  document: DocumentDTO;
  user: { id: string; name: string; email: string };
}

interface PresenceUser {
  userId: string;
  name: string;
  cursor?: { position: number };
  status: "online" | "offline" | "idle";
  color: string;
}

// Assign deterministic colors to collaborators
const PRESENCE_COLORS = [
  "#818cf8", "#34d399", "#fb923c", "#f472b6",
  "#60a5fa", "#a78bfa", "#facc15",
];

function getUserColor(userId: string): string {
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

export function CollaborativeEditor({ document, user }: CollaborativeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const syncManagerRef = useRef<SyncManager | null>(null);
  const isReadOnly = document.userRole === "VIEWER";

  // UI State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [revision, setRevision] = useState(document.revision);
  const [title, setTitle] = useState(document.title);
  const [presence, setPresence] = useState<Map<string, PresenceUser>>(new Map());
  const [showVersions, setShowVersions] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [wordCount, setWordCount] = useState(0);

  // ─────────────────────────────────────────────
  // SYNC MANAGER INIT
  // ─────────────────────────────────────────────

  useEffect(() => {
    const manager = new SyncManager(document.id, user.id);
    syncManagerRef.current = manager;

    manager.on("status:change", setSyncStatus);
    manager.on("revision:update", setRevision);
    manager.on("ops:applied", (ops) => {
      // Apply server ops to the editor DOM
      applyOpsToEditor(ops);
    });

    manager.init(document.content, document.revision, document.vectorClock).then(() => {
      // Seed editor with initial content
      if (editorRef.current && document.content.text) {
        editorRef.current.textContent = document.content.text;
        updateWordCount(document.content.text);
      }
    });

    return () => {
      manager.destroy();
      syncManagerRef.current = null;
    };
  }, [document.id]);

  // ─────────────────────────────────────────────
  // WEBSOCKET
  // ─────────────────────────────────────────────

  const { submitOps, sendCursorPosition } = useCollabSocket({
    documentId: document.id,
    onOpsReceived: (ops, rev, clock) => {
      syncManagerRef.current?.applyRemoteOps(ops, rev, clock);
    },
    onPresenceUpdate: (data) => {
      setPresence((prev) => {
        const next = new Map(prev);
        if (data.status === "offline") {
          next.delete(data.userId);
        } else {
          next.set(data.userId, {
            ...data,
            color: getUserColor(data.userId),
          });
        }
        return next;
      });
    },
    onConnectionChange: setIsConnected,
  });

  // ─────────────────────────────────────────────
  // EDITOR INPUT HANDLER
  // Converts DOM mutations into Operation objects
  // ─────────────────────────────────────────────

  const lastTextRef = useRef(document.content.text ?? "");

  const handleInput = useCallback(() => {
    if (isReadOnly || !editorRef.current || !syncManagerRef.current) return;

    const newText = editorRef.current.textContent ?? "";
    const oldText = lastTextRef.current;

    if (newText === oldText) return;

    // Compute the minimal diff (simple LCS-based diff for short edits)
    const op = computeOp(oldText, newText, user.id, syncManagerRef.current.getRevision());

    lastTextRef.current = newText;
    updateWordCount(newText);

    if (op) {
      syncManagerRef.current.applyLocalOp(op);

      // Fast-path: also submit via WebSocket for real-time collab
      if (isConnected) {
        submitOps(
          [op],
          syncManagerRef.current.getRevision() - 1,
          syncManagerRef.current.getClock()
        );
      }
    }
  }, [isReadOnly, isConnected, user.id]);

  // ─────────────────────────────────────────────
  // CURSOR TRACKING
  // ─────────────────────────────────────────────

  const handleSelectionChange = useCallback(() => {
    if (!editorRef.current || !isConnected) return;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      const position = getTextOffset(editorRef.current, range.startContainer, range.startOffset);
      sendCursorPosition(position);
    }
  }, [isConnected, sendCursorPosition]);

  useEffect(() => {
    document.addEventListener
      ? window.document.addEventListener("selectionchange", handleSelectionChange)
      : null;
    return () => window.document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  // ─────────────────────────────────────────────
  // TITLE SAVE (debounced)
  // ─────────────────────────────────────────────

  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(async () => {
      await fetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
    }, 800);
  }

  // ─────────────────────────────────────────────
  // RESTORE HANDLER (called from VersionHistoryPanel)
  // ─────────────────────────────────────────────

  const handleRestore = useCallback(async (versionId: string) => {
    const res = await fetch(`/api/documents/${document.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });

    if (res.ok) {
      const data = await res.json();
      if (editorRef.current && data.content?.text !== undefined) {
        editorRef.current.textContent = data.content.text;
        lastTextRef.current = data.content.text;
        updateWordCount(data.content.text);
        syncManagerRef.current?.applyRemoteOps(
          [data.restoreOp],
          data.newRevision,
          data.vectorClock
        );
      }
      setShowVersions(false);
    }
  }, [document.id]);

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  function applyOpsToEditor(ops: Operation[]) {
    if (!editorRef.current) return;
    // Only apply if the ops weren't originated locally
    // (local ops are applied optimistically, remote ops update text)
    const cursorPos = getCursorPosition();
    editorRef.current.textContent = syncManagerRef.current?.getText() ?? "";
    lastTextRef.current = editorRef.current.textContent;
    setCursorPosition(cursorPos);
  }

  function updateWordCount(text: string) {
    setWordCount(text.split(/\s+/).filter(Boolean).length);
  }

  function getCursorPosition(): number {
    if (!editorRef.current) return 0;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    return getTextOffset(editorRef.current, range.startContainer, range.startOffset);
  }

  function setCursorPosition(pos: number) {
    if (!editorRef.current) return;
    try {
      const range = window.document.createRange();
      const sel = window.getSelection();
      const textNode = editorRef.current.firstChild;
      if (textNode) {
        const clampedPos = Math.min(pos, textNode.textContent?.length ?? 0);
        range.setStart(textNode, clampedPos);
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    } catch { /* ignore cursor errors */ }
  }

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-base)" }}>
      {/* ── TOP BAR ── */}
      <header
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Back */}
        <a href="/dashboard" className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
          aria-label="Back to dashboard">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none"
            style={{ color: "var(--color-text-2)" }}>
            <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>

        {/* Title */}
        <input
          value={title}
          onChange={handleTitleChange}
          disabled={isReadOnly}
          className="flex-1 bg-transparent text-sm font-medium outline-none min-w-0
            disabled:cursor-default placeholder-neutral-600"
          style={{ color: "var(--color-text)" }}
          placeholder="Untitled Document"
          aria-label="Document title"
        />

        {/* Right side */}
        <div className="flex items-center gap-3 ml-auto shrink-0">
          <SyncStatusBadge
            status={syncStatus}
            isConnected={isConnected}
            revision={revision}
          />
          <PresenceAvatars presence={Array.from(presence.values())} currentUserId={user.id} />

          {!isReadOnly && (
            <AiAssistButton
              documentId={document.id}
              getContext={() => ({
                before: lastTextRef.current.slice(
                  Math.max(0, getCursorPosition() - 500),
                  getCursorPosition()
                ),
                after: lastTextRef.current.slice(
                  getCursorPosition(),
                  getCursorPosition() + 200
                ),
              })}
              onAccept={(text) => {
                if (!editorRef.current || !syncManagerRef.current) return;
                const pos = getCursorPosition();
                const op: Operation = {
                  type: "INSERT",
                  position: pos,
                  content: text,
                  clientOpId: uuidv4(),
                  baseRevision: syncManagerRef.current.getRevision(),
                  authorId: user.id,
                  timestamp: Date.now(),
                };
                const newText =
                  lastTextRef.current.slice(0, pos) + text + lastTextRef.current.slice(pos);
                editorRef.current.textContent = newText;
                lastTextRef.current = newText;
                syncManagerRef.current.applyLocalOp(op);
              }}
            />
          )}

          <button
            onClick={() => setShowVersions(true)}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: "var(--color-surface-2)",
              color: "var(--color-text-2)",
              border: "1px solid var(--color-border)",
            }}
            data-testid="version-history-btn"
          >
            History
          </button>

          {document.userRole === "OWNER" && (
            <button
              onClick={() => setShowCollaborators(true)}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: "var(--color-surface-2)",
                color: "var(--color-text-2)",
                border: "1px solid var(--color-border)",
              }}
            >
              Share
            </button>
          )}

          {/* Role badge */}
          {isReadOnly && (
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: "#1f1f1f", color: "#888" }}
              data-testid="role-badge"
            >
              Viewer
            </span>
          )}
        </div>
      </header>

      {/* ── TOOLBAR (only for editors) ── */}
      {!isReadOnly && (
        <EditorToolbar editorRef={editorRef} />
      )}

      {/* ── EDITOR BODY ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-[780px] mx-auto px-8 py-12">
          <div
            ref={editorRef}
            contentEditable={!isReadOnly}
            suppressContentEditableWarning
            onInput={handleInput}
            className="editor-content focus:outline-none"
            data-testid="editor-content"
            aria-label="Document content"
            aria-readonly={isReadOnly}
            spellCheck
          />
        </div>
      </main>

      {/* ── BOTTOM STATUS BAR ── */}
      <footer
        className="flex items-center justify-between px-6 py-2 border-t text-xs shrink-0"
        style={{
          background: "var(--color-surface)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-3)",
        }}
      >
        <span>{wordCount} words</span>
        <span>Rev {revision}</span>
      </footer>

      {/* ── PANELS ── */}
      {showVersions && (
        <VersionHistoryPanel
          documentId={document.id}
          canRestore={!isReadOnly}
          onRestore={handleRestore}
          onClose={() => setShowVersions(false)}
        />
      )}

      {showCollaborators && (
        <CollaboratorsPanel
          documentId={document.id}
          onClose={() => setShowCollaborators(false)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// DIFF HELPER: compute minimal op between two strings
// Uses a simple scan from both ends (good enough for keystroke-level diffs)
// ─────────────────────────────────────────────

function computeOp(
  oldText: string,
  newText: string,
  authorId: string,
  baseRevision: number
): Operation | null {
  if (oldText === newText) return null;

  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldText.length &&
    prefixLen < newText.length &&
    oldText[prefixLen] === newText[prefixLen]
  ) prefixLen++;

  // Find common suffix
  let oldSuffixStart = oldText.length;
  let newSuffixStart = newText.length;
  while (
    oldSuffixStart > prefixLen &&
    newSuffixStart > prefixLen &&
    oldText[oldSuffixStart - 1] === newText[newSuffixStart - 1]
  ) {
    oldSuffixStart--;
    newSuffixStart--;
  }

  const deleted = oldText.slice(prefixLen, oldSuffixStart);
  const inserted = newText.slice(prefixLen, newSuffixStart);

  const base = {
    clientOpId: uuidv4(),
    authorId,
    baseRevision,
    timestamp: Date.now(),
  };

  if (deleted.length === 0 && inserted.length > 0) {
    return { ...base, type: "INSERT", position: prefixLen, content: inserted };
  }
  if (deleted.length > 0 && inserted.length === 0) {
    return { ...base, type: "DELETE", position: prefixLen, length: deleted.length };
  }
  if (deleted.length > 0 && inserted.length > 0) {
    return { ...base, type: "REPLACE", position: prefixLen, length: deleted.length, content: inserted };
  }

  return null;
}

// Get flat text offset within a container
function getTextOffset(container: Node, node: Node, offset: number): number {
  const range = window.document.createRange();
  range.setStart(container, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}
