import { describe, expect, it } from "vitest";
import type { AskFn } from "jevctl";
import { deriveRelevanceRecommendations, extractClaudeSemanticItems, groupRelevanceBySession, judgeRelevance } from "../src/relevance.js";
import type { RelevanceJudgment, RelevanceReport } from "../src/types.js";

const source = [
  {
    type: "user",
    uuid: "turn-1",
    sessionId: "session-1",
    message: { content: "Fix the checkout test" },
  },
  {
    type: "assistant",
    sessionId: "session-1",
    message: { content: [{ type: "tool_use", id: "skill-1", name: "Skill", input: { skill: "unit-testing" } }] },
  },
  {
    type: "assistant",
    sessionId: "session-1",
    message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "npm test" } }] },
  },
  {
    type: "user",
    sessionId: "session-1",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "SECRET TEST OUTPUT" }] },
  },
].map((row) => JSON.stringify(row)).join("\n");

describe("semantic relevance", () => {
  it("extracts skill, tool, and resulting context candidates", () => {
    const items = extractClaudeSemanticItems(source);

    expect(items.map((item) => item.kind)).toEqual(["skill", "tool", "context"]);
    expect(items[0]).toMatchObject({ name: "unit-testing", request: "Fix the checkout test" });
    expect(items[2]).toMatchObject({ name: "Bash result", details: "SECRET TEST OUTPUT" });
  });

  it("persists judgments without raw content", async () => {
    const ask: AskFn = async (state, questions) => ({
      answers: Object.fromEntries(Object.keys(questions).map((id, index) => [id, {
        type: "choice",
        choice: (state as Array<{ candidate_type: string }>)[index]?.candidate_type === "tool" ? "irrelevant" : "relevant",
        confidence: 0.9,
        probabilities: (state as Array<{ candidate_type: string }>)[index]?.candidate_type === "tool"
          ? { relevant: 0.05, irrelevant: 0.9, uncertain: 0.05 }
          : { relevant: 0.9, irrelevant: 0.05, uncertain: 0.05 },
      }])),
      usage: { input_tokens: 100, output_tokens: 10 },
      provider: "typesafe",
      model: "jev-test",
    });

    const report = await judgeRelevance(ask, extractClaudeSemanticItems(source));

    expect(report.metrics.skill).toMatchObject({ relevant: 1, irrelevant: 0 });
    expect(report.metrics.tool).toMatchObject({ relevant: 0, irrelevant: 1 });
    expect(report.metrics.context).toMatchObject({ relevant: 1, irrelevant: 0 });
    expect(JSON.stringify(report)).not.toContain("SECRET TEST OUTPUT");
    expect(JSON.stringify(report)).not.toContain("Fix the checkout test");
  });

  it("samples context, skills, and tools separately", async () => {
    const seen: string[] = [];
    const ask: AskFn = async (state, questions) => {
      seen.push(...(state as Array<{ candidate_type: string }>).map((item) => item.candidate_type));
      return {
        answers: Object.fromEntries(Object.keys(questions).map((id) => [id, {
          type: "choice",
          choice: "relevant",
          confidence: 0.9,
          probabilities: { relevant: 0.9, irrelevant: 0.05, uncertain: 0.05 },
        }])),
        usage: { input_tokens: 100, output_tokens: 10 },
        provider: "typesafe",
        model: "jev-test",
      };
    };
    const base = { sessionId: "s", turnId: "t", request: "request", details: "details", name: "candidate" };
    const items = [
      ...Array.from({ length: 10 }, (_, index) => ({ ...base, id: `context-${index}`, kind: "context" as const })),
      { ...base, id: "skill-1", kind: "skill" as const },
      { ...base, id: "tool-1", kind: "tool" as const },
    ];

    await judgeRelevance(ask, items, { limit: 3 });

    expect(seen).toEqual(["context", "skill", "tool"]);
  });
});

const judgment = (overrides: Partial<RelevanceJudgment>): RelevanceJudgment => ({
  id: "id",
  sessionId: "session-1",
  turnId: "turn-1",
  kind: "tool",
  name: "Read",
  label: "relevant",
  confidence: 0.9,
  probabilities: { relevant: 0.9, irrelevant: 0.05, uncertain: 0.05 },
  ...overrides,
});

describe("groupRelevanceBySession", () => {
  it("counts per session and category", () => {
    const groups = groupRelevanceBySession([
      judgment({ sessionId: "a", kind: "tool", label: "relevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
      judgment({ sessionId: "b", kind: "context", label: "uncertain" }),
    ]);

    const a = groups.find((g) => g.sessionId === "a")!;
    const b = groups.find((g) => g.sessionId === "b")!;
    expect(a.counts.tool).toEqual({ relevant: 1, irrelevant: 1, uncertain: 0 });
    expect(b.counts.context).toEqual({ relevant: 0, irrelevant: 0, uncertain: 1 });
  });

  it("deduplicates identical non-relevant calls into one flagged entry with a count", () => {
    const groups = groupRelevanceBySession([
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Bash", label: "relevant" }),
    ]);

    const a = groups.find((g) => g.sessionId === "a")!;
    expect(a.flagged).toEqual([{ kind: "tool", name: "Read", label: "irrelevant", count: 3 }]);
  });

  it("sorts flagged entries by count, most frequent first", () => {
    const groups = groupRelevanceBySession([
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Bash", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Bash", label: "irrelevant" }),
    ]);

    const a = groups.find((g) => g.sessionId === "a")!;
    expect(a.flagged.map((f) => f.name)).toEqual(["Bash", "Read"]);
  });
});

function report(judgments: RelevanceJudgment[]): RelevanceReport {
  return {
    generatedAt: "2026-09-19T00:00:00Z",
    provider: "typesafe",
    model: "jev-test",
    sampled: judgments.length,
    available: judgments.length,
    metrics: {
      context: { total: 0, relevant: 0, irrelevant: 0, uncertain: 0, relevantRate: null, irrelevantRate: null },
      skill: { total: 0, relevant: 0, irrelevant: 0, uncertain: 0, relevantRate: null, irrelevantRate: null },
      tool: { total: 0, relevant: 0, irrelevant: 0, uncertain: 0, relevantRate: null, irrelevantRate: null },
    },
    judgments,
  };
}

describe("deriveRelevanceRecommendations", () => {
  it("recommends when a session/category is mostly irrelevant, with at least 3 samples", () => {
    const recommendations = deriveRelevanceRecommendations(report([
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Read", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", name: "Bash", label: "relevant" }),
    ]));

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      kind: "irrelevant-tool",
      sessionId: "a",
      risk: "review",
      confidence: "medium",
    });
    expect(recommendations[0]!.evidence.find((e) => e.label === "irrelevant")?.value).toBe("2/3");
  });

  it("does not recommend below the 3-sample minimum, even at 100% irrelevant", () => {
    const recommendations = deriveRelevanceRecommendations(report([
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
    ]));
    expect(recommendations).toEqual([]);
  });

  it("does not recommend when the irrelevant rate is below 30%", () => {
    const recommendations = deriveRelevanceRecommendations(report([
      judgment({ sessionId: "a", kind: "tool", label: "relevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "relevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "relevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
    ]));
    expect(recommendations).toEqual([]);
  });

  it("keeps sessions and categories separate", () => {
    const recommendations = deriveRelevanceRecommendations(report([
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
      judgment({ sessionId: "a", kind: "tool", label: "irrelevant" }),
      judgment({ sessionId: "b", kind: "context", label: "relevant" }),
      judgment({ sessionId: "b", kind: "context", label: "relevant" }),
      judgment({ sessionId: "b", kind: "context", label: "relevant" }),
    ]));
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]!.sessionId).toBe("a");
  });
});
