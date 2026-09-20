import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { estimateCostUsd } from "./pricing.js";
import type { SessionEvent } from "./types.js";

interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { thinking_tokens?: number };
}

interface ClaudeContentBlock {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
  input?: unknown;
  content?: unknown;
}

interface ClaudeRow {
  type?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  session_id?: string;
  cwd?: string;
  isSidechain?: boolean;
  effort?: string;
  message?: {
    id?: string;
    model?: string;
    stop_reason?: string;
    usage?: ClaudeUsage;
    content?: ClaudeContentBlock[] | string;
  };
}

interface MessageAggregate {
  id: string;
  sessionId: string;
  timestamp: string;
  model?: string;
  usage: ClaudeUsage;
  stopReason?: string;
  cwd?: string;
  isSidechain: boolean;
  effort?: string;
  toolUses: Map<string, { name: string; key: string }>;
}

export async function findClaudeCodeTranscriptFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
    }));
  }
  await visit(root);
  return files;
}

function rows(source: string): ClaudeRow[] {
  const parsed: ClaudeRow[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      parsed.push(JSON.parse(line) as ClaudeRow);
    } catch {
      // Active Claude sessions can expose a final partial line while being written.
    }
  }
  return parsed;
}

export function parseClaudeCodeTranscript(source: string): SessionEvent[] {
  const parsed = rows(source);
  const messages = new Map<string, MessageAggregate>();
  const failedTools = new Map<string, string>();

  for (const row of parsed) {
    if (row.type === "user" && Array.isArray(row.message?.content)) {
      for (const block of row.message.content) {
        if (block.type === "tool_result" && block.tool_use_id && block.is_error) {
          const errorHash = createHash("sha256").update(JSON.stringify(block.content ?? null)).digest("hex").slice(0, 16);
          failedTools.set(block.tool_use_id, errorHash);
        }
      }
    }
    if (row.type !== "assistant" || !row.message?.id || !row.message.usage) continue;
    const sessionId = row.sessionId ?? row.session_id;
    if (!sessionId) continue;
    const current: MessageAggregate = messages.get(row.message.id) ?? {
      id: row.message.id,
      sessionId,
      timestamp: row.timestamp ?? new Date(0).toISOString(),
      usage: row.message.usage,
      isSidechain: Boolean(row.isSidechain),
      toolUses: new Map<string, { name: string; key: string }>(),
    };
    current.timestamp = row.timestamp ?? current.timestamp;
    current.model = row.message.model ?? current.model;
    current.usage = row.message.usage;
    current.stopReason = row.message.stop_reason ?? current.stopReason;
    current.cwd = row.cwd ?? current.cwd;
    current.effort = row.effort ?? current.effort;
    if (Array.isArray(row.message.content)) {
      for (const block of row.message.content) {
        if (block.type === "tool_use" && block.id && block.name) {
          const inputHash = createHash("sha256").update(JSON.stringify(block.input ?? null)).digest("hex").slice(0, 16);
          current.toolUses.set(block.id, { name: block.name, key: `${block.name}:${inputHash}` });
        }
      }
    }
    messages.set(row.message.id, current);
  }

  return [...messages.values()].map((message) => {
    const cacheRead = message.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = message.usage.cache_creation_input_tokens ?? 0;
    const input = (message.usage.input_tokens ?? 0) + cacheRead + cacheCreation;
    const failed = [...message.toolUses.keys()].flatMap((id) => {
      const errorHash = failedTools.get(id);
      return errorHash ? [errorHash] : [];
    });
    const toolCalls = [...message.toolUses.values()];
    const toolNames = toolCalls.map((tool) => tool.name);
    const outputTokens = message.usage.output_tokens ?? 0;
    return {
      id: message.id,
      sessionId: message.sessionId,
      timestamp: message.timestamp,
      provider: "anthropic",
      model: message.model,
      route: message.cwd,
      inputTokens: input,
      outputTokens,
      cachedInputTokens: cacheRead,
      reasoningTokens: message.usage.output_tokens_details?.thinking_tokens ?? 0,
      // Claude Code transcripts don't report billed cost, so this is a coarse
      // tier-based estimate (see pricing.ts) - good enough to rank sessions
      // and gate cost-concentration, not to reconcile against an invoice.
      costUsd: estimateCostUsd(message.model, {
        inputTokens: message.usage.input_tokens ?? 0,
        outputTokens,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreation,
      }),
      toolName: toolNames[0],
      error: failed.length ? `Claude Code tool error:${[...new Set(failed)].sort().join(",")}` : undefined,
      metadata: {
        source: "claude-code",
        cacheCreationInputTokens: cacheCreation,
        nonCachedInputTokens: message.usage.input_tokens ?? 0,
        toolNames,
        toolCallKeys: toolCalls.map((tool) => tool.key),
        stopReason: message.stopReason,
        effort: message.effort,
        isSidechain: message.isSidechain,
        costBasis: "estimated",
      },
    } satisfies SessionEvent;
  });
}

export async function readClaudeCodeSessions(root: string): Promise<SessionEvent[]> {
  const files = await findClaudeCodeTranscriptFiles(root);
  const transcripts = await Promise.all(files.map(async (path) => parseClaudeCodeTranscript(await readFile(path, "utf8"))));
  return transcripts.flat();
}
