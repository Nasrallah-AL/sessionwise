# SessionLens

Analyze, understand, and optimize AI sessions. SessionLens turns agent transcripts and normalized LLM events into session-level evidence, recommendations, live signals, and a self-contained dashboard. Claude Code is the default adapter, not the only source.

## Why session-level analysis

Individual calls hide the patterns that waste time and money: context that grows across turns, unchanged failures, repeated tool reads, poor cache use, and reasoning effort that never reaches the output. SessionLens evaluates the complete run before suggesting a change.

## Install

```bash
npm install sessionlens
```

Node 20.12 or newer.

## Commands

**Observe**

| Command | Purpose |
| --- | --- |
| `sessionlens scan` | Summarize sessions, usage, and top findings |
| `sessionlens sessions` | List recorded sessions |
| `sessionlens inspect <id>` | Show one session with its evidence |
| `sessionlens why` | Where the tokens and calls actually go, grouped by model |
| `sessionlens metrics` | Compare model picking, cache, context efficiency, and health |
| `sessionlens model-fit` | Sessions ranked by model-fit score, worst first |
| `sessionlens cache` | Sessions ranked by cache hit rate, worst first |
| `sessionlens context` | Sessions ranked by context efficiency, worst first |
| `sessionlens health` | Sessions ranked by health score, worst first |

**Explain**

| Command | Purpose |
| --- | --- |
| `sessionlens recommend` | Evidence-backed recommendations |
| `sessionlens waste` | Just the opportunities, grouped by category, safest first |
| `sessionlens show <id>` | The individual calls behind one recommendation |
| `sessionlens relevance` | Judge context, skill, and tool relevance with Jev |

**Decide**

| Command | Purpose |
| --- | --- |
| `sessionlens verify <id>` | Sanity-check a recommendation's evidence with Jev |
| `sessionlens apply <id>` | Record that a recommendation was acted on |

**Report**

| Command | Purpose |
| --- | --- |
| `sessionlens live` | Watch the event ledger for new findings |
| `sessionlens dashboard` | Generate a responsive, self-contained HTML dashboard |
| `sessionlens adapters` | List available data adapters |
| `sessionlens privacy` | What is read, sent, and stored, per command |
| `sessionlens guide` | Which model tier fits which kind of turn |
| `sessionlens jev` | Check the Jev connection used by verify/relevance |

Commands read `~/.claude/projects` through the Claude Code adapter by default. Use `--claude-dir <path>` to override it, or `--adapter file --file <events.jsonl>` for normalized events. All commands accept `--json`. Dashboard generation also accepts `--out <report.html>`.

```bash
sessionlens scan
sessionlens why --model claude-sonnet-5
sessionlens waste
sessionlens metrics
sessionlens dashboard --out sessionlens-report.html
```

### Scanning by time

Every command that reads sessions (`scan`, `sessions`, `inspect`, `why`,
`metrics`, `model-fit`, `cache`, `context`, `health`, `recommend`, `waste`,
`show`, `dashboard`, `live`) accepts a time window:

```bash
sessionlens scan --days 7                              # last 7 days
sessionlens scan --since 2026-09-01                    # everything since a date
sessionlens scan --since 2026-09-01 --until 2026-09-10 # an explicit range
```

`--days` and `--since` are mutually exclusive; `--until` can combine with
either. Dates accept anything `Date.parse` understands (`2026-09-01`,
`2026-09-01T00:00:00Z`). The window filters individual calls before sessions
are summarized, so a session that started earlier and continued into the
window shows only the calls that happened in it. An invalid or contradictory
window (`--since` after `--until`, both `--days` and `--since`) fails
immediately with a clear message, before anything is read.

### Verify, then apply

`verify` and `apply` are deliberately separate and deliberately small. Neither
replays real traffic and neither changes a provider config, model setting, or
running session — SessionLens only reasons about, and records decisions
about, evidence it has already computed.

```bash
sessionlens verify model-fit:debug-checkout   # sanity-checks the evidence with Jev
sessionlens apply model-fit:debug-checkout     # requires a passing verify first
```

`apply` on a `safe`-risk recommendation records the decision immediately.
`review`-risk and `verify`-risk recommendations refuse until you verify first,
or pass `--force` to record the decision on your own judgment. Every decision
is appended to `~/.sessionlens/decisions.json` (override with
`--decisions-file`); nothing else on disk or in a provider account changes.

## Connecting to Jev

Only two commands ever call Jev: `verify` and `relevance`. Every other
command, including `scan`, `why`, `waste`, and `dashboard`, runs entirely
offline and needs no credential at all.

`sessionlens jev` checks the connection instantly, with no network call and
no session scan:

```bash
sessionlens jev
```

```
Not connected

Not connected to Jev.

SessionLens sends nothing to Jev on its own. Only `sessionlens verify` and
`sessionlens relevance` call it, and only when you run them.

Quickest: set one of these environment variables.
  TYPESAFE_API_KEY     https://console.typesafe.ai/settings/keys
  OPENROUTER_API_KEY    sk-or-...
  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

Recommended: install the jevctl CLI once and log in. It stores the key in
your OS keychain, and SessionLens reads that same stored key automatically
-- nothing to configure here.
  npm install -g jevctl
  jev auth login
  jev auth status   # confirms which provider is connected
```

If a credential is already stored via `jev auth login`, or set as an
environment variable, `verify` and `relevance` pick it up automatically —
there is nothing to configure in SessionLens itself. If nothing is found,
`verify` and `relevance` fail immediately with this same message, before
scanning any transcripts, instead of surfacing a raw HTTP error.

## Metrics

| Metric | Evidence |
| --- | --- |
| Model identity | Measured from Claude Code response metadata |
| Model picking | Inferred from observed reasoning, tools, context, and output shape |
| Cache hit and creation | Measured from Claude usage metadata |
| Context growth | Measured across calls in one session |
| Context efficiency | Inferred metadata proxy using growth, repeated tools, and failures |
| Context relevance | Unavailable until content-aware analysis is enabled |
| Session health | Measured errors and repeated tool behavior |

SessionLens does not present context efficiency as semantic relevance. True relevance requires opt-in content analysis.

Use `sessionlens why`, `sessionlens model-fit`, `sessionlens cache`, `sessionlens context`, or `sessionlens health` to see any one of these ranked across every session, worst first. `sessionlens privacy` prints the exact boundary below for every command, and `sessionlens guide` prints the thresholds behind model-fit scoring.

## Semantic relevance

Semantic analysis is separate and opt-in because it sends sampled content to your configured Jev provider.

```bash
# Recommended: start with one session and a small sample.
sessionlens relevance --session <session-id> --limit 30
sessionlens dashboard
```

The generated report shows each category independently:

| Category | Relevant | Irrelevant | Uncertain |
| --- | --- | --- | --- |
| Context | Tool results that helped answer the request | Unrelated or redundant results | Evidence was insufficient |
| Skills | Skills appropriate for the request | Skills unrelated to the request | Purpose could not be established |
| Tools | Tool calls that advanced the request | Unnecessary or redundant calls | Usefulness depended on hidden context |

Privacy boundary:

- Normal `scan`, `why`, `metrics`, `model-fit`, `cache`, `context`, `health`, `waste`, `recommend`, `show`, and `dashboard` commands remain metadata-only.
- `relevance` sends only the sampled current request and candidate context, skill, or tool details to Jev.
- `verify` sends only one recommendation's evidence numbers (never raw prompts or tool output) to Jev, to sanity-check the finding.
- `apply` never sends anything anywhere. It only appends a line to your local decisions ledger.
- Requests, tool arguments, and tool results exist only in memory during judging.
- `~/.sessionlens/relevance.json` stores labels, probabilities, names, and IDs only. It never stores raw prompts, arguments, or results.
- `--limit` defaults to 50. Use `--session` to keep analysis focused and inexpensive.

Run `sessionlens privacy` at any time for this same boundary, resolved to your actual paths.

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
- `file`: reads normalized SessionLens JSON or JSONL events.

Custom adapters can feed the same analysis engine:

```ts
import { analyzeSessions, readFromAdapters, type SessionAdapter } from "sessionlens";

const events = await readFromAdapters([myOpenAIAdapter, myCodexAdapter]);
const analysis = analyzeSessions(events);
```

## Event format

Adapters should emit one `SessionEvent` per model response or tool event. Provider-specific data stops at this boundary.

```json
{"id":"evt-1","sessionId":"checkout-debug","timestamp":"2026-09-19T12:00:00Z","provider":"anthropic","model":"claude-sonnet","inputTokens":12500,"outputTokens":420,"cachedInputTokens":0,"costUsd":0.041,"toolName":"read_file"}
```

The normalized file adapter can use `~/.sessionlens/events.jsonl` or any path passed with `--file`.

## Library

```ts
import { analyzeSessions, appendEvent, describeJevConnection, generateDashboard } from "sessionlens";

const analysis = analyzeSessions(events);
const html = generateDashboard(analysis);
await appendEvent("./events.jsonl", event);

const connection = describeJevConnection(process.env);
if (!connection.connected) console.log(connection.detail);
```

## Live optimization

SessionLens separates detection from control. The optimizer has three modes:

| Mode | Behavior |
| --- | --- |
| `observe` | Records proposals; never changes requests |
| `recommend` | Surfaces proposals; never changes requests |
| `controlled` | Applies a patch only when your `approve` callback returns `true` |

```ts
import { createControlledOptimizer } from "sessionlens";

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

Keep `approve` under application ownership. Model switches and reasoning changes should normally remain `verify` recommendations until replay evaluation proves they meet your quality bar.

## Initial detectors

- Cache opportunity
- Context growth
- Cost concentration
- Repeated failure loops
- Repeated tool calls
- Reasoning overhead

The analysis is deterministic and local. Prompt or response content is not required.
