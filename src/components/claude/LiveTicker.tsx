import { Activity, Sparkles, Bot, Pause, AlertTriangle } from "lucide-react";
import type { SessionActivity } from "../../store/claudeStore";
import { formatDuration, relTime } from "./relTime";
import { useNow } from "./useNow";

/**
 * Compact single-line "what's happening right now" banner driven entirely by
 * hook events. It updates the instant PreToolUse fires — faster than the
 * JSONL tail — so you get a pulse the moment Claude starts a Bash run even
 * though the matching message card may still be seconds away from flushing.
 */
export function LiveTicker({ activity }: { activity: SessionActivity }) {
  const now = useNow();
  const hasActivity = activity.lastEventAt > 0;
  const activeSubs = Object.values(activity.activeSubagents);
  const subCount = activeSubs.length;

  if (!hasActivity) return null;

  // Derive one primary icon + message from the freshest signal.
  let icon = <Activity size={11} />;
  let tone: "running" | "idle" | "stopped" | "error" | "subagent" = "idle";
  let head = "";
  let detail = "";

  if (activity.status === "error") {
    icon = <AlertTriangle size={11} />;
    tone = "error";
    head = "stopped with error";
  } else if (activity.currentTool) {
    icon = <Sparkles size={11} />;
    tone = "running";
    head = `running ${activity.currentTool.name}`;
    const since = now - activity.currentTool.startedAt;
    detail = `for ${formatDuration(since)}`;
  } else if (subCount > 0) {
    icon = <Bot size={11} />;
    tone = "subagent";
    head = subCount === 1
      ? `sub-agent ${activeSubs[0].subagentType ?? "running"}`
      : `${subCount} sub-agents running`;
    const tool = activeSubs.find((s) => s.currentTool)?.currentTool;
    if (tool) detail = `· ${tool.name} for ${formatDuration(now - tool.startedAt)}`;
  } else if (activity.status === "running") {
    icon = <Sparkles size={11} />;
    tone = "running";
    head = activity.lastEventLabel || "thinking";
  } else if (activity.status === "idle" || activity.status === "stopped") {
    icon = <Pause size={11} />;
    tone = "idle";
    head = "idle";
    if (activity.lastStopAt) detail = `last reply ${relTime(activity.lastStopAt, now)}`;
  } else if (activity.lastEventLabel) {
    head = activity.lastEventLabel;
  }

  return (
    <div className={`claude-live-ticker tone-${tone}`}>
      <span className="claude-live-ticker-icon">{icon}</span>
      <span className="claude-live-ticker-head">{head}</span>
      {detail && <span className="claude-live-ticker-detail">{detail}</span>}
      {subCount > 0 && tone !== "subagent" && (
        <span
          className="claude-live-ticker-sub-badge"
          title={`${subCount} sub-agent(s) active`}
        >
          <Bot size={9} /> {subCount}
        </span>
      )}
      <span
        className="claude-live-ticker-rel"
        title={new Date(activity.lastEventAt).toLocaleString()}
      >
        {relTime(activity.lastEventAt, now)}
      </span>
    </div>
  );
}
