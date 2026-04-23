/**
 * Short, human-readable deltas. Handy for the "2s ago" tail of streaming
 * messages where tabular-nums keeps the width stable. Keeps the full absolute
 * timestamp out of sight until the user hovers.
 */
export function relTime(tsMs: number, nowMs: number): string {
  if (!tsMs) return "";
  const diff = Math.max(0, nowMs - tsMs);
  if (diff < 5_000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ${Math.round(s % 60)}s`;
  const h = m / 60;
  return `${Math.floor(h)}h ${Math.round(m % 60)}m`;
}
