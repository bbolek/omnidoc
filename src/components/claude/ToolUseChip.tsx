import { useMemo, useState } from "react";
import {
  Wrench,
  FileText,
  FolderSearch,
  Search,
  Pencil,
  FileEdit,
  Terminal as TerminalIcon,
  BookOpen,
  Globe,
  Bot,
  ListChecks,
  Circle,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

/**
 * A chip that represents one `tool_use` content block. Click to expand the
 * raw input JSON; the status icon on the right reflects whether a matching
 * `tool_result` has arrived yet.
 */
export function ToolUseChip({
  name,
  input,
  resultPresent,
  resultError,
  compact = false,
}: {
  name: string;
  input: unknown;
  resultPresent: boolean;
  resultError?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => summarizeInput(name, input), [name, input]);
  const Icon = iconFor(name);
  const StatusIcon = !resultPresent
    ? Loader2
    : resultError
      ? XCircle
      : CheckCircle2;
  const statusColor = !resultPresent
    ? "var(--color-text-muted)"
    : resultError
      ? "#cf222e"
      : "#1f883d";
  const statusSpin = !resultPresent;

  return (
    <div className={`claude-tool-chip${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="claude-tool-chip-head"
        onClick={() => setOpen((o) => !o)}
        title={name}
      >
        <span className="claude-tool-chip-icon">
          <Icon size={12} />
        </span>
        <span className="claude-tool-chip-name">{name}</span>
        {summary && <span className="claude-tool-chip-summary">{summary}</span>}
        <span className="claude-tool-chip-spacer" />
        <StatusIcon
          size={12}
          className={statusSpin ? "claude-spin" : ""}
          style={{ color: statusColor, flexShrink: 0 }}
        />
        {open ? (
          <ChevronDown size={11} style={{ color: "var(--color-text-muted)" }} />
        ) : (
          <ChevronRight size={11} style={{ color: "var(--color-text-muted)" }} />
        )}
      </button>
      {open && (
        <pre className="claude-tool-chip-body">
          {safeStringify(input)}
        </pre>
      )}
    </div>
  );
}

function iconFor(name: string) {
  switch (name) {
    case "Read":
    case "NotebookRead":
      return FileText;
    case "Edit":
    case "NotebookEdit":
      return FileEdit;
    case "Write":
      return Pencil;
    case "Glob":
      return FolderSearch;
    case "Grep":
      return Search;
    case "Bash":
      return TerminalIcon;
    case "WebSearch":
    case "WebFetch":
      return Globe;
    case "Task":
      return Bot;
    case "TodoWrite":
      return ListChecks;
    case "Skill":
      return BookOpen;
    default:
      return Wrench;
  }
}

function summarizeInput(name: string, input: unknown): string {
  if (input == null || typeof input !== "object") return "";
  const obj = input as Record<string, unknown>;
  const first = (keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return "";
  };
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return shorten(first(["file_path", "path"]));
    case "Glob":
      return shorten(first(["pattern"]));
    case "Grep":
      return shorten(first(["pattern"]));
    case "Bash":
      return shorten(first(["command"]));
    case "WebFetch":
      return shorten(first(["url"]));
    case "WebSearch":
      return shorten(first(["query"]));
    case "Task":
      return shorten(first(["description", "subagent_type"]));
    case "Skill":
      return shorten(first(["skill"]));
    default: {
      const keys = Object.keys(obj);
      if (keys.length === 0) return "";
      const v = obj[keys[0]];
      if (typeof v === "string") return shorten(v);
      return "";
    }
  }
}

function shorten(s: string, n = 64): string {
  if (!s) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : one.slice(0, n - 1) + "…";
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export { Circle };
