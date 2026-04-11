import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "../../store/themeStore";
import { getTheme, resolveScheme } from "../../themes";

interface Props {
  code: string;
}

let mermaidInstance: typeof import("mermaid") | null = null;

async function getMermaid() {
  if (!mermaidInstance) {
    const m = await import("mermaid");
    mermaidInstance = m;
  }
  return mermaidInstance;
}

let idCounter = 0;

export function MermaidBlock({ code }: Props) {
  const { themeName, colorScheme } = useThemeStore();
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${++idCounter}`);

  const theme = getTheme(themeName);
  const scheme = resolveScheme(theme, colorScheme);
  const mermaidTheme = scheme === "dark" ? "dark" : "default";

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      try {
        const mermaid = await getMermaid();
        mermaid.default.initialize({
          startOnLoad: false,
          theme: mermaidTheme as "dark" | "default",
          securityLevel: "loose",
          fontFamily: "Inter, sans-serif",
        });

        const id = `${idRef.current}-${Date.now()}`;
        const { svg: rendered } = await mermaid.default.render(id, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      }
    };

    render();
    return () => { cancelled = true; };
  }, [code, mermaidTheme]);

  if (error) {
    return (
      <pre
        style={{
          background: "var(--color-bg-inset)",
          color: "#cf222e",
          padding: "1rem",
          borderRadius: "var(--radius)",
          fontSize: 12,
          overflow: "auto",
          border: "1px solid var(--color-border)",
        }}
      >
        Mermaid error: {error}
      </pre>
    );
  }

  if (!svg) {
    return (
      <div
        style={{
          background: "var(--color-bg-inset)",
          borderRadius: "var(--radius)",
          padding: "2rem",
          textAlign: "center",
          color: "var(--color-text-muted)",
          fontSize: 13,
          border: "1px solid var(--color-border)",
          margin: "1em 0",
        }}
      >
        Rendering diagram…
      </div>
    );
  }

  return (
    <div
      className="mermaid-container"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
