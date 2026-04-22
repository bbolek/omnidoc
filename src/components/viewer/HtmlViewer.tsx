import { useEffect, useState } from "react";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { PlainTextEditor } from "../editor/PlainTextEditor";
import type { Tab } from "../../types";

type ViewMode = "preview" | "source" | "edit";
const MODES: readonly ViewMode[] = ["preview", "source", "edit"];

interface Props {
  tab: Tab;
}

export function HtmlViewer({ tab }: Props) {
  const { themeName } = useThemeStore();
  const [mode, setMode] = useState<ViewMode>("preview");
  const [sourceHtml, setSourceHtml] = useState("");

  useEffect(() => {
    if (mode !== "source") return;
    const shikiTheme = getShikiTheme(themeName);
    highlight(tab.content, "html", shikiTheme)
      .then(setSourceHtml)
      .catch(() => setSourceHtml(""));
  }, [tab.content, themeName, mode]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Toggle bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          padding: "8px 48px",
          flexShrink: 0,
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border-muted, var(--color-border))",
          zIndex: 10,
        }}
      >
        {mode === "edit" && tab.isDirty && (
          <span style={{ fontSize: 12, color: "var(--color-accent)", marginRight: "auto" }}>
            • unsaved
          </span>
        )}
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            fontSize: 12,
          }}
        >
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "3px 10px",
                background: mode === m ? "var(--color-accent)" : "var(--color-bg-subtle)",
                color: mode === m ? "var(--color-accent-fg)" : "var(--color-text-muted)",
                border: "none",
                cursor: "pointer",
                fontFamily: "Inter, sans-serif",
                fontWeight: mode === m ? 600 : 400,
                transition: "background 0.1s",
                textTransform: "capitalize",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {mode === "edit" ? (
        <PlainTextEditor tab={tab} showToolbar showLineNumbers monospace />
      ) : mode === "preview" ? (
        <iframe
          srcDoc={tab.content}
          style={{ flex: 1, border: "none", width: "100%", background: "#fff" }}
          title="HTML Preview"
        />
      ) : sourceHtml ? (
        <div className="code-viewer selectable fade-in" style={{ flex: 1, overflowY: "auto" }}>
          <div dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        </div>
      ) : (
        <div className="code-viewer selectable fade-in" style={{ flex: 1, overflowY: "auto" }}>
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
        </div>
      )}
    </div>
  );
}
