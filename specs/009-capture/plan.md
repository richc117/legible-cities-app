# Implementation Plan: The capture

**Branch**: `A5-02a-capture` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-capture/spec.md`; ADR-024;
`docs/adr/spikes/offscreen-capture.md`, session three; the engine's
`bin/_record.js` and `export.beat_payload`.

## Summary

An offscreen window in the main process takes a project page's frames
through the DevTools protocol, in the order spike A0-07 measured. The order
lives in a pure orchestrator behind an interface for the window, so a unit
test asserts every step without Electron; the Electron half is thin and is
exercised end to end in a real Electron through a harness that loads it as
a second build entry. Nothing reaches the renderer; the export flow that
will call this is A5-02b.

## Technical Context

**Language/Version**: TypeScript 5, Electron 44.2.0 (Chromium 152), Node 22.

**Primary Dependencies**: none new. Playwright stays a test dependency.

**Storage**: PNG frames in a directory the caller names; nothing else is
written.

**Testing**: vitest over a fake page (the order, the clip, the window's
options, cancel and failure); Playwright's Electron driver over
`tests/e2e/capture-harness.cjs` (byte-identity twice, the zoom trap,
cancel, the preflight refusal, the real Los Angeles page when a checkout is
present); an opt-in vitest that spawns a real Electron to reproduce the
crash.

**Target Platform**: macOS and Windows; Linux runs the tests under xvfb.

**Performance Goals**: the spike's 117 ms per frame; a reel is about 95 s.

**Constraints**: ADR-024's sequence, verbatim; no preload, no bridge, a
session of the window's own; never `capturePage()`; never onscreen.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | Nothing draws. The frames are the engine's page, screenshotted. |
| II. The engine is the source of truth | The job is the engine's own shape; no value is computed that the engine will hand over later, except the sentence for an empty clock, copied from its recorder. |
| III. Determinism is a feature | This is the mechanism. `setCapture(true)` before any wait, `settle()` before the first frame, `advance(1/fps)`, two frames before each capture, a session the display cannot reach. |
| IV. No network without a reason | The window's session refuses every permission and serves project pages only. |
| V. Hygiene by tools | The window's options are asserted by a test; the crash order is asserted by a test; the zoom trap is asserted by a test. |
| VI. Accessible by default | No interface is added. |
| VII. Records | ADR-024 is the record; this plan adds none. |

## Project Structure

### Documentation (this feature)

```text
specs/009-capture/
├── spec.md
├── plan.md              # this file
├── tasks.md
├── quickstart.md
├── contracts/capture.md # the job, the sequence, the result
└── checklists/requirements.md
```

### Source code

```text
src/shared/capture.ts             # new: the job and beat types, frameTotal
src/main/capture.ts               # new: CapturePage, captureWindowOptions, validateCaptureJob, runCapture
src/main/capture-window.ts        # new: the Electron half; configureCapture, capture, abortCaptures; the second entry
src/main/scheme.ts                # new: registerAppScheme, shared by the app and the harness
src/main/protocol.ts              # edited: a session to serve, and projectsOnly
src/main/index.ts                 # edited: configureCapture at ready; abortCaptures on before-quit
electron.vite.config.ts           # edited: two main entries
eslint.config.mjs                 # edited: an environment for the CommonJS scripts under tests/
tests/unit/capture.test.ts        # new: the order, over a fake page
tests/unit/capture-crash.test.ts  # new: opt-in, a real Electron crashes the wrong way round
tests/fixtures/capture-page.html  # new: a page that animates, with the real seam
tests/fixtures/emulate-order.cjs  # new: the crash, reduced
tests/e2e/capture-harness.cjs     # new: a bare Electron around the capture entry
tests/e2e/capture.spec.ts         # new: byte-identity, the zoom trap, cancel, preflight, the real page
docs/ARCHITECTURE.md              # edited: a capture section; the absent table
CLAUDE.md, .claude/rules/main.md  # edited: what exists; the session rather than a userData path
```

**Structure Decision**: the orchestrator is pure and the adapter thin, the
pattern `viewer.ts` and `sidecar.ts` set. The harness exists because the
app has no way to start a capture from outside and must not grow one for a
test; a second rollup input costs one config block and gives the tests the
real window.

## Phase 0: research

Done in spike A0-07 and recorded in ADR-024. Two things this feature had to
find for itself: Playwright hands the Electron module first to
`electronApp.evaluate`, and a harness with one window quits when that
window is destroyed unless it subscribes to `window-all-closed`, which is
why two of the first five end-to-end runs died with a destroyed context.

## Phase 1: design

- The session is an in-memory partition rather than a `userData` path: the
  same isolation the spike got from a fresh profile, inside one process,
  and nothing to clean up.
- The frames directory is the caller's on success and removed on any
  other outcome; a half-directory is worse than none.
- Every step is raced against the cancel, the renderer dying and a
  timeout that names the step, and the first two are also remembered, so a
  step whose promise is already settled cannot win the race.
- The validator refuses a first beat that names no time. The engine's
  storyboards all do; the spike showed why a job that does not is not
  reproducible on any host.

## Phase 2: what comes next

A5-02b: `export.plan` from the engine (E09b) becomes the job, the capture
runs inside the export flow with its progress on the project screen, and
`export.encode` turns the directory into the file.

## What this feature does not do

No preset, no plan, no encode, no button, no bridge method. No change to
the engine. The page's `at` in the URL, the storyboard and the frame
parameters are the plan's to build; the tests build one by hand.
