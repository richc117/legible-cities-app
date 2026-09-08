<!--
Sync Impact Report (1.2.0)
- Version change: 1.1.0 -> 1.2.0
- Bump rationale: MINOR. A constraint's reasoning was **replaced**, not
  merely expanded, and a prohibition was added, which reads closer to a
  redefinition than an expansion. The deciding test is the one this project
  uses for the bump: does work that complied before now fail? It does not,
  because no viewer existed. So MINOR, with the wording noted. The old line said one origin exists so the viewer's contentWindow is
  reachable; A3-02 demonstrated that a page in a same-origin frame reads and
  calls the preload bridge, and that a parent never needed the shared origin
  to drive the page, because the main process injects into a frame's main
  world regardless. The new line requires the embedded page to be contained
  and forbids `allow-same-origin`. Nothing that complied before now fails:
  no viewer existed.
- Modified sections: Constraints these principles imply
- Added sections: none
- Removed sections: none
- Templates requiring updates: none; the plan template derives its gates from
  the principles, which are unchanged.
- Follow-up TODOs: none. ADR-028 carries the evidence and ADR-013 carries a
  note pointing at it.

Sync Impact Report (1.1.0)
- Version change: 1.0.1 -> 1.1.0
- Bump rationale: MINOR. Principle III is materially expanded: determinism
  is now stated per project over a stored layout, and the capture rules
  gain the paint wait, the stills case and independence from the attached
  display. Nothing that complied before now fails; no work re-ran the
  layout implicitly, because no work exists yet.
- Modified principles: III (Determinism is a feature)
- Added sections: none
- Modified sections: none
- Removed sections: none
- Templates requiring updates: none. Dependent templates and commands read
  this file at runtime; plan-template.md derives its Constitution Check
  gates from it and needs no regeneration.
- Follow-up TODOs: none
-->

# Legible Cities Constitution

How this project builds software. Every spec, plan and pull request is read
against it. It is short on purpose: a principle nobody can recite is not
governing anything.

## Core Principles

### I. One renderer

The engine emits a self-contained animation page, and that page **is** the
viewer. The app embeds it and drives it through `window.__present`. Nothing
in the app draws a map, a line, a station or a schematic.

Two renderers means two pictures of the same data, drifting apart at
whatever rate the bugs allow, and an export path that only knows about one
of them. The temptation arrives disguised as a small preview; it is not
small.

*Non-negotiable.* A change that draws transit geometry outside the engine's
page is rejected regardless of how well it works.

### II. The engine is the source of truth

Anything the app needs from the pipeline is a change to the engine,
versioned and tagged - never a copy, a re-implementation, or a value the app
computes because asking was inconvenient. The app pins an engine version and
a change on one side is a build error on the other, not a runtime surprise.

The protocol between them is a contract: JSON-RPC 2.0 over stdio, with types
generated from the engine's JSON Schema.

### III. Determinism is a feature

A project's layout is computed once and stored with the project. Every
render and every export reads that stored layout and never re-runs the
layout stages; re-running them is an explicit action, and the app says
plainly that it may produce a different map. Two exports of the same
project agree within the published threshold, and a test says so.

Capture sets `setCapture(true)` before any wait - stills included - settles
before the first frame, steps the clock by `1/fps`, waits for the paint
before each frame it takes, and compares in RGB with a channel tolerance of
8 - never RGBA, never exact equality. Exported pixels never depend on the
display attached to the machine.

"It looked right when I ran it" is not a result. A person making a video for
a city's transit page needs the same project to give the same output next
month, on their machine, at whatever scale factor their monitor has. The
layout engine is heuristic and, on some platforms, not reproducible
(ADR-023); storing its result is what makes that promise keepable.

### IV. No network without a reason, no telemetry ever

The app reaches the network to fetch a feed the user asked for, and for
nothing else. No analytics, no crash reporting, no update pings, no fonts
from a CDN. The data a user opens is transit data about the place they live;
what they do with it is not ours to observe.

Every new outbound call is a decision that needs a reason in the pull
request, and usually an ADR.

### V. Hygiene is enforced by tools, not attention

Keys, machine paths, personal addresses, private hostnames and links to tool
sessions are refused by `gitleaks` and `bin/preflight`, running from the
commit hook and again in CI. This is a public repository written with an AI
assistant, and both of those facts push in the same direction: whatever
protects it has to run without being remembered. See ADR-015.

A scanner that is wrong is a line in `.gitleaks.toml` with a reason beside
it, not a `--no-verify`.

### VI. Accessible by default

Keyboard reachable, labelled controls, visible focus, contrast that holds in
every theme, and `prefers-reduced-motion` respected by anything that moves.
Written with the feature, not retrofitted after: retrofitting accessibility
costs more and produces worse results than building it in, every time.

An app about making cities legible has no excuse for being illegible.

### VII. Spikes end in a record; decisions are recorded, not remembered

A spike is timeboxed and its deliverable is a report, not code; its branch is
deleted and the report survives. Anything hard to reverse gets a decision
record under `docs/adr/` saying what forced the choice, what else was on the
table, and what it costs.

Surprise is the reliable signal that a decision is being made. Write it down
the day it surprises you, while you still know why.

## Constraints these principles imply

- **Never write inside the app bundle.** The engine's home is
  `SCHEMATIC_HOME` under the user-data folder; exports go where the user
  chose. See ADR-016.
- **The page the app embeds is contained, not trusted.** The generated
  project page carries text from a transit feed, so it runs in a frame
  sandboxed to an opaque origin, served with a policy of its own, and driven
  from the main process. `allow-same-origin` is never added beside
  `allow-scripts`: it gives the page back the interface's realm and with it
  the bridge. `app://local` remains one scheme and one host, but that is no
  longer what makes the viewer work. See ADR-028, which corrects ADR-013.
- **The renderer holds no Node APIs.** `contextIsolation` on,
  `nodeIntegration` off, `sandbox` on; everything crosses through a narrow,
  typed preload bridge.
- **Child processes** get argument arrays, `windowsHide: true`, a timeout,
  stderr captured to the log, and a clean shutdown on quit.
- **Licensing is GPL-3.0-or-later**, inbound equals outbound, and every
  third-party component is listed in `THIRD_PARTY_NOTICES.md` with its
  licence and its obligations.

## Workflow

Features are specified before they are built: a spec under `specs/` with
user stories and acceptance criteria, then a plan, then tasks, then code.
The acceptance criteria are written so a test could assert them; where only
a person can check something, the spec says so.

Decisions get a record. Spikes get a question and a timebox before they get
a branch. Documentation changes with the code that made it wrong.

`CONTRIBUTING.md` holds the mechanics: labels, milestones, branches, the
definition of done.

## Governance

This constitution sits above habit and convenience, and below nothing except
the licence. A pull request that conflicts with it either changes to comply
or changes the constitution first - in the open, with the reason recorded.

Amendments are pull requests that say what changed and why, bump the version
below, and update anything the change contradicts in the same commit.
Principles I and II have been load-bearing since before this repository
existed; amending either is an ADR, not a tidy-up.

Compliance is checked at review. A pull request is read against these
principles the way it is read against its tests: `CONTRIBUTING.md`'s
definition of done carries that as a line, and the `reviewer` subagent
checks the same list. A violation is either fixed or argued in the open;
it is never merged quietly on the grounds that it is small.

The version below is the constitution's own, and it moves by semantic
versioning:

- **MAJOR** - a backward-incompatible governance change: a principle
  removed, or redefined so that work which used to comply no longer does.
- **MINOR** - a principle or section added, or guidance materially
  expanded.
- **PATCH** - a clarification, a wording fix, a corrected reference:
  nothing that changes what is permitted or forbidden.

An amendment names its bump and its reason in the pull request. Where the
bump is arguable, it is the larger one - a reader who over-estimates a
change loses a minute, and one who under-estimates it misses that the rules
moved.

Complexity is justified in the pull request or removed. "We might need it"
is not a justification.

**Version**: 1.2.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-08
