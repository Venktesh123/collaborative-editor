// src/components/sign-out-button.tsx
"use client";

import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="text-sm px-3 py-1.5 rounded-md transition-colors hover:bg-white/5"
      style={{ color: "var(--color-text-2)" }}
    >
      Sign out
    </button>
  );
}
