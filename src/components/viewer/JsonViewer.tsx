import { useEffect, useState } from "react";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
}

export function JsonViewer({ tab }: Props) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formatted, setFormatted] = useState(tab.content);

  useEffect(() => {
    try {
      const parsed = JSON.parse(tab.content);
      const pretty = JSON.stringify(parsed, null, 2);
      setFormatted(pretty);
      setError(null);
    } catch (e) {
      setFormatted(tab.content);
      setError(`JSON parse error: ${e}`);
    }
  }, [tab.content]);

  useEffect(() => {
    const shikiTheme = getShikiTheme(themeName);
    highlight(formatted, "json", shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(""));
  }, [formatted, themeName]);

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
        </div>
      )}
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.6 }}>
          {formatted}
        </pre>
      )}
    </div>
  );
}
