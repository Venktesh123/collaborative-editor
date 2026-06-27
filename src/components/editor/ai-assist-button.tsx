// src/components/editor/ai-assist-button.tsx
"use client";

import { useState, useRef } from "react";

type AiMode = "continue" | "rephrase" | "expand" | "fix_grammar" | "summarize_selection";

interface AiAssistButtonProps {
  documentId: string;
  getContext: () => { before: string; after: string };
  onAccept: (text: string) => void;
}

export function AiAssistButton({
  documentId,
  getContext,
  onAccept,
}: AiAssistButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const [mode, setMode] = useState<AiMode>("continue");
  const abortRef = useRef<AbortController | null>(null);

  const MODES: { value: AiMode; label: string; icon: string }[] = [
    { value: "continue",  label: "Continue writing", icon: "→" },
    { value: "expand",    label: "Expand paragraph", icon: "↕" },
    { value: "rephrase",  label: "Rephrase selection", icon: "⇄" },
    { value: "fix_grammar", label: "Fix grammar",    icon: "✓" },
  ];

  async function fetchSuggestion(selectedMode: AiMode) {
    setMode(selectedMode);
    setLoading(true);
    setSuggestion("");

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { before, after } = getContext();
      const res = await fetch("/api/ai/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextBefore: before,
          contextAfter: after,
          mode: selectedMode,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setSuggestion("Could not get suggestion. Try again.");
        return;
      }

      // Stream the response
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        accumulated += chunk;
        setSuggestion(accumulated);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSuggestion("Something went wrong.");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleAccept() {
    if (suggestion) {
      onAccept(suggestion);
      setSuggestion("");
      setOpen(false);
    }
  }

  function handleDiscard() {
    abortRef.current?.abort();
    setSuggestion("");
    setLoading(false);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
        style={{
          background: open ? "var(--color-accent)" : "var(--color-surface-2)",
          color: open ? "white" : "var(--color-text-2)",
          border: "1px solid var(--color-border)",
        }}
        aria-label="AI writing assistant"
        aria-expanded={open}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1l1.2 2.5L10 4.5 7.5 7 8 10 6 8.5 4 10l.5-3L2 4.5l2.8-.9L6 1z"
            fill="currentColor"
          />
        </svg>
        AI
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-72 rounded-xl overflow-hidden shadow-2xl z-30"
          style={{
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
          }}
        >
          {/* Mode buttons */}
          <div
            className="p-2 border-b grid grid-cols-2 gap-1"
            style={{ borderColor: "var(--color-border)" }}
          >
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => fetchSuggestion(m.value)}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs
                  transition-colors text-left disabled:opacity-50"
                style={{
                  background:
                    mode === m.value && (loading || suggestion)
                      ? "var(--color-accent)" + "22"
                      : "transparent",
                  color:
                    mode === m.value && (loading || suggestion)
                      ? "var(--color-accent)"
                      : "var(--color-text-2)",
                  border:
                    mode === m.value && (loading || suggestion)
                      ? "1px solid var(--color-accent)44"
                      : "1px solid transparent",
                }}
              >
                <span style={{ fontFamily: "monospace" }}>{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>

          {/* Suggestion output */}
          {(loading || suggestion) && (
            <div className="p-3">
              <div
                className="text-sm rounded-lg p-3 min-h-[60px] max-h-[200px] overflow-y-auto"
                style={{
                  background: "var(--color-surface)",
                  color: loading && !suggestion ? "var(--color-text-3)" : "var(--color-text)",
                  border: "1px solid var(--color-border)",
                  whiteSpace: "pre-wrap",
                  lineHeight: "1.6",
                }}
              >
                {loading && !suggestion ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                ) : suggestion}
              </div>

              {suggestion && !loading && (
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleAccept}
                    className="flex-1 py-1.5 rounded-md text-xs font-medium transition-colors"
                    style={{ background: "var(--color-accent)", color: "white" }}
                  >
                    Insert
                  </button>
                  <button
                    onClick={() => setSuggestion("")}
                    className="px-3 py-1.5 rounded-md text-xs transition-colors"
                    style={{
                      background: "var(--color-border)",
                      color: "var(--color-text-2)",
                    }}
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleDiscard}
                    className="px-3 py-1.5 rounded-md text-xs transition-colors"
                    style={{
                      background: "var(--color-border)",
                      color: "var(--color-text-2)",
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          {!loading && !suggestion && (
            <div className="px-3 py-2">
              <p className="text-xs" style={{ color: "var(--color-text-3)" }}>
                Powered by Gemini · Context-aware suggestions
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
