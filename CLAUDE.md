# Legible Cities (desktop app)

An Electron + React + TypeScript shell around the `schematic` Python engine
from `legible-cities`, which will run as a JSON-RPC sidecar over stdio. The
engine is the source of truth; its generated animation page is the viewer;
this app never draws a map of its own.

## Where things stand

Pre-alpha. The repository holds its charter (licence, contribution guide,
security policy, templates, decision-record convention), its hygiene tooling
(`bin/preflight`, gitleaks, the git hooks, the CI checks), and its specs
(Spec Kit, the constitution) - and **no application code yet**. There is
nothing to build, run or test.

Work proceeds phase by phase; `CONTRIBUTING.md` explains the flow, the
labels, the milestones and the `A0-05`-style issue codes. Phase 0 is
scaffolding and four spikes (native LOOM binaries, sidecar packaging,
offscreen capture, encoding), each ending in a decision record, then the
Electron skeleton. Until the build-and-test workflow lands with that
skeleton, the maintainer commits to `main` directly; after it, one issue,
one branch, one pull request.

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

Nothing else yet. Do not invent `npm` scripts; add them when the skeleton
lands, list them here, and add their permission rules to
`.claude/settings.json` at the same time.

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
- **Capture is deterministic.** `setCapture(true)` and `settle()` before the
  first captured frame; step the clock by `1/fps`; compare renders in RGB
  with a channel tolerance of 8, never RGBA and never exact equality.
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
