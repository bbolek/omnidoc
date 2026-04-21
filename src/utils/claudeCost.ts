/**
 * Client-side cost estimator for Claude Code sessions.
 *
 * Takes the `message.usage` block emitted into JSONL transcripts and returns
 * a rough USD cost. This is an *estimate* — the official docs call out that
 * the bundled table may drift from Console billing. We surface that caveat
 * inline on the `CostMeter`.
 *
 * Prices are per million tokens and keyed by a model-id prefix so minor
 * version bumps still resolve (e.g. `claude-opus-4-7-20260101` → opus-4-7).
 */

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

interface ModelPricing {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

// USD per MILLION tokens. Values sourced from https://anthropic.com/pricing;
// conservative latest-known at time of writing. Update as pricing moves.
const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    input: 15,
    output: 75,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30,
    cacheRead: 1.5,
  },
  "claude-opus-4-6": {
    input: 15,
    output: 75,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30,
    cacheRead: 1.5,
  },
  "claude-opus-4": {
    input: 15,
    output: 75,
    cacheWrite5m: 18.75,
    cacheWrite1h: 30,
    cacheRead: 1.5,
  },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
  "claude-sonnet-4-5": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
  "claude-sonnet-4": {
    input: 3,
    output: 15,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5": {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
  "claude-haiku-4": {
    input: 1,
    output: 5,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2,
    cacheRead: 0.1,
  },
};

function resolvePricing(model: string | undefined): ModelPricing | null {
  if (!model) return null;
  // Exact match first, then longest-prefix.
  if (PRICING[model]) return PRICING[model];
  const keys = Object.keys(PRICING).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (model.startsWith(k)) return PRICING[k];
  }
  return null;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  cacheWriteUsd: number;
  cacheReadUsd: number;
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  modelKnown: boolean;
}

const EMPTY: CostBreakdown = {
  inputUsd: 0,
  outputUsd: 0,
  cacheWriteUsd: 0,
  cacheReadUsd: 0,
  totalUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  totalTokens: 0,
  modelKnown: false,
};

export function costForUsage(
  model: string | undefined,
  usage: ClaudeUsage | undefined
): CostBreakdown {
  if (!usage) return EMPTY;
  const price = resolvePricing(model);
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheWrite5m = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const cacheWrite1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  // Fall back to the flat field when the granular breakdown isn't present.
  const cacheWriteTokens =
    cacheWrite5m + cacheWrite1h || usage.cache_creation_input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0;

  const totalTokens =
    inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens;

  if (!price) {
    return {
      ...EMPTY,
      inputTokens,
      outputTokens,
      cacheWriteTokens,
      cacheReadTokens,
      totalTokens,
    };
  }

  const inputUsd = (inputTokens / 1_000_000) * price.input;
  const outputUsd = (outputTokens / 1_000_000) * price.output;
  const cacheWriteUsd =
    (cacheWrite5m / 1_000_000) * price.cacheWrite5m +
    (cacheWrite1h / 1_000_000) * price.cacheWrite1h +
    (cacheWriteTokens - cacheWrite5m - cacheWrite1h >= 0
      ? ((cacheWriteTokens - cacheWrite5m - cacheWrite1h) / 1_000_000) *
        price.cacheWrite5m
      : 0);
  const cacheReadUsd = (cacheReadTokens / 1_000_000) * price.cacheRead;
  return {
    inputUsd,
    outputUsd,
    cacheWriteUsd,
    cacheReadUsd,
    totalUsd: inputUsd + outputUsd + cacheWriteUsd + cacheReadUsd,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens,
    modelKnown: true,
  };
}

export function addBreakdowns(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    inputUsd: a.inputUsd + b.inputUsd,
    outputUsd: a.outputUsd + b.outputUsd,
    cacheWriteUsd: a.cacheWriteUsd + b.cacheWriteUsd,
    cacheReadUsd: a.cacheReadUsd + b.cacheReadUsd,
    totalUsd: a.totalUsd + b.totalUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    totalTokens: a.totalTokens + b.totalTokens,
    modelKnown: a.modelKnown || b.modelKnown,
  };
}

export const emptyBreakdown = (): CostBreakdown => ({ ...EMPTY });

export function formatUsd(n: number): string {
  if (n === 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(1)}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
