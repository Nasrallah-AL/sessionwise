import { describe, expect, it } from "vitest";
import { calculateSessionMetrics, modelTier } from "../src/metrics.js";

describe("session metrics", () => {
  it("measures cache and labels model-fit inference", () => {
    const metrics = calculateSessionMetrics([
      {
        id: "1",
        sessionId: "a",
        timestamp: "2026-09-19T10:00:00Z",
        model: "claude-sonnet-5",
        inputTokens: 1_000,
        outputTokens: 100,
        cachedInputTokens: 800,
        metadata: { cacheCreationInputTokens: 100, toolNames: [] },
      },
      {
        id: "2",
        sessionId: "a",
        timestamp: "2026-09-19T10:01:00Z",
        model: "claude-sonnet-5",
        inputTokens: 2_000,
        outputTokens: 100,
        cachedInputTokens: 1_600,
        metadata: { cacheCreationInputTokens: 200, toolNames: [] },
      },
    ]);

    expect(metrics.cache).toMatchObject({ hitRate: 0.8, creationRate: 0.1, basis: "measured" });
    expect(metrics.modelPicking).toMatchObject({
      actualTier: "balanced",
      suggestedTier: "fast",
      oversizedCalls: 2,
      basis: "inferred",
    });
    expect(metrics.context.relevanceScore).toBeNull();
    expect(metrics.context.relevanceBasis).toBe("unavailable-without-content-analysis");
  });

  it("maps known model families to capability tiers", () => {
    expect(modelTier("claude-haiku-4-5")).toBe("fast");
    expect(modelTier("claude-sonnet-5")).toBe("balanced");
    expect(modelTier("claude-opus-4-1")).toBe("advanced");
  });
});
