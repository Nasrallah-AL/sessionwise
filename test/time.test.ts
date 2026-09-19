import { describe, expect, it } from "vitest";
import { filterEventsByTime, parsePositiveInt, resolveTimeWindow } from "../src/time.js";
import type { SessionEvent } from "../src/types.js";

const event = (id: string, timestamp: string): SessionEvent => ({
  id,
  sessionId: "s",
  timestamp,
  inputTokens: 10,
  outputTokens: 5,
});

describe("resolveTimeWindow", () => {
  const now = new Date("2026-09-19T12:00:00Z").getTime();

  it("returns an unrestricted window when nothing is given", () => {
    expect(resolveTimeWindow({ now })).toEqual({});
  });

  it("turns --days into a since boundary relative to now", () => {
    const window = resolveTimeWindow({ days: "7", now });
    expect(window.sinceMs).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(window.untilMs).toBeUndefined();
    expect(window.label).toContain("since");
  });

  it("parses --since and --until as explicit dates", () => {
    const window = resolveTimeWindow({ since: "2026-09-01", until: "2026-09-10" });
    expect(window.sinceMs).toBe(Date.parse("2026-09-01"));
    expect(window.untilMs).toBe(Date.parse("2026-09-10"));
  });

  it("rejects --days and --since together", () => {
    expect(() => resolveTimeWindow({ days: "1", since: "2026-09-01", now })).toThrow("either --days or --since");
  });

  it("rejects a since after until", () => {
    expect(() => resolveTimeWindow({ since: "2026-09-10", until: "2026-09-01" })).toThrow("before --until");
  });

  it("rejects an unparsable date", () => {
    expect(() => resolveTimeWindow({ since: "not-a-date" })).toThrow("--since must be a valid date");
  });

  it("rejects a non-positive --days", () => {
    expect(() => resolveTimeWindow({ days: "0", now })).toThrow("--days must be a positive number");
  });
});

describe("filterEventsByTime", () => {
  it("passes every event through an unrestricted window", () => {
    const events = [event("a", "2026-01-01T00:00:00Z")];
    expect(filterEventsByTime(events, {})).toBe(events);
  });

  it("keeps only events inside the window, inclusive of both ends", () => {
    const events = [
      event("early", "2026-09-01T00:00:00Z"),
      event("boundary-start", "2026-09-05T00:00:00Z"),
      event("inside", "2026-09-07T00:00:00Z"),
      event("boundary-end", "2026-09-10T00:00:00Z"),
      event("late", "2026-09-15T00:00:00Z"),
    ];
    const window = resolveTimeWindow({ since: "2026-09-05", until: "2026-09-10" });

    expect(filterEventsByTime(events, window).map((item) => item.id)).toEqual([
      "boundary-start",
      "inside",
      "boundary-end",
    ]);
  });

  it("drops events with an unparsable timestamp once a window is set", () => {
    const events = [event("bad", "not-a-timestamp")];
    expect(filterEventsByTime(events, resolveTimeWindow({ days: "1" }))).toEqual([]);
  });
});

describe("parsePositiveInt", () => {
  it("parses a valid positive integer", () => {
    expect(parsePositiveInt("5", "--recent")).toBe(5);
  });

  it("rejects zero, negatives, and non-numbers", () => {
    expect(() => parsePositiveInt("0", "--recent")).toThrow("--recent must be a positive integer");
    expect(() => parsePositiveInt("-3", "--recent")).toThrow("--recent must be a positive integer");
    expect(() => parsePositiveInt("abc", "--recent")).toThrow("--recent must be a positive integer");
  });
});
