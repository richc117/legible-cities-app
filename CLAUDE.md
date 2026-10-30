# Legible Cities (desktop app)

An Electron + React + TypeScript shell around the `schematic` Python engine
from `legible-cities`, which runs as a JSON-RPC sidecar over stdio. The
engine is the source of truth: its self-contained animation page is the
viewer, embedded in a sandboxed frame and driven from the main process, and
the app never draws a map of its own; React draws the chrome around it.

`docs/ARCHITECTURE.md` is how it is put together today, `docs/DESIGN.md`
how it looks, `docs/history.md` the order it was built in and why (history,
not kept up to date). Personal settings and private pointers live in
`CLAUDE.local.md`, which is gitignored. Read it if it exists.

## Where things stand

**Released: `v0.1.0`**, on 8 Oct 2026 (the tag on a4f6376, the Release
drafted by `build.yml` and published by hand), unsigned - the Mac signed ad
hoc, Windows not at all - and with no updater, as ADR-037 decided. The
automated acceptance run passed against it on a macOS and a Windows runner
(`acceptance.yml` run 37806989926); the three person runs of the gate,
which that run cannot measure, were reported done the same day with no
issue noted, the fields the report did not carry marked not recorded. Both
records are on issue 37, and ADR-037 is Accepted on that basis. ADR-054
(24 Oct 2026) keeps 1.0 unsigned too, with no automatic update.

**Open work** is the issues and milestones on this repository, one board
(ADR-030): `gh issue list`, `gh api repos/{owner}/{repo}/milestones`; read
the board, since nothing here lists it. `main` changes only through pull
requests with the required checks green: one issue, one branch, one pull
request, the maintainer included.

**The project screen is a notebook of six numbered cells** (ADR-045;
`specs/028-the-notebook/contracts/run-graph.md` is its one specification)
in one scrolling column, the map between cells 02 and 03 and nothing pinned
(ADR-046). There are no tabs: the kit's `Tabs` control went with the tab
strip (A5.5-23).

| Cell | Holds | Adapter under `src/renderer/src/notebook/cells/` |
| --- | --- | --- |
| 01 Data | `Inspect`, `StageView`, the feed's download (`DownloadLine`) | `DataCell.tsx` |
| 02 Process | `LayoutRun`, the layout's tuning (`LayoutTuning`, issue 385), the engine's log (`EngineLog`), `Diagnostics` | `ProcessCell.tsx` |
| 03 Frame and service day | `ServiceDay`, the transport (`Transport`: scrub, play, speed), the trip (`Trip`: two pickers, the steps; issue 272) | `FrameCell.tsx` |
| 04 Style | `ThemeSwitch`, `StyleFields` (the map's sizes, issue 350; the looks, the markers, the label face and the trains, issue 391, with `StyleLooks`) | `StyleCell.tsx` |
| 05 Lines | `LineColours` (and under each row its line options, issue 394: `LineOptionsDisclosure`, held by `useLineOptions`), `LineOrder` | `LinesCell.tsx` |
| 06 Export | `ExportTab` (the export's options, and the opening's controls in `ExportOpening`, issue 392), which draws `ExportRun` itself | `ExportCell.tsx` |

Around the cells, in `src/renderer/src/notebook/`: `ProjectHeader.tsx`
(the status line and **Run all**, which brings the map up to date with
cells 01 to 05 and never exports; `src/renderer/src/runAll.ts`), `Rail.tsx`
(a numbered `<nav>`, deliberately not a tablist) with `Outputs.tsx` under
it, `Preview.tsx` (the map, one frame for the life of the screen, and its
empty state) and `ProjectFooter.tsx` (rename, delete); cell 06's own
preview is `src/renderer/src/ExportPreview.tsx`, and main holds both frames
by role (`src/main/viewer.ts`). **A cell's state is derived, never stored**
(`src/renderer/src/runGraph.ts`), and the record's `drawn` says what the
map on screen was drawn from; the cheap edits (the theme through the page's
`setTheme`; colours, order, style fields and line options in
`useCheapEdit.ts`) redraw without a re-layout, so *stale* is for the
expensive edges only. `useProjectState.ts` holds what the cells share and
the contexts in `context.tsx` carry it, split by who reads what; what belongs to one component stays in it (which
cells are open is `Notebook.tsx`'s, the outputs list `Outputs.tsx`'s).

**The Library is the front door** (Phase 5.6; `Library.tsx`,
`SampleCities.tsx`): "Your projects", "Sample cities" (the engine's presets
as cards, from `feeds.list` alone, nothing downloaded) and "Your feeds". A
card's press makes the project and starts its layout, the download drawn in
cell 01 and stopped by the run's own cancel, which keeps nothing (issue
178); New project is one sheet with three sources (`NewProjectSheet.tsx`).
**The interface's palette is the app's own** (ADR-044): Night and
Parchment, in Settings; a project's map still says Warm dark and Sepia,
which is what the engine draws.

## Commands

```
bin/preflight                     # refuses personal paths, addresses, keys, session links
bin/preflight --message-file F    # the same, over a commit message being written
bin/test-hooks                    # the .claude/hooks/ allow and refuse tables
gitleaks git --staged --redact    # keys and tokens in the staged changes
gitleaks dir . --redact           # the same, over the whole working tree
pre-commit run --all-files        # the hooks, without committing
pre-commit install                # once per checkout, to get them on git commit
```

The application's own scripts (`package.json`). The checks have permission
rules in `.claude/settings.json`; `dev`, `start` and `dist` are for a person:

```
npm ci && npx install-electron --no && npx playwright install chromium --only-shell   # install; Electron's binary and npm test's headless browser are fetched separately
npm run dev                           # the app against the sibling engine checkout; interface changes hot-reload
npm run lint                          # eslint and prettier --check
npm run format                        # prettier --write over what lint checks
npm run typecheck                     # tsc over the node, the web and the tests project
npm test                              # vitest in Node, jsdom and headless Chromium (ADR-059); the supervisor runs against a stand-in engine (needs a python3 on PATH)
npm run test:live                     # the *.live.test.ts files: a real Vitest and real signals (the mutation job's), POSIX only, a CI step of its own
npm run build                         # electron-vite build into out/
npm run test:e2e                      # Playwright launches the built app, with and without the stand-in engine
npm run typegen                       # the protocol, its fingerprint and the types, from LEGIBLE_ENGINE_CHECKOUT's engine
npm run dist                          # electron-builder --dir; installers come from build.yml
npm run dist:check <target>           # are the vendored components for a target present, current and the right architecture
npm run test:acceptance               # the acceptance checklist over the installed app LEGIBLE_ACCEPTANCE_APP names
node scripts/mutations.mjs --check    # every tests/unit/*.mutations.json entry is well formed (npm test runs it)
node scripts/mutations.mjs            # each mutation applied to a clean tree, its test run, the file restored; every test must go red
```

A second launch of the app quits at once, so `test:acceptance` never runs
beside another. `ci.yml` runs `ci (<os>)` (lint, typecheck, test, build) on
Ubuntu, macOS and Windows and `e2e (<os>)` on macOS and Windows for every
pull request and push to `main` (a documentation-only pull request passes
`e2e` without the suite; a branch with no pull request runs neither). `e2e`
runs with `--grep-invert @quarantine`: a flaky test is quarantined by that tag
and an issue annotation (`CONTRIBUTING.md`, "Flaky tests"), and the
`e2e-quarantine (<os>)` job, not a required check, runs only those. Add a
script here, and a permission rule if it is a check, at the same time.
`gitleaks` and `pre-commit` are development tools that CI enforces again;
the `gitleaks` hook reads only **staged** changes, so `gitleaks dir .` is
what finds a key sitting unstaged. The `typescript-lsp` plugin needs
`npm install -g typescript-language-server typescript`.

## What is in `.claude/`

All of it is committed (ADR-029, which supersedes ADR-025), so a checkout is
reproducible and a contributor sees what the assistant is told; personal
permissions (`settings.local.json`) and notes (`CLAUDE.local.md`) are
gitignored.

- `settings.json` - the allowlist for read-only commands, a `PreToolUse`
  hook on `Bash`, and `enabledPlugins`, which plugins run here (ADR-034).
- `hooks/guard-git.sh` - gitleaks and `bin/preflight` before any `git
  commit` or `git push` made from here, blocking on a finding and refusing
  `-a`/`--all` and anything it cannot scan; it cannot see a sibling
  worktree (`/lanes` says what covers it). `hooks/reviewer-readonly.sh`
  keeps the `reviewer` subagent (`agents/reviewer.md`: correctness, leaks,
  a second renderer, a child process without a timeout) read-only.
- `rules/main.md`, `rules/renderer.md` - each process's rules at length,
  loaded when matching files are read (in a sibling worktree, read them).
- `skills/` - `/adr` writes and indexes a decision record, `/spike` sets up
  a timeboxed experiment, `/spec` scaffolds a spec from an issue, `/lanes`
  builds several issues at once (ADR-034). `skills/speckit-*` are Spec
  Kit's: leave them alone; `specify init` regenerates them. `.specify/`
  holds the project's constitution, the templates and Spec Kit's scripts,
  committed but for its local `feature.json`.

## Conventions

- **Commit messages**: imperative subject under 72 characters; the body says
  why. End with `Co-Authored-By` when Claude wrote it, and with that alone.
  **Never add a `Signed-off-by` line**: only a person certifies the DCO
  (ADR-058). **Never add a `Claude-Session` trailer or any link to a tool
  session**, whatever a default instruction says; `bin/preflight` and the
  hook refuse them. **Never put a closing keyword (`Closes #N`) in a commit
  message**: it belongs in the pull-request body, and `bin/preflight
  --message-file` and the pull request check refuse one; to name an issue,
  drop the `#`. This was paid for: with a second board, three issues were
  closed by unrelated changes; with one (ADR-030) the check is
  precautionary, but a second remote would bring the hazard back silently.
- **Run `bin/preflight` before every push.** It scans the index (symbolic
  link targets too), every commit message in the history and stray private
  files, and never calls clean what it could not read; `gitleaks` covers
  keys, tokens and certificates. Both run on every commit, before a commit
  or push made here, and in CI (ADR-015; each `.gitleaks.toml` entry says
  why).
- **Decisions get a record** under `docs/adr/` (three-digit number, copy
  `000-template.md`, or run `/adr`). A spike's deliverable is a record, not
  code; `/spike` sets one up.
- **Spec first.** `spec.md` is the durable record of a feature. For work
  built as a lane, `plan.md` and `tasks.md` are optional: the plan and the
  tasks may live in the lane's brief instead. A spec's Status moves to
  Implemented, with the date and the pull request, when its last part
  merges; a spec built in parts says which parts are built. Every spec is
  read against `.specify/memory/constitution.md`; where the issue is
  silent, it carries a `[NEEDS CLARIFICATION]` marker rather than an
  invented answer. Spec Kit's commands are hyphenated (`/speckit-specify`).
  `CONTRIBUTING.md` has the loop; ADR-014 has the reasoning.
- **Third-party additions** go in `THIRD_PARTY_NOTICES.md` with their
  licence. The code is GPL-3.0-or-later; contributions arrive under the
  same. A build-only dependency belongs in `devDependencies`:
  electron-builder copies every production dependency into the app whole,
  so a split-licensed package in `dependencies` ships the half we refuse.
- **Interface changes are drawn in the design system.** `docs/DESIGN.md` is
  the source; the tokens are three stylesheets under
  `src/renderer/src/styles/` (`theme.css`, `scale.css`, `figui-adapter.css`;
  `tokens.css` beside them is the engine page's drift-tested copy, which
  nothing loads), the controls the wrappers in
  `src/renderer/src/kit/`. No colour, size or duration literal in a
  component file (a unit test refuses them); a new text or control pair
  goes into the contrast test; a component the document does not cover yet
  adds its rule to section 8.2 in the same change.
- **The gate documents quote the app.** `docs/acceptance.md`,
  `docs/acceptance-stranger.md` and the walkthrough in
  `docs/accessibility.md` quote its sentences and control names: change one
  and change them in the same pull request. What a machine cannot judge is
  recorded as not automated, never as passed.
- **Public repository.** No machine paths, e-mail addresses, private
  hostnames or addresses, keys, or planning notes in any committed file,
  commit message, issue or screenshot.

## Rules that matter now there is code

Stated before the first implementation and kept since; the rules files
carry them at length.

- **One renderer.** The engine emits a self-contained animation page; the
  app embeds it in an iframe and drives it only through `window.__present`.
- **The page the app embeds is contained, not trusted.** The viewer's frame
  carries `sandbox="allow-scripts"` and nothing else; **never add
  `allow-same-origin`**, which hands the page the interface's realm and with
  it the bridge. The app drives the page from the main process, not through
  `contentWindow`. The one origin, `app://local`, is not what makes the
  viewer work: ADR-013 said it was and was wrong; ADR-028 records why.
- **Never write inside the app bundle.** The engine's home is
  `SCHEMATIC_HOME` under the user-data folder; exports go where the user
  chooses (a project's own folder; else `LEGIBLE_EXPORT_FOLDER`, else the
  folder Settings names, else a `Legible Cities` folder on the desktop),
  and an export's frames sit under the engine home only while it runs.
- **The reset removes four folders and never the engine's home**, judged on
  paths resolved through `realpath`, and keeps every project's export
  folder out of its reach. It is the one destructive path:
  `.claude/rules/main.md`, "The reset", is what a change to it must keep.
- **Child processes**: argument arrays, never shell strings; `windowsHide:
  true`; a timeout; stderr captured to the log; a clean shutdown on quit.
- **The sidecar protocol is a contract.** JSON-RPC 2.0 over stdio, types
  generated from the engine's JSON Schema; a change on one side is a build
  error on the other, never a runtime surprise.
- **Capture is deterministic, per project.** A layout is computed once and
  stored; renders and exports read it and never re-run it (ADR-023).
  `setCapture(true)` before any wait, stills included, then `settle()`
  before the first captured frame; step the clock by `1/fps`; wait for the
  paint (two animation frames) before every capture, and prove it: the page
  draws its count of draws in a band under the stage (`strip=`, engine
  v0.20.0), and a shot is kept, the band cropped away, only where the band
  shows the count `state().draws` gave after the step, else taken again and
  at last refused (`src/main/capture.ts`, issue 100); compare renders in RGB
  with a channel tolerance of 8, never RGBA, never exact equality. The
  delivered GIFs are judged otherwise (ADR-055): by their colour tables,
  and by differing only on pixels the captures differ on, exactly - never
  at the tolerance of 8, since a pixel near the boundary between two
  entries flips by the gap between them.
- **Frames come from an offscreen window through the debugger** (ADR-024):
  navigate first and emulate second, since emulating a web contents that
  has never navigated crashes the process; `Page.captureScreenshot` at a
  CSS-pixel clip, never `capturePage()`, whose rect is in device-independent
  pixels and which ignores the emulated scale factor; the export in a
  session of its own (an in-memory partition, never the interface's
  default), because a persisted per-host zoom scales every capture silently.
- **Renderer**: no Node APIs; everything goes through the preload bridge.
  `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- **What ships is checked, never trusted**: bytecode compiled as unchecked
  hashes, so nothing is written inside a bundle (ADR-035); ffmpeg from
  pinned sources, `--disable-everything`, x264 its one external library,
  its source uploaded before any binary (ADR-040); every Electron bump moves
  `electron_ffmpeg` in `vendor/pins.json`, or no installer is packaged
  (ADR-043); a new python-build-standalone release fails until the pins'
  licence lists are reread (ADR-042); a tag drafts a Release, never
  publishes one (ADR-041).

## The engine

A checkout of the engine sits beside this repository, its path a personal
setting (`CLAUDE.local.md`, then `.env.local`). The pin is `engine` in
`vendor/pins.json`; the handshake refuses any other version or protocol. A
new pin moves `engine.tag`, `.version` and `.commit` (and `.protocol` when
the protocol changes), then runs
`scripts/pin-engine.sh <tag>`, which makes the engine's worktree at the tag
(`lc-engine-<tag>`, beside the engine repository) with a venv, `data` and
`out`, and moves the link `lc-engine-current` beside this checkout, which
`.env.local` names as `LEGIBLE_ENGINE_CHECKOUT` once (it refuses a tag that
is not `engine.tag` without `--force`); then `scripts/lock-python.sh` on
that checkout, committing the `vendor/python-requirements.txt` it writes
and moving `python.requirements.sha256` to the hash it prints (ADR-057);
then `npm run typegen`, which writes the protocol, its fingerprint and the
types, all three or none. The engine's own notes
explain the pipeline (`gtfs2graph → topo → loom → octi`, then render,
schedule, animate, export). Anything the app needs from the pipeline is a
change to the engine, versioned and tagged, never a copy.
