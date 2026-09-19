import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionEvent } from "./types.js";

function assertEvent(value: unknown, index: number): asserts value is SessionEvent {
  if (!value || typeof value !== "object") throw new Error(`Event ${index} is not an object`);
  const event = value as Partial<SessionEvent>;
  for (const field of ["id", "sessionId", "timestamp"] as const) {
    if (typeof event[field] !== "string" || !event[field]) throw new Error(`Event ${index} has invalid ${field}`);
  }
  for (const field of ["inputTokens", "outputTokens"] as const) {
    if (typeof event[field] !== "number" || event[field] < 0) throw new Error(`Event ${index} has invalid ${field}`);
  }
}

export async function readEvents(path: string): Promise<SessionEvent[]> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!source.trim()) return [];

  const parsed: unknown[] = path.endsWith(".jsonl")
    ? source.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    : (() => {
        const value: unknown = JSON.parse(source);
        return Array.isArray(value) ? value : [value];
      })();
  const events: SessionEvent[] = [];
  parsed.forEach((value, index) => {
    assertEvent(value, index);
    events.push(value);
  });
  return events;
}

export async function appendEvent(path: string, event: SessionEvent): Promise<void> {
  assertEvent(event, 0);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
}
