import { useMemo, useRef, useState, type CSSProperties } from "react";
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso";
import { ChevronDown, Search, Eye, EyeOff, Bot, User as UserIcon, Zap } from "lucide-react";
import type { LogEntry, SessionActivity } from "../../store/claudeStore";
import { MessageCard, type ToolResultMap } from "./MessageCard";
import { colorForKey, folderColor } from "../../utils/folderColors";
import { AgentTimeline } from "./AgentTimeline";
import { LiveTicker } from "./LiveTicker";
import { buildLaneModel, isLaneLive } from "./agentLanes";
import { useNow } from "./useNow";
import { formatDuration } from "./relTime";

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
  activity,
}: {
  entries: LogEntry[];
  live: boolean;
  activity: SessionActivity;
}) {
  const [query, setQuery] = useState("");
  const [showThinking, setShowThinking] = useState(false);
  const [showSidechain, setShowSidechain] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const now = useNow();

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

  // Build the lane model once per render — the timeline above and the
  // per-thread coloring below both key off it, so a shared derivation avoids
  // the two diverging (e.g. the timeline showing 3 lanes while the feed
  // labels the 3rd thread as "sub-agent 2").
  const laneModel = useMemo(() => buildLaneModel(renderable), [renderable]);

  // Group entries into linear items and sidechain threads. Each thread's
  // taskInput + matching lane is attached so colors stay consistent with the
  // timeline bars.
  const items = useMemo(
    () => groupSidechains(renderable, showSidechain, laneModel),
    [renderable, showSidechain, laneModel],
  );

  // If a lane is solo-selected, drop items that don't belong to it before
  // the text filter runs.
  const laneFiltered = useMemo(() => {
    if (!selectedLaneId) return items;
    if (selectedLaneId === "main") return items.filter((it) => it.kind === "entry");
    return items.filter(
      (it) => it.kind === "thread" && it.laneId === selectedLaneId,
    );
  }, [items, selectedLaneId]);

  // Filter by query (case-insensitive substring on text / tool_use input).
  const filtered = useMemo(() => {
    if (!query.trim()) return laneFiltered;
    const q = query.toLowerCase();
    return laneFiltered.filter((it) => {
      if (it.kind === "entry") return entryMatches(it.entry, q);
      return it.entries.some((e) => entryMatches(e, q));
    });
  }, [laneFiltered, query]);

  return (
    <div className="claude-feed">
      <LiveTicker activity={activity} />
      <AgentTimeline
        model={laneModel}
        activity={activity}
        selectedLaneId={selectedLaneId}
        onSelectLane={setSelectedLaneId}
      />
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
            // Pull color + live-state from the shared lane model so the
            // timeline bar at the top and the thread card in the feed always
            // agree on visuals.
            const lane = laneModel.lanes.find((l) => l.id === it.laneId);
            const color = lane
              ? lane.color
              : it.taskInput?.subagent_type
                ? colorForKey(it.taskInput.subagent_type)
                : folderColor(it.threadIndex);
            const laneLive = lane ? isLaneLive(lane, activity, now) : false;
            const currentTool =
              lane && lane.sessionId
                ? activity.activeSubagents[lane.sessionId]?.currentTool
                : undefined;
            return (
              <div className="claude-feed-row">
                <SubAgentThread
                  entries={it.entries}
                  toolResults={toolResults}
                  accent={color.accent}
                  tint={color.tint}
                  showThinking={showThinking}
                  taskInput={it.taskInput}
                  startedAt={lane?.startedAt}
                  endedAt={lane?.endedAt}
                  live={laneLive}
                  currentTool={currentTool?.name}
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
  startedAt,
  endedAt,
  live,
  currentTool,
}: {
  entries: LogEntry[];
  toolResults: ToolResultMap;
  accent: string;
  tint: string;
  showThinking: boolean;
  taskInput?: { description?: string; subagent_type?: string };
  startedAt?: number;
  endedAt?: number;
  live?: boolean;
  currentTool?: string;
}) {
  const [open, setOpen] = useState(true);
  const now = useNow();
  // Publish the thread's accent/tint as custom properties so descendants
  // (title text, the inner left-rail, nested card border) can pick them up
  // without each needing its own inline style.
  const style = {
    borderLeftColor: accent,
    background: tint,
    ["--sidechain-accent" as string]: accent,
    ["--sidechain-tint" as string]: tint,
  } as CSSProperties;
  const duration =
    startedAt && (endedAt || live)
      ? formatDuration((live ? now : endedAt!) - startedAt)
      : "";
  return (
    <div className={`claude-sidechain${live ? " live" : ""}`} style={style}>
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
        {live && currentTool && (
          <span className="claude-sidechain-tool" title={`Running ${currentTool}`}>
            <Zap size={10} /> {currentTool}
          </span>
        )}
        {live && <span className="claude-sidechain-live" title="Active sub-agent">live</span>}
        {duration && (
          <span
            className="claude-sidechain-duration"
            title={
              startedAt
                ? `Started ${new Date(startedAt).toLocaleString()}${
                    endedAt ? `, ended ${new Date(endedAt).toLocaleString()}` : ""
                  }`
                : undefined
            }
          >
            {duration}
          </span>
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
      laneId: string;
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
 * thread supplies a header (agent type + description). Attach the matching
 * lane id from the shared lane model so the thread and the timeline agree
 * on identity + color.
 */
function groupSidechains(
  entries: LogEntry[],
  show: boolean,
  laneModel: import("./agentLanes").LaneModel,
): Item[] {
  const out: Item[] = [];
  let threadIndex = 0;
  let currentThread: LogEntry[] | null = null;
  let lastTaskInput:
    | { description?: string; subagent_type?: string }
    | undefined;
  // `buildLaneModel` assigns sub-agent lanes in start-order, so walking the
  // sub-agent lanes with a parallel cursor keeps thread ↔ lane alignment.
  const subLanes = laneModel.lanes.filter((l) => l.kind === "subagent");
  let subCursor = 0;
  const pushThread = (thread: LogEntry[]) => {
    const lane = subLanes[subCursor++];
    out.push({
      kind: "thread",
      laneId: lane?.id ?? `sub:${threadIndex}`,
      entries: thread,
      threadIndex: threadIndex++,
      taskInput: lane
        ? { description: lane.description, subagent_type: lane.subagentType }
        : lastTaskInput,
    });
  };
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
      if (show) pushThread(currentThread);
      currentThread = null;
    }
    out.push({ kind: "entry", entry: e });
  }
  if (currentThread && show) {
    pushThread(currentThread);
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
