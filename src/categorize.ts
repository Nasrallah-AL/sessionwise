import type { Recommendation } from "./types.js";

export type RecommendationCategory = "model" | "context" | "tools" | "cost";

export function recommendationCategory(recommendation: Recommendation): RecommendationCategory {
  if (recommendation.kind === "model-fit" || recommendation.kind === "reasoning-overhead") return "model";
  if (recommendation.kind === "cache-opportunity" || recommendation.kind === "context-growth") return "context";
  if (recommendation.kind === "cost-concentration") return "cost";
  return "tools";
}
