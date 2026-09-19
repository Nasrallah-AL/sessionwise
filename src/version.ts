import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_NAME = "sessionwise";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads this package's own version from its package.json, wherever it's installed. */
export function getOwnVersion(): string {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  return pkg.version;
}

/** Compares dotted numeric versions: positive if `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Asks npm for the latest published version. Never throws; undefined on any failure (offline, no npm, timeout). */
export function fetchLatestVersion(timeoutMs = 2000): string | undefined {
  try {
    return execFileSync("npm", ["view", PACKAGE_NAME, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
    }).trim();
  } catch {
    return undefined;
  }
}

export interface UpdateCache {
  lastCheckedAt: string;
  latestKnown: string;
}

/** True when there is no cache, or it is older than maxAgeMs. */
export function isCacheStale(cache: UpdateCache | undefined, now: number, maxAgeMs: number): boolean {
  if (!cache) return true;
  const checkedAt = Date.parse(cache.lastCheckedAt);
  return Number.isNaN(checkedAt) || now - checkedAt > maxAgeMs;
}

async function readUpdateCache(path: string): Promise<UpdateCache | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as UpdateCache) : undefined;
  } catch {
    return undefined; // missing or corrupt cache should never crash the CLI
  }
}

async function writeUpdateCache(path: string, cache: UpdateCache): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(cache), "utf8");
  } catch {
    // best-effort; a failed cache write should never crash the CLI
  }
}

export interface UpdateAvailable {
  current: string;
  latest: string;
}

export interface CheckForUpdateOptions {
  now?: number;
  currentVersion?: string;
  fetchLatest?: (timeoutMs?: number) => string | undefined;
  maxAgeMs?: number;
}

/**
 * Checks for a newer published version, using a 24h-cached result so most
 * invocations never touch the network. Never throws; resolves to undefined
 * on any failure or when already up to date.
 */
export async function checkForUpdate(cachePath: string, options: CheckForUpdateOptions = {}): Promise<UpdateAvailable | undefined> {
  const now = options.now ?? Date.now();
  const current = options.currentVersion ?? getOwnVersion();
  const fetchLatest = options.fetchLatest ?? fetchLatestVersion;
  const maxAgeMs = options.maxAgeMs ?? DAY_MS;

  const cache = await readUpdateCache(cachePath);
  let latest = cache?.latestKnown;
  if (isCacheStale(cache, now, maxAgeMs)) {
    const fresh = fetchLatest();
    if (fresh) {
      latest = fresh;
      await writeUpdateCache(cachePath, { lastCheckedAt: new Date(now).toISOString(), latestKnown: fresh });
    } else if (!cache) {
      return undefined; // never checked before and npm isn't reachable right now
    }
  }
  if (!latest) return undefined;
  return compareVersions(latest, current) > 0 ? { current, latest } : undefined;
}
