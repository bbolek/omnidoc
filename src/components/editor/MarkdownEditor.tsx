import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  FileCode,
  Link,
  Minus,
  Save,
  RotateCcw,
} from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

// ── Tooltip Button ─────────────────────────────────────────────────────────────

interface TooltipButtonProps {
  tooltip: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  accent?: boolean;
  label?: string;
}

function TooltipButton({ tooltip, onClick, children, disabled, accent, label }: TooltipButtonProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const show = () => {
    timerRef.current = setTimeout(() => {
      if (btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
      }
    }, 300);
  };
  const hide = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPos(null);
  };

  return (
    <div style={{ display: "inline-flex", flexShrink: 0 }}>
      <button
        ref={btnRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseDown={hide}
        onClick={onClick}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: label ? 5 : 0,
          width: label ? "auto" : 28,
          height: 28,
          padding: label ? "0 10px" : 0,
          border: "none",
          borderRadius: "var(--radius-sm, 4px)",
          background: accent
            ? disabled
              ? "var(--color-accent-subtle, #e8f0fe)"
              : "var(--color-accent, #0969da)"
            : "transparent",
          color: accent
            ? disabled
              ? "var(--color-text-muted)"
              : "var(--color-accent-fg, #fff)"
            : disabled
            ? "var(--color-text-muted)"
            : "var(--color-text-muted)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.45 : 1,
          transition: "background 0.1s, color 0.1s",
          flexShrink: 0,
          fontSize: 12,
          fontFamily: "Inter, sans-serif",
          fontWeight: accent ? 600 : 400,
          whiteSpace: "nowrap",
        }}
        onMouseOver={(e) => {
          if (disabled) return;
          const el = e.currentTarget;
          if (!accent) {
            el.style.background = "var(--color-bg-subtle)";
            el.style.color = "var(--color-text)";
          } else {
            el.style.background = "var(--color-accent-hover, #0860ca)";
          }
        }}
        onMouseOut={(e) => {
          const el = e.currentTarget;
          if (!accent) {
            el.style.background = "transparent";
            el.style.color = disabled ? "var(--color-text-muted)" : "var(--color-text-muted)";
          } else {
            el.style.background = disabled
              ? "var(--color-accent-subtle)"
              : "var(--color-accent)";
          }
        }}
      >
        {children}
        {label && <span>{label}</span>}
      </button>

      {pos && createPortal(
        <div
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            transform: "translateX(-50%)",
            background: "var(--color-bg-overlay, #1a1a2e)",
            color: "#e8e8e8",
            fontSize: 11,
            fontFamily: "Inter, sans-serif",
            padding: "4px 8px",
            borderRadius: "var(--radius-sm, 4px)",
            boxShadow: "var(--shadow-md, 0 4px 12px rgba(0,0,0,0.3))",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            zIndex: 9999,
            lineHeight: 1.4,
          }}
        >
          <span
            style={{
              position: "absolute",
              top: -4,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "4px solid transparent",
              borderRight: "4px solid transparent",
              borderBottom: "4px solid var(--color-bg-overlay, #1a1a2e)",
            }}
          />
          {tooltip}
        </div>,
        document.body
      )}
    </div>
  );
}

function Separator() {
  return (
    <span
      style={{
        width: 1,
        height: 16,
        background: "var(--color-border-muted, var(--color-border))",
        margin: "0 6px",
        flexShrink: 0,
        alignSelf: "center",
      }}
    />
  );
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onChange: (v: string) => void
) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const selected = value.slice(start, end) || "text";
  const alreadyWrapped =
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after;

  let newValue: string;
  let newStart: number;
  let newEnd: number;

  if (alreadyWrapped) {
    // Unwrap
    newValue =
      value.slice(0, start - before.length) +
      selected +
      value.slice(end + after.length);
    newStart = start - before.length;
    newEnd = end - before.length;
  } else {
    newValue = value.slice(0, start) + before + selected + after + value.slice(end);
    newStart = start + before.length;
    newEnd = end + before.length;
  }

  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(newStart, newEnd);
  });
}

function toggleLinePrefix(
  textarea: HTMLTextAreaElement,
  prefix: string,
  onChange: (v: string) => void
) {
  const { value, selectionStart: start } = textarea;
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = value.indexOf("\n", start);
  const line = value.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

  let newValue: string;
  let cursorDelta: number;

  if (line.startsWith(prefix)) {
    newValue =
      value.slice(0, lineStart) +
      line.slice(prefix.length) +
      value.slice(lineEnd === -1 ? value.length : lineEnd);
    cursorDelta = -prefix.length;
  } else {
    // Remove any other heading prefix before adding new one
    const headingMatch = line.match(/^(#{1,6} |- |\d+\. |> )/);
    const cleanLine = headingMatch ? line.slice(headingMatch[0].length) : line;
    const replacement = prefix + cleanLine;
    newValue =
      value.slice(0, lineStart) +
      replacement +
      value.slice(lineEnd === -1 ? value.length : lineEnd);
    cursorDelta = prefix.length - (headingMatch ? headingMatch[0].length : 0);
  }

  onChange(newValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start + cursorDelta, start + cursorDelta);
  });
}

function insertBlock(
  textarea: HTMLTextAreaElement,
  block: string,
  onChange: (v: string) => void
) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const selected = value.slice(start, end);
  const filled = block.includes("{sel}") ? block.replace("{sel}", selected || "text") : block;
  const needsNewlineBefore = start > 0 && value[start - 1] !== "\n";
  const needsNewlineAfter = end < value.length && value[end] !== "\n";
  const newValue =
    value.slice(0, start) +
    (needsNewlineBefore ? "\n" : "") +
    filled +
    (needsNewlineAfter ? "\n" : "") +
    value.slice(end);

  onChange(newValue);
  const cursorPos = start + (needsNewlineBefore ? 1 : 0) + filled.length;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  });
}

function insertLink(
  textarea: HTMLTextAreaElement,
  onChange: (v: string) => void
) {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const selected = value.slice(start, end);
  const linkText = selected || "link text";
  const insertion = `[${linkText}](url)`;
  const newValue = value.slice(0, start) + insertion + value.slice(end);
  onChange(newValue);
  // Select "url" part for easy replacement
  const urlStart = start + linkText.length + 3;
  const urlEnd = urlStart + 3;
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(urlStart, urlEnd);
  });
}

// ── Main Editor ────────────────────────────────────────────────────────────────

export function MarkdownEditor({ tab }: Props) {
  const { updateTabContent, saveTabContent, discardTabChanges } = useFileStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);

  const onChange = useCallback(
    (value: string) => {
      updateTabContent(tab.id, value);
    },
    [tab.id, updateTabContent]
  );

  const handleSave = useCallback(async () => {
    if (!tab.isDirty || saving) return;
    setSaving(true);
    try {
      await saveTabContent(tab.id);
    } finally {
      setSaving(false);
    }
  }, [tab.id, tab.isDirty, saving, saveTabContent]);

  const handleDiscard = useCallback(async () => {
    await discardTabChanges(tab.id);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [tab.id, discardTabChanges]);

  // Keyboard shortcuts inside the textarea
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (ctrl && e.key === "b") {
        e.preventDefault();
        if (textareaRef.current) wrapSelection(textareaRef.current, "**", "**", onChange);
        return;
      }
      if (ctrl && e.key === "i") {
        e.preventDefault();
        if (textareaRef.current) wrapSelection(textareaRef.current, "*", "*", onChange);
        return;
      }
      // Tab → insert 2 spaces instead of moving focus
      if (e.key === "Tab") {
        e.preventDefault();
        const ta = textareaRef.current;
        if (!ta) return;
        const { value, selectionStart: s, selectionEnd: en } = ta;
        const newValue = value.slice(0, s) + "  " + value.slice(en);
        onChange(newValue);
        requestAnimationFrame(() => ta.setSelectionRange(s + 2, s + 2));
      }
    },
    [handleSave, onChange]
  );

  const btn = (action: () => void) => () => {
    action();
  };

  const ta = () => textareaRef.current!;

  // Sync textarea value when tab content changes from outside (e.g. discard)
  useEffect(() => {
    if (textareaRef.current && textareaRef.current.value !== tab.content) {
      textareaRef.current.value = tab.content;
    }
  }, [tab.content]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Formatting Toolbar ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 12px",
          height: 38,
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border-muted, var(--color-border))",
          flexShrink: 0,
          overflowX: "auto",
          overflowY: "hidden",
        }}
      >
        {/* Text formatting */}
        <TooltipButton tooltip="Bold • Ctrl+B" onClick={btn(() => wrapSelection(ta(), "**", "**", onChange))}>
          <Bold size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Italic • Ctrl+I" onClick={btn(() => wrapSelection(ta(), "*", "*", onChange))}>
          <Italic size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Strikethrough" onClick={btn(() => wrapSelection(ta(), "~~", "~~", onChange))}>
          <Strikethrough size={14} />
        </TooltipButton>

        <Separator />

        {/* Headings */}
        <TooltipButton tooltip="Heading 1" onClick={btn(() => toggleLinePrefix(ta(), "# ", onChange))}>
          <Heading1 size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Heading 2" onClick={btn(() => toggleLinePrefix(ta(), "## ", onChange))}>
          <Heading2 size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Heading 3" onClick={btn(() => toggleLinePrefix(ta(), "### ", onChange))}>
          <Heading3 size={14} />
        </TooltipButton>

        <Separator />

        {/* Lists */}
        <TooltipButton tooltip="Unordered list" onClick={btn(() => toggleLinePrefix(ta(), "- ", onChange))}>
          <List size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Ordered list" onClick={btn(() => toggleLinePrefix(ta(), "1. ", onChange))}>
          <ListOrdered size={14} />
        </TooltipButton>
        <TooltipButton tooltip="Blockquote" onClick={btn(() => toggleLinePrefix(ta(), "> ", onChange))}>
          <Quote size={14} />
        </TooltipButton>

        <Separator />

        {/* Code */}
        <TooltipButton tooltip="Inline code" onClick={btn(() => wrapSelection(ta(), "`", "`", onChange))}>
          <Code size={14} />
        </TooltipButton>
        <TooltipButton
          tooltip="Code block"
          onClick={btn(() =>
            insertBlock(ta(), "```\n{sel}\n```", onChange)
          )}
        >
          <FileCode size={14} />
        </TooltipButton>

        <Separator />

        {/* Misc */}
        <TooltipButton tooltip="Insert link" onClick={btn(() => insertLink(ta(), onChange))}>
          <Link size={14} />
        </TooltipButton>
        <TooltipButton
          tooltip="Horizontal rule"
          onClick={btn(() => insertBlock(ta(), "---", onChange))}
        >
          <Minus size={14} />
        </TooltipButton>

        {/* Push save/discard to the right */}
        <div style={{ flex: 1 }} />

        {tab.isDirty && (
          <TooltipButton tooltip="Discard changes" onClick={handleDiscard}>
            <RotateCcw size={14} />
          </TooltipButton>
        )}

        <div style={{ width: 6, flexShrink: 0 }} />

        <TooltipButton
          tooltip={saving ? "Saving…" : tab.isDirty ? "Save • Ctrl+S" : "No unsaved changes"}
          onClick={handleSave}
          disabled={!tab.isDirty || saving}
          accent
          label={saving ? "Saving…" : "Save"}
        >
          <Save size={13} />
        </TooltipButton>
      </div>

      {/* ── Textarea ───────────────────────────────────────────────── */}
      <textarea
        ref={textareaRef}
        defaultValue={tab.content}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck={false}
        style={{
          flex: 1,
          width: "100%",
          resize: "none",
          border: "none",
          outline: "none",
          background: "var(--color-bg)",
          color: "var(--color-text)",
          fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontSize: 13,
          lineHeight: 1.7,
          padding: "24px 48px",
          boxSizing: "border-box",
          overflowY: "auto",
          caretColor: "var(--color-accent)",
        }}
      />
    </div>
  );
}
