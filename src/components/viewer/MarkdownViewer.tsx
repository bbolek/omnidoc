import { useEffect, useLayoutEffect, useRef, useState, memo, createContext, useContext, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import type { Components } from "react-markdown";
import { useThemeStore } from "../../store/themeStore";
import { useUiStore } from "../../store/uiStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";
import { getLanguageForExtension } from "../../utils/fileUtils";
import { MermaidBlock } from "./MermaidBlock";
import { Callout, extractCalloutFromChildren } from "./Callout";
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
export const CodeBlock = memo(function CodeBlock({
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
  // react-markdown v9 no longer passes an `inline` prop. Fenced blocks always
  // have a `language-xxx` class and typically contain a trailing newline;
  // inline `` `code` `` has neither. Treating everything without a language
  // class as inline keeps inline spans from being rendered as block-level
  // shiki wrappers (which stacked them into one-per-row columns).
  const inline =
    (props.inline as boolean | undefined) ?? (!langMatch && !/\n/.test(String(children)));

  // Mermaid: render as diagram
  if (lang === "mermaid" && !inline) {
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

// ── Folding context ────────────────────────────────────────────────────────────

interface FoldContextValue {
  foldedSlugs: Set<string>;
  toggleFold: (slug: string, ctrlKey: boolean) => void;
}

const FoldContext = createContext<FoldContextValue | null>(null);

// Add id/data-slug to headings for TOC + scroll, plus a fold toggle button
function makeHeadingComponent(level: 1 | 2 | 3 | 4 | 5 | 6) {
  return function HeadingComponent({
    children,
    node: _node,
    ...props
  }: React.HTMLAttributes<HTMLHeadingElement> & { node?: unknown }) {
    const text = String(children ?? "");
    const slug = slugify(text);
    const foldCtx = useContext(FoldContext);
    const foldable = level >= 1 && level <= 4;
    const isFolded = foldCtx?.foldedSlugs.has(slug) ?? false;

    const handleFoldClick = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      foldCtx?.toggleFold(slug, e.ctrlKey || e.metaKey);
    };

    const headingInner = (
      <>
        {foldable && (
          <button
            type="button"
            className={`heading-fold-btn${isFolded ? " folded" : ""}`}
            aria-label={isFolded ? "Expand section" : "Collapse section"}
            title={isFolded ? "Expand (Ctrl+Click: all)" : "Collapse (Ctrl+Click: all)"}
            onClick={handleFoldClick}
            tabIndex={-1}
          >
            {isFolded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        )}
        {children}
        {isFolded && <span className="fold-placeholder">…</span>}
      </>
    );

    // Move heading margins onto the wrapper div so vertical spacing is
    // preserved after we zero out the heading's own margins (which we do
    // to avoid double-spacing inside the wrapper).
    const wrapperProps = {
      id: slug,
      "data-slug": slug,
      "data-heading-level": String(level),
      style: {
        scrollMarginTop: 80,
        marginTop: "1.5em",
        marginBottom: "0.5em",
      } as React.CSSProperties,
    };

    return (
      <div {...wrapperProps}>
        {level === 1 && <h1 style={{ margin: 0 }} {...props}>{headingInner}</h1>}
        {level === 2 && <h2 style={{ margin: 0 }} {...props}>{headingInner}</h2>}
        {level === 3 && <h3 style={{ margin: 0 }} {...props}>{headingInner}</h3>}
        {level === 4 && <h4 style={{ margin: 0 }} {...props}>{headingInner}</h4>}
        {level === 5 && <h5 style={{ margin: 0 }} {...props}>{headingInner}</h5>}
        {level === 6 && <h6 style={{ margin: 0 }} {...props}>{headingInner}</h6>}
      </div>
    );
  };
}

function CalloutBlockquote({
  children,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLQuoteElement> & { node?: unknown }) {
  const extracted = extractCalloutFromChildren(children);
  if (extracted) {
    return <Callout match={extracted.match}>{extracted.content}</Callout>;
  }
  return <blockquote {...props}>{children}</blockquote>;
}

export const components: Components = {
  code: CodeBlock as Components["code"],
  h1: makeHeadingComponent(1) as Components["h1"],
  h2: makeHeadingComponent(2) as Components["h2"],
  h3: makeHeadingComponent(3) as Components["h3"],
  h4: makeHeadingComponent(4) as Components["h4"],
  h5: makeHeadingComponent(5) as Components["h5"],
  h6: makeHeadingComponent(6) as Components["h6"],
  blockquote: CalloutBlockquote as Components["blockquote"],
};

export function MarkdownViewer({ tab }: Props) {
  const { themeName } = useThemeStore();
  const { showLineNumbers, setPresentationVisible } = useUiStore();
  const [mode, setMode] = useState<ViewMode>("preview");
  const [sourceHtml, setSourceHtml] = useState("");
  const [foldedSlugs, setFoldedSlugs] = useState<Set<string>>(new Set());
  const previewRef = useRef<HTMLDivElement>(null);
  const shikiTheme = getShikiTheme(themeName);

  useEffect(() => {
    if (mode !== "source") return;
    highlight(tab.content, "markdown", shikiTheme)
      .then(setSourceHtml)
      .catch(() => setSourceHtml(""));
  }, [tab.content, shikiTheme, mode]);

  // Reset fold state when switching tabs or content (per-file, non-persisted)
  useEffect(() => {
    setFoldedSlugs(new Set());
  }, [tab.id]);

  const toggleFold = useCallback(
    (slug: string, ctrlKey: boolean) => {
      if (ctrlKey) {
        // Toggle all: collect all foldable heading slugs from the rendered DOM
        const root = previewRef.current;
        if (!root) return;
        const nodes = root.querySelectorAll<HTMLElement>(
          "[data-heading-level='1'],[data-heading-level='2'],[data-heading-level='3'],[data-heading-level='4']"
        );
        const allSlugs: string[] = [];
        nodes.forEach((n) => {
          const s = n.dataset.slug;
          if (s) allSlugs.push(s);
        });
        setFoldedSlugs((prev) => {
          // If any are folded, unfold all; otherwise fold all
          const anyFolded = allSlugs.some((s) => prev.has(s));
          if (anyFolded) return new Set();
          return new Set(allSlugs);
        });
        return;
      }
      setFoldedSlugs((prev) => {
        const next = new Set(prev);
        if (next.has(slug)) next.delete(slug);
        else next.add(slug);
        return next;
      });
    },
    []
  );

  // Apply fold visibility to DOM siblings after render
  useLayoutEffect(() => {
    if (mode !== "preview") return;
    const root = previewRef.current;
    if (!root) return;

    const children = Array.from(root.children) as HTMLElement[];

    // Reset display
    children.forEach((el) => {
      el.style.display = "";
    });

    // Compute hidden ranges for each folded heading
    const headings = children
      .map((el, idx) => {
        const lvl = parseInt(el.dataset.headingLevel ?? "0", 10);
        return { el, idx, level: lvl, slug: el.dataset.slug ?? "" };
      })
      .filter((h) => h.level >= 1 && h.level <= 6);

    foldedSlugs.forEach((slug) => {
      const h = headings.find((x) => x.slug === slug);
      if (!h) return;
      for (let i = h.idx + 1; i < children.length; i++) {
        const nextLvl = parseInt(children[i].dataset.headingLevel ?? "0", 10);
        if (nextLvl >= 1 && nextLvl <= h.level) break;
        children[i].style.display = "none";
      }
    });
  }, [foldedSlugs, tab.content, mode]);

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
        className="markdown-viewer-toggle-bar"
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
        <button
          type="button"
          className="present-toggle-btn"
          onClick={() => setPresentationVisible(true)}
          title="Present (Ctrl+Shift+P)"
        >
          <Play size={12} />
          Present
        </button>
      </div>

      {/* Content */}
      {mode === "edit" ? (
        <MarkdownEditor tab={tab} />
      ) : mode === "preview" ? (
        <FoldContext.Provider value={{ foldedSlugs, toggleFold }}>
          <div
            ref={previewRef}
            className={`markdown-body selectable fade-in${showLineNumbers ? " show-line-numbers" : ""}`}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeRaw]}
              components={components}
            >
              {tab.content}
            </ReactMarkdown>
          </div>
        </FoldContext.Provider>
      ) : sourceHtml ? (
        <div className={`code-viewer selectable fade-in${showLineNumbers ? " show-line-numbers" : ""}`}>
          <div dangerouslySetInnerHTML={{ __html: sourceHtml }} />
        </div>
      ) : (
        <div className={`code-viewer selectable fade-in${showLineNumbers ? " show-line-numbers" : ""}`}>
          <pre style={{ fontFamily: "'Fira Code', monospace", fontSize: 13, lineHeight: 1.6, color: "var(--color-text)" }}>
            {tab.content}
          </pre>
        </div>
      )}
    </div>
  );
}
