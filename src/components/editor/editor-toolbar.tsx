// src/components/editor/editor-toolbar.tsx
"use client";

import type { RefObject } from "react";

interface EditorToolbarProps {
  editorRef: RefObject<HTMLDivElement | null>;
}

export function EditorToolbar({ editorRef }: EditorToolbarProps) {

  function focusEditor() {
    editorRef.current?.focus();
  }

  function insertAtCursor(text: string) {
    const editor = editorRef.current;
    if (!editor) return;

    // Must be focused first
    editor.focus();

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      // No selection — append at end
      const existingText = editor.textContent ?? "";
      editor.textContent = existingText + text;
      // Move cursor to end
      const range = window.document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      const range = sel.getRangeAt(0);
      // Only insert if selection is inside the editor
      if (!editor.contains(range.commonAncestorContainer)) {
        editor.textContent = (editor.textContent ?? "") + text;
      } else {
        range.deleteContents();
        range.insertNode(window.document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }

    // Trigger input event so sync manager picks up the change
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  function wrapSelection(before: string, after: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const selected = sel.toString();
    if (selected) {
      insertAtCursor(`${before}${selected}${after}`);
    } else {
      insertAtCursor(`${before}${after}`);
    }
  }

  const actions = [
    {
      label: "Bold",
      display: "B",
      style: { fontWeight: "700" },
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        wrapSelection("**", "**");
      },
    },
    {
      label: "Italic",
      display: "I",
      style: { fontStyle: "italic", fontFamily: "Georgia, serif" },
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        wrapSelection("_", "_");
      },
    },
    {
      label: "Heading",
      display: "H₁",
      style: {},
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        insertAtCursor("\n## ");
      },
    },
    {
      label: "Bullet list",
      display: "•—",
      style: {},
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        insertAtCursor("\n- ");
      },
    },
    {
      label: "Numbered list",
      display: "1.",
      style: {},
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        insertAtCursor("\n1. ");
      },
    },
    {
      label: "Code block",
      display: "</>",
      style: { fontFamily: "monospace" },
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        wrapSelection("\n```\n", "\n```\n");
      },
    },
    {
      label: "Horizontal rule",
      display: "———",
      style: {},
      onClick: (e: React.MouseEvent) => {
        e.preventDefault();
        insertAtCursor("\n\n---\n\n");
      },
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
          type="button"
          onMouseDown={action.onClick}
          title={action.label}
          aria-label={action.label}
          className="px-2.5 py-1 rounded text-xs font-medium transition-colors hover:bg-white/5 active:bg-white/10 shrink-0"
          style={{
            color: "var(--color-text-2)",
            ...action.style,
          }}
        >
          {action.display}
        </button>
      ))}

      <div
        className="w-px h-4 mx-1 shrink-0"
        style={{ background: "var(--color-border)" }}
        aria-hidden="true"
      />

      <span
        className="ml-auto text-xs shrink-0"
        style={{ color: "var(--color-text-3)" }}
      >
        Markdown supported
      </span>
    </div>
  );
}