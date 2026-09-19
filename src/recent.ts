import type { SessionEvent } from "./types.js";

/** Keeps only the events belonging to the N most recently active sessions (by last event time). */
export function filterToRecentSessions(events: SessionEvent[], count: number): SessionEvent[] {
  if (!Number.isFinite(count) || count <= 0) return events;
  const latestBySession = new Map<string, number>();
  for (const event of events) {
    const ms = Date.parse(event.timestamp);
    if (Number.isNaN(ms)) continue;
    const current = latestBySession.get(event.sessionId);
    if (current === undefined || ms > current) latestBySession.set(event.sessionId, ms);
  }
  const keep = new Set(
    [...latestBySession.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([sessionId]) => sessionId),
  );
  return events.filter((event) => keep.has(event.sessionId));
}
