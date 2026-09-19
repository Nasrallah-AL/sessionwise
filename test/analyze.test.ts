import { describe, expect, it } from "vitest";
import { analyzeSessions } from "../src/analyze.js";
import type { SessionEvent } from "../src/types.js";

const event = (overrides: Partial<SessionEvent> = {}): SessionEvent => ({
  id: crypto.randomUUID(),
  sessionId: "session-a",
  timestamp: "2026-09-19T10:00:00Z",
  inputTokens: 12_000,
  outputTokens: 100,
  cachedInputTokens: 0,
  costUsd: 0.1,
  ...overrides,
});

describe("analyzeSessions", () => {
  it("groups events and detects session-wide waste", () => {
    const events = [
      event({ id: "1", inputTokens: 12_000, timestamp: "2026-09-19T10:00:00Z", error: "tool failed" }),
      event({ id: "2", inputTokens: 24_000, timestamp: "2026-09-19T10:01:00Z", error: "tool failed" }),
      event({ id: "3", inputTokens: 40_000, timestamp: "2026-09-19T10:02:00Z", error: "tool failed" }),
    ];
    const result = analyzeSessions(events);

    expect(result.sessions).toHaveLength(1);
    expect(result.totals.costUsd).toBe(0.3);
    expect(result.recommendations.map((item) => item.kind)).toEqual(
      expect.arrayContaining(["cache-opportunity", "context-growth", "error-loop"]),
    );
  });

  it("detects cost concentration across sessions", () => {
    const result = analyzeSessions([
      event({ id: "1", sessionId: "expensive", costUsd: 9 }),
      event({ id: "2", sessionId: "small-a", costUsd: 0.5 }),
      event({ id: "3", sessionId: "small-b", costUsd: 0.5 }),
    ]);

    expect(result.recommendations.some((item) => item.kind === "cost-concentration")).toBe(true);
  });
});
