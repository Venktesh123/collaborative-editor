// src/app/not-found.tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "var(--color-base)", color: "var(--color-text)" }}
    >
      <h1 className="text-6xl font-bold mb-4" style={{ color: "var(--color-accent)" }}>404</h1>
      <p className="text-xl mb-8" style={{ color: "var(--color-text-2)" }}>Page not found</p>
      <Link
        href="/dashboard"
        className="px-6 py-2 rounded-lg text-sm font-medium"
        style={{ background: "var(--color-accent)", color: "white" }}
      >
        Go to dashboard
      </Link>
    </div>
  );
}