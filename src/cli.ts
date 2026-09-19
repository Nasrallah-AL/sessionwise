#!/usr/bin/env node
import { watch } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createAsk, resolveConfig, withStoredCredentials } from "jevctl";
import { claudeCodeAdapter, eventFileAdapter, readFromAdapters, type SessionAdapter } from "./adapters.js";
import { analyzeSessions } from "./analyze.js";
import { buildModelBreakdown } from "./breakdown.js";
import { recommendationCategory } from "./categorize.js";
import { paint, shouldColor, type SingleStyle } from "./color.js";
import { latestDecision, readDecisions, recordDecision } from "./decisions.js";
import { generateDashboard } from "./dashboard.js";
import { describeJevConnection } from "./jev-connection.js";
import { deriveRelevanceRecommendations, judgeRelevance, readClaudeSemanticItems } from "./relevance.js";
import { filterToRecentSessions } from "./recent.js";
import { filterEventsByTime, parsePositiveInt, resolveTimeWindow } from "./time.js";
import type { Analysis, Recommendation, RelevanceReport, SessionEvent, SessionMetrics } from "./types.js";
import { verifyRecommendation } from "./verify.js";
import { checkForUpdate, getOwnVersion } from "./version.js";

const args = process.argv.slice(2);
const command = args[0] ?? "help";

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const fileOption = option("--file");
const adapterId = option("--adapter") ?? option("--source") ?? (fileOption ? "file" : "claude-code");
const inputPath = resolve(fileOption ?? `${homedir()}/.sessionwise/events.jsonl`);
const claudeRoot = resolve(option("--claude-dir") ?? `${homedir()}/.claude/projects`);
const relevancePath = resolve(option("--relevance-file") ?? `${homedir()}/.sessionwise/relevance.json`);
const decisionsPath = resolve(option("--decisions-file") ?? `${homedir()}/.sessionwise/decisions.json`);
const updateCachePath = resolve(`${homedir()}/.sessionwise/update-check.json`);
const json = args.includes("--json");
const force = args.includes("--force");

let cachedTimeWindow: ReturnType<typeof resolveTimeWindow> | undefined;
/** Resolved lazily so a bad --since/--until is caught by run().catch, not thrown at import time. */
function getTimeWindow(): ReturnType<typeof resolveTimeWindow> {
  cachedTimeWindow ??= resolveTimeWindow({ days: option("--days"), hours: option("--hours"), since: option("--since"), until: option("--until") });
  return cachedTimeWindow;
}

interface HelpEntry {
  command: string;
  description: string;
}

interface HelpSection {
  title: string;
  color: SingleStyle;
  entries: HelpEntry[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: "Observe",
    color: "cyan",
    entries: [
      { command: "sessionwise scan", description: "quick look: 5 most recent sessions, writes a report" },
      { command: "sessionwise analyze", description: "scan, plus opt-in Jev relevance, writes a report" },
      { command: "sessionwise sessions", description: "list recorded sessions" },
      { command: "sessionwise inspect <id>", description: "inspect one session" },
      { command: "sessionwise why", description: "where the tokens and calls actually go, by model" },
      { command: "sessionwise metrics", description: "model, cache, context, and health metrics" },
      { command: "sessionwise model-fit", description: "sessions ranked by model-fit score" },
      { command: "sessionwise cache", description: "sessions ranked by cache hit rate" },
      { command: "sessionwise context", description: "sessions ranked by context efficiency" },
      { command: "sessionwise health", description: "sessions ranked by health score" },
    ],
  },
  {
    title: "Explain",
    color: "magenta",
    entries: [
      { command: "sessionwise recommend", description: "evidence-backed recommendations" },
      { command: "sessionwise waste", description: "just the opportunities, grouped by category" },
      { command: "sessionwise show <id>", description: "the calls behind one recommendation" },
      { command: "sessionwise relevance", description: "judge context, skill, and tool relevance with Jev" },
    ],
  },
  {
    title: "Decide",
    color: "yellow",
    entries: [
      { command: "sessionwise verify <id>", description: "sanity-check a recommendation's evidence with Jev" },
      { command: "sessionwise apply <id>", description: "record that a recommendation was acted on" },
    ],
  },
  {
    title: "Report",
    color: "green",
    entries: [
      { command: "sessionwise live", description: "watch a JSONL ledger for new findings" },
      { command: "sessionwise dashboard", description: "write a self-contained HTML dashboard" },
      { command: "sessionwise adapters", description: "list available data adapters" },
      { command: "sessionwise privacy", description: "what is read, sent, and stored" },
      { command: "sessionwise guide", description: "which model tier fits which kind of turn" },
      { command: "sessionwise jev", description: "check the Jev connection used by verify/relevance/analyze" },
    ],
  },
];

const HELP_FLAGS: HelpEntry[] = [
  { command: "--adapter claude-code|file", description: "data adapter; defaults to Claude Code" },
  { command: "--claude-dir <path>", description: "Claude Code projects directory" },
  { command: "--file <path>", description: "normalized JSON or JSONL event source" },
  { command: "--relevance-file <path>", description: "semantic relevance report path" },
  { command: "--decisions-file <path>", description: "decisions ledger path" },
  { command: "--model <name>", description: "why: limit to one model" },
  { command: "--session <id>", description: "scope to one session (any command)" },
  { command: "--limit <n>", description: "analyze/relevance: maximum relevance candidates (default 50)" },
  { command: "--out <path>", description: "scan/analyze/dashboard output path" },
  { command: "--force", description: "apply: proceed without a passing verify" },
  { command: "--days <n>", description: "only calls from the last n days" },
  { command: "--hours <n>", description: "only calls from the last n hours" },
  { command: "--since <date>", description: "only calls at or after this date" },
  { command: "--until <date>", description: "only calls at or before this date" },
  { command: "--recent <n>", description: "only the n most recently active sessions" },
  { command: "--all", description: "scan/analyze: full history, not just the 5 most recent" },
  { command: "--no-report", description: "scan/analyze: skip writing the HTML report" },
  { command: "--version, -v", description: "print the installed version" },
  { command: "--no-update-check", description: "skip the once-a-day check for a newer version" },
  { command: "--json", description: "machine-readable output" },
];

const HELP_COLUMN = 34;

function help(): void {
  const color = shouldColor();
  const lines: string[] = [""];

  lines.push(
    `${paint(color, "bold", `SessionWise v${getOwnVersion()}`)} ${paint(color, "dim", "- analyze, understand, and optimize AI sessions")}`,
  );
  lines.push(paint(color, "dim", "(also installed as `sw` and `wise`, same command, shorter to type)"));

  for (const section of HELP_SECTIONS) {
    lines.push("");
    lines.push(paint(color, ["bold", section.color], `  ${section.title}`));
    for (const entry of section.entries) {
      lines.push(`  ${paint(color, "bold", entry.command.padEnd(HELP_COLUMN))}${paint(color, "dim", entry.description)}`);
    }
  }

  lines.push("");
  lines.push(paint(color, ["bold", "white"], "  Flags"));
  for (const entry of HELP_FLAGS) {
    lines.push(`  ${paint(color, "cyan", entry.command.padEnd(HELP_COLUMN))}${paint(color, "dim", entry.description)}`);
  }
  lines.push("");

  console.log(lines.join("\n"));
}

function printRecommendations(recommendations: Recommendation[]): void {
  if (!recommendations.length) {
    console.log("No recommendations. Nothing in this window crossed a detector's threshold.");
    return;
  }
  for (const item of recommendations) {
    console.log(`\n${item.risk.toUpperCase()}  ${item.title}`);
    console.log(`      ${item.suggestion}`);
    console.log(`      ${item.evidence.map((evidence) => `${evidence.label}: ${evidence.value}`).join(" | ")}`);
    console.log(`      ${item.id}`);
  }
}

function printScan(analysis: Analysis, scope: { totalSessions: number; recentCap?: number }): void {
  console.log("\nSessionWise | session intelligence\n");
  const window = getTimeWindow();
  if (window.label) console.log(`Window: ${window.label}\n`);
  if (scope.recentCap !== undefined && scope.totalSessions > scope.recentCap) {
    console.log(`Showing the ${scope.recentCap} most recently active sessions (of ${scope.totalSessions} total). Use --all or --days N to see more.\n`);
  }
  const hasCost = analysis.events.some((event) => (event.costUsd ?? 0) > 0);
  console.log(hasCost
    ? `${analysis.sessions.length} sessions · ${analysis.totals.eventCount} events · $${analysis.totals.costUsd.toFixed(4)} recorded`
    : `${analysis.sessions.length} sessions · ${analysis.totals.eventCount} events · cost not tracked for this adapter`);
  console.log(`${analysis.totals.inputTokens.toLocaleString()} input · ${analysis.totals.outputTokens.toLocaleString()} output · ${analysis.totals.errorCount} errors`);
  console.log(`\n${analysis.recommendations.length} recommendations`);
  printRecommendations(analysis.recommendations.slice(0, 5));
}

const DEFAULT_SCAN_RECENT = 5;

/**
 * `scan` defaults to the 5 most recently active sessions unless the caller
 * already scoped things with --days/--since/--until/--session/--all, or gave
 * an explicit --recent. Every other command is unrestricted by default;
 * --recent still applies to them if passed explicitly.
 */
function getRecentCap(applyDefault: boolean): number | undefined {
  const recentOption = option("--recent");
  if (recentOption !== undefined) return parsePositiveInt(recentOption, "--recent");
  if (!applyDefault) return undefined;
  const explicitlyScoped = Boolean(option("--days") || option("--hours") || option("--since") || option("--until") || option("--session")) || args.includes("--all");
  return explicitlyScoped ? undefined : DEFAULT_SCAN_RECENT;
}

async function loadEvents(): Promise<{ events: SessionEvent[]; totalSessions: number }> {
  let adapter: SessionAdapter;
  if (adapterId === "claude" || adapterId === "claude-code") adapter = claudeCodeAdapter({ root: claudeRoot });
  else if (adapterId === "file") adapter = eventFileAdapter({ path: inputPath });
  else throw new Error(`Unsupported adapter: ${adapterId}`);
  let events = filterEventsByTime(await readFromAdapters([adapter]), getTimeWindow());
  const sessionFilter = option("--session");
  if (sessionFilter) events = events.filter((event) => event.sessionId === sessionFilter);
  const totalSessions = new Set(events.map((event) => event.sessionId)).size;
  return { events, totalSessions };
}

async function load(): Promise<Analysis> {
  const { events } = await loadEvents();
  const recentCap = getRecentCap(false);
  return analyzeSessions(recentCap === undefined ? events : filterToRecentSessions(events, recentCap));
}

async function loadForScan(): Promise<{ analysis: Analysis; totalSessions: number; recentCap?: number }> {
  const recentCap = getRecentCap(true);
  const { events, totalSessions } = await loadEvents();
  const analysis = analyzeSessions(recentCap === undefined ? events : filterToRecentSessions(events, recentCap));
  return { analysis, totalSessions, recentCap };
}

async function loadRelevance(): Promise<RelevanceReport | undefined> {
  try {
    return JSON.parse(await readFile(relevancePath, "utf8")) as RelevanceReport;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Fails fast, before any Jev call, with the same pointer `sessionwise jev` prints. */
function requireJevConnection(env: NodeJS.ProcessEnv): void {
  const connection = describeJevConnection(env);
  if (!connection.connected) throw new Error(connection.detail);
}

function metricTable(sessions: Analysis["sessions"], pick: (metrics: SessionMetrics) => number | null, label: string, ascending: boolean): void {
  const ranked = sessions
    .map((session) => ({ id: session.id, model: session.models.join(", ") || "unknown", value: pick(session.metrics) }))
    .filter((row): row is { id: string; model: string; value: number } => row.value !== null)
    .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value));
  if (json) {
    console.log(JSON.stringify(ranked, null, 2));
    return;
  }
  if (!ranked.length) {
    console.log(`No sessions with a ${label} value yet.`);
    return;
  }
  console.table(ranked.map((row) => ({ id: row.id, model: row.model, [label]: row.value })));
}

async function run(): Promise<void> {
  if (command === "help" || command === "--help" || command === "-h") return help();
  if (command === "--version" || command === "-v" || command === "version" || args.includes("--version") || args.includes("-v")) {
    console.log(getOwnVersion());
    return;
  }

  if (command === "scan") {
    const { analysis, totalSessions, recentCap } = await loadForScan();
    if (json) {
      console.log(JSON.stringify(analysis, null, 2));
      return;
    }
    printScan(analysis, { totalSessions, recentCap });
    if (!args.includes("--no-report")) {
      const output = resolve(option("--out") ?? "sessionwise-report.html");
      await writeFile(output, generateDashboard(analysis, await loadRelevance()), "utf8");
      console.log(`\nFull report written to ${output} (--no-report to skip)`);
    }
    return;
  }

  if (command === "analyze") {
    const { analysis, totalSessions, recentCap } = await loadForScan();
    const sessionIds = new Set(analysis.sessions.map((session) => session.id));
    const connection = describeJevConnection(withStoredCredentials(process.env));
    let relevance: RelevanceReport | undefined;
    let relevanceSkippedReason: string | undefined;

    if (adapterId !== "claude" && adapterId !== "claude-code") {
      relevanceSkippedReason = "semantic relevance currently requires the claude-code adapter";
    } else if (!connection.connected) {
      relevanceSkippedReason = "not connected to Jev (run `sessionwise jev` for setup)";
    } else {
      const available = await readClaudeSemanticItems(claudeRoot);
      const items = available.filter((item) => sessionIds.has(item.sessionId));
      if (!items.length) {
        relevanceSkippedReason = "no context, skill, or tool calls found in the analyzed sessions";
      } else {
        const rawLimit = option("--limit");
        const limit = rawLimit === undefined ? 50 : parsePositiveInt(rawLimit, "--limit");
        const env = withStoredCredentials(process.env);
        const config = resolveConfig({ env });
        const ask = createAsk({ provider: config.provider, model: config.model, timeoutMs: config.timeoutMs, env });
        try {
          relevance = await judgeRelevance(ask, items, { limit });
          await mkdir(dirname(relevancePath), { recursive: true });
          await writeFile(relevancePath, `${JSON.stringify(relevance, null, 2)}\n`, "utf8");
        } catch (error) {
          // A Jev call failing (bad key, network, rate limit) must never cost you the
          // local analysis you already have. Report it and keep going.
          relevanceSkippedReason = `Jev call failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    }

    const enrichedAnalysis: Analysis = relevance
      ? { ...analysis, recommendations: [...analysis.recommendations, ...deriveRelevanceRecommendations(relevance)] }
      : analysis;

    if (json) {
      console.log(JSON.stringify({ analysis: enrichedAnalysis, relevance, relevanceSkippedReason }, null, 2));
      return;
    }
    printScan(enrichedAnalysis, { totalSessions, recentCap });
    if (relevance) {
      const derivedCount = enrichedAnalysis.recommendations.length - analysis.recommendations.length;
      console.log(`\nRelevance: ${relevance.sampled}/${relevance.available} candidates sampled, written to ${relevancePath}`);
      if (derivedCount > 0) console.log(`${derivedCount} additional recommendation${derivedCount === 1 ? "" : "s"} from relevance findings above.`);
    } else {
      console.log(`\nRelevance skipped: ${relevanceSkippedReason}`);
    }
    if (!args.includes("--no-report")) {
      const output = resolve(option("--out") ?? "sessionwise-report.html");
      await writeFile(output, generateDashboard(enrichedAnalysis, relevance ?? (await loadRelevance())), "utf8");
      console.log(`\nFull report written to ${output} (--no-report to skip)`);
    }
    return;
  }

  if (command === "sessions") {
    const analysis = await load();
    return json
      ? console.log(JSON.stringify(analysis.sessions, null, 2))
      : console.table(analysis.sessions.map(({ id, eventCount, costUsd, errorCount, models, metrics }) => ({
          id,
          events: eventCount,
          cost: costUsd,
          errors: errorCount,
          model: models.join(", "),
          modelFit: metrics.modelPicking.fitScore ?? "n/a",
          cacheHit: metrics.cache.hitRate === null ? "n/a" : `${Math.round(metrics.cache.hitRate * 100)}%`,
          context: metrics.context.efficiencyScore ?? "n/a",
          health: metrics.health.score,
        })));
  }

  if (command === "inspect") {
    const id = args[1];
    if (!id) throw new Error("Usage: sessionwise inspect <id>");
    const analysis = await load();
    const session = analysis.sessions.find((item) => item.id === id);
    if (!session) throw new Error(`Session not found: ${id}`);
    const result = { session, events: analysis.events.filter((event) => event.sessionId === id), recommendations: analysis.recommendations.filter((item) => item.sessionId === id) };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "why") {
    const analysis = await load();
    const modelFilter = option("--model");
    if (modelFilter) {
      const sessions = analysis.sessions.filter((session) => session.models.includes(modelFilter));
      if (!sessions.length) throw new Error(`No sessions found for model: ${modelFilter}`);
      return json
        ? console.log(JSON.stringify(sessions, null, 2))
        : console.table(sessions.map((session) => ({
            id: session.id,
            events: session.eventCount,
            tokens: session.inputTokens + session.outputTokens,
            cacheHit: session.metrics.cache.hitRate === null ? "n/a" : `${Math.round(session.metrics.cache.hitRate * 100)}%`,
            fit: session.metrics.modelPicking.fitScore ?? "n/a",
            health: session.metrics.health.score,
          })));
    }
    const breakdown = buildModelBreakdown(analysis.sessions);
    if (json) {
      console.log(JSON.stringify(breakdown, null, 2));
      return;
    }
    console.log("\nWhere the calls go, by model. Add --model <name> to drill into its sessions.\n");
    console.table(breakdown.map((row) => ({
      model: row.model,
      sessions: row.sessionCount,
      calls: row.eventCount,
      tokens: row.tokens,
      cacheHit: row.cacheHitRate === null ? "n/a" : `${Math.round(row.cacheHitRate * 100)}%`,
      fit: row.fitScore ?? "n/a",
      health: row.healthScore,
    })));
    return;
  }

  if (command === "recommend") {
    const recommendations = (await load()).recommendations;
    return json ? console.log(JSON.stringify(recommendations, null, 2)) : printRecommendations(recommendations);
  }

  if (command === "waste") {
    const recommendations = (await load()).recommendations;
    const order = { safe: 0, review: 1, verify: 2 } as const;
    const sorted = [...recommendations].sort((a, b) => order[a.risk] - order[b.risk]);
    if (json) {
      console.log(JSON.stringify(sorted, null, 2));
      return;
    }
    if (!sorted.length) {
      console.log("No opportunities found.");
      return;
    }
    console.log("\nOpportunities, safest first\n");
    for (const item of sorted) {
      console.log(`[${item.risk}] ${recommendationCategory(item)} · ${item.title}`);
      console.log(`  ${item.evidence.map((evidence) => `${evidence.label}: ${evidence.value}`).join(" | ")}`);
      console.log(`  ${item.id}`);
    }
    return;
  }

  if (command === "show") {
    const id = args[1];
    if (!id) throw new Error("Usage: sessionwise show <recommendation-id>");
    const analysis = await load();
    const recommendation = analysis.recommendations.find((item) => item.id === id);
    if (!recommendation) throw new Error(`Recommendation not found: ${id}`);
    const events = recommendation.sessionId
      ? analysis.events.filter((event) => event.sessionId === recommendation.sessionId)
      : [];
    const rows = events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      model: event.model ?? "unknown",
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      tool: event.toolName ?? "",
      error: Boolean(event.error),
    }));
    if (json) {
      console.log(JSON.stringify({ recommendation, calls: rows }, null, 2));
      return;
    }
    console.log(`\n${recommendation.title}\n${recommendation.suggestion}\n`);
    console.log(recommendation.evidence.map((item) => `${item.label}: ${item.value}`).join(" | "));
    console.log(`\n${rows.length} calls in this session:\n`);
    console.table(rows);
    return;
  }

  if (command === "verify") {
    const id = args[1];
    if (!id) throw new Error("Usage: sessionwise verify <recommendation-id>");
    const analysis = await load();
    const recommendation = analysis.recommendations.find((item) => item.id === id);
    if (!recommendation) throw new Error(`Recommendation not found: ${id}`);
    const env = withStoredCredentials(process.env);
    requireJevConnection(env);
    const config = resolveConfig({ env });
    const ask = createAsk({ provider: config.provider, model: config.model, timeoutMs: config.timeoutMs, env });
    const result = await verifyRecommendation(ask, recommendation);
    await recordDecision(decisionsPath, {
      recommendationId: id,
      status: result.passed ? "verified" : "skipped",
      note: result.rationale,
      recordedAt: new Date().toISOString(),
    });
    if (json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\n${result.passed ? "PASS" : "FAIL"}  ${recommendation.title}`);
    console.log(result.rationale);
    console.log(result.passed ? `\nsessionwise apply ${id}` : "\nThis recommendation was not marked verified.");
    return;
  }

  if (command === "apply") {
    const id = args[1];
    if (!id) throw new Error("Usage: sessionwise apply <recommendation-id>");
    const analysis = await load();
    const recommendation = analysis.recommendations.find((item) => item.id === id);
    if (!recommendation) throw new Error(`Recommendation not found: ${id}`);
    const decisions = await readDecisions(decisionsPath);
    const verified = Boolean(latestDecision(decisions, id, "verified"));
    if (recommendation.risk === "verify" && !verified && !force) {
      throw new Error(`This recommendation needs verification first. Run: sessionwise verify ${id}`);
    }
    if (recommendation.risk === "review" && !verified && !force) {
      throw new Error("This recommendation should be reviewed first. Re-run with --force to record it anyway.");
    }
    await recordDecision(decisionsPath, {
      recommendationId: id,
      status: "applied",
      note: recommendation.suggestion,
      recordedAt: new Date().toISOString(),
    });
    if (json) {
      console.log(JSON.stringify({ recommendationId: id, status: "applied" }, null, 2));
      return;
    }
    console.log(`\nRecorded as applied: ${recommendation.title}`);
    console.log(`Action to take: ${recommendation.suggestion}`);
    console.log(`\nSessionWise does not change any provider or agent config. This only records your decision at ${decisionsPath}.`);
    return;
  }

  if (command === "adapters") {
    const adapters = [
      claudeCodeAdapter({ root: claudeRoot }),
      eventFileAdapter({ path: inputPath }),
    ].map(({ id, label, description }) => ({ id, label, description }));
    if (json) console.log(JSON.stringify(adapters, null, 2));
    else console.table(adapters);
    return;
  }

  if (command === "metrics") {
    const sessions = (await load()).sessions.map(({ id, models, metrics }) => ({ id, models, ...metrics }));
    if (json) console.log(JSON.stringify(sessions, null, 2));
    else console.table(sessions.map(({ id, models, modelPicking, cache, context, health }) => ({
      id,
      model: models.join(", "),
      modelFit: modelPicking.fitScore ?? "n/a",
      lowerTierCalls: `${modelPicking.oversizedCalls}/${modelPicking.evaluatedCalls}`,
      cacheHit: cache.hitRate === null ? "n/a" : `${Math.round(cache.hitRate * 100)}%`,
      contextEfficiency: context.efficiencyScore ?? "n/a",
      health: health.score,
    })));
    return;
  }

  if (command === "model-fit") {
    const analysis = await load();
    return metricTable(analysis.sessions, (metrics) => metrics.modelPicking.fitScore, "modelFit", true);
  }

  if (command === "cache") {
    const analysis = await load();
    return metricTable(analysis.sessions, (metrics) => metrics.cache.hitRate === null ? null : Math.round(metrics.cache.hitRate * 100), "cacheHitPercent", true);
  }

  if (command === "context") {
    const analysis = await load();
    return metricTable(analysis.sessions, (metrics) => metrics.context.efficiencyScore, "contextEfficiency", true);
  }

  if (command === "health") {
    const analysis = await load();
    return metricTable(analysis.sessions, (metrics) => metrics.health.score, "health", true);
  }

  if (command === "relevance") {
    if (adapterId !== "claude" && adapterId !== "claude-code") {
      throw new Error("Semantic extraction currently requires the claude-code adapter.");
    }
    const env = withStoredCredentials(process.env);
    requireJevConnection(env);
    const requestedSession = option("--session");
    const rawLimit = option("--limit");
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
    const available = await readClaudeSemanticItems(claudeRoot);
    const items = requestedSession ? available.filter((item) => item.sessionId === requestedSession) : available;
    if (!items.length) throw new Error(requestedSession ? `No semantic candidates found for session ${requestedSession}.` : "No semantic candidates found.");
    const config = resolveConfig({ env });
    const ask = createAsk({ provider: config.provider, model: config.model, timeoutMs: config.timeoutMs, env });
    const report = await judgeRelevance(ask, items, { limit });
    await mkdir(dirname(relevancePath), { recursive: true });
    await writeFile(relevancePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`\nSemantic relevance | ${report.sampled}/${report.available} candidates sampled\n`);
      console.table(Object.entries(report.metrics).map(([kind, metric]) => ({
        kind,
        relevant: metric.relevant,
        irrelevant: metric.irrelevant,
        uncertain: metric.uncertain,
        relevantRate: metric.relevantRate === null ? "n/a" : `${Math.round(metric.relevantRate * 100)}%`,
      })));
      console.log(`Report written to ${relevancePath}`);
    }
    return;
  }

  if (command === "dashboard") {
    const output = resolve(option("--out") ?? "sessionwise-report.html");
    await writeFile(output, generateDashboard(await load(), await loadRelevance()), "utf8");
    console.log(`Dashboard written to ${output}`);
    return;
  }

  if (command === "privacy") {
    console.log(`
SessionWise | privacy

Local by default. Nothing is read, sent, or stored unless a command below says so.

  scan, sessions, inspect, why, metrics,
  model-fit, cache, context, health,
  waste, recommend, show, dashboard, live   Read transcript metadata only:
                                            model, token counts, cache tokens,
                                            timestamps, tool names, error hashes.
                                            Nothing leaves this machine.

  relevance                                Opt-in. Sends a sampled current
                                            request plus one candidate's
                                            context, skill, or tool detail to
                                            your configured Jev provider.
                                            Stores only labels and
                                            probabilities at ${relevancePath}.

  verify                                   Sends one recommendation's evidence
                                            numbers (not raw prompts or tool
                                            output) to Jev, to sanity-check the
                                            finding. Records pass or fail at
                                            ${decisionsPath}.

  apply                                    Local only. Records your decision
                                            at ${decisionsPath}. Never edits a
                                            provider key, config file, or
                                            running session.

Claude Code transcripts are read from ${claudeRoot} unless --claude-dir points
elsewhere. Tool inputs and outputs are hashed for repeat detection; the hash
cannot be reversed into the original content.

Update check                               Once every 24 hours (cached at
                                            ${updateCachePath}),
                                            every command except --json runs
                                            checks whether a newer version is
                                            on npm (\`npm view sessionwise
                                            version\`) and prints a one-line
                                            note if so. It reads only a
                                            version number, never anything
                                            about your sessions. Disable with
                                            --no-update-check or
                                            SESSIONWISE_NO_UPDATE_CHECK=1.

Run \`sessionwise jev\` to check whether verify/relevance can reach Jev right now.
`);
    return;
  }

  if (command === "jev") {
    const connection = describeJevConnection(withStoredCredentials(process.env));
    if (json) {
      console.log(JSON.stringify(connection, null, 2));
      return;
    }
    console.log(`\n${connection.connected ? "Connected" : "Not connected"}\n`);
    console.log(connection.detail);
    return;
  }

  if (command === "guide") {
    console.log(`
SessionWise | model-fit guide

How a turn is classified, from its observed shape alone (no content read):

  fast       reasoning < 300 tokens, 0 tool calls, input < 20k, output < 1k
  balanced   reasoning >= 300, or 1+ tool calls, or input >= 20k, or output >= 1k
  advanced   reasoning >= 2,000, or 4+ tool calls, or output >= 4,000

A model-fit finding fires when a session's actual model tier sits above what
its turns needed on average. It is inferred, not measured, and is always
marked "verify" risk until you run:

  sessionwise verify <recommendation-id>
`);
    return;
  }

  if (command === "live") {
    if (adapterId === "file") {
      await mkdir(dirname(inputPath), { recursive: true });
      await writeFile(inputPath, "", { flag: "a" });
    }
    const seen = new Set<string>();
    const report = async () => {
      const recommendations = (await load()).recommendations.filter((item) => !seen.has(item.id));
      for (const item of recommendations) seen.add(item.id);
      if (json) recommendations.forEach((item) => console.log(JSON.stringify(item)));
      else printRecommendations(recommendations);
    };
    await report();
    const isClaude = adapterId === "claude" || adapterId === "claude-code";
    const watchedPath = isClaude ? claudeRoot : inputPath;
    console.log(json ? JSON.stringify({ status: "watching", adapter: adapterId, path: watchedPath }) : `\nWatching ${watchedPath}`);
    let timer: NodeJS.Timeout | undefined;
    watch(watchedPath, { recursive: isClaude }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => void report(), 100);
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

/**
 * Warns, at most once a day and never in --json mode, when a newer version
 * is published. Cache lives at ~/.sessionwise/update-check.json; see
 * `sessionwise privacy` for what this does and how to turn it off.
 */
async function warnIfUpdateAvailable(): Promise<void> {
  if (json || args.includes("--no-update-check") || process.env.SESSIONWISE_NO_UPDATE_CHECK) return;
  const update = await checkForUpdate(updateCachePath).catch(() => undefined);
  if (update) {
    console.error(`\nsessionwise ${update.latest} is available (you have ${update.current}). Update: npm install -g sessionwise@latest`);
  }
}

run()
  .then(() => warnIfUpdateAvailable())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
