import { useMemo, type CSSProperties } from "react";
import { Bot, User as UserIcon, Zap, Filter, X } from "lucide-react";
import type { SessionActivity } from "../../store/claudeStore";
import {
  assignLaneRows,
  isLaneLive,
  type AgentLane,
  type LaneModel,
} from "./agentLanes";
import { formatDuration, relTime } from "./relTime";
import { useNow } from "./useNow";

/**
 * Mission-control style swim-lane timeline. Draws one row per concurrent
 * agent (main on top, sub-agents stacked below in the order they start).
 * Each lane is a colored segment positioned proportionally across the
 * session's overall time span, so two sub-agents running in parallel render
 * side-by-side on adjacent rows — making concurrency visible at a glance.
 *
 * Live lanes (those whose hook events are still flowing) pulse with a
 * moving gradient. Clicking a lane solo-filters the transcript below to
 * that agent's messages; clicking again clears the filter.
 */
export function AgentTimeline({
  model,
  activity,
  selectedLaneId,
  onSelectLane,
}: {
  model: LaneModel;
  activity: SessionActivity;
  selectedLaneId: string | null;
  onSelectLane: (id: string | null) => void;
}) {
  const now = useNow();
  const rowMap = useMemo(() => assignLaneRows(model), [model]);
  const rowCount = Math.max(1, ...Array.from(rowMap.values()).map((r) => r + 1));

  // Time domain: use the model's observed span, widen to "now" if any lane is
  // still live so the current activity bar reaches the right edge.
  const anyLive = model.lanes.some((l) => isLaneLive(l, activity, now));
  const minT = model.minT || model.maxT || now - 60_000;
  const maxT = anyLive ? Math.max(model.maxT, now) : model.maxT || minT + 60_000;
  const span = Math.max(1, maxT - minT);

  // If there are no subagent lanes we still render the bar so the live
  // indicator / filter chips have a home — that's why the grid always has
  // at least one row.
  const subLanes = model.lanes.filter((l) => l.kind === "subagent");
  const hasSub = subLanes.length > 0;

  return (
    <div className="claude-lanes">
      <div className="claude-lanes-head">
        <span className="claude-lanes-title">
          <Zap size={11} /> agents
        </span>
        <span className="claude-lanes-meta">
          {hasSub ? (
            <>
              {subLanes.length} sub-agent{subLanes.length === 1 ? "" : "s"}
              {model.maxConcurrentSub > 1 && (
                <span className="claude-lanes-concurrent" title="Max concurrent sub-agents">
                  · up to {model.maxConcurrentSub} at once
                </span>
              )}
            </>
          ) : (
            <span className="claude-lanes-empty">no sub-agents yet</span>
          )}
        </span>
        {selectedLaneId && (
          <button
            type="button"
            className="claude-lanes-clear"
            onClick={() => onSelectLane(null)}
            title="Clear lane filter"
          >
            <X size={10} /> clear filter
          </button>
        )}
      </div>

      <div
        className="claude-lanes-track"
        style={{ ["--lane-rows" as string]: rowCount } as CSSProperties}
      >
        {model.lanes.map((lane) => {
          const row = rowMap.get(lane.id) ?? 0;
          const start = lane.startedAt || minT;
          const end = Math.max(start + 1, lane.endedAt || (anyLive && isLaneLive(lane, activity, now) ? now : start));
          const left = ((start - minT) / span) * 100;
          const width = Math.max(1.5, ((end - start) / span) * 100);
          const live = isLaneLive(lane, activity, now);
          const selected = selectedLaneId === lane.id;

          return (
            <LaneBar
              key={lane.id}
              lane={lane}
              row={row}
              left={left}
              width={width}
              live={live}
              selected={selected}
              onClick={() =>
                onSelectLane(selectedLaneId === lane.id ? null : lane.id)
              }
            />
          );
        })}
      </div>

      <LaneLegend
        lanes={model.lanes}
        activity={activity}
        selectedLaneId={selectedLaneId}
        onSelectLane={onSelectLane}
        nowMs={now}
      />
    </div>
  );
}

function LaneBar({
  lane,
  row,
  left,
  width,
  live,
  selected,
  onClick,
}: {
  lane: AgentLane;
  row: number;
  left: number;
  width: number;
  live: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const style: CSSProperties = {
    gridRow: row + 1,
    left: `${left}%`,
    width: `${width}%`,
    ["--lane-accent" as string]: lane.color.accent,
    ["--lane-tint" as string]: lane.color.tint,
  };
  const dur =
    lane.startedAt && lane.endedAt
      ? formatDuration(lane.endedAt - lane.startedAt)
      : "";
  const title =
    lane.kind === "main"
      ? `main agent · ${lane.entryIdxs.length} msgs${dur ? ` · ${dur}` : ""}`
      : `${lane.subagentType ?? "sub-agent"}${
          lane.description ? `: ${lane.description}` : ""
        } · ${lane.entryIdxs.length} msgs${dur ? ` · ${dur}` : ""}`;

  return (
    <button
      type="button"
      className={`claude-lane-bar${live ? " live" : ""}${selected ? " selected" : ""} ${
        lane.kind === "main" ? "main" : "sub"
      }`}
      style={style}
      onClick={onClick}
      title={title}
    >
      <span className="claude-lane-bar-label">
        {lane.kind === "main" ? (
          <UserIcon size={9} />
        ) : (
          <Bot size={9} />
        )}
        <span>{lane.kind === "main" ? "main" : lane.subagentType ?? "sub"}</span>
      </span>
    </button>
  );
}

function LaneLegend({
  lanes,
  activity,
  selectedLaneId,
  onSelectLane,
  nowMs,
}: {
  lanes: AgentLane[];
  activity: SessionActivity;
  selectedLaneId: string | null;
  onSelectLane: (id: string | null) => void;
  nowMs: number;
}) {
  // Show each lane as a color-coded chip. Order = main first, then sub-agents
  // by start time. Chip displays: color dot, name, msg count, live pulse +
  // currently-running tool name, elapsed time. Clicking = filter.
  const chips = lanes;
  return (
    <div className="claude-lanes-legend">
      {chips.map((lane) => {
        const live = isLaneLive(lane, activity, nowMs);
        const selected = selectedLaneId === lane.id;
        const currentTool =
          lane.kind === "main"
            ? activity.currentTool
            : lane.sessionId
              ? activity.activeSubagents[lane.sessionId]?.currentTool
              : undefined;
        const elapsed =
          lane.startedAt && (lane.endedAt || live)
            ? formatDuration((live ? nowMs : lane.endedAt) - lane.startedAt)
            : "";
        const lastT = lane.endedAt || lane.startedAt;
        return (
          <button
            key={lane.id}
            type="button"
            className={`claude-lane-chip${live ? " live" : ""}${
              selected ? " selected" : ""
            }`}
            style={
              {
                ["--lane-accent" as string]: lane.color.accent,
                ["--lane-tint" as string]: lane.color.tint,
              } as CSSProperties
            }
            onClick={() =>
              onSelectLane(selectedLaneId === lane.id ? null : lane.id)
            }
            title={
              lane.kind === "main"
                ? `Solo-view the main agent`
                : `${lane.subagentType ?? "sub-agent"}${
                    lane.description ? ` — ${lane.description}` : ""
                  }`
            }
          >
            <span className="claude-lane-chip-dot" />
            {lane.kind === "main" ? (
              <UserIcon size={10} />
            ) : (
              <Bot size={10} />
            )}
            <span className="claude-lane-chip-name">
              {lane.kind === "main" ? "main" : lane.subagentType ?? "sub"}
            </span>
            {lane.kind !== "main" && lane.description && (
              <span className="claude-lane-chip-desc">{lane.description}</span>
            )}
            <span className="claude-lane-chip-count">{lane.entryIdxs.length}</span>
            {currentTool && (
              <span className="claude-lane-chip-tool" title={`Running ${currentTool.name}`}>
                <Zap size={9} /> {currentTool.name}
              </span>
            )}
            {!currentTool && elapsed && (
              <span className="claude-lane-chip-elapsed">{elapsed}</span>
            )}
            {!live && lastT ? (
              <span
                className="claude-lane-chip-rel"
                title={new Date(lastT).toLocaleString()}
              >
                {relTime(lastT, nowMs)}
              </span>
            ) : null}
            {selected && <Filter size={9} className="claude-lane-chip-filter" />}
          </button>
        );
      })}
    </div>
  );
}
