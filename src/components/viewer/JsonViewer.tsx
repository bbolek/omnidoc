import { useEffect, useState } from "react";
import { JsonTree } from "./JsonTree";
import { ModeToggle } from "./ModeToggle";
import { PlainTextEditor } from "../editor/PlainTextEditor";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

const MODES = ["tree", "edit"] as const;
type Mode = (typeof MODES)[number];

export function JsonViewer({ tab }: Props) {
  const [parsed, setParsed] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("tree");

  useEffect(() => {
    try {
      setParsed(JSON.parse(tab.content));
      setError(null);
    } catch (e) {
      setParsed(null);
      setError(`JSON parse error: ${e}`);
    }
  }, [tab.content]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header: mode toggle + parse error */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid var(--color-border-muted)",
          background: "var(--color-bg-subtle)",
          flexShrink: 0,
          flexWrap: "wrap",
        }}
      >
        <ModeToggle modes={MODES} value={mode} onChange={setMode} />
        {mode === "edit" && tab.isDirty && (
          <span style={{ fontSize: 12, color: "var(--color-accent)" }}>• unsaved</span>
        )}
        {error && mode === "tree" && (
          <div
            style={{
              flex: 1,
              background: "rgba(207,34,46,0.08)",
              border: "1px solid rgba(207,34,46,0.3)",
              borderRadius: "var(--radius-sm)",
              padding: "3px 8px",
              color: "#cf222e",
              fontSize: 12,
            }}
          >
            {error}
          </div>
        )}
      </div>

      {mode === "edit" ? (
        <PlainTextEditor tab={tab} showToolbar showLineNumbers monospace language="json" />
      ) : (
        <div className="json-viewer selectable fade-in" style={{ flex: 1, overflow: "auto" }}>
          {error ? (
            <div
              style={{
                background: "rgba(207,34,46,0.08)",
                border: "1px solid rgba(207,34,46,0.3)",
                borderRadius: "var(--radius)",
                padding: "8px 12px",
                margin: 16,
                color: "#cf222e",
                fontSize: 12,
              }}
            >
              <pre style={{ marginTop: 8, fontFamily: "'Fira Code', monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
                {tab.content}
              </pre>
            </div>
          ) : (
            parsed !== null && <JsonTree data={parsed as never} />
          )}
        </div>
      )}
    </div>
  );
}
