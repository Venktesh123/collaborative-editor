// src/components/editor/collaborators-panel.tsx
"use client";

import { useEffect, useState } from "react";

interface Collaborator {
  id: string;
  userId: string;
  role: "OWNER" | "EDITOR" | "VIEWER";
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
  };
}

interface CollaboratorsPanelProps {
  documentId: string;
  onClose: () => void;
}

export function CollaboratorsPanel({ documentId, onClose }: CollaboratorsPanelProps) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "VIEWER">("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");

  useEffect(() => {
    fetch(`/api/documents/${documentId}/collaborators`)
      .then((r) => r.json())
      .then((d) => setCollaborators(d.collaborators ?? []))
      .finally(() => setLoading(false));
  }, [documentId]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setInviteError("");

    try {
      const res = await fetch(`/api/documents/${documentId}/collaborators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();

      if (!res.ok) {
        setInviteError(data.error ?? "Failed to add collaborator");
      } else {
        setCollaborators((prev) => {
          const exists = prev.find((c) => c.id === data.collaborator.id);
          if (exists) return prev.map((c) => c.id === data.collaborator.id ? data.collaborator : c);
          return [...prev, data.collaborator];
        });
        setInviteEmail("");
      }
    } finally {
      setInviting(false);
    }
  }

  async function handleUpdateRole(userId: string, role: "EDITOR" | "VIEWER") {
    const res = await fetch(`/api/documents/${documentId}/collaborators`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role }),
    });
    if (res.ok) {
      setCollaborators((prev) =>
        prev.map((c) => (c.userId === userId ? { ...c, role } : c))
      );
    }
  }

  async function handleRemove(userId: string) {
    const res = await fetch(`/api/documents/${documentId}/collaborators`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      setCollaborators((prev) => prev.filter((c) => c.userId !== userId));
    }
  }

  const roleColor = (role: string) => {
    if (role === "OWNER") return { color: "#a5b4fc", bg: "#1e1b4b" };
    if (role === "EDITOR") return { color: "#4ade80", bg: "#14291f" };
    return { color: "#888", bg: "#1f1f1f" };
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-80 flex flex-col overflow-hidden shadow-2xl"
        style={{
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
        }}
        role="dialog"
        aria-label="Share document"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold">Share document</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-white/5 transition-colors"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
              style={{ color: "var(--color-text-2)" }}>
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Invite form */}
        <div
          className="px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <form onSubmit={handleInvite} className="space-y-3">
            <div>
              <label className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-text-2)" }}>
                Invite by email
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                className="w-full px-3 py-1.5 rounded-md text-sm outline-none"
                style={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              />
            </div>
            <div className="flex gap-2">
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "EDITOR" | "VIEWER")}
                className="flex-1 px-2 py-1.5 rounded-md text-sm outline-none"
                style={{
                  background: "var(--color-surface-2)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text)",
                }}
              >
                <option value="EDITOR">Editor</option>
                <option value="VIEWER">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={inviting}
                className="px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-50"
                style={{ background: "var(--color-accent)", color: "white" }}
              >
                {inviting ? "…" : "Invite"}
              </button>
            </div>
            {inviteError && (
              <p className="text-xs" style={{ color: "var(--color-error)" }}>
                {inviteError}
              </p>
            )}
          </form>
        </div>

        {/* Collaborator list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-20">
              <span className="text-sm" style={{ color: "var(--color-text-3)" }}>Loading…</span>
            </div>
          ) : (
            <ul className="py-2">
              {collaborators.map((c) => {
                const rc = roleColor(c.role);
                const isOwner = c.role === "OWNER";
                return (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-white/3 transition-colors"
                  >
                    {/* Avatar */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0"
                      style={{ background: rc.bg, color: rc.color }}
                      aria-hidden="true"
                    >
                      {(c.user.name ?? c.user.email).charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {c.user.name ?? c.user.email}
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--color-text-2)" }}>
                        {c.user.email}
                      </p>
                    </div>

                    {/* Role control */}
                    {isOwner ? (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
                        style={{ background: rc.bg, color: rc.color }}
                      >
                        Owner
                      </span>
                    ) : (
                      <div className="flex items-center gap-1 shrink-0">
                        <select
                          value={c.role}
                          onChange={(e) =>
                            handleUpdateRole(c.userId, e.target.value as "EDITOR" | "VIEWER")
                          }
                          className="text-xs px-1.5 py-0.5 rounded outline-none"
                          style={{
                            background: rc.bg,
                            color: rc.color,
                            border: "none",
                          }}
                          aria-label={`${c.user.name ?? c.user.email}'s role`}
                        >
                          <option value="EDITOR">Editor</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        <button
                          onClick={() => handleRemove(c.userId)}
                          className="p-1 rounded hover:bg-white/5 transition-colors"
                          aria-label={`Remove ${c.user.name ?? c.user.email}`}
                          title="Remove"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                            style={{ color: "var(--color-text-3)" }}>
                            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor"
                              strokeWidth="1.5" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Roles legend */}
        <div
          className="px-5 py-3 border-t shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p className="text-xs" style={{ color: "var(--color-text-3)" }}>
            <span className="font-medium" style={{ color: "var(--color-text-2)" }}>Editors</span>
            {" "}can view and edit.{" "}
            <span className="font-medium" style={{ color: "var(--color-text-2)" }}>Viewers</span>
            {" "}can only read.
          </p>
        </div>
      </aside>
    </>
  );
}
