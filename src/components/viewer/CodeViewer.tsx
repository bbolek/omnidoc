import { useEffect, useState } from "react";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getLanguageForExtension } from "../../utils/fileUtils";
import type { Tab } from "../../types";

interface Props {
  tab: Tab;
  ext: string;
}

export function CodeViewer({ tab, ext }: Props) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const lang = getLanguageForExtension(ext);

  useEffect(() => {
    const shikiTheme = getShikiTheme(themeName);
    highlight(tab.content, lang, shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(""));
  }, [tab.content, lang, themeName]);

  return (
    <div className="code-viewer selectable fade-in">
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
  );
}
