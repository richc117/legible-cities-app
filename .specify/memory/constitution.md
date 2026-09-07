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

Two exports of the same job agree within the published threshold, and a test
says so. Capture sets `setCapture(true)` and settles before the first frame,
steps the clock by `1/fps`, and compares in RGB with a channel tolerance of
8 - never RGBA, never exact equality.

"It looked right when I ran it" is not a result. A person making a video for
a city's transit page needs the same input to give the same output next
month, on their machine, at whatever scale factor their monitor has.

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
- **`app://local` is one origin on purpose.** The UI and the generated
  project pages share a scheme and host so the viewer's `contentWindow` is
  reachable. See ADR-013.
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

Complexity is justified in the pull request or removed. "We might need it"
is not a justification.

**Version**: 1.0.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-07
