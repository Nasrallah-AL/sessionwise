import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, compareVersions, isCacheStale } from "../src/version.js";

describe("compareVersions", () => {
  it("compares dotted numeric versions component by component", () => {
    expect(compareVersions("0.1.1", "0.1.0")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats a missing component as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });
});

describe("isCacheStale", () => {
  it("is stale when there is no cache", () => {
    expect(isCacheStale(undefined, Date.now(), 1000)).toBe(true);
  });

  it("is fresh within maxAgeMs, stale beyond it", () => {
    const now = Date.parse("2026-09-19T12:00:00Z");
    const cache = { lastCheckedAt: "2026-09-19T11:00:00Z", latestKnown: "0.1.0" };
    expect(isCacheStale(cache, now, 2 * 60 * 60 * 1000)).toBe(false); // 1h old, 2h window
    expect(isCacheStale(cache, now, 30 * 60 * 1000)).toBe(true); // 1h old, 30m window
  });

  it("is stale when the cached timestamp is unparsable", () => {
    expect(isCacheStale({ lastCheckedAt: "not-a-date", latestKnown: "0.1.0" }, Date.now(), 1000)).toBe(true);
  });
});

describe("checkForUpdate", () => {
  let dir: string;
  let cachePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sessionwise-update-"));
    cachePath = join(dir, "update-check.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports an update when a newer version is fetched", async () => {
    const fetchLatest = vi.fn(() => "0.2.0");

    const result = await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest });

    expect(result).toEqual({ current: "0.1.0", latest: "0.2.0" });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("reports nothing when already up to date", async () => {
    const fetchLatest = vi.fn(() => "0.1.0");
    expect(await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest })).toBeUndefined();
  });

  it("does not hit the network again within the cache window", async () => {
    const fetchLatest = vi.fn(() => "0.2.0");
    const now = Date.now();

    await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest, now });
    const second = await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest, now: now + 1000 });

    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ current: "0.1.0", latest: "0.2.0" });
  });

  it("re-checks once the cache goes stale", async () => {
    const fetchLatest = vi.fn(() => "0.2.0");
    const now = Date.now();

    await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest, now, maxAgeMs: 1000 });
    await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest, now: now + 2000, maxAgeMs: 1000 });

    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it("never throws when npm is unreachable and there is no cache yet", async () => {
    const fetchLatest = vi.fn(() => undefined);
    expect(await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest })).toBeUndefined();
  });

  it("falls back to the cached value when npm is unreachable but a cache exists", async () => {
    const now = Date.now();
    await checkForUpdate(cachePath, { currentVersion: "0.1.0", fetchLatest: () => "0.2.0", now });
    const result = await checkForUpdate(cachePath, {
      currentVersion: "0.1.0",
      fetchLatest: () => undefined,
      now: now + 2 * 24 * 60 * 60 * 1000, // well past the default 24h window
    });
    expect(result).toEqual({ current: "0.1.0", latest: "0.2.0" });
  });
});
