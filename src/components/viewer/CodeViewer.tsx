import { useEffect, useState } from "react";
import { Eye, Pencil } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";
import { useUiStore } from "../../store/uiStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getLanguageForExtension } from "../../utils/fileUtils";
import { PlainTextEditor } from "../editor/PlainTextEditor";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  ext: string;
}

export function CodeViewer({ tab, ext }: Props) {
  const { themeName } = useThemeStore();
  const { showLineNumbers } = useUiStore();
  const [html, setHtml] = useState("");
  const [editing, setEditing] = useState(false);
  const lang = getLanguageForExtension(ext);

  useEffect(() => {
    if (editing) return;
    const shikiTheme = getShikiTheme(themeName);
    highlight(tab.content, lang, shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(""));
  }, [tab.content, lang, themeName, editing]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          fontSize: 12,
          color: "var(--color-text-muted)",
          flexShrink: 0,
        }}
      >
        <span style={{ textTransform: "uppercase", letterSpacing: 0.5 }}>{lang}</span>
        {editing && tab.isDirty && (
          <span style={{ color: "var(--color-accent)" }}>• unsaved</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setEditing((v) => !v)}
          title={editing ? "Switch to view mode" : "Switch to edit mode"}
          style={{
            background: editing ? "var(--color-accent-subtle)" : "none",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "2px 6px",
            cursor: "pointer",
            color: editing ? "var(--color-accent)" : "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
          }}
        >
          {editing ? <Eye size={12} /> : <Pencil size={12} />}
          {editing ? "View" : "Edit"}
        </button>
      </div>

      {editing ? (
        <PlainTextEditor
          tab={tab}
          showToolbar
          showLineNumbers={showLineNumbers}
          monospace
        />
      ) : (
        <div
          className={`code-viewer selectable fade-in${showLineNumbers ? " show-line-numbers" : ""}`}
          style={{ flex: 1, overflow: "auto" }}
        >
          {html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre
              style={{
                fontFamily: "'Fira Code', monospace",
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--color-text)",
              }}
            >
              {tab.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
