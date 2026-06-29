// src/components/editor/sync-status-badge.tsx
"use client";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error";

interface SyncStatusBadgeProps {
  status: SyncStatus;
  isConnected: boolean;
  revision: number;
}

const STATUS_CONFIG: Record<SyncStatus, { label: string; color: string; bg: string; dot: string }> = {
  idle:    { label: "Ready",    color: "#888",    bg: "#1a1a1a", dot: "#555" },
  syncing: { label: "Syncing…", color: "#60a5fa", bg: "#0f1e30", dot: "#60a5fa" },
  synced:  { label: "Saved",    color: "#4ade80", bg: "#0d2018", dot: "#4ade80" },
  offline: { label: "Offline",  color: "#f59e0b", bg: "#2a1f0a", dot: "#f59e0b" },
  error:   { label: "Error",    color: "#ef4444", bg: "#2a0e0e", dot: "#ef4444" },
};

export function SyncStatusBadge({ status, isConnected, revision }: SyncStatusBadgeProps) {
  const displayStatus = !isConnected && status !== "syncing" ? "offline" : status;
  const cfg = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.idle;

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}22` }}
      data-testid="connection-status"
      aria-live="polite"
      aria-label={`Sync status: ${cfg.label}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          background: cfg.dot,
          animation: displayStatus === "syncing" ? "pulse 1s ease-in-out infinite" : "none",
        }}
      />
      <span data-testid="sync-status">{cfg.label}</span>
      {status === "synced" && (
        <span style={{ color: cfg.color + "88", fontSize: "0.6rem" }}>r{revision}</span>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.8)} }`}</style>
    </div>
  );
}