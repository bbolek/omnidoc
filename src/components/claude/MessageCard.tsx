import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
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
            title={ts.toLocaleString()}
            dateTime={ts.toISOString()}
          >
            {ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
      return (
        <div className="claude-md">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>{text}</ReactMarkdown>
        </div>
      );
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
      {open && <div className="claude-thinking-body">{text}</div>}
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
      {open && <pre className="claude-tool-result-body">{preview}</pre>}
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
