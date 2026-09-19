import { readClaudeCodeSessions } from "./claude-code.js";
import { readEvents } from "./io.js";
import type { SessionEvent } from "./types.js";

export interface SessionAdapter {
  id: string;
  label: string;
  description: string;
  read(): Promise<SessionEvent[]>;
}

export function claudeCodeAdapter(options: { root: string }): SessionAdapter {
  return {
    id: "claude-code",
    label: "Claude Code",
    description: "Reads Claude Code project and subagent transcripts.",
    read: () => readClaudeCodeSessions(options.root),
  };
}

export function eventFileAdapter(options: { path: string }): SessionAdapter {
  return {
    id: "file",
    label: "Event file",
    description: "Reads normalized SessionWise JSON or JSONL events.",
    read: () => readEvents(options.path),
  };
}

export async function readFromAdapters(adapters: SessionAdapter[]): Promise<SessionEvent[]> {
  const results = await Promise.all(adapters.map((adapter) => adapter.read()));
  return results.flat();
}
