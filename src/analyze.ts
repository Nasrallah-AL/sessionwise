import type { Analysis, Recommendation, SessionEvent, SessionSummary } from "./types.js";
import { calculateSessionMetrics, eventToolCallKeys, eventToolNames } from "./metrics.js";

const money = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

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

function sessionRecommendations(summary: SessionSummary, events: SessionEvent[]): Recommendation[] {
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
  if (cacheable.length >= 3 && cacheRatio < 0.2) {
    recommendations.push({
      id: `cache-opportunity:${summary.id}`,
      kind: "cache-opportunity",
      sessionId: summary.id,
      title: "Large repeated context is not being cached",
      suggestion: "Stabilize the shared prompt prefix and enable provider prompt caching.",
      confidence: "high",
      risk: "safe",
      evidence: [
        { label: "large calls", value: cacheable.length },
        { label: "cache ratio", value: `${Math.round(cacheRatio * 100)}%` },
      ],
    });
  }

  if (first.inputTokens >= 1_000 && last.inputTokens >= 20_000 && last.inputTokens >= first.inputTokens * 3) {
    recommendations.push({
      id: `context-growth:${summary.id}`,
      kind: "context-growth",
      sessionId: summary.id,
      title: "Session context grew faster than the work",
      suggestion: "Compact or checkpoint the session before the next phase of work.",
      confidence: "high",
      risk: "review",
      evidence: [
        { label: "first input", value: first.inputTokens },
        { label: "last input", value: last.inputTokens },
        { label: "growth", value: `${(last.inputTokens / first.inputTokens).toFixed(1)}x` },
      ],
    });
  }

  const errors = new Map<string, number>();
  for (const event of events) {
    if (event.error) errors.set(event.error, (errors.get(event.error) ?? 0) + 1);
  }
  const repeatedError = [...errors.entries()].sort((a, b) => b[1] - a[1])[0];
  if (repeatedError && repeatedError[1] >= 3) {
    recommendations.push({
      id: `error-loop:${summary.id}`,
      kind: "error-loop",
      sessionId: summary.id,
      title: "The same failure repeated without recovery",
      suggestion: "Stop automatic retries after two identical failures and request a changed strategy.",
      confidence: "high",
      risk: "safe",
      evidence: [
        { label: "repeated failures", value: repeatedError[1] },
        { label: "error", value: repeatedError[0] },
      ],
    });
  }

  const tools = new Map<string, { count: number; name: string }>();
  for (const event of events) {
    const names = eventToolNames(event);
    const keys = eventToolCallKeys(event);
    keys.forEach((key, index) => {
      const current = tools.get(key);
      tools.set(key, { count: (current?.count ?? 0) + 1, name: names[index] ?? "tool" });
    });
  }
  const repeatedTool = [...tools.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (repeatedTool && repeatedTool[1].count >= 3) {
    recommendations.push({
      id: `repeated-tool-call:${summary.id}:${repeatedTool[0]}`,
      kind: "repeated-tool-call",
      sessionId: summary.id,
      title: "The same tool call repeated with identical input",
      suggestion: "Reuse the earlier result or change the inputs before retrying this tool call.",
      confidence: "high",
      risk: "safe",
      evidence: [
        { label: "tool", value: repeatedTool[1].name },
        { label: "identical calls", value: repeatedTool[1].count },
      ],
    });
  }

  if (summary.reasoningTokens >= 5_000 && summary.reasoningTokens > summary.outputTokens * 2) {
    recommendations.push({
      id: `reasoning-overhead:${summary.id}`,
      kind: "reasoning-overhead",
      sessionId: summary.id,
      title: "Reasoning spend is high relative to delivered output",
      suggestion: "Replay representative calls with lower reasoning effort and verify output quality.",
      confidence: "medium",
      risk: "verify",
      evidence: [
        { label: "reasoning tokens", value: summary.reasoningTokens },
        { label: "output tokens", value: summary.outputTokens },
      ],
    });
  }

  const modelPicking = summary.metrics.modelPicking;
  if (modelPicking.evaluatedCalls >= 3 && modelPicking.oversizedCalls / modelPicking.evaluatedCalls >= 0.3) {
    recommendations.push({
      id: `model-fit:${summary.id}`,
      kind: "model-fit",
      sessionId: summary.id,
      title: "Some turns may not need the selected model tier",
      suggestion: "Replay low-complexity turns on a faster model before enabling per-turn routing.",
      confidence: "medium",
      risk: "verify",
      evidence: [
        { label: "oversized calls", value: `${modelPicking.oversizedCalls}/${modelPicking.evaluatedCalls}` },
        { label: "model-fit score", value: `${modelPicking.fitScore}/100` },
        { label: "basis", value: "inferred from observed call shape" },
      ],
    });
  }

  return recommendations;
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
  const recommendations = [...groups.entries()].flatMap(([id, sessionEvents]) =>
    sessionRecommendations(sessions.find((session) => session.id === id)!, sessionEvents),
  );
  const totalCost = sessions.reduce((sum, session) => sum + session.costUsd, 0);
  const expensive = sessions[0];
  if (expensive && sessions.length >= 3 && totalCost > 0 && expensive.costUsd / totalCost >= 0.5) {
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
