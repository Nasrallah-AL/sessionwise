import { describe, expect, it } from "vitest";
import type { AskFn } from "jevctl";
import { verifyRecommendation } from "../src/verify.js";
import type { Recommendation } from "../src/types.js";

const recommendation: Recommendation = {
  id: "model-fit:session-1",
  kind: "model-fit",
  sessionId: "session-1",
  title: "Some turns may not need the selected model tier",
  suggestion: "Replay low-complexity turns on a faster model.",
  confidence: "medium",
  risk: "verify",
  evidence: [
    { label: "oversized calls", value: "5/6" },
    { label: "model-fit score", value: "70/100" },
  ],
};

describe("verifyRecommendation", () => {
  it("passes only what it was given as evidence, never raw content", async () => {
    let seenState: unknown;
    const ask: AskFn = async (state, questions) => {
      seenState = state;
      return {
        answers: { label: { type: "choice", choice: "sound", confidence: 0.8, probabilities: { sound: 0.8, unsound: 0.2 } } },
        usage: { input_tokens: 50, output_tokens: 5 },
        provider: "typesafe",
        model: "jev-test",
      };
    };

    const result = await verifyRecommendation(ask, recommendation);

    expect(result).toMatchObject({ recommendationId: recommendation.id, passed: true });
    expect(JSON.stringify(seenState)).toContain("oversized calls");
    expect(JSON.stringify(seenState)).not.toContain("session-1-raw-prompt");
  });

  it("fails when the judge finds the evidence unsound", async () => {
    const ask: AskFn = async () => ({
      answers: { label: { type: "choice", choice: "unsound", confidence: 0.7, probabilities: { sound: 0.3, unsound: 0.7 } } },
      usage: { input_tokens: 50, output_tokens: 5 },
      provider: "typesafe",
      model: "jev-test",
    });

    const result = await verifyRecommendation(ask, recommendation);

    expect(result.passed).toBe(false);
  });
});
