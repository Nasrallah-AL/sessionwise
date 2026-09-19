import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type DecisionStatus = "verified" | "applied" | "skipped";

export interface Decision {
  recommendationId: string;
  status: DecisionStatus;
  note: string;
  recordedAt: string;
}

export async function readDecisions(path: string): Promise<Decision[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed) ? (parsed as Decision[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordDecision(path: string, decision: Decision): Promise<Decision[]> {
  const decisions = await readDecisions(path);
  decisions.push(decision);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(decisions, null, 2)}\n`, "utf8");
  return decisions;
}

/** Most recent decision for a recommendation with the given status, if any. */
export function latestDecision(decisions: Decision[], recommendationId: string, status: DecisionStatus): Decision | undefined {
  return [...decisions].reverse().find((decision) => decision.recommendationId === recommendationId && decision.status === status);
}
