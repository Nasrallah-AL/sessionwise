export interface SessionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  provider?: string;
  model?: string;
  route?: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  toolName?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  latencyMs: number;
  errorCount: number;
  toolCalls: number;
  models: string[];
  routes: string[];
  metrics: SessionMetrics;
}

export type ModelTier = "fast" | "balanced" | "advanced" | "unknown";

export interface SessionMetrics {
  modelPicking: {
    actualTier: ModelTier;
    suggestedTier: ModelTier;
    fitScore: number | null;
    oversizedCalls: number;
    evaluatedCalls: number;
    basis: "inferred" | "unavailable";
  };
  cache: {
    hitRate: number | null;
    creationRate: number | null;
    readTokens: number;
    creationTokens: number;
    eligibleTokens: number;
    basis: "measured" | "unavailable";
  };
  context: {
    peakTokens: number;
    growthRatio: number | null;
    efficiencyScore: number | null;
    relevanceScore: null;
    relevanceBasis: "unavailable-without-content-analysis";
    basis: "inferred" | "unavailable";
  };
  health: {
    score: number;
    errorRate: number;
    repeatedToolRate: number;
    basis: "measured";
  };
}

export type RecommendationKind =
  | "cache-opportunity"
  | "context-growth"
  | "cost-concentration"
  | "error-loop"
  | "model-fit"
  | "reasoning-overhead"
  | "repeated-tool-call"
  | "irrelevant-context"
  | "irrelevant-skill"
  | "irrelevant-tool";

export type RecommendationRisk = "safe" | "review" | "verify";

export interface Evidence {
  label: string;
  value: number | string;
}

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  sessionId?: string;
  title: string;
  suggestion: string;
  confidence: "low" | "medium" | "high";
  risk: RecommendationRisk;
  estimatedSavingsUsd?: number;
  evidence: Evidence[];
}

export interface Analysis {
  generatedAt: string;
  events: SessionEvent[];
  sessions: SessionSummary[];
  recommendations: Recommendation[];
  totals: Omit<SessionSummary, "id" | "startedAt" | "endedAt" | "models" | "routes" | "metrics">;
}

export interface OptimizableRequest {
  sessionId: string;
  model?: string;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OptimizationProposal<T extends OptimizableRequest> {
  request: T;
  recommendation: Recommendation;
  patch: Partial<T>;
}

export type OptimizerMode = "observe" | "recommend" | "controlled";

export type RelevanceKind = "context" | "skill" | "tool";
export type RelevanceLabel = "relevant" | "irrelevant" | "uncertain";

/** Contains raw content in memory and must never be persisted as part of a report. */
export interface SemanticItem {
  id: string;
  sessionId: string;
  turnId: string;
  kind: RelevanceKind;
  name: string;
  request: string;
  details: string;
}

export interface RelevanceJudgment {
  id: string;
  sessionId: string;
  turnId: string;
  kind: RelevanceKind;
  name: string;
  label: RelevanceLabel;
  confidence: number | null;
  probabilities: Record<RelevanceLabel, number>;
}

export interface RelevanceMetric {
  total: number;
  relevant: number;
  irrelevant: number;
  uncertain: number;
  relevantRate: number | null;
  irrelevantRate: number | null;
}

export interface RelevanceReport {
  generatedAt: string;
  provider: string;
  model: string;
  sampled: number;
  available: number;
  metrics: Record<RelevanceKind, RelevanceMetric>;
  judgments: RelevanceJudgment[];
}
