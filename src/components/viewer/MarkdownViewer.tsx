import { useEffect, useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getLanguageForExtension } from "../../utils/fileUtils";
import { MermaidBlock } from "./MermaidBlock";
import { MarkdownEditor } from "../editor/MarkdownEditor";
import type { Tab } from "../../types";
import "katex/dist/katex.min.css";

interface Props {
  tab: Tab;
}

type ViewMode = "preview" | "source" | "edit";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Shiki-powered code block
const CodeBlock = memo(function CodeBlock({
  className,
  children,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLElement> & { inline?: boolean; node?: unknown }) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  const code = String(children).replace(/\n$/, "");
  const langMatch = className?.match(/language-(\w+)/);
  const lang = langMatch ? langMatch[1] : "text";
  const inline = props.inline as boolean | undefined;

  // Mermaid: render as diagram
  if (lang === "mermaid") {
    return <MermaidBlock code={code} />;
  }

  // Inline code
  if (inline) {
    return <code className={className}>{children}</code>;
  }

  useEffect(() => {
    const shikiTheme = getShikiTheme(themeName);
    const language = getLanguageForExtension(lang);
    highlight(code, language, shikiTheme)
      .then(setHtml)
      .catch(() => setHtml(`<pre><code>${escapeHtml(code)}</code></pre>`));
  }, [code, lang, themeName]);

  if (!html) {
    return (
      <pre
        style={{
          background: "var(--color-syntax-bg)",
          padding: "1rem",
          borderRadius: "var(--radius)",
          overflow: "auto",
          fontSize: 13,
          fontFamily: "'Fira Code', monospace",
          border: "1px solid var(--color-border)",
        }}
      >
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="shiki-wrapper"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ margin: "1em 0", minWidth: 0, overflow: "hidden" }}
    />
  );
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

// Add id/data-slug to headings for TOC + scroll
function makeHeadingComponent(level: 1 | 2 | 3 | 4 | 5 | 6) {
  return function HeadingComponent({
    children,
    node: _node,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) {
    const tag = `h${level}`;
    const text = String(children ?? "");
    const slug = slugify(text);

    return (
      <div
        id={slug}
        data-slug={slug}
        style={{ scrollMarginTop: 80 }}
        {...(props as React.HTMLAttributes<HTMLDivElement>)}
        className={undefined}
      >
        {/* Render as heading semantically inside the div */}
        {tag === "h1" && <h1 style={{ margin: 0 }} {...props}>{children}</h1>}
        {tag === "h2" && <h2 style={{ margin: 0 }} {...props}>{children}</h2>}
        {tag === "h3" && <h3 style={{ margin: 0 }} {...props}>{children}</h3>}
        {tag === "h4" && <h4 style={{ margin: 0 }} {...props}>{children}</h4>}
        {tag === "h5" && <h5 style={{ margin: 0 }} {...props}>{children}</h5>}
        {tag === "h6" && <h6 style={{ margin: 0 }} {...props}>{children}</h6>}
      </div>
    );
  };
}

const components: Components = {
  code: CodeBlock as Components["code"],
  h1: makeHeadingComponent(1) as Components["h1"],
  h2: makeHeadingComponent(2) as Components["h2"],
  h3: makeHeadingComponent(3) as Components["h3"],
  h4: makeHeadingComponent(4) as Components["h4"],
  h5: makeHeadingComponent(5) as Components["h5"],
  h6: makeHeadingComponent(6) as Components["h6"],
};

export function MarkdownViewer({ tab }: Props) {
  const { themeName } = useThemeStore();
  const [mode, setMode] = useState<ViewMode>("preview");
  const [sourceHtml, setSourceHtml] = useState("");
  const shikiTheme = getShikiTheme(themeName);

  useEffect(() => {
    if (mode !== "source") return;
    highlight(tab.content, "markdown", shikiTheme)
      .then(setSourceHtml)
      .catch(() => setSourceHtml(""));
  }, [tab.content, shikiTheme, mode]);

  const isEditMode = mode === "edit";

  return (
    <div
      style={
        isEditMode
          ? { display: "flex", flexDirection: "column", height: "100%" }
          : undefined
      }
    >
      {/* Sticky toggle bar */}
      <div
        style={{
          position: isEditMode ? "relative" : "sticky",
          top: 0,
          zIndex: 10,
          display: "flex",
          justifyContent: "flex-end",
          padding: "8px 48px",
          background: "var(--color-bg)",
          borderBottom: "1px solid var(--color-border-muted, var(--color-border))",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
            fontSize: 12,
          }}
        >
          {(["preview", "source", "edit"] as ViewMode[]).map((m) => (
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
        <MarkdownEditor tab={tab} />
      ) : mode === "preview" ? (
        <div className="markdown-body selectable fade-in">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, rehypeRaw]}
            components={components}
          >
            {tab.content}
          </ReactMarkdown>
        </div>
      ) : sourceHtml ? (
        <div className="code-viewer selectable fade-in">
          <div dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        </div>
      ) : (
        <div className="code-viewer selectable fade-in">
          <pre style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.6, color: "var(--color-text)" }}>
            {tab.content}
          </pre>
        </div>
      )}
    </div>
  );
}
