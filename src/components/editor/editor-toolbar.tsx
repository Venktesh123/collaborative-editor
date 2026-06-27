// src/components/editor/editor-toolbar.tsx
"use client";

import type { RefObject } from "react";

interface EditorToolbarProps {
  editorRef: RefObject<HTMLDivElement | null>;
}

interface ToolbarAction {
  label: string;
  icon: string;
  action: () => void;
  shortcut?: string;
}

export function EditorToolbar({ editorRef }: EditorToolbarProps) {
  function insertAtCursor(text: string) {
    const editor = editorRef.current;
    if (!editor) return;

    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(window.document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);

    // Trigger input event so sync manager picks up the change
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  function wrapSelection(before: string, after: string) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    const selected = sel.toString();
    insertAtCursor(`${before}${selected}${after}`);
  }

  const actions: ToolbarAction[] = [
    {
      label: "Bold",
      shortcut: "Ctrl+B",
      icon: "B",
      action: () => wrapSelection("**", "**"),
    },
    {
      label: "Italic",
      shortcut: "Ctrl+I",
      icon: "I",
      action: () => wrapSelection("_", "_"),
    },
    {
      label: "Heading",
      icon: "H₁",
      action: () => insertAtCursor("\n## "),
    },
    {
      label: "Bullet list",
      icon: "•—",
      action: () => insertAtCursor("\n- "),
    },
    {
      label: "Numbered list",
      icon: "1.",
      action: () => insertAtCursor("\n1. "),
    },
    {
      label: "Code block",
      icon: "</>",
      action: () => wrapSelection("\n```\n", "\n```\n"),
    },
    {
      label: "Horizontal rule",
      icon: "———",
      action: () => insertAtCursor("\n\n---\n\n"),
    },
  ];

  return (
    <div
      className="flex items-center gap-0.5 px-4 py-1.5 border-b overflow-x-auto"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
      role="toolbar"
      aria-label="Formatting toolbar"
    >
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={action.action}
          title={`${action.label}${action.shortcut ? ` (${action.shortcut})` : ""}`}
          aria-label={action.label}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors
            hover:bg-white/5 active:bg-white/10 shrink-0"
          style={{
            color: "var(--color-text-2)",
            fontFamily:
              action.icon === "</>"
                ? "var(--font-mono)"
                : action.icon === "I"
                ? "Georgia, serif"
                : "inherit",
            fontStyle: action.icon === "I" ? "italic" : "normal",
            fontWeight: action.icon === "B" ? "700" : "500",
            letterSpacing: action.icon === "B" ? "0.02em" : "normal",
          }}
        >
          {action.icon}
        </button>
      ))}

      <div
        className="w-px h-4 mx-1 shrink-0"
        style={{ background: "var(--color-border)" }}
        aria-hidden="true"
      />

      {/* Word count hint */}
      <span
        className="ml-auto text-xs shrink-0"
        style={{ color: "var(--color-text-3)" }}
      >
        Markdown supported
      </span>
    </div>
  );
}
