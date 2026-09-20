# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Pre-1.0 minor versions may include
breaking changes to flags or JSON output; they are called out below.

## [Unreleased]

### Added

- `Recommendation.estimatedSavingsUsd`: every recommendation now carries a dollar estimate (cache waste, wasted retries, repeated tool calls, reasoning overhead, or a model downgrade), computed from each event's cost.
- `Analysis.aggregatedRecommendations`: recommendations rolled up one entry per rule kind across the whole analyzed window, with total estimated savings, how many sessions are affected, and the top 5 sessions to fix first.
- `sessionwise overview`: the aggregated view above as a command — total recoverable spend, ranked by dollar impact, instead of one line per session.
- The Claude Code adapter now estimates `costUsd` per event from a coarse per-tier rate card (`src/pricing.ts`), since Claude Code transcripts don't report billed cost. Marked `metadata.costBasis: "estimated"`.

### Changed

- `sessionwise inspect <id>` is now a full session detail view by default: model-fit, cache, context, health, relevance judgments (if sampled for that session), and that session's recommendations with their dollar estimates. `--json` still returns the raw session, events, recommendations, and session-scoped relevance.
- Lowered several recommendation thresholds so they fire on real, moderately-inefficient sessions instead of only pathological ones: `error-loop`/`repeated-tool-call` now need 2 repeats (was 3), `cache-opportunity` fires under 30% cache ratio (was 20%), `context-growth` at 2x growth (was 3x), `reasoning-overhead` at 3k reasoning tokens and 1.5x output (was 5k/2x), `model-fit` at a 20% oversized-call share (was 30%), `cost-concentration` at a 40% spend share (was 50%).
- Added a percentile-relative gate alongside the absolute thresholds above: `cache-opportunity`, `context-growth`, `reasoning-overhead`, and `model-fit` can now also fire when a session is in the worst quartile of its own analyzed window (needs 5+ sessions), even if it doesn't cross the absolute threshold.

## [0.1.4] - 2026-09-19

### Added

- New recommendation kinds `irrelevant-context`, `irrelevant-skill`, `irrelevant-tool`: `analyze` now turns relevance judgments into recommendations. Any session and category with 3+ sampled items and a 30%+ irrelevant rate gets a `review`-risk recommendation, citing the repeated names and counts.

### Changed

- Dashboard relevance table is now grouped by session and category instead of one flat row per judgment, with identical repeated calls deduplicated into a count (`Read x3`, not three rows). Each session links to its row in the Sessions table.
- The top relevance cards' "Flagged" examples are deduplicated the same way, instead of listing the same name up to 3 times.
- `scan`/`analyze` no longer print `$0.0000 recorded` for adapters that don't track cost (Claude Code never does). They print "cost not tracked for this adapter" instead, so a genuine $0 and "not measured" are never confused.
- The empty-recommendations message is now "No recommendations. Nothing in this window crossed a detector's threshold." instead of the ambiguous "No recommendations yet."

## [0.1.3] - 2026-09-19

### Added

- `--help` is now colored and categorized: each command group (Observe, Explain, Decide, Report) gets its own color, command names are bold, descriptions are dim. Honors `NO_COLOR`/`FORCE_COLOR` and falls back to plain text when not a TTY, same convention as jevctl.

### Fixed

- `analyze`: a Jev call failing (invalid or expired API key, network error, rate limit) no longer discards the local analysis that already succeeded. It now reports "Relevance skipped: Jev call failed: ..." and still prints the summary and writes the report, instead of aborting the whole command with a bare error.

## [0.1.2] - 2026-09-19

### Added

- `--hours <n>`: a time window flag alongside `--days`, `--since`, and `--until`.
- `analyze`: runs the same local analysis as `scan`, then scopes opt-in Jev relevance judging to exactly the sessions that analysis covered, writes the relevance report, and includes it in the dashboard. Degrades gracefully (with a stated reason) when Jev isn't connected or the adapter isn't `claude-code`, rather than failing.
- `--session <id>` now scopes any command's local analysis, not just `relevance`'s candidate extraction.
- `--version` / `-v`: prints the installed version.
- Once-a-day check for a newer published version, cached locally, skipped in `--json` mode. Disable with `--no-update-check` or `SESSIONWISE_NO_UPDATE_CHECK=1`. Documented in `sessionwise privacy`.

### Changed

- README rewritten: badges, a "First run" example with real output, one flag-reference table for time/session scope, and a privacy table instead of prose.

## [0.1.1] - 2026-09-19

### Changed

- `scan` now defaults to the 5 most recently active sessions instead of your entire Claude Code history, and always prints which sessions it's showing (`Showing the 5 most recently active sessions (of N total)`). Use `--all`, `--days`, `--since`, `--until`, `--session`, or an explicit `--recent` to see more; any of these disables the default cap.
- `scan` now also writes `sessionwise-report.html` by default after printing its summary, instead of requiring a separate `dashboard` call. Pass `--no-report` to skip it.

### Added

- `--recent <n>`: limit any command to the n most recently active sessions.
- `sw` and `wise`: additional CLI command names, same binary as `sessionwise`.

## [0.1.0] - 2026-09-19

### Added

- `scan`, `sessions`, `inspect`, `why`, `metrics`, `model-fit`, `cache`, `context`, `health`: read Claude Code transcripts (or normalized JSON/JSONL events) and summarize spend-free session evidence.
- Detectors: cache opportunity, context growth, cost concentration, error loops, model fit, reasoning overhead, repeated tool calls.
- `recommend`, `waste`, `show <id>`: evidence-backed recommendations, filterable and drillable to the calls behind them.
- `relevance`: opt-in semantic judging of context, skill, and tool relevance via Jev, sampled and stratified.
- `verify <id>`, `apply <id>`: sanity-check a recommendation's evidence with Jev, then record a local decision. Neither changes any provider config or running session.
- `jev`: instant, offline check of the Jev connection used by `verify`/`relevance`, with a pointer to `jevctl` when nothing is configured.
- `privacy`, `guide`: what each command reads/sends/stores, and the thresholds behind model-fit scoring.
- `--days`, `--since`, `--until`: scope any session-reading command to a time window.
- `dashboard`: a responsive, self-contained HTML report with search and category filters.
- `claude-code` and `file` adapters behind one `SessionAdapter` contract; `live` watches either for new findings.
