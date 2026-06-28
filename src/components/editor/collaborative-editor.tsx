"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { useCollabSocket } from "@/lib/client/use-socket";
import { SyncStatusBadge } from "@/components/editor/sync-status-badge";
import { PresenceAvatars } from "@/components/editor/presence-avatars";
import { VersionHistoryPanel } from "@/components/editor/version-history-panel";
import { CollaboratorsPanel } from "@/components/editor/collaborators-panel";
import { AiAssistButton } from "@/components/editor/ai-assist-button";
import { EditorToolbar } from "@/components/editor/editor-toolbar";
import type { DocumentDTO } from "@/types/document";
import type { Operation } from "@/types/document";

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

type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

const PRESENCE_COLORS = ["#818cf8","#34d399","#fb923c","#f472b6","#60a5fa","#a78bfa","#facc15"];
function getUserColor(userId: string): string {
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

export function CollaborativeEditor({ document, user }: CollaborativeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isReadOnly = document.userRole === "VIEWER";

  // Flags
  const isSettingText = useRef(false);  // true when WE set the DOM
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // State
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("synced");
  const [title, setTitle] = useState(document.title);
  const [revision, setRevision] = useState(document.revision);
  const [wordCount, setWordCount] = useState(0);
  const [presence, setPresence] = useState<Map<string, PresenceUser>>(new Map());
  const [showVersions, setShowVersions] = useState(false);
  const [showCollaborators, setShowCollaborators] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  // The text we last saved to server (for change detection)
  const savedTextRef = useRef("");
  // My own op IDs sent via WebSocket — ignore echoes
  const myOpIds = useRef(new Set<string>());

  function updateWordCount(text: string) {
    setWordCount(text.split(/\s+/).filter(Boolean).length);
  }

  function getCursorPosition(): number {
    if (!editorRef.current) return 0;
    try {
      const sel = window.getSelection();
      if (!sel?.rangeCount) return 0;
      const range = sel.getRangeAt(0);
      return getTextOffset(editorRef.current, range.startContainer, range.startOffset);
    } catch { return 0; }
  }

  // Safely set editor text from outside (remote changes, restore)
  // Saves and restores cursor position
  function setEditorText(newText: string) {
    if (!editorRef.current) return;
    if (editorRef.current.textContent === newText) return;
    const cursorPos = getCursorPosition();
    isSettingText.current = true;
    editorRef.current.textContent = newText;
    updateWordCount(newText);
    try {
      const sel = window.getSelection();
      const textNode = editorRef.current.firstChild;
      if (sel && textNode) {
        const range = window.document.createRange();
        range.setStart(textNode, Math.min(cursorPos, newText.length));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch {}
    requestAnimationFrame(() => { isSettingText.current = false; });
  }

  // Load initial content from server
  useEffect(() => {
    if (!editorRef.current) return;
    const text = document.content?.text ?? "";
    isSettingText.current = true;
    editorRef.current.textContent = text;
    savedTextRef.current = text;
    updateWordCount(text);
    requestAnimationFrame(() => { isSettingText.current = false; });
  }, [document.id]);

  // ── SAVE: send full text to server ──────────────────────────────
  // Simple, reliable, no OT corruption
  async function saveFullText(text: string) {
    if (text === savedTextRef.current) {
      setSyncStatus("synced");
      return;
    }
    setSyncStatus("syncing");
    try {
      const res = await fetch(`/api/documents/${document.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        savedTextRef.current = text;
        if (data.revision) setRevision(data.revision);
        setSyncStatus("synced");
      } else {
        setSyncStatus("error");
      }
    } catch {
      setSyncStatus("error");
    }
  }

  // ── WEBSOCKET: send ops for real-time collab ─────────────────────
  const { submitOps, sendCursorPosition } = useCollabSocket({
    documentId: document.id,

    // Remote user edited — apply their op to our editor
    onOpsReceived: (ops, rev, clock) => {
      if (!editorRef.current) return;

      // Filter out our own ops (echo prevention)
      const remoteOps = ops.filter(op => !myOpIds.current.has(op.clientOpId));
      if (remoteOps.length === 0) return;

      // Apply remote ops to current editor text
      let text = editorRef.current.textContent ?? "";
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

      setEditorText(text);
      savedTextRef.current = text;
      if (rev) setRevision(rev);
    },

    onPresenceUpdate: (data) => {
      setPresence(prev => {
        const next = new Map(prev);
        if (data.status === "offline") {
          next.delete(data.userId);
        } else {
          next.set(data.userId, { ...data, color: getUserColor(data.userId) });
        }
        return next;
      });
    },

    onConnectionChange: (connected) => {
      setIsConnected(connected);
      if (!connected) setSyncStatus("offline");
      else setSyncStatus("synced");
    },
  });

  // ── INPUT HANDLER ────────────────────────────────────────────────
  // Browser already updated the DOM — we just read it and:
  // 1. Send op via WebSocket for real-time collab
  // 2. Schedule full-text save for reliability
  const handleInput = useCallback(() => {
    if (isSettingText.current || isReadOnly || !editorRef.current) return;

    const newText = editorRef.current.textContent ?? "";
    const oldText = savedTextRef.current;

    updateWordCount(newText);
    setSyncStatus("offline");

    // Build op from diff for WebSocket real-time broadcast
    const op = buildOp(oldText, newText, user.id, revision);
    if (op && isConnected) {
      myOpIds.current.add(op.clientOpId);
      submitOps([op], revision, {});
    }

    // Debounced full-text HTTP save — this is what actually persists
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveFullText(newText), 1500);
  }, [isReadOnly, isConnected, revision, user.id]);

  // Cursor tracking for presence
  const handleSelectionChange = useCallback(() => {
    if (!editorRef.current || !isConnected) return;
    const sel = window.getSelection();
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      sendCursorPosition(getTextOffset(editorRef.current, range.startContainer, range.startOffset));
    }
  }, [isConnected, sendCursorPosition]);

  useEffect(() => {
    window.document.addEventListener("selectionchange", handleSelectionChange);
    return () => window.document.removeEventListener("selectionchange", handleSelectionChange);
  }, [handleSelectionChange]);

  // Title save
  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const newTitle = e.target.value;
    setTitle(newTitle);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      await fetch(`/api/documents/${document.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle }),
      });
    }, 800);
  }

  // Version restore
  const handleRestore = useCallback(async (versionId: string) => {
    const res = await fetch(`/api/documents/${document.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.content?.text !== undefined) {
        setEditorText(data.content.text);
        savedTextRef.current = data.content.text;
        if (data.newRevision) setRevision(data.newRevision);
      }
      setShowVersions(false);
    }
  }, [document.id]);

  return (
    <div className="flex flex-col h-screen" style={{ background: "var(--color-base)" }}>
      <header
        className="flex items-center gap-3 px-4 py-2 border-b shrink-0"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
      >
        <a href="/dashboard" className="p-1.5 rounded-md hover:bg-white/5 transition-colors" aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ color: "var(--color-text-2)" }}>
            <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>

        <input
          value={title}
          onChange={handleTitleChange}
          disabled={isReadOnly}
          className="flex-1 bg-transparent text-sm font-medium outline-none min-w-0 disabled:cursor-default"
          style={{ color: "var(--color-text)" }}
          placeholder="Untitled Document"
          aria-label="Document title"
        />

        <div className="flex items-center gap-3 ml-auto shrink-0">
          <SyncStatusBadge status={syncStatus} isConnected={isConnected} revision={revision} />
          <PresenceAvatars presence={Array.from(presence.values())} currentUserId={user.id} />

          {!isReadOnly && (
            <AiAssistButton
              documentId={document.id}
              getContext={() => ({
                before: (editorRef.current?.textContent ?? "").slice(Math.max(0, getCursorPosition() - 500), getCursorPosition()),
                after: (editorRef.current?.textContent ?? "").slice(getCursorPosition(), getCursorPosition() + 200),
              })}
              onAccept={(text) => {
                if (!editorRef.current) return;
                const pos = getCursorPosition();
                const current = editorRef.current.textContent ?? "";
                const newText = current.slice(0, pos) + text + current.slice(pos);
                setEditorText(newText);
                saveFullText(newText);
              }}
            />
          )}

          <button
            onClick={() => setShowVersions(true)}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ background: "var(--color-surface-2)", color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}
            data-testid="version-history-btn"
          >
            History
          </button>

          {document.userRole === "OWNER" && (
            <button
              onClick={() => setShowCollaborators(true)}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{ background: "var(--color-surface-2)", color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}
            >
              Share
            </button>
          )}

          {isReadOnly && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "#1f1f1f", color: "#888" }} data-testid="role-badge">
              Viewer
            </span>
          )}
        </div>
      </header>

      {!isReadOnly && <EditorToolbar editorRef={editorRef} />}

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
            spellCheck
            style={{ minHeight: "60vh", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: "1.8" }}
          />
        </div>
      </main>

      <footer
        className="flex items-center justify-between px-6 py-2 border-t text-xs shrink-0"
        style={{ background: "var(--color-surface)", borderColor: "var(--color-border)", color: "var(--color-text-3)" }}
      >
        <span>{wordCount} words</span>
        <span>Rev {revision}</span>
      </footer>

      {showVersions && (
        <VersionHistoryPanel documentId={document.id} canRestore={!isReadOnly} onRestore={handleRestore} onClose={() => setShowVersions(false)} />
      )}
      {showCollaborators && (
        <CollaboratorsPanel documentId={document.id} onClose={() => setShowCollaborators(false)} />
      )}
    </div>
  );
}

function buildOp(oldText: string, newText: string, authorId: string, baseRevision: number): Operation | null {
  if (oldText === newText) return null;
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (oldEnd > start && newEnd > start && oldText[oldEnd - 1] === newText[newEnd - 1]) { oldEnd--; newEnd--; }
  const removed = oldText.slice(start, oldEnd);
  const added = newText.slice(start, newEnd);
  const base = { clientOpId: uuidv4(), authorId, baseRevision, timestamp: Date.now() };
  if (removed.length === 0 && added.length > 0) return { ...base, type: "INSERT", position: start, content: added };
  if (removed.length > 0 && added.length === 0) return { ...base, type: "DELETE", position: start, length: removed.length };
  if (removed.length > 0 && added.length > 0) return { ...base, type: "REPLACE", position: start, length: removed.length, content: added };
  return null;
}

function getTextOffset(container: Node, node: Node, offset: number): number {
  try {
    const range = window.document.createRange();
    range.setStart(container, 0);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch { return 0; }
}