import { modelTier } from "./metrics.js";
import type { ModelTier } from "./types.js";

/**
 * Per-million-token USD rates, keyed by the same tier buckets metrics.ts already
 * infers from a model id (fast/balanced/advanced). Not official price lists for
 * any specific model version - a deliberately coarse estimate used only to rank
 * sessions and gate the cost-concentration detector when an adapter (like
 * claude-code) doesn't report billed cost directly.
 */
const TIER_RATES: Record<Exclude<ModelTier, "unknown">, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  fast: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  balanced: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  advanced: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
};

export interface CostEstimateTokens {
  /** Fresh (non-cached) input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Per-million-token rates for a tier, for callers estimating savings deltas (e.g. a downgrade). */
export function ratesForTier(tier: ModelTier): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  return TIER_RATES[tier === "unknown" ? "balanced" : tier];
}

const TIER_ORDER: Exclude<ModelTier, "unknown">[] = ["fast", "balanced", "advanced"];

/** The tier one step cheaper than the given tier, or the same tier if already the cheapest. */
export function nextCheaperTier(tier: ModelTier): Exclude<ModelTier, "unknown"> {
  const resolved = tier === "unknown" ? "balanced" : tier;
  const index = TIER_ORDER.indexOf(resolved);
  return TIER_ORDER[Math.max(0, index - 1)] ?? "fast";
}

/**
 * Estimates USD cost for a single call from token counts and a coarse per-tier
 * rate card. Unknown models fall back to the "balanced" tier rather than
 * skipping cost entirely, since most adapters that lack native cost reporting
 * still route through a mid-tier model.
 */
export function estimateCostUsd(model: string | undefined, tokens: CostEstimateTokens): number {
  const tier = modelTier(model);
  const rates = ratesForTier(tier);
  const million = 1_000_000;
  const cost =
    (tokens.inputTokens * rates.input +
      tokens.outputTokens * rates.output +
      (tokens.cacheReadTokens ?? 0) * rates.cacheRead +
      (tokens.cacheCreationTokens ?? 0) * rates.cacheWrite) /
    million;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
