import type { SessionEvent } from "./types.js";

export interface TimeWindow {
  sinceMs?: number;
  untilMs?: number;
  /** Human-readable summary of the window, or undefined when unrestricted. */
  label?: string;
}

export interface TimeWindowOptions {
  days?: string;
  hours?: string;
  since?: string;
  until?: string;
  /** Injectable for tests; defaults to the real current time. */
  now?: number;
}

function parseBoundary(value: string, flag: string): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`${flag} must be a valid date (e.g. 2026-09-01 or 2026-09-01T00:00:00Z), got "${value}".`);
  return ms;
}

/** Parses a flag expecting a positive integer (e.g. --recent 5). Throws with the flag name on bad input. */
export function parsePositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} must be a positive integer, got "${value}".`);
  return n;
}

/** Resolves --days / --hours / --since / --until into a single window. Pure; throws on bad input. */
export function resolveTimeWindow(options: TimeWindowOptions): TimeWindow {
  const now = options.now ?? Date.now();
  const given = [
    options.days !== undefined ? "--days" : undefined,
    options.hours !== undefined ? "--hours" : undefined,
    options.since !== undefined ? "--since" : undefined,
  ].filter((flag): flag is string => flag !== undefined);
  if (given.length > 1) throw new Error(`Use only one of ${given.join(", ")}.`);

  let sinceMs: number | undefined;
  if (options.days !== undefined) {
    const days = Number(options.days);
    if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number, got "${options.days}".`);
    sinceMs = now - days * 24 * 60 * 60 * 1000;
  } else if (options.hours !== undefined) {
    const hours = Number(options.hours);
    if (!Number.isFinite(hours) || hours <= 0) throw new Error(`--hours must be a positive number, got "${options.hours}".`);
    sinceMs = now - hours * 60 * 60 * 1000;
  } else if (options.since !== undefined) {
    sinceMs = parseBoundary(options.since, "--since");
  }

  const untilMs = options.until !== undefined ? parseBoundary(options.until, "--until") : undefined;
  if (sinceMs !== undefined && untilMs !== undefined && sinceMs > untilMs) {
    throw new Error("--since must be before --until.");
  }

  if (sinceMs === undefined && untilMs === undefined) return {};
  const label = [
    sinceMs !== undefined ? `since ${new Date(sinceMs).toISOString()}` : undefined,
    untilMs !== undefined ? `until ${new Date(untilMs).toISOString()}` : undefined,
  ].filter(Boolean).join(" ");
  return { sinceMs, untilMs, label };
}

/** Keeps only events whose timestamp falls inside the window. Events with an unparsable timestamp are dropped. */
export function filterEventsByTime(events: SessionEvent[], window: TimeWindow): SessionEvent[] {
  if (window.sinceMs === undefined && window.untilMs === undefined) return events;
  return events.filter((event) => {
    const ms = Date.parse(event.timestamp);
    if (Number.isNaN(ms)) return false;
    if (window.sinceMs !== undefined && ms < window.sinceMs) return false;
    if (window.untilMs !== undefined && ms > window.untilMs) return false;
    return true;
  });
}
