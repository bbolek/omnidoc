import { useEffect, useState } from "react";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getLanguageForExtension } from "../../utils/fileUtils";
import { PlainTextEditor } from "../editor/PlainTextEditor";
import { ModeToggle } from "./ModeToggle";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  ext: string;
}

const MODES = ["view", "edit"] as const;
type Mode = (typeof MODES)[number];

export function CodeViewer({ tab, ext }: Props) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const [mode, setMode] = useState<Mode>("view");
  const editing = mode === "edit";
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
        <ModeToggle modes={MODES} value={mode} onChange={setMode} />
      </div>

      {editing ? (
        <PlainTextEditor
          tab={tab}
          showToolbar
          showLineNumbers
          monospace
          language={lang}
        />
      ) : (
        <div
          className="code-viewer selectable fade-in show-line-numbers"
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
