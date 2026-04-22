import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso";
import { ChevronDown, Search, Eye, EyeOff, Bot, User as UserIcon } from "lucide-react";
import type { LogEntry } from "../../store/claudeStore";
import { MessageCard, type ToolResultMap } from "./MessageCard";
import { colorForKey, folderColor } from "../../utils/folderColors";

/**
 * The meat of the drawer: a virtualized list of rendered message cards,
 * with sidechain (sub-agent) runs grouped into collapsible bordered threads.
 *
 * Virtuoso handles the heavy lifting — only the handful of rows in (and
 * just beyond) the viewport are mounted, so sessions with thousands of
 * entries render without stalling React. Each entry and each sidechain
 * thread is a single Virtuoso row; Virtuoso measures heights on the fly
 * via ResizeObserver so expanding thinking / tool-result disclosures just
 * work. `followOutput` keeps the view pinned to the bottom while new
 * entries stream in, unless the user has scrolled away.
 */
export function TranscriptFeed({
  entries,
  live,
}: {
  entries: LogEntry[];
  live: boolean;
}) {
  const [query, setQuery] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [showSidechain, setShowSidechain] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);

  // Build a map of tool_use_id → result info so chips can show status.
  const toolResults: ToolResultMap = useMemo(() => {
    const map: ToolResultMap = new Map();
    for (const e of entries) {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
          map.set(b.tool_use_id, { error: b.is_error === true });
        }
      }
    }
    return map;
  }, [entries]);

  // Drop bookkeeping records (queue-operation, attachment, last-prompt,
  // ai-title, …) — the CLI writes these alongside real messages, and without
  // a `message` field they'd render as empty "(no content)" system cards.
  const renderable = useMemo(() => entries.filter((e) => e.message != null), [entries]);

  // Group entries into linear items and sidechain threads.
  // A sidechain thread is a consecutive run of entries with isSidechain === true.
  // We keep the preceding Task tool_use entry outside the thread — it becomes
  // the header row, and the thread slots in right after it.
  const items = useMemo(() => groupSidechains(renderable, showSidechain), [renderable, showSidechain]);

  // Filter by query (case-insensitive substring on text / tool_use input).
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((it) => {
      if (it.kind === "entry") return entryMatches(it.entry, q);
      return it.entries.some((e) => entryMatches(e, q));
    });
  }, [items, query]);

  return (
    <div className="claude-feed">
      <div className="claude-feed-toolbar">
        <label className="claude-feed-search">
          <Search size={12} />
          <input
            type="text"
            placeholder="Filter transcript…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={`claude-feed-toggle${showThinking ? " active" : ""}`}
          onClick={() => setShowThinking((v) => !v)}
          title="Show / hide thinking blocks"
        >
          {showThinking ? <Eye size={12} /> : <EyeOff size={12} />}
          <span>thinking</span>
        </button>
        <button
          type="button"
          className={`claude-feed-toggle${showSidechain ? " active" : ""}`}
          onClick={() => setShowSidechain((v) => !v)}
          title="Show / hide sub-agent threads"
        >
          {showSidechain ? <Bot size={12} /> : <UserIcon size={12} />}
          <span>agents</span>
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="claude-feed-empty">
          {renderable.length === 0
            ? live
              ? "Listening for the first message…"
              : "This session has no entries yet."
            : "No entries match your filter."}
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          className="claude-feed-scroll"
          data={filtered}
          // Start at the most recent entry. Only applied on mount — subsequent
          // appends are kept in view by `followOutput` below.
          initialTopMostItemIndex={Math.max(0, filtered.length - 1)}
          // Render ~400px of extra rows above and below the viewport so fast
          // scrolling doesn't flash empty space while cards measure in.
          increaseViewportBy={400}
          atBottomStateChange={setAtBottom}
          // Auto-pin to the bottom when new entries stream in, but only if
          // the user is already at the bottom. `"auto"` = jump instantly (no
          // smooth-scroll spam during a 200-entry backfill).
          followOutput={(isAtBottom) => (isAtBottom ? "auto" : false)}
          components={FEED_COMPONENTS}
          computeItemKey={(i, it) =>
            it.kind === "entry"
              ? `e-${it.entry.uuid ?? i}`
              : `t-${it.entries[0]?.uuid ?? i}`
          }
          itemContent={(_i, it) => {
            if (it.kind === "entry") {
              return (
                <div className="claude-feed-row">
                  <MessageCard
                    entry={it.entry}
                    toolResults={toolResults}
                    showThinking={showThinking}
                  />
                </div>
              );
            }
            // Prefer a name-derived color so the same agent type reads the
            // same shade across runs (and parallel siblings pick up distinct
            // shades). Fall back to the thread index only when the Task
            // tool_use didn't carry a subagent_type.
            const color = it.taskInput?.subagent_type
              ? colorForKey(it.taskInput.subagent_type)
              : folderColor(it.threadIndex);
            return (
              <div className="claude-feed-row">
                <SubAgentThread
                  entries={it.entries}
                  toolResults={toolResults}
                  accent={color.accent}
                  tint={color.tint}
                  showThinking={showThinking}
                  taskInput={it.taskInput}
                />
              </div>
            );
          }}
        />
      )}

      {!atBottom && filtered.length > 0 && (
        <button
          type="button"
          className="claude-feed-follow"
          onClick={() => {
            virtuosoRef.current?.scrollToIndex({
              index: filtered.length - 1,
              behavior: "smooth",
              align: "end",
            });
          }}
          title="Jump to latest"
        >
          <ChevronDown size={13} /> latest
        </button>
      )}
    </div>
  );
}

function SubAgentThread({
  entries,
  toolResults,
  accent,
  tint,
  showThinking,
  taskInput,
}: {
  entries: LogEntry[];
  toolResults: ToolResultMap;
  accent: string;
  tint: string;
  showThinking: boolean;
  taskInput?: { description?: string; subagent_type?: string };
}) {
  const [open, setOpen] = useState(true);
  // Publish the thread's accent/tint as custom properties so descendants
  // (title text, the inner left-rail, nested card border) can pick them up
  // without each needing its own inline style.
  const style = {
    borderLeftColor: accent,
    background: tint,
    ["--sidechain-accent" as string]: accent,
    ["--sidechain-tint" as string]: tint,
  } as CSSProperties;
  return (
    <div className="claude-sidechain" style={style}>
      <button
        type="button"
        className="claude-sidechain-head"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronDown size={12} style={{ transform: "rotate(-90deg)" }} />}
        <Bot size={12} style={{ color: accent }} />
        <span className="claude-sidechain-title">
          {taskInput?.subagent_type ? `${taskInput.subagent_type}` : "sub-agent"}
        </span>
        {taskInput?.description && (
          <span className="claude-sidechain-desc">{taskInput.description}</span>
        )}
        <span className="claude-sidechain-count">{entries.length} msg</span>
      </button>
      {open && (
        <div className="claude-sidechain-body">
          {entries.map((e, i) => (
            <MessageCard
              key={`se-${i}-${e.uuid ?? ""}`}
              entry={e}
              toolResults={toolResults}
              isSidechain
              sidechainAccent={accent}
              showThinking={showThinking}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type Item =
  | { kind: "entry"; entry: LogEntry }
  | {
      kind: "thread";
      entries: LogEntry[];
      threadIndex: number;
      taskInput?: { description?: string; subagent_type?: string };
    };

// Hoisted so its identity is stable across renders — Virtuoso treats a new
// `components` object as a prop change and tears down measurements.
const FEED_COMPONENTS: Components<Item> = {
  Header: () => <div className="claude-feed-spacer-top" />,
  Footer: () => <div className="claude-feed-spacer-bottom" />,
};

/**
 * Walk entries and bundle every consecutive run of `isSidechain: true`
 * messages into a thread item. The most recent Task tool_use preceding the
 * thread supplies a header (agent type + description).
 */
function groupSidechains(entries: LogEntry[], show: boolean): Item[] {
  const out: Item[] = [];
  let threadIndex = 0;
  let currentThread: LogEntry[] | null = null;
  let lastTaskInput:
    | { description?: string; subagent_type?: string }
    | undefined;
  for (const e of entries) {
    // Track the latest Task tool_use input so we can label the next thread.
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && b.name === "Task") {
          const inp = b.input as Record<string, unknown> | undefined;
          lastTaskInput = {
            description: inp && typeof inp.description === "string" ? inp.description : undefined,
            subagent_type:
              inp && typeof inp.subagent_type === "string" ? inp.subagent_type : undefined,
          };
        }
      }
    }
    if (e.isSidechain) {
      if (!currentThread) currentThread = [];
      currentThread.push(e);
      continue;
    }
    if (currentThread) {
      if (show) {
        out.push({
          kind: "thread",
          entries: currentThread,
          threadIndex: threadIndex++,
          taskInput: lastTaskInput,
        });
      }
      currentThread = null;
    }
    out.push({ kind: "entry", entry: e });
  }
  if (currentThread && show) {
    out.push({
      kind: "thread",
      entries: currentThread,
      threadIndex: threadIndex++,
      taskInput: lastTaskInput,
    });
  }
  return out;
}

function entryMatches(entry: LogEntry, q: string): boolean {
  const content = entry.message?.content;
  if (typeof content === "string") return content.toLowerCase().includes(q);
  if (!Array.isArray(content)) return false;
  for (const b of content as Array<Record<string, unknown>>) {
    if (b.type === "text" && typeof b.text === "string" && b.text.toLowerCase().includes(q)) {
      return true;
    }
    if (b.type === "tool_use") {
      try {
        if (JSON.stringify(b.input).toLowerCase().includes(q)) return true;
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}
