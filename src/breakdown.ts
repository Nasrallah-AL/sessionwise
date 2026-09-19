import type { SessionSummary } from "./types.js";

export interface ModelBreakdownRow {
  model: string;
  sessionCount: number;
  eventCount: number;
  tokens: number;
  cacheHitRate: number | null;
  fitScore: number | null;
  healthScore: number;
}

const round = (value: number) => Math.round(value * 100) / 100;

function average(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length ? round(finite.reduce((sum, value) => sum + value, 0) / finite.length) : null;
}

/** Attributes a session to its first model, or "mixed" when it used more than one. */
export function primaryModel(session: SessionSummary): string {
  if (session.models.length === 0) return "unknown";
  if (session.models.length === 1) return session.models[0]!;
  return "mixed";
}

/** Groups sessions by primary model, sorted by total tokens (where the effort is). */
export function buildModelBreakdown(sessions: SessionSummary[]): ModelBreakdownRow[] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const key = primaryModel(session);
    const group = groups.get(key) ?? [];
    group.push(session);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([model, group]) => ({
      model,
      sessionCount: group.length,
      eventCount: group.reduce((sum, session) => sum + session.eventCount, 0),
      tokens: group.reduce((sum, session) => sum + session.inputTokens + session.outputTokens, 0),
      cacheHitRate: average(group.flatMap((session) => session.metrics.cache.hitRate === null ? [] : [session.metrics.cache.hitRate])),
      fitScore: average(group.flatMap((session) => session.metrics.modelPicking.fitScore === null ? [] : [session.metrics.modelPicking.fitScore])),
      healthScore: average(group.map((session) => session.metrics.health.score)) ?? 0,
    }))
    .sort((a, b) => b.tokens - a.tokens);
}
