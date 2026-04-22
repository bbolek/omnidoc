import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  /** When true, the save/discard/status bar is rendered. Defaults to true. */
  showToolbar?: boolean;
  /** Optional gutter showing line numbers. */
  showLineNumbers?: boolean;
  /** Monospace font when true (code/json/etc.), else fall back to the body font. */
  monospace?: boolean;
  /** Placeholder to show when the file is empty. */
  placeholder?: string;
}

export function PlainTextEditor({
  tab,
  showToolbar = true,
  showLineNumbers = false,
  monospace = true,
  placeholder,
}: Props) {
  const { updateTabContent, saveTabContent, discardTabChanges } = useFileStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [lineCount, setLineCount] = useState(() => tab.content.split("\n").length);

  const onChange = useCallback(
    (value: string) => {
      updateTabContent(tab.id, value);
      setLineCount(value.split("\n").length);
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

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
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

  // Sync textarea when content changes from outside (discard, external change).
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value !== tab.content) {
      ta.value = tab.content;
      setLineCount(tab.content.split("\n").length);
    }
  }, [tab.content]);

  // Keep the line-number gutter aligned with the textarea's scroll position.
  const onScroll = useCallback(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const fontFamily = monospace
    ? "'Fira Code', 'Cascadia Code', 'Consolas', monospace"
    : "Inter, sans-serif";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {showToolbar && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 12px",
            height: 34,
            background: "var(--color-bg)",
            borderBottom: "1px solid var(--color-border-muted, var(--color-border))",
            flexShrink: 0,
            fontSize: 12,
            color: "var(--color-text-muted)",
          }}
        >
          <span>
            {lineCount} {lineCount === 1 ? "line" : "lines"}
          </span>
          {tab.isDirty && (
            <span style={{ color: "var(--color-accent)" }}>• unsaved changes</span>
          )}
          <div style={{ flex: 1 }} />
          {tab.isDirty && (
            <button
              type="button"
              onClick={handleDiscard}
              title="Discard changes"
              style={toolbarButtonStyle(false)}
            >
              <RotateCcw size={12} />
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!tab.isDirty || saving}
            title={saving ? "Saving…" : tab.isDirty ? "Save • Ctrl+S" : "No unsaved changes"}
            style={toolbarButtonStyle(true, !tab.isDirty || saving)}
          >
            <Save size={12} />
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex", position: "relative" }}>
        {showLineNumbers && (
          <div
            ref={gutterRef}
            aria-hidden
            style={{
              padding: "16px 8px 16px 16px",
              textAlign: "right",
              color: "var(--color-text-muted)",
              userSelect: "none",
              borderRight: "1px solid var(--color-border-muted)",
              background: "var(--color-bg-subtle)",
              flexShrink: 0,
              minWidth: 44,
              overflow: "hidden",
              fontFamily: "'Fira Code', monospace",
              fontSize: 13,
              lineHeight: 1.7,
              boxSizing: "border-box",
            }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          defaultValue={tab.content}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={showLineNumbers ? onScroll : undefined}
          spellCheck={false}
          style={{
            flex: 1,
            width: "100%",
            resize: "none",
            border: "none",
            outline: "none",
            background: "var(--color-bg)",
            color: "var(--color-text)",
            fontFamily,
            fontSize: 13,
            lineHeight: 1.7,
            padding: "16px 24px",
            boxSizing: "border-box",
            overflowY: "auto",
            caretColor: "var(--color-accent)",
          }}
        />
      </div>
    </div>
  );
}

function toolbarButtonStyle(accent: boolean, disabled = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    height: 24,
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
    fontWeight: accent ? 600 : 400,
    border: accent ? "none" : "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm, 4px)",
    background: accent
      ? disabled
        ? "var(--color-accent-subtle, #e8f0fe)"
        : "var(--color-accent, #0969da)"
      : "var(--color-bg-subtle)",
    color: accent
      ? disabled
        ? "var(--color-text-muted)"
        : "var(--color-accent-fg, #fff)"
      : "var(--color-text-muted)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
