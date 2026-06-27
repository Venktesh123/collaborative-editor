// src/components/editor/sync-status-badge.tsx
"use client";

import type { SyncStatus } from "@/lib/client/sync-manager";

interface SyncStatusBadgeProps {
  status: SyncStatus;
  isConnected: boolean;
  revision: number;
}

const STATUS_CONFIG: Record<
  SyncStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  idle:     { label: "Ready",    color: "#888",     bg: "#1a1a1a", dot: "#555" },
  syncing:  { label: "Syncing…", color: "#60a5fa",  bg: "#0f1e30", dot: "#60a5fa" },
  synced:   { label: "Saved",    color: "#4ade80",  bg: "#0d2018", dot: "#4ade80" },
  offline:  { label: "Offline",  color: "#f59e0b",  bg: "#2a1f0a", dot: "#f59e0b" },
  error:    { label: "Error",    color: "#ef4444",  bg: "#2a0e0e", dot: "#ef4444" },
  conflict: { label: "Conflict", color: "#f97316",  bg: "#2a1500", dot: "#f97316" },
};

export function SyncStatusBadge({
  status,
  isConnected,
  revision,
}: SyncStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const showOffline = !isConnected && status !== "syncing";
  const displayStatus = showOffline ? "offline" : status;
  const display = STATUS_CONFIG[displayStatus];

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: display.bg,
        color: display.color,
        border: `1px solid ${display.color}22`,
      }}
      data-testid="connection-status"
      aria-live="polite"
      aria-label={`Sync status: ${display.label}`}
    >
      {/* Animated dot */}
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{
          background: display.dot,
          animation:
            displayStatus === "syncing"
              ? "pulse 1s ease-in-out infinite"
              : "none",
        }}
      />
      <span data-testid="sync-status">{display.label}</span>
      {status === "synced" && (
        <span style={{ color: display.color + "88", fontSize: "0.6rem" }}>
          r{revision}
        </span>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
