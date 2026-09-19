import { describe, expect, it } from "vitest";
import { buildModelBreakdown, primaryModel } from "../src/breakdown.js";
import type { SessionSummary } from "../src/types.js";

const baseMetrics: SessionSummary["metrics"] = {
  modelPicking: { actualTier: "balanced", suggestedTier: "fast", fitScore: 80, oversizedCalls: 1, evaluatedCalls: 2, basis: "inferred" },
  cache: { hitRate: 0.5, creationRate: 0.1, readTokens: 100, creationTokens: 20, eligibleTokens: 200, basis: "measured" },
  context: { peakTokens: 1000, growthRatio: 1.2, efficiencyScore: 90, relevanceScore: null, relevanceBasis: "unavailable-without-content-analysis", basis: "inferred" },
  health: { score: 95, errorRate: 0, repeatedToolRate: 0, basis: "measured" },
};

function session(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "s",
    startedAt: "2026-01-01T00:00:00Z",
    endedAt: "2026-01-01T00:01:00Z",
    eventCount: 2,
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 10,
    reasoningTokens: 0,
    costUsd: 0.01,
    latencyMs: 100,
    errorCount: 0,
    toolCalls: 0,
    models: ["claude-sonnet-5"],
    routes: [],
    metrics: baseMetrics,
    ...overrides,
  };
}

describe("primaryModel", () => {
  it("returns the single model, or mixed when a session used more than one", () => {
    expect(primaryModel(session({ models: ["claude-sonnet-5"] }))).toBe("claude-sonnet-5");
    expect(primaryModel(session({ models: ["claude-sonnet-5", "claude-haiku-4-5"] }))).toBe("mixed");
    expect(primaryModel(session({ models: [] }))).toBe("unknown");
  });
});

describe("buildModelBreakdown", () => {
  it("groups sessions by model and sorts by total tokens", () => {
    const rows = buildModelBreakdown([
      session({ id: "a", models: ["claude-sonnet-5"], inputTokens: 100, outputTokens: 50 }),
      session({ id: "b", models: ["claude-haiku-4-5"], inputTokens: 10, outputTokens: 5 }),
      session({ id: "c", models: ["claude-sonnet-5"], inputTokens: 200, outputTokens: 100 }),
    ]);

    expect(rows[0]).toMatchObject({ model: "claude-sonnet-5", sessionCount: 2, tokens: 450 });
    expect(rows[1]).toMatchObject({ model: "claude-haiku-4-5", sessionCount: 1, tokens: 15 });
  });
});
