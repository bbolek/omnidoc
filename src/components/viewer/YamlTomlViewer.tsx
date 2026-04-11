import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  format: "yaml" | "toml";
}

export function YamlTomlViewer({ tab, format }: Props) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState(tab.content);

  useEffect(() => {
    try {
      if (format === "yaml") {
        const parsed = yaml.load(tab.content);
        // Validate parse worked, then show original source
        setDisplay(tab.content);
      } else {
        parseToml(tab.content);
        setDisplay(tab.content);
      }
      setError(null);
    } catch (e) {
      setError(String(e));
      setDisplay(tab.content);
    }
  }, [tab.content, format]);

  useEffect(() => {
    const shikiTheme = getShikiTheme(themeName);
    highlight(display, format === "yaml" ? "yaml" : "toml", shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(""));
  }, [display, format, themeName]);

  return (
    <div className="code-viewer selectable fade-in">
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
          Parse error: {error}
        </div>
      )}
      {html ? (
        <div dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.6 }}>
          {display}
        </pre>
      )}
    </div>
  );
}
