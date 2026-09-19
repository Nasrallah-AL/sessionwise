import { describe, expect, it, vi } from "vitest";
import { createControlledOptimizer } from "../src/optimizer.js";
import type { Recommendation } from "../src/types.js";

const recommendation: Recommendation = {
  id: "model:test",
  kind: "reasoning-overhead",
  title: "Test",
  suggestion: "Test",
  confidence: "medium",
  risk: "verify",
  evidence: [],
};

describe("createControlledOptimizer", () => {
  it("never mutates requests in recommend mode", async () => {
    const optimizer = createControlledOptimizer({
      mode: "recommend",
      propose: (request) => [{ request, recommendation, patch: { model: "small" } }],
    });

    await expect(optimizer.beforeCall({ sessionId: "a", model: "large" }, [recommendation]))
      .resolves.toEqual({ sessionId: "a", model: "large" });
  });

  it("applies approved patches only in controlled mode", async () => {
    const onProposal = vi.fn();
    const optimizer = createControlledOptimizer({
      mode: "controlled",
      propose: (request) => [{ request, recommendation, patch: { model: "small" } }],
      approve: () => true,
      onProposal,
    });

    await expect(optimizer.beforeCall({ sessionId: "a", model: "large" }, [recommendation]))
      .resolves.toEqual({ sessionId: "a", model: "small" });
    expect(onProposal).toHaveBeenCalledWith(expect.anything(), true);
  });
});
