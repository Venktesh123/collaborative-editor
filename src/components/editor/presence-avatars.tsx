// src/components/editor/presence-avatars.tsx
"use client";

interface PresenceUser {
  userId: string;
  name: string;
  status: "online" | "offline" | "idle";
  color: string;
}

interface PresenceAvatarsProps {
  presence: PresenceUser[];
  currentUserId: string;
}

export function PresenceAvatars({ presence, currentUserId }: PresenceAvatarsProps) {
  const others = presence.filter(
    (p) => p.userId !== currentUserId && p.status !== "offline"
  );

  if (others.length === 0) return null;

  const visible = others.slice(0, 4);
  const overflow = others.length - visible.length;

  return (
    <div
      className="flex items-center"
      aria-label={`${others.length} other ${others.length === 1 ? "person" : "people"} editing`}
    >
      <div className="flex -space-x-2">
        {visible.map((user) => (
          <div
            key={user.userId}
            title={user.name}
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs
              font-semibold ring-2 shrink-0 select-none"
            style={{
              background: user.color + "33",
              color: user.color,
              ringColor: "var(--color-base)",
              border: `2px solid var(--color-base)`,
            }}
            aria-hidden="true"
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        ))}
        {overflow > 0 && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs
              font-semibold ring-2 shrink-0"
            style={{
              background: "var(--color-surface-2)",
              color: "var(--color-text-2)",
              border: "2px solid var(--color-base)",
            }}
            aria-label={`+${overflow} more`}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
