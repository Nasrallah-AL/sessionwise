# SessionWise

[![CI](https://github.com/Nasrallah-AL/sessionwise/actions/workflows/ci.yml/badge.svg)](https://github.com/Nasrallah-AL/sessionwise/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/sessionwise.svg)](https://www.npmjs.com/package/sessionwise)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Analyze, understand, and optimize AI sessions. SessionWise reads Claude Code transcripts (or normalized JSON/JSONL events), finds patterns that cost time and tokens, and shows evidence for every finding.

Installed from npm as **`sessionwise`**. The command works as `sessionwise`, `sw`, or `wise`, same binary.

## Why session-level analysis

A single call can look fine on its own. A session reveals what a single call cannot: context growing turn over turn, the same failure retried unchanged, a tool re-read that already gave the same answer, cache misses on a prompt that barely changed, or reasoning effort that never reached the output. SessionWise looks at the whole run before it suggests anything.

## Install

```bash
npm install -g sessionwise
sessionwise --version
```

Node 20.12 or newer. No install: `npx sessionwise scan`.

## First run

```bash
sessionwise scan
```

```text
SessionWise | session intelligence

Showing the 5 most recently active sessions (of 89 total). Use --all or --days N to see more.

5 sessions · 250 events · $0.0000 recorded
25,038,828 input · 124,544 output · 5 errors

2 recommendations

REVIEW  Session context grew faster than the work
      Compact or checkpoint the session before the next phase of work.
      first input: 44391 | last input: 204096 | growth: 4.6x
      context-growth:47720427-18a2-4f05-b73a-7a41c50168ff

Full report written to sessionwise-report.html (--no-report to skip)
```

`scan` only looks at your 5 most recently active sessions by default and writes a browsable report alongside the terminal summary. Everything is local: no network call, no API key needed.

## Commands

### Observe

Local, no network call, no credential needed.

| Command | Purpose |
| --- | --- |
| `sessionwise scan` | Quick look: 5 most recent sessions, writes a report |
| `sessionwise sessions` | List recorded sessions |
| `sessionwise inspect <id>` | One session, in full, with its evidence |
| `sessionwise why` | Where the tokens and calls actually go, grouped by model |
| `sessionwise metrics` | Model picking, cache, context efficiency, and health, per session |
| `sessionwise model-fit` | Sessions ranked by model-fit score, worst first |
| `sessionwise cache` | Sessions ranked by cache hit rate, worst first |
| `sessionwise context` | Sessions ranked by context efficiency, worst first |
| `sessionwise health` | Sessions ranked by health score, worst first |

```bash
sessionwise why --model claude-sonnet-5
sessionwise model-fit
sessionwise inspect debug-checkout --json
```

### Explain

| Command | Purpose |
| --- | --- |
| `sessionwise recommend` | Evidence-backed recommendations |
| `sessionwise waste` | Just the opportunities, grouped by category, safest first |
| `sessionwise show <id>` | The individual calls behind one recommendation |
| `sessionwise relevance` | Judge context, skill, and tool relevance with Jev (opt-in) |
| `sessionwise analyze` | `scan` plus opt-in Jev relevance for the same sessions, writes a report |

```bash
sessionwise waste
sessionwise show cache-opportunity:debug-checkout
sessionwise analyze --recent 5 --limit 30
```

### Decide

| Command | Purpose |
| --- | --- |
| `sessionwise verify <id>` | Sanity-check a recommendation's evidence with Jev (opt-in) |
| `sessionwise apply <id>` | Record that a recommendation was acted on |

```bash
sessionwise verify model-fit:debug-checkout
sessionwise apply model-fit:debug-checkout
```

### Report

| Command | Purpose |
| --- | --- |
| `sessionwise live` | Watch the event ledger for new findings |
| `sessionwise dashboard` | Write a self-contained HTML dashboard |
| `sessionwise adapters` | List available data adapters |
| `sessionwise privacy` | What is read, sent, and stored, per command |
| `sessionwise guide` | Which model tier fits which kind of turn |
| `sessionwise jev` | Check the Jev connection used by verify/relevance/analyze |

```bash
sessionwise dashboard --out report.html
sessionwise privacy
sessionwise jev
```

Every command accepts `--json` for machine-readable output. `sessionwise --help` lists every flag, colored and grouped by category in a real terminal (plain text when piped, or with `NO_COLOR` set).

## Scope: time, sessions, and history

Every command that reads sessions accepts a time window or a session limit. These combine with each other but not with themselves (pick one of `--days`/`--hours`/`--since`).

| Flag | Effect | Example |
| --- | --- | --- |
| `--days <n>` | Only calls from the last n days | `--days 7` |
| `--hours <n>` | Only calls from the last n hours | `--hours 6` |
| `--since <date>` | Only calls at or after this date | `--since 2026-09-01` |
| `--until <date>` | Only calls at or before this date, combines with any of the above | `--until 2026-09-10` |
| `--session <id>` | Only this one session | `--session debug-checkout` |
| `--recent <n>` | Only the n most recently active sessions | `--recent 20` |
| `--all` | No cap at all, full history | `--all` |

```bash
sessionwise scan --hours 6
sessionwise why --days 7
sessionwise dashboard --since 2026-09-01 --until 2026-09-10
sessionwise metrics --session debug-checkout
```

Dates accept anything `Date.parse` understands (`2026-09-01`, `2026-09-01T00:00:00Z`). A window filters individual calls before sessions are summarized, so a session that started earlier and continued into the window shows only the calls inside it. A bad or contradictory window fails immediately with a clear message, before anything is read.

**`scan` defaults to your 5 most recently active sessions**, not your entire history. `--days`, `--hours`, `--since`, `--until`, `--session`, `--all`, or an explicit `--recent` all disable that default. Every other command is unrestricted by default.

`scan` and `analyze` also write `sessionwise-report.html` after printing their summary. Pass `--no-report` to skip it, or `--out <path>` to change where it goes.

## Analyze and relevance

`analyze` runs the same local analysis as `scan`, then scopes opt-in Jev relevance judging to exactly the sessions that analysis covered, writes the relevance report, and folds it into the dashboard:

```bash
sessionwise analyze --recent 5 --limit 30
```

If Jev isn't connected, the adapter isn't `claude-code`, or the Jev call itself fails (bad key, network, rate limit), `analyze` says so and still produces the local analysis and report. It never loses the local analysis over the opt-in part.

To run relevance on its own, without the local analysis:

```bash
sessionwise relevance --session <session-id> --limit 30
sessionwise dashboard
```

The report shows each category independently:

| Category | Relevant | Irrelevant | Uncertain |
| --- | --- | --- | --- |
| Context | Tool results that helped answer the request | Unrelated or redundant results | Evidence was insufficient |
| Skills | Skills appropriate for the request | Skills unrelated to the request | Purpose could not be established |
| Tools | Tool calls that advanced the request | Unnecessary or redundant calls | Usefulness depended on hidden context |

## Verify, then apply

`verify` and `apply` are deliberately small. Neither replays real traffic, and neither changes a provider config, model setting, or running session. SessionWise only reasons about evidence it already computed, and records the decision.

```bash
sessionwise verify model-fit:debug-checkout    # sanity-checks the evidence with Jev
sessionwise apply model-fit:debug-checkout     # requires a passing verify first
```

`apply` on a `safe`-risk recommendation records immediately. `review` and `verify`-risk recommendations refuse until you verify first, or pass `--force` to record the decision on your own judgment. Every decision is appended to `~/.sessionwise/decisions.json` (override with `--decisions-file`).

## Connecting to Jev

Three commands ever call Jev: `verify`, `relevance`, and `analyze` (for its relevance step only). Every other command runs entirely offline.

SessionWise depends on **`jevctl`** (the same package that ships the `jev` CLI) as a normal npm dependency, and calls it as a library, not as a subprocess. That means it reuses `jev`'s own credential resolution: an environment variable, or whatever key you already stored with `jev auth login`. There is nothing separate to configure.

```bash
sessionwise jev
```

```text
Not connected

Not connected to Jev.

Quickest: set one of these environment variables.
  TYPESAFE_API_KEY     https://console.typesafe.ai/settings/keys
  OPENROUTER_API_KEY    sk-or-...
  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

Recommended: install the jevctl CLI once and log in.
  npm install -g jevctl
  jev auth login
  jev auth status
```

If a credential is already stored via `jev auth login`, or set as an environment variable, `verify`/`relevance`/`analyze` pick it up automatically. Nothing to configure in SessionWise itself. If nothing is found, those commands fail immediately with this same message, before reading anything, instead of surfacing a raw HTTP error.

## Metrics

| Metric | Evidence |
| --- | --- |
| Model identity | Measured from Claude Code response metadata |
| Model picking | Inferred from observed reasoning, tools, context, and output shape |
| Cache hit and creation | Measured from Claude usage metadata |
| Context growth | Measured across calls in one session |
| Context efficiency | Inferred metadata proxy using growth, repeated tools, and failures |
| Context relevance | Unavailable until `relevance`/`analyze` runs |
| Session health | Measured errors and repeated tool behavior |

SessionWise never presents an inferred metric as measured. Every recommendation carries its own evidence, and `sessionwise guide` prints the exact thresholds behind model-fit scoring.

## Privacy

| Commands | What happens |
| --- | --- |
| `scan`, `analyze` (local part), `sessions`, `inspect`, `why`, `metrics`, `model-fit`, `cache`, `context`, `health`, `waste`, `recommend`, `show`, `dashboard`, `live` | Metadata only. Nothing leaves the machine. |
| `relevance`, `analyze` (relevance step) | Sends the sampled current request plus one candidate's context, skill, or tool detail to Jev. |
| `verify` | Sends only one recommendation's evidence numbers (never raw prompts or tool output) to Jev. |
| `apply` | Local only. Appends one line to `~/.sessionwise/decisions.json`. |

`--limit` defaults to 50. Use `--session`, `--recent`, `--days`, or `--hours` to keep relevance sampling small and cheap. Run `sessionwise privacy` at any time for the full boundary, resolved to your actual file paths.

## Updates

```bash
sessionwise --version
```

Once every 24 hours, any command except `--json` mode checks npm for a newer release and prints a one-line note if one exists, using a local cache so it never adds a network call more than once a day. Disable with `--no-update-check` or `SESSIONWISE_NO_UPDATE_CHECK=1`.

## Adapters

Every source implements one provider-independent contract:

```ts
interface SessionAdapter {
  id: string;
  label: string;
  description: string;
  read(): Promise<SessionEvent[]>;
}
```

Built in:

- `claude-code`: reads project and subagent transcripts, aggregating duplicate content-block rows by `message.id`.
- `file`: reads normalized SessionWise JSON or JSONL events.

Custom adapters feed the same analysis engine:

```ts
import { analyzeSessions, readFromAdapters, type SessionAdapter } from "sessionwise";

const events = await readFromAdapters([myOpenAIAdapter, myCodexAdapter]);
const analysis = analyzeSessions(events);
```

## Event format

Adapters emit one `SessionEvent` per model response or tool event. Provider-specific data stops at this boundary.

```json
{"id":"evt-1","sessionId":"checkout-debug","timestamp":"2026-09-19T12:00:00Z","provider":"anthropic","model":"claude-sonnet","inputTokens":12500,"outputTokens":420,"cachedInputTokens":0,"costUsd":0.041,"toolName":"read_file"}
```

Use `--adapter file --file <events.jsonl>` to point at your own file, or `~/.sessionwise/events.jsonl` by default.

## Library

```ts
import { analyzeSessions, appendEvent, describeJevConnection, generateDashboard } from "sessionwise";

const analysis = analyzeSessions(events);
const html = generateDashboard(analysis);
await appendEvent("./events.jsonl", event);

const connection = describeJevConnection(process.env);
if (!connection.connected) console.log(connection.detail);
```

### Controlled optimizer

SessionWise separates detection from control. The optimizer never applies a change unless your own callback approves it:

| Mode | Behavior |
| --- | --- |
| `observe` | Records proposals, never changes requests |
| `recommend` | Surfaces proposals, never changes requests |
| `controlled` | Applies a patch only when your `approve` callback returns `true` |

```ts
import { createControlledOptimizer } from "sessionwise";

const optimizer = createControlledOptimizer({
  mode: "controlled",
  propose: async (request, recommendations) =>
    recommendations
      .filter((item) => item.kind === "reasoning-overhead")
      .map((recommendation) => ({
        request,
        recommendation,
        patch: { model: "a-cheaper-verified-model" },
      })),
  approve: async (proposal) => proposal.recommendation.risk === "safe",
  onProposal: async (proposal, applied) => {
    console.log(applied ? "applied" : "suggested", proposal.recommendation.id);
  },
});

const nextRequest = await optimizer.beforeCall(request, analysis.recommendations);
```

Keep `approve` under your own application's control. Model switches and reasoning changes should stay `verify`-risk recommendations until a replay proves they meet your quality bar.

## Detectors

- Cache opportunity
- Context growth
- Cost concentration across sessions
- Repeated failure loops
- Repeated tool calls
- Reasoning overhead
- Model fit

The analysis is deterministic and local. Prompt or response content is never required.
