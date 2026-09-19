import type { ModelTier, SessionEvent, SessionMetrics } from "./types.js";

const tierRank: Record<ModelTier, number> = { unknown: -1, fast: 0, balanced: 1, advanced: 2 };
const round = (value: number) => Math.round(value * 1_000) / 1_000;

export function modelTier(model?: string): ModelTier {
  const id = model?.toLowerCase() ?? "";
  if (!id) return "unknown";
  if (id.includes("haiku") || id.includes("mini") || id.includes("flash")) return "fast";
  if (id.includes("opus") || id.includes("pro") || id.includes("o1") || id.includes("o3")) return "advanced";
  if (id.includes("sonnet") || id.includes("gpt-4") || id.includes("gpt-5")) return "balanced";
  return "unknown";
}

export function eventToolNames(event: SessionEvent): string[] {
  const names = event.metadata?.toolNames;
  if (Array.isArray(names)) return names.filter((name): name is string => typeof name === "string");
  return event.toolName ? [event.toolName] : [];
}

export function eventToolCallKeys(event: SessionEvent): string[] {
  const keys = event.metadata?.toolCallKeys;
  if (Array.isArray(keys)) return keys.filter((key): key is string => typeof key === "string");
  return eventToolNames(event).map((name) => `${name}:${event.id}`);
}

function requiredTier(event: SessionEvent): Exclude<ModelTier, "unknown"> {
  const reasoning = event.reasoningTokens ?? 0;
  const tools = eventToolNames(event).length;
  if (reasoning >= 2_000 || tools >= 4 || event.outputTokens >= 4_000) return "advanced";
  if (reasoning >= 300 || tools >= 1 || event.inputTokens >= 20_000 || event.outputTokens >= 1_000) return "balanced";
  return "fast";
}

function highestTier(tiers: ModelTier[]): ModelTier {
  return tiers.reduce<ModelTier>((highest, tier) => tierRank[tier] > tierRank[highest] ? tier : highest, "unknown");
}

export function calculateSessionMetrics(events: SessionEvent[]): SessionMetrics {
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const tokenEvents = ordered.filter((event) => event.inputTokens > 0 || event.outputTokens > 0);
  const actualTiers = tokenEvents.map((event) => modelTier(event.model)).filter((tier) => tier !== "unknown");
  const evaluated = tokenEvents.filter((event) => modelTier(event.model) !== "unknown");
  const required = evaluated.map(requiredTier);
  const scores = evaluated.map((event) => {
    const actual = tierRank[modelTier(event.model)];
    const needed = tierRank[requiredTier(event)];
    if (actual === needed) return 100;
    if (actual > needed) return actual - needed === 1 ? 72 : 52;
    return 35;
  });
  const oversizedCalls = evaluated.filter((event) => tierRank[modelTier(event.model)] > tierRank[requiredTier(event)]).length;

  const eligibleTokens = tokenEvents.reduce((sum, event) => sum + event.inputTokens, 0);
  const readTokens = tokenEvents.reduce((sum, event) => sum + (event.cachedInputTokens ?? 0), 0);
  const creationTokens = tokenEvents.reduce((sum, event) => {
    const value = event.metadata?.cacheCreationInputTokens;
    return sum + (typeof value === "number" ? value : 0);
  }, 0);

  const first = tokenEvents[0];
  const last = tokenEvents.at(-1);
  const growthRatio = first && last && first.inputTokens > 0 ? last.inputTokens / first.inputTokens : null;
  const toolKeys = events.flatMap(eventToolCallKeys);
  const repeatedToolRate = toolKeys.length ? 1 - new Set(toolKeys).size / toolKeys.length : 0;
  const errorRate = events.length ? events.filter((event) => event.error).length / events.length : 0;
  const growthPenalty = growthRatio === null ? 0 : Math.min(1, Math.max(0, growthRatio - 1) / 4);
  const efficiencyScore = tokenEvents.length
    ? Math.round(100 * (1 - 0.45 * growthPenalty - 0.35 * repeatedToolRate - 0.2 * errorRate))
    : null;

  return {
    modelPicking: {
      actualTier: highestTier(actualTiers),
      suggestedTier: highestTier(required),
      fitScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
      oversizedCalls,
      evaluatedCalls: evaluated.length,
      basis: evaluated.length ? "inferred" : "unavailable",
    },
    cache: {
      hitRate: eligibleTokens ? round(readTokens / eligibleTokens) : null,
      creationRate: eligibleTokens ? round(creationTokens / eligibleTokens) : null,
      readTokens,
      creationTokens,
      eligibleTokens,
      basis: eligibleTokens ? "measured" : "unavailable",
    },
    context: {
      peakTokens: Math.max(0, ...tokenEvents.map((event) => event.inputTokens)),
      growthRatio: growthRatio === null ? null : round(growthRatio),
      efficiencyScore,
      relevanceScore: null,
      relevanceBasis: "unavailable-without-content-analysis",
      basis: tokenEvents.length ? "inferred" : "unavailable",
    },
    health: {
      score: Math.round(100 * (1 - 0.65 * errorRate - 0.35 * repeatedToolRate)),
      errorRate: round(errorRate),
      repeatedToolRate: round(repeatedToolRate),
      basis: "measured",
    },
  };
}
