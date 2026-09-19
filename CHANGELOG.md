# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Pre-1.0 minor versions may include
breaking changes to flags or JSON output; they are called out below.

## [Unreleased]

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
