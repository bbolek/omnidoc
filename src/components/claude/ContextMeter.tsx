import { Gauge } from "lucide-react";
import type { LogEntry } from "../../store/claudeStore";
import type { ClaudeUsage } from "../../utils/claudeCost";
import { formatTokens } from "../../utils/claudeCost";

/**
 * Live reconstruction of Claude Code's `/context` summary from the JSONL
 * transcript. The most recent assistant turn's `usage` block tells us how
 * many tokens the model actually saw in its prompt — that's the authoritative
 * "context used" value and it refreshes automatically as new entries stream
 * in.
 *
 *   prompt tokens = input_tokens + cache_read_input_tokens
 *                 + cache_creation_input_tokens
 *
 * We add the turn's `output_tokens` so the bar reflects the full exchange
 * that'll roll forward into the next turn's context.
 */
export function ContextMeter({ entries }: { entries: LogEntry[] }) {
  const snap = latestContextSnapshot(entries);
  if (!snap) return null;

  const limit = contextWindowFor(snap.model);
  const used = snap.prompt + snap.output;
  const pct = Math.min(100, (used / limit) * 100);
  const free = Math.max(0, limit - used);
  const tone = pct >= 85 ? "danger" : pct >= 70 ? "warn" : "ok";

  // "/context" mirror: input (new) vs cached (read+write) vs output.
  const parts: Array<[string, number, string]> = [
    ["input", snap.input, "#388bfd"],
    ["cached", snap.cacheRead + snap.cacheWrite, "#1f883d"],
    ["output", snap.output, "#8250df"],
  ];
  const sum = used || 1;

  return (
    <div className={`claude-context tone-${tone}`} title="Context window usage (/context)">
      <div className="claude-context-top">
        <Gauge size={11} style={{ color: "var(--color-text-muted)" }} />
        <span className="claude-context-label">context</span>
        <span className="claude-context-used">
          {formatTokens(used)}
          <span className="claude-context-limit"> / {formatTokens(limit)}</span>
        </span>
        <span className="claude-context-pct">{pct.toFixed(0)}%</span>
        <span className="claude-context-spacer" />
        <span className="claude-context-free" title="Free space left in window">
          {formatTokens(free)} free
        </span>
      </div>
      <div className="claude-context-bar">
        {parts.map(([label, n, color]) => {
          const w = (n / sum) * pct;
          if (w <= 0) return null;
          return (
            <span
              key={label}
              className="claude-context-seg"
              style={{ width: `${w}%`, background: color }}
              title={`${label}: ${formatTokens(n)}`}
            />
          );
        })}
      </div>
      <div className="claude-context-legend">
        {parts.map(([label, n, color]) => (
          <span key={label}>
            <span
              className="claude-context-legend-dot"
              style={{ background: color }}
            />
            {label} {formatTokens(n)}
          </span>
        ))}
      </div>
    </div>
  );
}

interface ContextSnapshot {
  model: string | undefined;
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
  prompt: number;
}

/**
 * Return the usage snapshot from the most recent main-chain assistant turn.
 * We skip sub-agent (sidechain) turns because those run in a separate context
 * window and would otherwise stomp the main-chain view.
 */
function latestContextSnapshot(entries: LogEntry[]): ContextSnapshot | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type !== "assistant") continue;
    if (e.isSidechain) continue;
    const u: ClaudeUsage | undefined = e.message?.usage;
    if (!u) continue;
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheWrite = u.cache_creation_input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    return {
      model: e.message?.model,
      input,
      cacheRead,
      cacheWrite,
      output,
      prompt: input + cacheRead + cacheWrite,
    };
  }
  return null;
}

/**
 * Context window size in tokens for the given model id. Falls back to the
 * Claude 4 family default (200k) when the model prefix isn't recognised.
 * Sonnet 4.x advertises a 1M window in beta; we treat the default as the
 * published "standard" 200k since the CLI's `/context` uses that bound.
 */
function contextWindowFor(model: string | undefined): number {
  if (!model) return 200_000;
  if (/\[1m\]$/i.test(model)) return 1_000_000;
  if (/sonnet-4-6.*1m/i.test(model)) return 1_000_000;
  return 200_000;
}
