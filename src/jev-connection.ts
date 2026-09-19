import { resolveCredentials } from "jevctl";

export interface JevConnection {
  connected: boolean;
  /** Which transport would be used, when connected. */
  provider?: "typesafe" | "openrouter" | "cloudflare";
  /** Where the credential came from, when connected. */
  source?: "env" | "keychain" | "file";
  /** Human-readable status, safe to print as-is. */
  detail: string;
}

const SETUP_POINTER = [
  "SessionLens sends nothing to Jev on its own. Only `sessionlens verify` and",
  "`sessionlens relevance` call it, and only when you run them.",
  "",
  "Quickest: set one of these environment variables.",
  "  TYPESAFE_API_KEY     https://console.typesafe.ai/settings/keys",
  "  OPENROUTER_API_KEY    sk-or-...",
  "  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
  "",
  "Recommended: install the jevctl CLI once and log in. It stores the key in",
  "your OS keychain, and SessionLens reads that same stored key automatically",
  "-- nothing to configure here.",
  "  npm install -g jevctl",
  "  jev auth login",
  "  jev auth status   # confirms which provider is connected",
].join("\n");

/** Checks for a usable Jev credential without making a network call. */
export function describeJevConnection(env: NodeJS.ProcessEnv = process.env): JevConnection {
  const resolved = resolveCredentials(env).find((entry) => entry.source !== "none");
  if (resolved) {
    return {
      connected: true,
      provider: resolved.provider,
      source: resolved.source === "none" ? undefined : resolved.source,
      detail: `Connected to Jev via ${resolved.provider} (credential from ${resolved.source}).`,
    };
  }
  const cloudflareToken = env.JEV_CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN;
  if (cloudflareToken && env.CLOUDFLARE_ACCOUNT_ID) {
    return {
      connected: true,
      provider: "cloudflare",
      source: "env",
      detail: "Connected to Jev via cloudflare (credential from env).",
    };
  }
  return { connected: false, detail: `Not connected to Jev.\n\n${SETUP_POINTER}` };
}
