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
 * Sub-agent entries (`isSidechain: true`) are grouped by their `sessionId` —
 * Claude Code writes one JSONL per sub-agent run, so the sessionId is the
 * stable identity of a sub-agent across interleaved timestamps. This
 * correctly handles parallel sub-agents whose messages arrive interleaved by
 * time (an older "consecutive run" grouper would have merged them).
 *
 * The most recent Task tool_use on the main thread supplies the lane's
 * subagent_type + description — we pair it with the sub-session it spawned
 * by taking the first sidechain-sessionId to appear after each Task.
 */
export function buildLaneModel(entries: LogEntry[]): LaneModel {
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

  // Pending Task invocations from the main thread that haven't yet been
  // matched to a sub-session. FIFO — the first new sidechain sessionId we
  // see claims the oldest pending Task.
  const pendingTasks: Array<{ description?: string; subagent_type?: string }> = [];
  // sessionId → lane (created lazily on first sidechain entry for that id).
  const subLanes = new Map<string, AgentLane>();
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

    const content = e.message?.content;
    if (Array.isArray(content) && !e.isSidechain) {
      for (const b of content as Array<Record<string, unknown>>) {
        if (b.type === "tool_use" && b.name === "Task") {
          const inp = b.input as Record<string, unknown> | undefined;
          pendingTasks.push({
            description: typeof inp?.description === "string" ? inp.description : undefined,
            subagent_type:
              typeof inp?.subagent_type === "string" ? inp.subagent_type : undefined,
          });
        }
      }
    }

    if (e.isSidechain) {
      const sid = typeof e.sessionId === "string" ? e.sessionId : `anon:${subIndex}`;
      let lane = subLanes.get(sid);
      if (!lane) {
        const taskInput = pendingTasks.shift();
        const key = taskInput?.subagent_type ?? `sub-${subIndex}`;
        lane = {
          id: `sub:${subIndex}`,
          kind: "subagent",
          label: taskInput?.subagent_type ?? `sub-agent ${subIndex + 1}`,
          subagentType: taskInput?.subagent_type,
          description: taskInput?.description,
          startIdx: i,
          endIdx: i,
          startedAt: t,
          endedAt: t,
          entryIdxs: [],
          color: colorForKey(key + ":" + subIndex),
          sessionId: typeof e.sessionId === "string" ? e.sessionId : undefined,
        };
        subLanes.set(sid, lane);
        subIndex++;
      }
      lane.entryIdxs.push(i);
      lane.endIdx = i;
      if (t) {
        if (!lane.startedAt) lane.startedAt = t;
        lane.endedAt = t;
      }
      continue;
    }

    if (mainLane.startIdx < 0) mainLane.startIdx = i;
    mainLane.endIdx = i;
    if (t) {
      if (!mainLane.startedAt) mainLane.startedAt = t;
      mainLane.endedAt = t;
    }
    mainLane.entryIdxs.push(i);
  }

  // Order sub-agent lanes by first timestamp (falling back to entry index),
  // so the timeline reads left-to-right by start time.
  const lanes = [...subLanes.values()].sort((a, b) => {
    const as = a.startedAt || a.startIdx;
    const bs = b.startedAt || b.startIdx;
    return as - bs;
  });
  // Disambiguate labels when the same `subagent_type` runs more than once —
  // without this, two parallel "general-purpose" agents render identical text
  // on both lanes and read as a single agent. We suffix " #N" only when
  // duplicates exist; uniquely-named lanes keep their bare type.
  const typeCounts = new Map<string, number>();
  for (const lane of lanes) {
    const t = lane.subagentType;
    if (!t) continue;
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const typeSeen = new Map<string, number>();
  for (const lane of lanes) {
    const t = lane.subagentType;
    if (!t) {
      lane.label = lane.label || `sub-agent`;
      continue;
    }
    if ((typeCounts.get(t) ?? 0) > 1) {
      const n = (typeSeen.get(t) ?? 0) + 1;
      typeSeen.set(t, n);
      lane.label = `${t} #${n}`;
    } else {
      lane.label = t;
    }
  }
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
 * Assign each sub-agent lane to its own row, in start-time order. Every
 * sub-agent gets a distinct swimlane — sequential and parallel runs alike —
 * so the user can read at a glance how many agents Claude spawned across the
 * session and trace each one's timing on its own line. (An earlier version
 * greedy-packed non-overlapping lanes onto shared rows, which collapsed two
 * sequential sub-agents into what looked like a single agent.)
 */
export function assignLaneRows(model: LaneModel): Map<string, number> {
  const rows = new Map<string, number>();
  rows.set("main", 0);
  const subs = model.lanes
    .filter((l) => l.kind === "subagent")
    .sort((a, b) => {
      const as = a.startedAt || a.startIdx;
      const bs = b.startedAt || b.startIdx;
      return as - bs;
    });
  subs.forEach((lane, i) => rows.set(lane.id, i + 1));
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
