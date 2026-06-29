// src/app/error.tsx
"use client";

export default function Error({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "var(--color-base)", color: "var(--color-text)" }}
    >
      <h1 className="text-6xl font-bold mb-4" style={{ color: "#ef4444" }}>500</h1>
      <p className="text-xl mb-8" style={{ color: "var(--color-text-2)" }}>Something went wrong</p>
      <button
        onClick={reset}
        className="px-6 py-2 rounded-lg text-sm font-medium"
        style={{ background: "var(--color-accent)", color: "white" }}
      >
        Try again
      </button>
    </div>
  );
}