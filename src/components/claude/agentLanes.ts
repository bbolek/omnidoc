import type { LogEntry, SessionActivity } from "../../store/claudeStore";
import { colorForKey, folderColor, type FolderColor } from "../../utils/folderColors";

/**
 * A "lane" is one agent's continuous run. The main agent has exactly one lane
 * per session. Each sub-agent Task invocation gets its own lane — a
 * consecutive sidechain thread bounded by the preceding Task tool_use and the
 * trailing return-to-main-thread.
 *
 * Lanes are the unit of time/space the swim-lane timeline draws. A lane with
 * no end timestamp is still open (running). Lanes overlap when sub-agents run
 * in parallel, and the timeline stacks them vertically so concurrency reads
 * at a glance.
 */
export interface AgentLane {
  /** Stable per-session lane id — `main` for the root, `sub:<index>` for sub-agents. */
  id: string;
  kind: "main" | "subagent";
  label: string;
  subagentType?: string;
  description?: string;
  /** First entry index belonging to this lane, within the flat entries array. */
  startIdx: number;
  /** Last entry index (inclusive). */
  endIdx: number;
  /** Timestamps in ms (epoch). 0 means unknown. */
  startedAt: number;
  endedAt: number;
  /** Indices (within `entries`) that belong to this lane, in order. */
  entryIdxs: number[];
  /** Color picked deterministically from subagent_type (or lane index). */
  color: FolderColor;
  /** Session id on the sub-agent entries — lets us correlate hook events. */
  sessionId?: string;
}

export interface LaneModel {
  /** All lanes ordered by start, with main first. */
  lanes: AgentLane[];
  /** Max concurrent sub-agent lanes observed at any instant — drives timeline row count. */
  maxConcurrentSub: number;
  /** Global time span across entries. */
  minT: number;
  maxT: number;
}

/**
 * Walk entries once, bucket them into the main lane or a sub-agent lane.
 * Consecutive isSidechain entries form one lane; a non-sidechain entry breaks
 * the run. The Task tool_use preceding the sidechain supplies the lane's
 * subagent_type + description; we also record the sub-agent's sessionId from
 * the first sidechain entry so hook events can be matched.
 */
export function buildLaneModel(entries: LogEntry[]): LaneModel {
  const lanes: AgentLane[] = [];
  const mainLane: AgentLane = {
    id: "main",
    kind: "main",
    label: "main",
    startIdx: -1,
    endIdx: -1,
    startedAt: 0,
    endedAt: 0,
    entryIdxs: [],
    color: folderColor(0),
  };

  let lastTaskInput: { description?: string; subagent_type?: string } | undefined;
  let currentSub: AgentLane | null = null;
  let subIndex = 0;
  let minT = Number.POSITIVE_INFINITY;
  let maxT = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const t = e.timestamp ? Date.parse(e.timestamp) : 0;
    if (t) {
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }

    // Track the latest Task tool_use's input so we can label the next sub-agent lane.
    const content = e.message?.content;
    if (Array.isArray(content)) {
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && b.name === "Task") {
          const inp = b.input as Record<string, unknown> | undefined;
          lastTaskInput = {
            description: typeof inp?.description === "string" ? inp.description : undefined,
            subagent_type:
              typeof inp?.subagent_type === "string" ? inp.subagent_type : undefined,
          };
        }
      }
    }

    if (e.isSidechain) {
      if (!currentSub) {
        const key = lastTaskInput?.subagent_type ?? `sub-${subIndex}`;
        currentSub = {
          id: `sub:${subIndex}`,
          kind: "subagent",
          label: lastTaskInput?.subagent_type ?? `sub-agent ${subIndex + 1}`,
          subagentType: lastTaskInput?.subagent_type,
          description: lastTaskInput?.description,
          startIdx: i,
          endIdx: i,
          startedAt: t,
          endedAt: t,
          entryIdxs: [],
          color: colorForKey(key + ":" + subIndex),
          sessionId: typeof e.sessionId === "string" ? e.sessionId : undefined,
        };
        subIndex++;
      }
      currentSub.entryIdxs.push(i);
      currentSub.endIdx = i;
      if (t) currentSub.endedAt = t;
      if (!currentSub.sessionId && typeof e.sessionId === "string") {
        currentSub.sessionId = e.sessionId;
      }
      continue;
    }

    if (currentSub) {
      lanes.push(currentSub);
      currentSub = null;
    }
    if (mainLane.startIdx < 0) mainLane.startIdx = i;
    mainLane.endIdx = i;
    if (t) {
      if (!mainLane.startedAt) mainLane.startedAt = t;
      mainLane.endedAt = t;
    }
    mainLane.entryIdxs.push(i);
  }
  if (currentSub) lanes.push(currentSub);

  const ordered: AgentLane[] = [mainLane, ...lanes];
  // Pick a nice main-agent color distinct from the palette-hashed sub-agents.
  mainLane.color = { accent: "#0969da", tint: "rgba(9,105,218,0.12)" };
  if (mainLane.startIdx < 0) {
    mainLane.startIdx = 0;
    mainLane.endIdx = Math.max(0, entries.length - 1);
  }

  // Compute max concurrency among sub-agent lanes via a sweep-line on their
  // time ranges (falling back to index ranges when timestamps are missing).
  const ranges = lanes
    .map((l) => ({
      a: l.startedAt || l.startIdx,
      b: (l.endedAt || l.endIdx) + 1,
    }))
    .sort((x, y) => x.a - y.a);
  let maxConcurrentSub = 0;
  const activeEnds: number[] = [];
  for (const r of ranges) {
    for (let i = activeEnds.length - 1; i >= 0; i--) {
      if (activeEnds[i] <= r.a) activeEnds.splice(i, 1);
    }
    activeEnds.push(r.b);
    if (activeEnds.length > maxConcurrentSub) maxConcurrentSub = activeEnds.length;
  }

  if (!Number.isFinite(minT)) minT = 0;
  return { lanes: ordered, maxConcurrentSub, minT, maxT };
}

/**
 * Assign each sub-agent lane to the lowest-numbered "row" such that no earlier
 * lane on that row overlaps. Greedy interval-graph coloring — gives the
 * timeline a clean stacked view where concurrent lanes occupy distinct rows.
 */
export function assignLaneRows(model: LaneModel): Map<string, number> {
  const rowEnds: number[] = []; // end (exclusive) of last lane on each row
  const rows = new Map<string, number>();
  rows.set("main", 0);
  const subs = model.lanes.filter((l) => l.kind === "subagent");
  // Sort by start so the greedy assignment is stable.
  const sorted = [...subs].sort((a, b) => {
    const as = a.startedAt || a.startIdx;
    const bs = b.startedAt || b.startIdx;
    return as - bs;
  });
  for (const lane of sorted) {
    const start = lane.startedAt || lane.startIdx;
    const end = (lane.endedAt || lane.endIdx) + 1;
    let placed = false;
    for (let r = 0; r < rowEnds.length; r++) {
      if (rowEnds[r] <= start) {
        rowEnds[r] = end;
        rows.set(lane.id, r + 1); // +1 so main occupies row 0
        placed = true;
        break;
      }
    }
    if (!placed) {
      rowEnds.push(end);
      rows.set(lane.id, rowEnds.length); // new row below
    }
  }
  return rows;
}

/** Is this lane currently "live" — has a hook event landed for its sessionId within the window? */
export function isLaneLive(
  lane: AgentLane,
  activity: SessionActivity,
  nowMs: number,
  windowMs = 30_000,
): boolean {
  if (lane.kind === "main") {
    if (activity.status === "running" && activity.lastEventAt) {
      return nowMs - activity.lastEventAt < windowMs;
    }
    return activity.currentTool != null;
  }
  if (!lane.sessionId) return false;
  const sub = activity.activeSubagents[lane.sessionId];
  if (!sub) return false;
  return nowMs - sub.lastEventAt < windowMs;
}
