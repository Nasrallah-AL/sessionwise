import { describe, expect, it } from "vitest";
import { analyzeSessions } from "../src/analyze.js";
import { generateDashboard } from "../src/dashboard.js";

describe("generateDashboard", () => {
  it("renders a self-contained responsive report", () => {
    const html = generateDashboard(analyzeSessions([{
      id: "event-1",
      sessionId: "session-1",
      timestamp: "2026-09-19T10:00:00Z",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.01,
    }]));

    expect(html).toContain("SessionWise report");
    expect(html).toContain("session-1");
    expect(html).toContain("@media(max-width:760px)");
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("shows relevant and irrelevant semantic counts", () => {
    const analysis = analyzeSessions([]);
    const html = generateDashboard(analysis, {
      generatedAt: "2026-09-19T10:00:00Z",
      provider: "typesafe",
      model: "jev-test",
      sampled: 5,
      available: 5,
      metrics: {
        context: { total: 2, relevant: 1, irrelevant: 1, uncertain: 0, relevantRate: 0.5, irrelevantRate: 0.5 },
        skill: { total: 1, relevant: 1, irrelevant: 0, uncertain: 0, relevantRate: 1, irrelevantRate: 0 },
        tool: { total: 2, relevant: 1, irrelevant: 0, uncertain: 1, relevantRate: 0.5, irrelevantRate: 0 },
      },
      judgments: [],
    });

    expect(html).toContain("Context relevance");
    expect(html).toContain("Skills relevance");
    expect(html).toContain("Tools relevance");
    expect(html).toContain("<strong>1</strong> irrelevant");
    expect(html).toContain("id=\"report-search\"");
    expect(html).toContain("data-view=\"recommendations\"");
    expect(html).not.toContain("confidence");
    expect(html).not.toContain("—");
  });
});
