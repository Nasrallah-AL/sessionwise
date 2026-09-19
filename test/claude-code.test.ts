import { describe, expect, it } from "vitest";
import { parseClaudeCodeTranscript } from "../src/claude-code.js";

const transcript = [
  {
    type: "assistant",
    sessionId: "session-1",
    timestamp: "2026-09-19T10:00:00Z",
    message: {
      id: "message-1",
      model: "claude-sonnet-5",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 900,
        output_tokens: 50,
        output_tokens_details: { thinking_tokens: 20 },
      },
      content: [{ type: "thinking" }],
    },
  },
  {
    type: "assistant",
    sessionId: "session-1",
    timestamp: "2026-09-19T10:00:01Z",
    message: {
      id: "message-1",
      model: "claude-sonnet-5",
      stop_reason: "tool_use",
      usage: {
        input_tokens: 10,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 900,
        output_tokens: 50,
        output_tokens_details: { thinking_tokens: 20 },
      },
      content: [{ type: "tool_use", id: "tool-1", name: "Read" }],
    },
  },
  {
    type: "user",
    sessionId: "session-1",
    timestamp: "2026-09-19T10:00:02Z",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", is_error: true }] },
  },
].map((row) => JSON.stringify(row)).join("\n");

describe("parseClaudeCodeTranscript", () => {
  it("deduplicates content blocks by message id", () => {
    const events = parseClaudeCodeTranscript(transcript);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "message-1",
      model: "claude-sonnet-5",
      inputTokens: 1_010,
      cachedInputTokens: 900,
      outputTokens: 50,
      reasoningTokens: 20,
      toolName: "Read",
    });
    expect(events[0]?.error).toMatch(/^Claude Code tool error:[a-f0-9]{16}$/);
    expect(events[0]?.metadata?.toolNames).toEqual(["Read"]);
  });

  it("ignores partial lines from an active transcript", () => {
    expect(parseClaudeCodeTranscript(`${transcript}\n{"type":`)).toHaveLength(1);
  });
});
