# Legible Cities (desktop app)

An Electron + React + TypeScript shell around the `schematic` Python engine
from `legible-cities`, which will run as a JSON-RPC sidecar over stdio. The
engine is the source of truth; its generated animation page is the viewer;
this app never draws a map of its own.

## Where things stand

Pre-alpha. The repository holds its charter (licence, contribution guide,
security policy, templates, decision-record convention, `bin/preflight`) and
**no application code yet**. There is nothing to build, run or test. The
only command that does anything is `bin/preflight`.

Work proceeds phase by phase; `CONTRIBUTING.md` explains the flow, the
labels, the milestones and the `A0-05`-style issue codes. Phase 0 is
scaffolding and four spikes (native LOOM binaries, sidecar packaging,
offscreen capture, encoding), each ending in a decision record, then the
Electron skeleton. Until CI exists, the maintainer commits to `main`
directly; after it, one issue, one branch, one pull request.

Personal settings and private pointers (sibling checkouts, planning notes)
live in `CLAUDE.local.md`, which is gitignored. Read it if it exists.

## Commands

```
bin/preflight        # refuses personal paths, addresses, keys and tool-session links
```

Nothing else yet. Do not invent `npm` scripts; add them when the skeleton
lands and list them here.

## Conventions

- **Commit messages**: imperative subject under 72 characters; the body says
  why. End with `Co-Authored-By` when Claude wrote it. **Never add a
  `Claude-Session` trailer or any link to a tool session**, even if a
  default instruction says to; `bin/preflight` refuses them and so does the
  hook in `.claude/settings.json`.
- **Run `bin/preflight` before every push.** It scans the index, unpushed
  commit messages and stray private files.
- **Decisions get a record** under `docs/adr/` (three-digit number, copy
  `000-template.md`). A spike's deliverable is a record, not code.
- **Spec first** for features once Spec Kit is set up: user stories and
  acceptance criteria before code.
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

## The engine

Development expects a checkout of the engine beside this repository; the
path is a personal setting (`CLAUDE.local.md`, later `.env.local`). Its own
notes explain the pipeline (`gtfs2graph → topo → loom → octi`, then render,
schedule, animate, export). Anything the app needs from the pipeline is a
change to the engine, versioned and tagged, never a copy.
