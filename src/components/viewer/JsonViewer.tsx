import { useEffect, useState } from "react";
import { JsonTree } from "./JsonTree";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

export function JsonViewer({ tab }: Props) {
  const [parsed, setParsed] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="json-viewer selectable fade-in">
      {error && (
        <div
          style={{
            background: "rgba(207,34,46,0.08)",
            border: "1px solid rgba(207,34,46,0.3)",
            borderRadius: "var(--radius)",
            padding: "8px 12px",
            marginBottom: 16,
            color: "#cf222e",
            fontSize: 12,
          }}
        >
          {error}
          <pre style={{ marginTop: 8, fontFamily: "'Fira Code', monospace", fontSize: 12, whiteSpace: "pre-wrap" }}>
            {tab.content}
          </pre>
        </div>
      )}
      {parsed !== null && <JsonTree data={parsed as never} />}
    </div>
  );
}
