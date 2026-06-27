// src/components/editor/version-history-panel.tsx
"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "@/lib/utils";

interface Version {
  id: string;
  label: string | null;
  revision: number;
  createdAt: string;
  createdBy: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface VersionHistoryPanelProps {
  documentId: string;
  canRestore: boolean;
  onRestore: (versionId: string) => Promise<void>;
  onClose: () => void;
}

export function VersionHistoryPanel({
  documentId,
  canRestore,
  onRestore,
  onClose,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/documents/${documentId}/versions`)
      .then((r) => r.json())
      .then((d) => setVersions(d.versions ?? []))
      .finally(() => setLoading(false));
  }, [documentId]);

  async function handleCreateVersion() {
    setCreating(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel || undefined }),
      });
      const data = await res.json();
      if (data.version) {
        setVersions((v) => [data.version, ...v]);
        setNewLabel("");
        setShowCreateForm(false);
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRestore(versionId: string) {
    setRestoring(versionId);
    try {
      await onRestore(versionId);
    } finally {
      setRestoring(null);
      setConfirmRestore(null);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-80 flex flex-col overflow-hidden shadow-2xl"
        style={{
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
        }}
        role="dialog"
        aria-label="Version history"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold">Version History</h2>
          <div className="flex items-center gap-2">
            {canRestore && (
              <button
                onClick={() => setShowCreateForm((v) => !v)}
                className="text-xs px-2.5 py-1 rounded-md transition-colors"
                style={{
                  background: "var(--color-accent)",
                  color: "white",
                }}
                data-testid="create-version-btn"
              >
                + Save snapshot
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
              aria-label="Close version history"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
                style={{ color: "var(--color-text-2)" }}>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor"
                  strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Create form */}
        {showCreateForm && (
          <div
            className="px-5 py-3 border-b shrink-0"
            style={{
              background: "var(--color-surface-2)",
              borderColor: "var(--color-border)",
            }}
          >
            <input
              type="text"
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateVersion()}
              className="w-full px-3 py-1.5 rounded-md text-sm outline-none mb-2"
              style={{
                background: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text)",
              }}
              data-testid="version-label-input"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateVersion}
                disabled={creating}
                className="flex-1 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 transition-opacity"
                style={{ background: "var(--color-accent)", color: "white" }}
                data-testid="confirm-version-btn"
              >
                {creating ? "Saving…" : "Save"}
              </button>
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 rounded-md text-xs"
                style={{ background: "var(--color-border)", color: "var(--color-text-2)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Version list */}
        <div className="flex-1 overflow-y-auto" data-testid="version-list">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-sm" style={{ color: "var(--color-text-3)" }}>
                Loading…
              </span>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 px-5 text-center">
              <p className="text-sm" style={{ color: "var(--color-text-3)" }}>
                No snapshots yet
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-3)" }}>
                Save a snapshot to start tracking history
              </p>
            </div>
          ) : (
            <ul className="py-2">
              {versions.map((v, i) => (
                <li
                  key={v.id}
                  className="px-5 py-3 hover:bg-white/3 transition-colors"
                  style={{
                    borderBottom: i < versions.length - 1
                      ? "1px solid var(--color-border)"
                      : "none",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {v.label ?? `Revision ${v.revision}`}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-2)" }}>
                        {formatDistanceToNow(new Date(v.createdAt))} ·{" "}
                        {v.createdBy.name ?? v.createdBy.email}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--color-text-3)" }}>
                        r{v.revision}
                      </p>
                    </div>

                    {canRestore && (
                      <div className="shrink-0">
                        {confirmRestore === v.id ? (
                          <div className="flex flex-col gap-1">
                            <p className="text-xs text-center" style={{ color: "var(--color-warning)" }}>
                              Restore?
                            </p>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleRestore(v.id)}
                                disabled={restoring === v.id}
                                className="px-2 py-0.5 rounded text-xs font-medium disabled:opacity-50"
                                style={{ background: "var(--color-accent)", color: "white" }}
                                data-testid="confirm-restore-btn"
                              >
                                {restoring === v.id ? "…" : "Yes"}
                              </button>
                              <button
                                onClick={() => setConfirmRestore(null)}
                                className="px-2 py-0.5 rounded text-xs"
                                style={{
                                  background: "var(--color-border)",
                                  color: "var(--color-text-2)",
                                }}
                              >
                                No
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmRestore(v.id)}
                            className="text-xs px-2.5 py-1 rounded-md transition-colors hover:bg-white/5"
                            style={{ color: "var(--color-text-2)" }}
                            data-testid="restore-version-btn"
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
