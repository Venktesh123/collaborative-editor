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

      {/* ── FOOTER ── */}
      <footer
        className="text-center py-6 text-xs border-t"
        style={{
          color: "var(--color-text-3)",
          borderColor: "var(--color-border)",
        }}
      >
        <p className="mb-2">
          Built for House of Edtech Assignment · Next.js · PostgreSQL · Socket.IO · OT
        </p>
        <div className="flex items-center justify-center gap-4">
          <a
            href="https://github.com/Venktesh123"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            style={{ color: "var(--color-text-2)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            Venktesh123
          </a>
          <span style={{ color: "var(--color-text-3)" }}>·</span>
          <a
            href="https://www.linkedin.com/in/venktesh-kumar-misra-427160202/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            style={{ color: "var(--color-text-2)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
            Venktesh Kumar Misra
          </a>
        </div>
      </footer>
    </div>
  );
}