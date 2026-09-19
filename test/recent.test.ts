import { describe, expect, it } from "vitest";
import { filterToRecentSessions } from "../src/recent.js";
import type { SessionEvent } from "../src/types.js";

const event = (id: string, sessionId: string, timestamp: string): SessionEvent => ({
  id,
  sessionId,
  timestamp,
  inputTokens: 10,
  outputTokens: 5,
});

describe("filterToRecentSessions", () => {
  it("keeps only the events from the N most recently active sessions", () => {
    const events = [
      event("a1", "old", "2026-09-01T00:00:00Z"),
      event("b1", "mid", "2026-09-10T00:00:00Z"),
      event("b2", "mid", "2026-09-11T00:00:00Z"),
      event("c1", "new", "2026-09-19T00:00:00Z"),
    ];

    const result = filterToRecentSessions(events, 2);

    expect(result.map((item) => item.id).sort()).toEqual(["b1", "b2", "c1"]);
  });

  it("ranks a session by its latest event, not its first", () => {
    const events = [
      event("early-in-late-session", "late-starter", "2026-09-02T00:00:00Z"),
      event("recent-in-late-session", "late-starter", "2026-09-18T00:00:00Z"),
      event("only-event", "early-finisher", "2026-09-05T00:00:00Z"),
    ];

    expect(filterToRecentSessions(events, 1).map((item) => item.sessionId)).toEqual([
      "late-starter",
      "late-starter",
    ]);
  });

  it("passes every event through when count is not positive", () => {
    const events = [event("a", "s", "2026-09-01T00:00:00Z")];
    expect(filterToRecentSessions(events, 0)).toBe(events);
    expect(filterToRecentSessions(events, -1)).toBe(events);
  });

  it("drops events with an unparsable timestamp from the ranking", () => {
    const events = [
      event("bad", "s1", "not-a-timestamp"),
      event("good", "s2", "2026-09-01T00:00:00Z"),
    ];
    expect(filterToRecentSessions(events, 1).map((item) => item.id)).toEqual(["good"]);
  });
});
