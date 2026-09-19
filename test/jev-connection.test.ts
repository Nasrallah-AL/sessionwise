import { describe, expect, it } from "vitest";
import { describeJevConnection } from "../src/jev-connection.js";

// Force the file-backed store at an empty path so these assertions never
// depend on whatever is in the machine's real OS keychain.
const isolated = { JEV_CREDENTIAL_STORE: "file", HOME: "/tmp/sessionwise-test-no-credentials" };

describe("describeJevConnection", () => {
  it("reports connected when a TypeSafe key is in the environment", () => {
    const connection = describeJevConnection({ ...isolated, TYPESAFE_API_KEY: "sk-test" });
    expect(connection).toMatchObject({ connected: true, provider: "typesafe", source: "env" });
  });

  it("reports connected when an OpenRouter key is in the environment", () => {
    const connection = describeJevConnection({ ...isolated, OPENROUTER_API_KEY: "sk-or-test" });
    expect(connection).toMatchObject({ connected: true, provider: "openrouter", source: "env" });
  });

  it("reports connected when Cloudflare credentials are in the environment", () => {
    const connection = describeJevConnection({ ...isolated, CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "acct" });
    expect(connection).toMatchObject({ connected: true, provider: "cloudflare", source: "env" });
  });

  it("points to jevctl when nothing is configured", () => {
    const connection = describeJevConnection(isolated);
    expect(connection.connected).toBe(false);
    expect(connection.detail).toContain("npm install -g jevctl");
    expect(connection.detail).toContain("jev auth login");
    expect(connection.detail).toContain("TYPESAFE_API_KEY");
  });
});
