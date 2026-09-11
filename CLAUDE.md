# Legible Cities (desktop app)

An Electron + React + TypeScript shell around the `schematic` Python engine
from `legible-cities`, which runs as a JSON-RPC sidecar over stdio. The
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
deleted from the Library through a five-method preload bridge), the engine's
supervisor (A1-01: the pinned engine started as a child process and spoken
to over JSON-RPC on its stdio, with a handshake, restart and a clean
shutdown; `docs/ARCHITECTURE.md`, "The engine process"), the dev loop
against the sibling engine, and CI on three platforms - and the design
system's foundations (A2-00: the tokens of `docs/DESIGN.md` in four
stylesheets, FigUI3's MIT core behind wrappers and a build guard that
refuses its PolyForm half, Phosphor icons, the Beck progress line, every
screen restyled), the typed client generated from the engine's own schema
(A1-02), the layout run (A3-01: one button runs the engine's stages behind
a progress line and records the layout the project was drawn from; A3-05:
the id is the engine's own and "Re-layout" runs every stage again behind a
warning, ADR-033; A3-04: the service day is the engine's choice from a
stored anchor, `feeds.service` at every layout run, a date control bounded
by the stored window, and a chosen day a rebuild from the stored layout,
never a re-layout) and the viewer (A3-02: the engine's page in a frame sandboxed to
an opaque origin and driven from the main process, ADR-028), and the
capture (A5-02a: an offscreen window in its own session takes a page's
frames through the DevTools protocol, byte-identical run to run,
`src/main/capture.ts`) and the export (A5-02b: one preset, `instagram-reel`,
from a button on the project screen, over the engine's `export.plan` and
`export.encode` with the capture in the middle, into a folder on the
desktop or `LEGIBLE_EXPORT_FOLDER`, the sidecar beside the file;
`src/main/export.ts`). That is the first reel.

Work proceeds phase by phase; `CONTRIBUTING.md` explains the flow, the
labels, the milestones and the `A0-05`-style issue codes. The four Phase 0
spikes have run: LOOM ships without its optional solvers (ADR-019), the
sidecar is a pinned python-build-standalone runtime (ADR-020), Windows
stays in the first release (ADR-021), and a project's layout is stored
rather than recomputed because `topo` is not reproducible on macOS
(ADR-023), with the service day resolved once at the first layout
(ADR-031). One spike (A0-06) still waits on the Intel and Windows runners
for its last two targets; the offscreen-capture spike is finished, and
ADR-024 puts capture in the app's own process, in an offscreen window
driven through the Chrome DevTools Protocol. The "First reel" milestone -
one preset feed through layout, viewer and export before the phases
broaden - is complete: the engine's export halves (E10, E09b) landed at
v0.3.0 and the app exports the reel (A5-02b). Since 2026-09-07 `main`
changes only through pull requests with the `ci` check green: one issue,
one branch, one pull request, the maintainer included.

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
npm test                              # vitest; the supervisor runs against a stand-in engine (needs a python3 on PATH)
npm run build                         # electron-vite build into out/
npm run test:e2e                      # Playwright launches the built app, with and without the stand-in engine
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

All of it is committed here (ADR-029, which supersedes ADR-025). It is
technical: permission rules, hooks that run the same scanners CI runs,
per-process rules, and skills. A checkout is reproducible, the hooks are
exercised by `bin/test-hooks`, and a contributor can see what the assistant
is told rather than guessing. Personal permissions go in
`settings.local.json`, which is gitignored and stays on the machine, as do
private notes in `CLAUDE.local.md`.

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
  hook in `.claude/settings.json`. **Never put a closing keyword
  (`Closes #N`) in a commit message either**; it belongs in the pull-request
  body. `bin/preflight --message-file` refuses one from the `commit-msg`
  hook, and the pull request check refuses one in any commit the branch
  adds. To name an issue in a message without closing it, drop the `#`.
  This rule was paid for: while `main` reached a second board whose numbers
  differed, one keyword closed an issue on each and three were closed by
  changes that had nothing to do with them. There is one board now
  (ADR-030), so the check is precautionary rather than load-bearing - but a
  commit message is for why a change was made, and a second remote would
  bring the hazard back silently.
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
  A dependency that is only a build input belongs in `devDependencies`:
  electron-builder copies every production dependency into the app whole,
  so a split-licensed package in `dependencies` ships the half we refuse.
- **Interface changes are drawn in the design system.** `docs/DESIGN.md` is
  the source; the tokens are the four stylesheets under
  `src/renderer/src/styles/` and the controls are the wrappers in
  `src/renderer/src/kit/`. No colour, size or duration literal in a
  component file (a unit test refuses them); a new text or control pair
  goes into the contrast test; a component the document does not cover yet
  adds its rule to section 8.2 in the same change.
- **Public repository.** No machine paths, e-mail addresses, private
  hostnames or addresses, keys, or planning notes in any committed file,
  commit message, issue or screenshot.

## Rules that matter now there is code

Stated before the first implementation, and kept since.

- **One renderer.** The engine emits a self-contained animation page; the
  app embeds it in an iframe and drives it only through `window.__present`.
- **The page the app embeds is contained, not trusted.** The viewer's frame
  carries `sandbox="allow-scripts"` and nothing else; **never add
  `allow-same-origin`**, which hands the page the interface's realm and with
  it the bridge. The app drives the page from the main process, not through
  `contentWindow`. `app://local` is still one scheme and one host, but that
  is no longer what makes the viewer work: ADR-013 said it was and was
  wrong, and ADR-028 records why.
- **Never write inside the app bundle.** The engine's home is
  `SCHEMATIC_HOME` under the user-data folder; exports go where the user
  chooses (`LEGIBLE_EXPORT_FOLDER`, or a `Legible Cities` folder on the
  desktop until Settings exist), and an export's frames sit under the
  engine home only while it runs.
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
  equality.
- **Frames come from an offscreen window through the debugger** (ADR-024):
  navigate first and emulate second, because emulating a web contents that
  has never navigated crashes the process; take the frame with
  `Page.captureScreenshot` at a CSS-pixel clip, never `capturePage()`,
  whose rect is in device-independent pixels and which ignores the
  emulated scale factor; give the export a session of its own (an
  in-memory partition, never the interface's default session), because a
  persisted per-host zoom level scales every capture silently.
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
