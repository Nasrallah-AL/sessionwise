import type { SessionEvent } from "./types.js";

export interface TimeWindow {
  sinceMs?: number;
  untilMs?: number;
  /** Human-readable summary of the window, or undefined when unrestricted. */
  label?: string;
}

export interface TimeWindowOptions {
  days?: string;
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

/** Resolves --days / --since / --until into a single window. Pure; throws on bad input. */
export function resolveTimeWindow(options: TimeWindowOptions): TimeWindow {
  const now = options.now ?? Date.now();
  let sinceMs: number | undefined;
  let untilMs: number | undefined;

  if (options.days !== undefined) {
    const days = Number(options.days);
    if (!Number.isFinite(days) || days <= 0) throw new Error(`--days must be a positive number, got "${options.days}".`);
    sinceMs = now - days * 24 * 60 * 60 * 1000;
  }
  if (options.since !== undefined) {
    if (sinceMs !== undefined) throw new Error("Use either --days or --since, not both.");
    sinceMs = parseBoundary(options.since, "--since");
  }
  if (options.until !== undefined) {
    untilMs = parseBoundary(options.until, "--until");
  }
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
