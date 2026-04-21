import { Coins, Bot, User, Database } from "lucide-react";
import type { SessionCost } from "../../store/claudeStore";
import { formatTokens, formatUsd } from "../../utils/claudeCost";

/**
 * Compact cost + token dashboard for one session. Visualizes:
 *   - Total USD (big)
 *   - Token stacked bar (input / output / cache-write / cache-read)
 *   - Main-agent vs sub-agent split
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
  const mainPct = total.totalTokens === 0
    ? 50
    : (cost.main.totalTokens / total.totalTokens) * 100;
  const subPct = 100 - mainPct;

  return (
    <div className={`claude-cost${live ? " live" : ""}`}>
      <div className="claude-cost-top">
        <div className="claude-cost-total">
          <Coins size={13} style={{ color: "var(--color-text-muted)" }} />
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
        </div>
        {live && (
          <div className="claude-cost-live" title="Live-tailing this session">
            <span className="claude-pulse-dot" />
            <span>live</span>
          </div>
        )}
      </div>

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

      <div className="claude-cost-split" title="Main vs sub-agent tokens">
        <div className="claude-cost-split-bar">
          <span
            className="claude-cost-split-main"
            style={{ width: `${mainPct}%` }}
          />
          <span
            className="claude-cost-split-sub"
            style={{ width: `${subPct}%` }}
          />
        </div>
        <div className="claude-cost-split-legend">
          <span>
            <User size={10} /> main {formatUsd(cost.main.totalUsd)}
          </span>
          <span>
            <Bot size={10} /> agents {formatUsd(cost.sub.totalUsd)}
          </span>
        </div>
      </div>

      <div className="claude-cost-meta">
        <Database size={10} /> est. client-side
      </div>
    </div>
  );
}
