import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { useFileStore } from "../../store/fileStore";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { useTabScrollMemory } from "../../hooks/useTabScrollMemory";
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
  /**
   * Shiki language id. When set, the editor layers a syntax-highlighted
   * `<pre>` behind a transparent `<textarea>` so code keeps its colors in
   * edit mode. Omit for prose-style plain text.
   */
  language?: string;
}

export function PlainTextEditor({
  tab,
  showToolbar = true,
  showLineNumbers = true,
  monospace = true,
  placeholder,
  language,
}: Props) {
  const { updateTabContent, saveTabContent, discardTabChanges } = useFileStore();
  const { themeName } = useThemeStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The wrapper — not the textarea — is the scroll container, so scroll
  // memory must track it (the textarea is overflow:hidden and never scrolls).
  useTabScrollMemory(scrollerRef, tab.id, "editor");
  const [saving, setSaving] = useState(false);
  const [lineCount, setLineCount] = useState(() => tab.content.split("\n").length);
  const [highlightedHtml, setHighlightedHtml] = useState<string>("");

  // When a language is supplied, keep a Shiki-highlighted copy of the content
  // in sync with edits. It's rendered behind a transparent textarea so the
  // caret, selection, and input handling stay native while the user sees
  // colored tokens underneath.
  useEffect(() => {
    if (!language) {
      setHighlightedHtml("");
      return;
    }
    let cancelled = false;
    const shikiTheme = getShikiTheme(themeName);
    // Keep a trailing newline so the last empty line still renders a slot —
    // without it, Shiki strips the final line break and the caret appears
    // above a blank area with no token underneath.
    const src = tab.content.endsWith("\n") ? tab.content : tab.content + "\n";
    highlight(src, language, shikiTheme)
      .then((html) => {
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        if (!cancelled) setHighlightedHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [tab.content, language, themeName]);

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

  // Grow the textarea to fit its content so the wrapper (`.pte-scroller`),
  // not the textarea, is the thing that scrolls. With the textarea and the
  // highlight overlay sharing a single scroller, they move together natively
  // and can't drift — there's no JS scroll sync to lag behind a fast/momentum
  // scroll. The two overlap in one CSS-grid cell, so the row sizes to the
  // taller of them: the textarea reflects edits instantly (its height is
  // measured here) while the overlay `<pre>` drives the width (`max-content`).
  const overlayActive = !!(language && highlightedHtml);
  const resize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Reset to auto before reading scrollHeight, else a previously-grown
    // height inflates the measurement (read-after-write feedback loop).
    ta.style.height = "auto";
    // Grow to the content height, but never below the viewport — so a short
    // file still fills the editor and clicking the empty area below the text
    // places the caret instead of doing nothing.
    const fill = scrollerRef.current?.clientHeight ?? 0;
    ta.style.height = `${Math.max(ta.scrollHeight, fill)}px`;
  }, []);

  // Sync textarea when content changes from outside (discard, external change).
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta && ta.value !== tab.content) {
      ta.value = tab.content;
      setLineCount(tab.content.split("\n").length);
    }
  }, [tab.content]);

  // Re-grow on every input, content swap, mode change, or once the async
  // Shiki overlay arrives (its `<pre>` settles the column's width/height).
  useLayoutEffect(() => {
    resize();
  }, [tab.content, language, highlightedHtml, resize]);

  // Prose soft-wraps, so its height depends on the available width — re-grow
  // when the scroller is resized. (Code wraps off, so width changes don't
  // affect its height, but observing is harmless.)
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(scroller);
    return () => ro.disconnect();
  }, [resize]);

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

      {/*
        Single shared scroll container. The line-number gutter, the
        highlighted overlay, and the textarea all live inside it and scroll
        together natively — there is no JS scroll sync to lag behind a fast
        scroll, so the colored overlay can never drift from the caret /
        selection. The textarea is `overflow: hidden` and sized to its
        content (see `resize`), so the scrollbars belong to this wrapper.
      */}
      <div
        ref={scrollerRef}
        className="pte-scroller"
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          background: "var(--color-bg)",
          overflowY: "auto",
          // Code may have long lines (wrap off) and needs horizontal scroll;
          // prose wraps, so it never scrolls horizontally.
          overflowX: language ? "auto" : "hidden",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
            // Fill the viewport even for short/empty files so the background
            // and click target cover the whole area.
            minHeight: "100%",
            minWidth: "100%",
            // For highlighted code, size to the longest line so the wrapper
            // gets a horizontal scrollbar; otherwise fill the width.
            width: overlayActive ? "max-content" : "100%",
            boxSizing: "border-box",
          }}
        >
          {showLineNumbers && (
            <div
              aria-hidden
              className="pte-gutter"
              style={{
                // Pinned to the left while content scrolls horizontally.
                position: "sticky",
                left: 0,
                zIndex: 2,
                padding: "16px 8px 16px 16px",
                textAlign: "right",
                color: "var(--color-text-muted)",
                userSelect: "none",
                borderRight: "1px solid var(--color-border-muted)",
                background: "var(--color-bg-subtle)",
                flexShrink: 0,
                minWidth: 44,
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
          {/*
            Single-cell grid: the overlay and textarea are placed in the same
            grid area so they overlap pixel-for-pixel. The cell sizes to the
            larger of the two in each axis — the overlay `<pre>` (max-content)
            drives the width so long code lines scroll horizontally, while the
            textarea drives the height so freshly typed lines are never clipped
            waiting on the async re-highlight.
          */}
          <div
            style={{
              display: "grid",
              minWidth: 0,
              // Grow to fill leftover width when lines are short, but never
              // shrink below the (max-content) overlay so long lines still
              // produce a horizontal scrollbar.
              flex: overlayActive ? "1 0 auto" : "1 1 0%",
            }}
          >
            {overlayActive && (
              <div
                aria-hidden
                className="pte-highlight"
                style={{
                  gridArea: "1 / 1",
                  alignSelf: "start",
                  justifySelf: "start",
                  // Longest line sets the column's max-content width; `100%`
                  // floor keeps it spanning the cell when lines are short.
                  width: "max-content",
                  minWidth: "100%",
                  margin: 0,
                  padding: "16px 24px",
                  fontFamily,
                  fontSize: 13,
                  lineHeight: 1.7,
                  pointerEvents: "none",
                  boxSizing: "border-box",
                }}
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            )}
            <textarea
              ref={textareaRef}
              defaultValue={tab.content}
              placeholder={placeholder}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              // With a language overlay, disable the textarea's own soft-wrap so
              // each logical line stays on a single visual row — otherwise it
              // wraps long lines while the overlay (`white-space: pre`) does
              // not, and the caret ends up rows away from the token you clicked.
              wrap={language ? "off" : "soft"}
              style={{
                // Share the overlay's grid cell so they overlap exactly, and
                // stretch to fill the cell width so the whole row is clickable.
                gridArea: "1 / 1",
                alignSelf: "start",
                justifySelf: "stretch",
                width: "100%",
                // Height is owned by `resize` (auto-grown to content) so the
                // textarea — not the lagging overlay — sets the row height.
                resize: "none",
                border: "none",
                outline: "none",
                // The wrapper scrolls; the textarea must not, or it would
                // create a second, drifting scroll position.
                overflow: "hidden",
                background: overlayActive ? "transparent" : "var(--color-bg)",
                // Hide the textarea's own text only while the colored overlay
                // is showing; before Shiki loads, keep code readable. The
                // caret always renders via `caretColor`.
                color: overlayActive ? "transparent" : "var(--color-text)",
                WebkitTextFillColor: overlayActive ? "transparent" : undefined,
                fontFamily,
                fontSize: 13,
                lineHeight: 1.7,
                padding: "16px 24px",
                boxSizing: "border-box",
                // Match the overlay's tab width so literal tab chars line up
                // with the highlighted tokens underneath.
                tabSize: language ? 2 : undefined,
                whiteSpace: language ? "pre" : undefined,
                caretColor: "var(--color-accent)",
              }}
            />
          </div>
        </div>
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
