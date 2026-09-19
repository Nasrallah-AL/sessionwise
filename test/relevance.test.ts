import { describe, expect, it } from "vitest";
import type { AskFn } from "jevctl";
import { extractClaudeSemanticItems, judgeRelevance } from "../src/relevance.js";

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
