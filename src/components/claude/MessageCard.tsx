import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  User,
  Sparkles,
  Brain,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import type { LogEntry } from "../../store/claudeStore";
import { ToolUseChip } from "./ToolUseChip";
import { relTime } from "./relTime";
import { useNow } from "./useNow";
import { useThemeStore } from "../../store/themeStore";
import { getShikiTheme } from "../../themes";
import { highlight } from "../../utils/shikiUtils";

// Inline URL matcher used to linkify plain-text tool output. Anchored on
// protocol, non-greedy up to the first whitespace or common trailing
// punctuation, so "See https://example.com." doesn't drag the period into
// the link.
const URL_RE = /\bhttps?:\/\/[^\s<>"'()\]]+[^\s<>"'()\].,;:!?]/g;

function handleExternalLink(e: React.MouseEvent<HTMLAnchorElement>, href?: string) {
  if (!href) return;
  if (!/^https?:/i.test(href)) return;
  e.preventDefault();
  openExternal(href).catch((err) => console.warn("[claude] openExternal failed:", err));
}

/** Shiki-highlighted block. Renders a plain `<pre>` fallback until the
 *  async highlighter resolves, then swaps to the themed HTML. Used by both
 *  the JSON pretty-print path in SmartText and the Markdown fenced-code
 *  override below. */
function ShikiBlock({
  code,
  lang,
  dense,
}: {
  code: string;
  lang: string;
  dense?: boolean;
}) {
  const { themeName } = useThemeStore();
  const [html, setHtml] = useState("");
  useEffect(() => {
    let cancelled = false;
    highlight(code, lang, getShikiTheme(themeName))
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch((err) => {
        // Surface highlight failures so the next person doesn't have to guess
        // why the plain-text fallback never swaps in. See shikiUtils for the
        // common causes (unsupported theme, highlighter init, etc).
        console.warn("[claude] ShikiBlock highlight failed:", err);
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, themeName]);

  const cls = `claude-shiki${dense ? " dense" : ""}`;
  if (!html) {
    return (
      <pre className={`claude-code-block${dense ? " dense" : ""}`}>
        <code>{code}</code>
      </pre>
    );
  }
  return <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Map common language aliases used in Markdown fence info strings to the
 *  language names Shiki knows about. Unknown values fall through to "text"
 *  inside `highlight()`. */
function normalizeLang(input: string | undefined): string {
  if (!input) return "text";
  const l = input.toLowerCase();
  const map: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    "c++": "cpp",
    cs: "csharp",
    ps1: "powershell",
  };
  return map[l] ?? l;
}

/** ReactMarkdown component overrides: intercept link clicks so they open in
 *  the user's default browser instead of navigating the Tauri webview, and
 *  route fenced code blocks through Shiki so ```json / ```python etc. get
 *  proper syntax highlighting in the panel. */
const MD_COMPONENTS: Components = {
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => handleExternalLink(e, href)}
      {...props}
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const langMatch = className?.match(/language-(\w+)/);
    const raw = String(children ?? "");
    // react-markdown v9 dropped the `inline` prop. Fenced blocks pass through
    // remark with a trailing "\n" in their value; inline `` `code` `` never
    // has one. Using the raw newline (before we strip it) reliably
    // distinguishes the two even when a fenced block has no language and
    // only one line of content.
    const inline = !langMatch && !raw.endsWith("\n");
    if (inline) {
      return <code className={className} {...props}>{children}</code>;
    }
    const code = raw.replace(/\n$/, "");
    return <ShikiBlock code={code} lang={normalizeLang(langMatch?.[1])} />;
  },
  pre: ({ children }) => <>{children}</>,
};

const MD_REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/** Try to parse `text` as JSON and return a pretty-printed version. Returns
 *  `null` if the input isn't JSON (or is a bare scalar — pretty-printing
 *  `"hello"` as `"hello"` is pointless). Handles whitespace tolerantly so
 *  tool output with a trailing newline still succeeds. */
function tryPrettyJson(text: string): string | null {
  const t = text.trim();
  if (t.length < 2) return null;
  const first = t[0];
  const last = t[t.length - 1];
  if (!((first === "{" && last === "}") || (first === "[" && last === "]"))) {
    return null;
  }
  try {
    const parsed = JSON.parse(t);
    if (parsed == null || typeof parsed !== "object") return null;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Cheap heuristic: does this text contain enough Markdown-ish markers to be
 *  worth rendering via the markdown pipeline? Plain CLI output (like `ls`
 *  stdout, stack traces) renders badly through Markdown — leading `#` turns
 *  into a heading, indented blocks collapse, etc. Only flip to Markdown when
 *  we see clear authored structure. */
function looksLikeMarkdown(text: string): boolean {
  // Headings (`# `, `## `, …), fenced code blocks, inline links, bullet/numbered
  // lists at line start, bold/italic, or blockquotes. Anchored to line starts
  // (via `\n` / string start) to avoid matching random `#` inside log output.
  return /(^|\n)(#{1,6} |> |[-*] |\d+\. )|```|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/.test(text);
}

/** Best-effort smart renderer: JSON → syntax-highlighted pretty block,
 *  Markdown-shaped text → ReactMarkdown, anything else → a plain-text block
 *  with autolinked URLs. Used in both message text blocks and tool-result
 *  previews, so every surface in the panel formats the same way. */
function SmartText({ text, dense }: { text: string; dense?: boolean }) {
  const json = useMemo(() => tryPrettyJson(text), [text]);
  if (json != null) {
    return <ShikiBlock code={json} lang="json" dense={dense} />;
  }
  if (looksLikeMarkdown(text)) {
    return (
      <div className="claude-md">
        <ReactMarkdown remarkPlugins={MD_REMARK_PLUGINS} components={MD_COMPONENTS}>
          {text}
        </ReactMarkdown>
      </div>
    );
  }
  return (
    <pre className={`claude-plain${dense ? " dense" : ""}`}>{linkifyText(text)}</pre>
  );
}

/** Split a plain-text string into an array of strings and <a> nodes for
 *  every URL found. Used inside `<pre>` tool-result bodies where we can't
 *  run a markdown parser but still want click-through links. */
function linkifyText(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(text)) != null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    const url = match[0];
    out.push(
      <a
        key={`${match.index}-${url}`}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => handleExternalLink(e, url)}
      >
        {url}
      </a>,
    );
    lastIndex = match.index + url.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out.length > 0 ? out : [text];
}

/** Map from tool_use id → whether its matching tool_result arrived (and if errored). */
export type ToolResultMap = Map<string, { error: boolean }>;

interface Props {
  entry: LogEntry;
  toolResults: ToolResultMap;
  isSidechain?: boolean;
  sidechainAccent?: string;
  showThinking?: boolean;
}

export function MessageCard({
  entry,
  toolResults,
  isSidechain,
  sidechainAccent,
  showThinking = false,
}: Props) {
  const role = entry.message?.role ?? (entry.type === "user" ? "user" : entry.type === "assistant" ? "assistant" : "system");
  const model = entry.message?.model;
  const ts = entry.timestamp ? new Date(entry.timestamp) : null;
  const now = useNow();
  const content = entry.message?.content;

  // User messages sometimes carry a plain string, sometimes an array of
  // content blocks. Assistant messages are always arrays of blocks.
  const rawBlocks: ContentBlock[] = Array.isArray(content)
    ? (content as ContentBlock[])
    : typeof content === "string"
      ? [{ type: "text", text: content }]
      : [];

  // Drop blocks that would render nothing so the `(no content)` placeholder
  // below fires instead of leaving the bubble visually blank. An assistant
  // turn with only whitespace text or only empty thinking would otherwise
  // show just the header and an empty body.
  const blocks = rawBlocks.filter((b) => {
    if (b.type === "text") return ((b as TextBlock).text ?? "").trim().length > 0;
    if (b.type === "thinking")
      return ((b as ThinkingBlock).thinking ?? "").trim().length > 0;
    return true;
  });

  const isAssistant = role === "assistant";
  const RoleIcon = isAssistant ? Sparkles : role === "user" ? User : AlertTriangle;

  return (
    <div
      className={`claude-msg claude-msg-${role}${isSidechain ? " sidechain" : ""}`}
      style={
        sidechainAccent
          ? { borderLeftColor: sidechainAccent }
          : undefined
      }
    >
      <div className="claude-msg-head">
        <div className="claude-msg-avatar" data-role={role}>
          <RoleIcon size={12} />
        </div>
        <span className="claude-msg-role">
          {isSidechain ? "sub-agent" : role}
        </span>
        {model && isAssistant && (
          <span className="claude-msg-model" title={model}>{shortModel(model)}</span>
        )}
        <span className="claude-msg-spacer" />
        {ts && (
          <time
            className="claude-msg-time"
            title={`${ts.toLocaleString()} · ${ts.toISOString()}`}
            dateTime={ts.toISOString()}
          >
            <span className="claude-msg-time-rel">{relTime(ts.getTime(), now)}</span>
            <span className="claude-msg-time-abs">
              {ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </time>
        )}
      </div>
      <div className="claude-msg-body">
        {blocks.length === 0 && (
          <span className="claude-msg-empty">(no content)</span>
        )}
        {blocks.map((b, i) => (
          <Block key={i} block={b} toolResults={toolResults} showThinking={showThinking} />
        ))}
      </div>
    </div>
  );
}

interface TextBlock { type: "text"; text: string }
interface ThinkingBlock { type: "thinking"; thinking: string }
interface ToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }
interface ToolResultBlock { type: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean }
interface ImageBlock { type: "image"; source?: unknown }
type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock | { type: string; [k: string]: unknown };

function Block({
  block,
  toolResults,
  showThinking,
}: {
  block: ContentBlock;
  toolResults: ToolResultMap;
  showThinking: boolean;
}) {
  switch (block.type) {
    case "text": {
      const text = (block as TextBlock).text ?? "";
      if (!text.trim()) return null;
      return <SmartText text={text} />;
    }
    case "thinking":
      return <ThinkingDisclosure text={(block as ThinkingBlock).thinking ?? ""} startOpen={showThinking} />;
    case "tool_use": {
      const tu = block as ToolUseBlock;
      const r = toolResults.get(tu.id);
      return (
        <ToolUseChip
          name={tu.name}
          input={tu.input}
          resultPresent={!!r}
          resultError={r?.error}
        />
      );
    }
    case "tool_result": {
      const tr = block as ToolResultBlock;
      return <ToolResultView content={tr.content} isError={!!tr.is_error} />;
    }
    case "image":
      return <div className="claude-inline-chip"><em>(image)</em></div>;
    default:
      return (
        <div className="claude-inline-chip" title={String((block as { type: string }).type)}>
          <em>({(block as { type: string }).type})</em>
        </div>
      );
  }
}

function ThinkingDisclosure({ text, startOpen }: { text: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!text.trim()) return null;
  return (
    <div className="claude-thinking">
      <button
        type="button"
        className="claude-thinking-head"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Brain size={11} />
        <span>Thinking</span>
        <span className="claude-thinking-count">{approxWords(text)} words</span>
      </button>
      {open && <div className="claude-thinking-body">{linkifyText(text)}</div>}
    </div>
  );
}

function ToolResultView({ content, isError }: { content: unknown; isError: boolean }) {
  const [open, setOpen] = useState(false);
  const preview = renderPreview(content);
  return (
    <div className={`claude-tool-result${isError ? " error" : ""}`}>
      <button
        type="button"
        className="claude-tool-result-head"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{isError ? "error" : "result"}</span>
        <span className="claude-tool-result-preview">{shorten(preview, 90)}</span>
      </button>
      {open && (
        <div className="claude-tool-result-body">
          <SmartText text={preview} dense />
        </div>
      )}
    </div>
  );
}

function renderPreview(content: unknown): string {
  if (typeof content === "string") return stripAnsi(content);
  if (Array.isArray(content)) {
    return stripAnsi(
      content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object" && "text" in (c as Record<string, unknown>)) {
            return String((c as Record<string, unknown>).text ?? "");
          }
          return "";
        })
        .join("\n")
    );
  }
  if (content == null) return "";
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

// Tool stdout often contains ANSI color / cursor sequences (e.g. a `tree`
// command's `\x1b[37m…\x1b[39m` coloring) because CLI tools don't always
// detect that they're piped. A `<pre>` swallows the ESC byte but leaves the
// `[39m` / `[37m` payload visible as literal text — strip both the escape
// form and its bare-CSI variant so the preview reads as plain text.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function approxWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function shorten(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function shortModel(m: string): string {
  // "claude-opus-4-7" → "opus 4.7", "claude-sonnet-4-6" → "sonnet 4.6"
  const match = m.match(/^claude-([a-z]+)-(\d+)-(\d+)/);
  if (!match) return m;
  return `${match[1]} ${match[2]}.${match[3]}`;
}

export function _assertReactNode(n: ReactNode): ReactNode {
  return n;
}
