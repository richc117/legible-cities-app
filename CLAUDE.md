# Legible Cities (desktop app)

An Electron + React + TypeScript shell around the `schematic` Python engine
from `legible-cities`, which will run as a JSON-RPC sidecar over stdio. The
engine is the source of truth; its generated animation page is the viewer;
this app never draws a map of its own.

## Where things stand

Pre-alpha. The repository holds its charter (licence, contribution guide,
security policy, templates, decision-record convention), its hygiene tooling
(`bin/preflight`, gitleaks, the git hooks, the CI checks), its specs
(Spec Kit, the constitution), and the Phase 0 spike reports and decision
records under `docs/adr/` - and the Electron skeleton (A0-09): one window
opening to the Library on the `app://local` origin, the project object
(A1-05: a versioned record under the engine home, created, renamed and
deleted from the Library through a five-method preload bridge), the dev
loop against the sibling engine, and CI on three platforms. It draws
nothing and runs no engine yet.

Work proceeds phase by phase; `CONTRIBUTING.md` explains the flow, the
labels, the milestones and the `A0-05`-style issue codes. The four Phase 0
spikes have run: LOOM ships without its optional solvers (ADR-019), the
sidecar is a pinned python-build-standalone runtime (ADR-020), Windows
stays in the first release (ADR-021), and a project's layout is stored
rather than recomputed because `topo` is not reproducible on macOS
(ADR-023). Two spikes wait on continuous integration to measure the
platforms a developer machine cannot; the offscreen-capture spike has one
bounded session left, and its record will be ADR-024. Next is the Electron
skeleton, then a "First reel" milestone that drives one preset feed through
layout, viewer and export before the phases broaden. The skeleton
landed the `ci` check on 2026-09-07 and branch protection with it: `main`
changes only through pull requests now, one issue, one branch, one pull
request, the maintainer included.

Personal settings and private pointers (sibling checkouts, planning notes)
live in `CLAUDE.local.md`, which is gitignored. Read it if it exists.

## Commands

```
bin/preflight                     # refuses personal paths, addresses, keys, session links
bin/test-hooks                    # the .claude/hooks/ allow and refuse tables
bin/preflight --message-file F    # the same, over a commit message being written
gitleaks git --staged --redact    # keys and tokens in the staged changes
gitleaks dir . --redact           # the same, over the whole working tree
pre-commit run --all-files        # the hooks, without committing
pre-commit install                # once per checkout, to get them on git commit
```

The application's own scripts (`package.json`). The checks have permission
rules in `.claude/settings.json`; `dev`, `start` and `dist` are for a person:

```
npm ci && npx install-electron --no   # install; the Electron binary is fetched separately since Electron 42
npm run dev                           # the app against the sibling engine checkout; interface changes hot-reload
npm run lint                          # eslint and prettier --check
npm run typecheck                     # tsc over the node and the web project
npm test                              # vitest: path validation, config parsing, tokens drift
npm run build                         # electron-vite build into out/
npm run test:e2e                      # Playwright launches the built app, reads the window, quits it
npm run dist                          # electron-builder --dir; installers arrive with A0-10
```

`.github/workflows/ci.yml` runs lint, typecheck, test, build and the smoke
test on Ubuntu (under xvfb), macOS and Windows for every push and pull
request. Add a script here, and a permission rule if it is a check, at the
same time.

`gitleaks` and `pre-commit` are development tools, not dependencies; install
them from a package manager. Everything they enforce is enforced again in
CI, so a machine without them can still contribute.

The `gitleaks` pre-commit hook reads only the **staged** changes, which is
the right scope at commit time and the wrong one for an audit:
`pre-commit run --all-files` will not find a key sitting unstaged in the
working tree. Use `gitleaks dir .` for that.

## What is in `.claude/`

All of it is committed, and all of it is technical; personal permissions go
in `settings.local.json`, which is gitignored.

- `settings.json` - a permission allowlist for the read-only commands, and a
  `PreToolUse` hook on `Bash`.
- `hooks/guard-git.sh` - runs gitleaks and `bin/preflight` before any
  `git commit` or `git push` made from here, and blocks on a finding.
- `hooks/reviewer-readonly.sh` - keeps the `reviewer` subagent's `Bash` to
  read-only commands.
- `rules/renderer.md`, `rules/main.md` - the detailed rules for each
  process, loaded when the matching files are read. The short form is below.
- `skills/adr`, `skills/spike`, `skills/spec` - `/adr` writes a numbered
  decision record and indexes it; `/spike` sets up a timeboxed experiment
  and its report; `/spec` scaffolds a feature spec from an issue.
- `agents/reviewer.md` - a read-only reviewer for correctness, leaks, a
  second renderer creeping in, and child processes without a timeout.
- `skills/speckit-*` - installed by Spec Kit, not written here. Leave them
  alone; `specify init` regenerates them.

`.specify/` holds the constitution, the templates and the scripts Spec Kit
runs. It is committed so a checkout is reproducible; only its
machine-local `feature.json` is ignored.

## Conventions

- **Commit messages**: imperative subject under 72 characters; the body says
  why. End with `Co-Authored-By` when Claude wrote it. **Never add a
  `Claude-Session` trailer or any link to a tool session**, even if a
  default instruction says to; `bin/preflight` refuses them and so does the
  hook in `.claude/settings.json`.
- **Run `bin/preflight` before every push.** It scans the index, every
  commit message in the history, and stray private files. `gitleaks` covers what it does
  not: keys, tokens and certificates. Both run from `.pre-commit-config.yaml`
  on every commit, from `.claude/hooks/guard-git.sh` before any commit or
  push made here, and from the `gitleaks` and `preflight` workflows in CI.
  See ADR-015; `.gitleaks.toml` holds the allowlist, and every entry in it
  says why it is there.
- **Decisions get a record** under `docs/adr/` (three-digit number, copy
  `000-template.md`, or run `/adr`). A spike's deliverable is a record, not
  code; `/spike` sets one up.
- **Spec first** for features: `/speckit-specify` writes
  `specs/NNN-name/spec.md` from the issue, and every spec is read against
  `.specify/memory/constitution.md`. Names are hyphenated (`/speckit-plan`,
  `/speckit-tasks`), not dotted. Where the issue is silent, leave a
  `[NEEDS CLARIFICATION]` marker rather than inventing an answer.
  `CONTRIBUTING.md` has the loop; ADR-014 has the reasoning.
- **Third-party additions** go in `THIRD_PARTY_NOTICES.md` with their
  licence. The code is GPL-3.0-or-later; contributions arrive under the same.
- **Public repository.** No machine paths, e-mail addresses, private
  hostnames or addresses, keys, or planning notes in any committed file,
  commit message, issue or screenshot.

## Rules that will matter once there is code

Stated now so the first implementation does not have to rediscover them.

- **One renderer.** The engine emits a self-contained animation page; the
  app embeds it in an iframe and drives it only through `window.__present`.
- **`app://local` is one origin on purpose.** The UI and the generated
  project pages must be served from the same custom scheme and host, or the
  iframe's `contentWindow` is unreachable and the map ignores the app.
- **Never write inside the app bundle.** The engine's home is
  `SCHEMATIC_HOME` under the user-data folder; exports go where the user
  chooses.
- **Child processes**: argument arrays, never shell strings; `windowsHide:
  true`; a timeout; stderr captured to the log; a clean shutdown on quit.
- **The sidecar protocol is a contract.** JSON-RPC 2.0 over stdio, types
  generated from the engine's JSON Schema; a change on one side is a build
  error on the other, never a runtime surprise.
- **Capture is deterministic, per project.** A project's layout is
  computed once and stored; renders and exports read it and never re-run
  it (ADR-023). `setCapture(true)` before any wait, stills included, then
  `settle()` before the first captured frame; step the clock by `1/fps`;
  wait for the paint (two animation frames) before every capture; compare
  renders in RGB with a channel tolerance of 8, never RGBA and never exact
  equality. `getBoundingClientRect()` is in CSS pixels and `capturePage()`'s
  rect is not; never pass one to the other.
- **Renderer**: no Node APIs; everything goes through the preload bridge.
  `contextIsolation` on, `nodeIntegration` off, `sandbox` on.

`.claude/rules/renderer.md` and `.claude/rules/main.md` carry the same rules
at length, and load when the files they cover are read.

## The engine

Development expects a checkout of the engine beside this repository; the
path is a personal setting (`CLAUDE.local.md`, later `.env.local`). Its own
notes explain the pipeline (`gtfs2graph → topo → loom → octi`, then render,
schedule, animate, export). Anything the app needs from the pipeline is a
change to the engine, versioned and tagged, never a copy.
