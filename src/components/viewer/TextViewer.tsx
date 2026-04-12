import { useState } from "react";
import { Hash, WrapText } from "lucide-react";
import { useUiStore } from "../../store/uiStore";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

export function TextViewer({ tab }: Props) {
  const [wrap, setWrap] = useState(true);
  const { showLineNumbers, toggleLineNumbers } = useUiStore();
  const lines = tab.content.split("\n");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
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
        <span>{lines.length} lines</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={toggleLineNumbers}
          title="Toggle line numbers"
          style={{
            background: showLineNumbers ? "var(--color-accent-subtle)" : "none",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "2px 6px",
            cursor: "pointer",
            color: showLineNumbers ? "var(--color-accent)" : "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <Hash size={12} />
          Lines
        </button>
        <button
          onClick={() => setWrap((w) => !w)}
          title="Toggle word wrap"
          style={{
            background: wrap ? "var(--color-accent-subtle)" : "none",
            border: "none",
            borderRadius: "var(--radius-sm)",
            padding: "2px 6px",
            cursor: "pointer",
            color: wrap ? "var(--color-accent)" : "var(--color-text-muted)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontFamily: "Inter, sans-serif",
          }}
        >
          <WrapText size={12} />
          Wrap
        </button>
      </div>

      {/* Content */}
      <div
        className="selectable fade-in"
        style={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          fontFamily: "'Fira Code', monospace",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {/* Line numbers */}
        {showLineNumbers && (
          <div
            style={{
              padding: "16px 8px 16px 16px",
              textAlign: "right",
              color: "var(--color-text-muted)",
              userSelect: "none",
              borderRight: "1px solid var(--color-border-muted)",
              background: "var(--color-bg-subtle)",
              flexShrink: 0,
              minWidth: 44,
            }}
          >
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        )}

        {/* Text */}
        <pre
          style={{
            flex: 1,
            padding: "16px 24px",
            margin: 0,
            color: "var(--color-text)",
            background: "var(--color-bg)",
            whiteSpace: wrap ? "pre-wrap" : "pre",
            overflowX: wrap ? "hidden" : "auto",
            wordBreak: wrap ? "break-word" : "normal",
            lineHeight: 1.6,
          }}
        >
          {tab.content}
        </pre>
      </div>
    </div>
  );
}
