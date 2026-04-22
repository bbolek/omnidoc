import { Coins } from "lucide-react";
import type { SessionCost } from "../../store/claudeStore";
import { formatTokens, formatUsd } from "../../utils/claudeCost";

/**
 * Single-line cost + token strip for one session. Shows total USD, total
 * tokens, a live indicator when tailing, and a thin stacked bar visualizing
 * the input / output / cache-write / cache-read split.
 */
export function CostMeter({
  cost,
  live,
}: {
  cost: SessionCost;
  live: boolean;
}) {
  const total = cost.total;
  const segments: Array<[string, number, string]> = [
    ["Input", total.inputTokens, "#388bfd"],
    ["Output", total.outputTokens, "#8250df"],
    ["Cache+", total.cacheWriteTokens, "#bf8700"],
    ["Cache↻", total.cacheReadTokens, "#1f883d"],
  ];
  const sum = segments.reduce((a, [, n]) => a + n, 0) || 1;
  const hasSub = cost.sub.totalTokens > 0;

  return (
    <div className={`claude-cost${live ? " live" : ""}`}>
      <div className="claude-cost-top">
        <Coins size={11} style={{ color: "var(--color-text-muted)" }} />
        <span className="claude-cost-total">
          <span className="claude-cost-usd">
            {total.modelKnown ? formatUsd(total.totalUsd) : "—"}
          </span>
          <span className="claude-cost-tokens">
            {formatTokens(total.totalTokens)} tok
          </span>
          {!total.modelKnown && total.totalTokens > 0 && (
            <span className="claude-cost-nopricing" title="Model not in pricing table">
              tokens only
            </span>
          )}
        </span>
        {hasSub && (
          <span className="claude-cost-split" title="Main vs sub-agent cost">
            <span>
              <span
                className="claude-cost-split-dot"
                style={{ background: "var(--color-accent)" }}
              />
              {formatUsd(cost.main.totalUsd)}
            </span>
            <span>
              <span
                className="claude-cost-split-dot"
                style={{ background: "#8250df" }}
              />
              {formatUsd(cost.sub.totalUsd)}
            </span>
          </span>
        )}
        {live && (
          <div className="claude-cost-live" title="Live-tailing this session">
            <span className="claude-pulse-dot" />
            <span>live</span>
          </div>
        )}
      </div>

      {total.totalTokens > 0 && (
        <div className="claude-cost-bar" title="Token mix (stacked)">
          {segments.map(([label, n, color]) => {
            const pct = (n / sum) * 100;
            if (pct <= 0) return null;
            return (
              <span
                key={label}
                className="claude-cost-seg"
                style={{ width: `${pct}%`, background: color }}
                title={`${label}: ${formatTokens(n)}`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
