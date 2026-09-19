# CLAUDE.md

TypeScript CLI + library (`sessionwise`, npm package `sessionwise`) that analyzes AI agent sessions. Claude Code is the default `SessionAdapter`, not the only source; normalized JSON/JSONL events are supported via the `file` adapter.

## Commands

```bash
npm run check   # typecheck, test, build. Run before every commit.
npm test        # vitest
npm run build   # tsup -> dist/index.js, dist/cli.js
npm run dev -- <args>   # run from source, e.g. npm run dev -- scan --adapter file --file examples/events.jsonl
```

## Architecture in one breath

`src/cli.ts` (flag parsing, printing) → `src/analyze.ts` (pure findings from `SessionEvent[]`) → `src/metrics.ts` (model-fit, cache, context, health) → `src/dashboard.ts` (self-contained HTML). `src/adapters.ts` defines the one contract every source implements (`claude-code`, `file`). `src/relevance.ts` and `src/verify.ts` are the only two paths that call Jev (via `jevctl`), and only when `relevance`/`verify` are run explicitly.

## Rules

- `analyze.ts`, `metrics.ts`, `breakdown.ts`, `categorize.ts`, `time.ts` are pure: no `process.env`, no filesystem, no network. Adapters and the CLI own I/O.
- A recommendation's `risk` (`safe`/`review`/`verify`) gates `apply`; `apply` never edits provider config or a running session, only `~/.sessionwise/decisions.json`.
- `relevance` and `verify` send only what their command docs say they send (sampled request/candidate text, or evidence numbers) — never raw tool output beyond that, and nothing is sent by any other command.
- Public contract: CLI flag names, JSON field names, and exit codes are part of the contract. Changing any of these needs a `CHANGELOG.md` entry under `Unreleased`.
- Tests live in `test/`, one file per module, using fixtures over network calls (fake `AskFn` for anything that would otherwise call Jev).

## Releasing

Bump `package.json` version, move `Unreleased` notes under the new version in `CHANGELOG.md`, commit, then `git tag vX.Y.Z && git push origin main --tags`. CI publishes to npm via Trusted Publishing and creates the GitHub release.

The very first release of a new package name can't use Trusted Publishing — npm requires the package to already exist before a trusted publisher can be attached. Run `npm publish --access public` by hand once, then configure Trusted Publishing on npmjs.com (package Settings → Trusted Publisher → GitHub Actions → owner `Nasrallah-AL`, repo `sessionwise`, workflow `release.yml`) for every release after that.
