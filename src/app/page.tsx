// src/app/page.tsx
// Landing home page — shown at http://localhost:3000

import Link from "next/link";

export default function HomePage() {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--color-base)", color: "var(--color-text)" }}
    >
      {/* NAV */}
      <nav
        className="flex items-center justify-between px-8 py-5 border-b"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-xl font-bold tracking-tight">
          Collab<span style={{ color: "var(--color-accent)" }}>doc</span>
        </span>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--color-text-2)" }}
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm px-4 py-2 rounded-lg font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--color-accent)", color: "white" }}
          >
            Get started free
          </Link>
        </div>
      </nav>

      {/* HERO */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center py-24">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium mb-8"
          style={{
            background: "#6366f118",
            color: "var(--color-accent)",
            border: "1px solid #6366f130",
          }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--color-accent)" }} />
          Local-first · Real-time · Offline sync
        </div>

        <h1
          className="text-5xl md:text-6xl font-bold tracking-tight mb-6 max-w-3xl leading-tight"
          style={{ color: "white" }}
        >
          Write together,{" "}
          <span style={{ color: "var(--color-accent)" }}>even offline</span>
        </h1>

        <p
          className="text-lg max-w-xl mb-10 leading-relaxed"
          style={{ color: "var(--color-text-2)" }}
        >
          A collaborative document editor that works without internet.
          Changes sync automatically when you reconnect — no data loss, ever.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <Link
            href="/register"
            className="px-8 py-3 rounded-xl text-base font-semibold hover:opacity-90 w-full sm:w-auto text-center"
            style={{ background: "var(--color-accent)", color: "white" }}
          >
            Create free account
          </Link>
          <Link
            href="/login"
            className="px-8 py-3 rounded-xl text-base font-medium hover:bg-white/5 w-full sm:w-auto text-center"
            style={{ color: "var(--color-text-2)", border: "1px solid var(--color-border)" }}
          >
            Sign in
          </Link>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-20 max-w-3xl w-full text-left">
          {[
            { icon: "⚡", title: "Real-time collaboration", desc: "See other users' cursors and edits instantly via WebSocket." },
            { icon: "📴", title: "Works offline", desc: "Edit without internet. Changes queue locally and sync when back online." },
            { icon: "🕐", title: "Version history", desc: "Save snapshots and restore any previous version safely." },
            { icon: "🔒", title: "Role-based access", desc: "Owner, Editor, Viewer roles. Viewers can never push edits." },
            { icon: "🤖", title: "AI writing assistant", desc: "Continue writing, rephrase, or fix grammar powered by Gemini." },
            { icon: "🔀", title: "Conflict resolution", desc: "Operational Transform merges concurrent edits without data loss." },
          ].map((f) => (
            <div
              key={f.title}
              className="p-5 rounded-xl"
              style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
            >
              <div className="text-2xl mb-3">{f.icon}</div>
              <h3 className="text-sm font-semibold mb-1.5" style={{ color: "white" }}>{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-2)" }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer
        className="text-center py-6 text-xs border-t"
        style={{ color: "var(--color-text-3)", borderColor: "var(--color-border)" }}
      >
        Built for House of Edtech Assignment · Next.js · PostgreSQL · Socket.IO · OT
      </footer>
    </div>
  );
}