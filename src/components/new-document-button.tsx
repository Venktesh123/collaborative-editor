// src/components/new-document-button.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface NewDocumentButtonProps {
  label?: string;
}

export function NewDocumentButton({ label = "New document" }: NewDocumentButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    setLoading(true);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled Document" }),
      });
      const data = await res.json();
      if (data.document?.id) {
        router.push(`/editor/${data.document.id}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleCreate}
      disabled={loading}
      data-testid="new-document-btn"
      className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium
        transition-opacity disabled:opacity-50"
      style={{ background: "var(--color-accent)", color: "white" }}
    >
      {loading ? (
        "Creating…"
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2v10M2 7h10" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
