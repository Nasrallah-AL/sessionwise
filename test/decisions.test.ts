import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestDecision, readDecisions, recordDecision } from "../src/decisions.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sessionlens-decisions-"));
  path = join(dir, "nested", "decisions.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("decisions ledger", () => {
  it("returns an empty list when nothing has been recorded", async () => {
    expect(await readDecisions(path)).toEqual([]);
  });

  it("appends decisions and creates parent directories", async () => {
    await recordDecision(path, { recommendationId: "a", status: "verified", note: "ok", recordedAt: "2026-01-01T00:00:00Z" });
    await recordDecision(path, { recommendationId: "a", status: "applied", note: "done", recordedAt: "2026-01-01T00:01:00Z" });

    const decisions = await readDecisions(path);
    expect(decisions).toHaveLength(2);
    expect(latestDecision(decisions, "a", "verified")?.note).toBe("ok");
    expect(latestDecision(decisions, "a", "applied")?.note).toBe("done");
    expect(latestDecision(decisions, "missing", "applied")).toBeUndefined();
  });
});
