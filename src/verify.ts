import { buildClassifyRequest, type AskFn } from "jevctl";
import type { Recommendation } from "./types.js";

export interface VerificationResult {
  recommendationId: string;
  passed: boolean;
  rationale: string;
  provider: string;
  model: string;
}

const labels = [
  { label: "sound", description: "The evidence given supports this recommendation, and the suggested action follows from it" },
  { label: "unsound", description: "The evidence is too weak, too small a sample, or does not support the suggested action" },
];

/**
 * Sanity-checks one recommendation against only its own evidence numbers, never
 * against raw prompts or tool output. This is a judgment call on the arithmetic
 * and sample size behind a finding, not a replay of real traffic.
 */
export async function verifyRecommendation(ask: AskFn, recommendation: Recommendation): Promise<VerificationResult> {
  const request = buildClassifyRequest({
    text: null,
    labels,
    instructions: "Judge only the evidence object below. Is this recommendation's evidence strong enough, and does the suggested action follow from it?",
    other: false,
  });
  const state = {
    title: recommendation.title,
    suggestion: recommendation.suggestion,
    kind: recommendation.kind,
    declared_risk: recommendation.risk,
    evidence: recommendation.evidence,
  };
  const result = await ask(state, request.questions);
  const answer = result.answers.label;
  const passed = answer?.choice === "sound";
  return {
    recommendationId: recommendation.id,
    passed,
    rationale: passed
      ? "The evidence sample and arithmetic support this recommendation."
      : "The evidence sample or arithmetic does not clearly support this recommendation.",
    provider: result.provider,
    model: result.model,
  };
}
