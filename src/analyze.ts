import type { AggregatedRecommendation, Analysis, Recommendation, SessionEvent, SessionSummary } from "./types.js";
import { calculateSessionMetrics, eventToolCallKeys, eventToolNames, modelTier } from "./metrics.js";
import { nextCheaperTier, ratesForTier } from "./pricing.js";

const money = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** The tier most of a session's calls ran on, for savings math - "balanced" if no model was recorded. */
function dominantTier(summary: SessionSummary) {
  return summary.models.length ? modelTier(summary.models[0]) : "balanced";
}

function summarize(id: string, events: SessionEvent[]): SessionSummary {
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) throw new Error(`Cannot summarize empty session: ${id}`);

  return {
    id,
    startedAt: first.timestamp,
    endedAt: last.timestamp,
    eventCount: events.length,
    inputTokens: events.reduce((sum, event) => sum + event.inputTokens, 0),
    outputTokens: events.reduce((sum, event) => sum + event.outputTokens, 0),
    cachedInputTokens: events.reduce((sum, event) => sum + (event.cachedInputTokens ?? 0), 0),
    reasoningTokens: events.reduce((sum, event) => sum + (event.reasoningTokens ?? 0), 0),
    costUsd: money(events.reduce((sum, event) => sum + (event.costUsd ?? 0), 0)),
    latencyMs: events.reduce((sum, event) => sum + (event.latencyMs ?? 0), 0),
    errorCount: events.filter((event) => event.error).length,
    toolCalls: events.reduce((sum, event) => sum + eventToolNames(event).length, 0),
    models: [...new Set(events.flatMap((event) => (event.model ? [event.model] : [])))],
    routes: [...new Set(events.flatMap((event) => (event.route ? [event.route] : [])))],
    metrics: calculateSessionMetrics(events),
  };
}

/** Population-relative gates computed once across all sessions in the window. */
interface PopulationThresholds {
  /** p75 of per-session growth ratios (last input / first input). */
  growthRatioP75: number | null;
  /** p25 of per-session cache hit ratios - a low value here is the bad tail. */
  cacheRatioP25: number | null;
  /** p75 of per-session reasoning-token / output-token share. */
  reasoningShareP75: number | null;
  /** p75 of per-session oversized-call share from modelPicking. */
  oversizedShareP75: number | null;
}

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const index = Math.min(sortedAscending.length - 1, Math.floor(sortedAscending.length * p));
  return sortedAscending[index] ?? null;
}

/**
 * Enough sessions are required before a percentile is trusted as a "relative
 * outlier" signal - below that, every session both is and isn't the p75, so
 * we fall back to absolute thresholds alone.
 */
const MIN_SESSIONS_FOR_PERCENTILE = 5;

function computePopulationThresholds(sessions: SessionSummary[]): PopulationThresholds {
  if (sessions.length < MIN_SESSIONS_FOR_PERCENTILE) {
    return { growthRatioP75: null, cacheRatioP25: null, reasoningShareP75: null, oversizedShareP75: null };
  }

  const growthRatios = sessions
    .map((session) => session.metrics.context.growthRatio)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const cacheRatios = sessions
    .filter((session) => session.metrics.cache.eligibleTokens >= 30_000)
    .map((session) => session.metrics.cache.hitRate)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const reasoningShares = sessions
    .filter((session) => session.outputTokens > 0)
    .map((session) => session.reasoningTokens / session.outputTokens)
    .sort((a, b) => a - b);
  const oversizedShares = sessions
    .filter((session) => session.metrics.modelPicking.evaluatedCalls >= 3)
    .map((session) => session.metrics.modelPicking.oversizedCalls / session.metrics.modelPicking.evaluatedCalls)
    .sort((a, b) => a - b);

  return {
    growthRatioP75: percentile(growthRatios, 0.75),
    cacheRatioP25: percentile(cacheRatios, 0.25),
    reasoningShareP75: percentile(reasoningShares, 0.75),
    oversizedShareP75: percentile(oversizedShares, 0.75),
  };
}

function sessionRecommendations(
  summary: SessionSummary,
  events: SessionEvent[],
  thresholds: PopulationThresholds,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const ordered = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const first = ordered[0];
  const last = ordered.at(-1);
  if (!first || !last) return recommendations;

  const cacheable = events.filter((event) => event.inputTokens >= 10_000);
  const cacheRatio = cacheable.length
    ? cacheable.reduce((sum, event) => sum + (event.cachedInputTokens ?? 0), 0) /
      cacheable.reduce((sum, event) => sum + event.inputTokens, 0)
    : 1;
  const cacheRelativeOutlier =
    thresholds.cacheRatioP25 !== null && cacheRatio <= thresholds.cacheRatioP25 && cacheRatio < 0.7;
  if (cacheable.length >= 3 && (cacheRatio < 0.3 || cacheRelativeOutlier)) {
    const rates = ratesForTier(dominantTier(summary));
    const totalInput = cacheable.reduce((sum, event) => sum + event.inputTokens, 0);
    const cachedInput = cacheable.reduce((sum, event) => sum + (event.cachedInputTokens ?? 0), 0);
    const uncachedInput = Math.max(0, totalInput - cachedInput);
    const estimatedSavingsUsd = money((uncachedInput * Math.max(0, rates.input - rates.cacheRead)) / 1_000_000);
    recommendations.push({
      id: `cache-opportunity:${summary.id}`,
      kind: "cache-opportunity",
      sessionId: summary.id,
      title: "Large repeated context is not being cached",
      suggestion: "Stabilize the shared prompt prefix and enable provider prompt caching.",
      confidence: "high",
      risk: "safe",
      estimatedSavingsUsd,
      evidence: [
        { label: "large calls", value: cacheable.length },
        { label: "cache ratio", value: `${Math.round(cacheRatio * 100)}%` },
        ...(cacheRelativeOutlier && cacheRatio >= 0.3
          ? [{ label: "basis", value: "worst quartile of this window's sessions" }]
          : []),
      ],
    });
  }

  const growthRatio = first.inputTokens > 0 ? last.inputTokens / first.inputTokens : null;
  const growthRelativeOutlier =
    thresholds.growthRatioP75 !== null && growthRatio !== null && growthRatio >= thresholds.growthRatioP75 && growthRatio >= 1.5;
  if (
    first.inputTokens >= 1_000 &&
    last.inputTokens >= 20_000 &&
    growthRatio !== null &&
    (growthRatio >= 2 || growthRelativeOutlier)
  ) {
    const rates = ratesForTier(dominantTier(summary));
    const excessTokens = Math.max(0, last.inputTokens - first.inputTokens * 2);
    const estimatedSavingsUsd = money((excessTokens * rates.cacheRead) / 1_000_000);
    recommendations.push({
      id: `context-growth:${summary.id}`,
      kind: "context-growth",
      sessionId: summary.id,
      title: "Session context grew faster than the work",
      suggestion: "Compact or checkpoint the session before the next phase of work.",
      confidence: "high",
      risk: "review",
      estimatedSavingsUsd,
      evidence: [
        { label: "first input", value: first.inputTokens },
        { label: "last input", value: last.inputTokens },
        { label: "growth", value: `${growthRatio.toFixed(1)}x` },
        ...(growthRelativeOutlier && growthRatio < 2
          ? [{ label: "basis", value: "worst quartile of this window's sessions" }]
          : []),
      ],
    });
  }

  const errors = new Map<string, number>();
  for (const event of events) {
    if (event.error) errors.set(event.error, (errors.get(event.error) ?? 0) + 1);
  }
  const repeatedError = [...errors.entries()].sort((a, b) => b[1] - a[1])[0];
  if (repeatedError && repeatedError[1] >= 2) {
    const erroringEvents = events.filter((event) => event.error === repeatedError[0]);
    // The first occurrence of a failure is the real attempt; everything after it is a wasted retry.
    const estimatedSavingsUsd = money(
      erroringEvents.slice(1).reduce((sum, event) => sum + (event.costUsd ?? 0), 0),
    );
    recommendations.push({
      id: `error-loop:${summary.id}`,
      kind: "error-loop",
      sessionId: summary.id,
      title: "The same failure repeated without recovery",
      suggestion: "Stop automatic retries after one identical failure and request a changed strategy.",
      confidence: "high",
      risk: "safe",
      estimatedSavingsUsd,
      evidence: [
        { label: "repeated failures", value: repeatedError[1] },
        { label: "error", value: repeatedError[0] },
      ],
    });
  }

  const tools = new Map<string, { count: number; name: string }>();
  const toolRepeatCost = new Map<string, number>();
  for (const event of ordered) {
    const names = eventToolNames(event);
    const keys = eventToolCallKeys(event);
    const apportionedCost = keys.length ? (event.costUsd ?? 0) / keys.length : 0;
    keys.forEach((key, index) => {
      const current = tools.get(key);
      const nextCount = (current?.count ?? 0) + 1;
      tools.set(key, { count: nextCount, name: names[index] ?? "tool" });
      // Only occurrences after the first are "repeats" - the first call did real work.
      if (nextCount > 1) toolRepeatCost.set(key, (toolRepeatCost.get(key) ?? 0) + apportionedCost);
    });
  }
  const repeatedTool = [...tools.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (repeatedTool && repeatedTool[1].count >= 2) {
    recommendations.push({
      id: `repeated-tool-call:${summary.id}:${repeatedTool[0]}`,
      kind: "repeated-tool-call",
      sessionId: summary.id,
      title: "The same tool call repeated with identical input",
      suggestion: "Reuse the earlier result or change the inputs before retrying this tool call.",
      confidence: "high",
      risk: "safe",
      estimatedSavingsUsd: money(toolRepeatCost.get(repeatedTool[0]) ?? 0),
      evidence: [
        { label: "tool", value: repeatedTool[1].name },
        { label: "identical calls", value: repeatedTool[1].count },
      ],
    });
  }

  const reasoningShare = summary.outputTokens > 0 ? summary.reasoningTokens / summary.outputTokens : null;
  const reasoningRelativeOutlier =
    thresholds.reasoningShareP75 !== null &&
    reasoningShare !== null &&
    reasoningShare >= thresholds.reasoningShareP75 &&
    reasoningShare >= 1;
  if (summary.reasoningTokens >= 3_000 && (summary.reasoningTokens > summary.outputTokens * 1.5 || reasoningRelativeOutlier)) {
    const rates = ratesForTier(dominantTier(summary));
    // Assumes lowering effort would have cut roughly 60% of the reasoning tokens - a heuristic, not a measurement.
    const estimatedSavingsUsd = money((summary.reasoningTokens * 0.6 * rates.output) / 1_000_000);
    recommendations.push({
      id: `reasoning-overhead:${summary.id}`,
      kind: "reasoning-overhead",
      sessionId: summary.id,
      title: "Reasoning spend is high relative to delivered output",
      suggestion: "Replay representative calls with lower reasoning effort and verify output quality.",
      confidence: "medium",
      risk: "verify",
      estimatedSavingsUsd,
      evidence: [
        { label: "reasoning tokens", value: summary.reasoningTokens },
        { label: "output tokens", value: summary.outputTokens },
        ...(reasoningRelativeOutlier && summary.reasoningTokens <= summary.outputTokens * 1.5
          ? [{ label: "basis", value: "worst quartile of this window's sessions" }]
          : []),
      ],
    });
  }

  const modelPicking = summary.metrics.modelPicking;
  const oversizedShare = modelPicking.evaluatedCalls >= 3 ? modelPicking.oversizedCalls / modelPicking.evaluatedCalls : null;
  const oversizedRelativeOutlier =
    thresholds.oversizedShareP75 !== null &&
    oversizedShare !== null &&
    oversizedShare >= thresholds.oversizedShareP75 &&
    oversizedShare > 0;
  if (modelPicking.evaluatedCalls >= 3 && oversizedShare !== null && (oversizedShare >= 0.2 || oversizedRelativeOutlier)) {
    const actualTier = dominantTier(summary);
    const cheaperTier = nextCheaperTier(actualTier);
    const actualRates = ratesForTier(actualTier);
    const cheaperRates = ratesForTier(cheaperTier);
    const actualBlended = actualRates.input + actualRates.output;
    const cheaperBlended = cheaperRates.input + cheaperRates.output;
    const reductionFactor = actualBlended > 0 ? Math.max(0, 1 - cheaperBlended / actualBlended) : 0;
    // Cost attributable to the oversized share of calls, assuming roughly uniform cost per call.
    const oversizedCostShare = summary.costUsd * oversizedShare;
    const estimatedSavingsUsd = money(oversizedCostShare * reductionFactor);
    recommendations.push({
      id: `model-fit:${summary.id}`,
      kind: "model-fit",
      sessionId: summary.id,
      title: "Some turns may not need the selected model tier",
      suggestion: "Replay low-complexity turns on a faster model before enabling per-turn routing.",
      confidence: "medium",
      risk: "verify",
      estimatedSavingsUsd,
      evidence: [
        { label: "oversized calls", value: `${modelPicking.oversizedCalls}/${modelPicking.evaluatedCalls}` },
        { label: "model-fit score", value: `${modelPicking.fitScore}/100` },
        { label: "basis", value: "inferred from observed call shape" },
      ],
    });
  }

  return recommendations;
}

/**
 * Rolls per-session recommendations up into one entry per rule (kind), with
 * total estimated savings across every affected session and the sessions
 * worth looking at first - so a rule that fires in 40 sessions is one line,
 * not 40.
 */
export function aggregateRecommendations(recommendations: Recommendation[]): AggregatedRecommendation[] {
  const groups = new Map<string, Recommendation[]>();
  for (const recommendation of recommendations) {
    const list = groups.get(recommendation.kind) ?? [];
    list.push(recommendation);
    groups.set(recommendation.kind, list);
  }

  const aggregated = [...groups.entries()].map(([kind, recs]) => {
    const sessionIds = new Set(recs.map((rec) => rec.sessionId).filter((id): id is string => Boolean(id)));
    const totalEstimatedSavingsUsd = money(recs.reduce((sum, rec) => sum + (rec.estimatedSavingsUsd ?? 0), 0));
    const topSessions = recs
      .filter((rec): rec is Recommendation & { sessionId: string } => Boolean(rec.sessionId))
      .sort((a, b) => (b.estimatedSavingsUsd ?? 0) - (a.estimatedSavingsUsd ?? 0))
      .slice(0, 5)
      .map((rec) => ({ sessionId: rec.sessionId, estimatedSavingsUsd: rec.estimatedSavingsUsd ?? 0, evidence: rec.evidence }));
    const representative = recs[0]!;
    return {
      kind: representative.kind,
      title: representative.title,
      suggestion: representative.suggestion,
      confidence: representative.confidence,
      risk: representative.risk,
      sessionCount: sessionIds.size,
      totalEstimatedSavingsUsd,
      topSessions,
    } satisfies AggregatedRecommendation;
  });

  return aggregated.sort((a, b) => b.totalEstimatedSavingsUsd - a.totalEstimatedSavingsUsd);
}

export function analyzeSessions(events: SessionEvent[]): Analysis {
  const groups = new Map<string, SessionEvent[]>();
  for (const event of events) {
    const group = groups.get(event.sessionId) ?? [];
    group.push(event);
    groups.set(event.sessionId, group);
  }

  const sessions = [...groups.entries()]
    .map(([id, sessionEvents]) => summarize(id, sessionEvents))
    .sort((a, b) => b.costUsd - a.costUsd);
  const thresholds = computePopulationThresholds(sessions);
  const recommendations = [...groups.entries()].flatMap(([id, sessionEvents]) =>
    sessionRecommendations(sessions.find((session) => session.id === id)!, sessionEvents, thresholds),
  );
  const totalCost = sessions.reduce((sum, session) => sum + session.costUsd, 0);
  const expensive = sessions[0];
  if (expensive && sessions.length >= 3 && totalCost > 0 && expensive.costUsd / totalCost >= 0.4) {
    recommendations.push({
      id: `cost-concentration:${expensive.id}`,
      kind: "cost-concentration",
      sessionId: expensive.id,
      title: "One session dominates total spend",
      suggestion: "Inspect this session first; optimization here has the highest leverage.",
      confidence: "high",
      risk: "review",
      evidence: [
        { label: "session cost", value: `$${expensive.costUsd.toFixed(4)}` },
        { label: "share of spend", value: `${Math.round((expensive.costUsd / totalCost) * 100)}%` },
      ],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    events,
    sessions,
    recommendations,
    aggregatedRecommendations: aggregateRecommendations(recommendations),
    totals: {
      eventCount: sessions.reduce((sum, session) => sum + session.eventCount, 0),
      inputTokens: sessions.reduce((sum, session) => sum + session.inputTokens, 0),
      outputTokens: sessions.reduce((sum, session) => sum + session.outputTokens, 0),
      cachedInputTokens: sessions.reduce((sum, session) => sum + session.cachedInputTokens, 0),
      reasoningTokens: sessions.reduce((sum, session) => sum + session.reasoningTokens, 0),
      costUsd: money(totalCost),
      latencyMs: sessions.reduce((sum, session) => sum + session.latencyMs, 0),
      errorCount: sessions.reduce((sum, session) => sum + session.errorCount, 0),
      toolCalls: sessions.reduce((sum, session) => sum + session.toolCalls, 0),
    },
  };
}
