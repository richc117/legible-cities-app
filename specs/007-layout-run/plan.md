# Implementation Plan: The layout run

**Branch**: `A3-01-layout-run` | **Date**: 2026-09-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-layout-run/spec.md`

## Summary

One action on the project screen asks the engine for a project's layout and
then its map, draws each stage as the engine finishes it, and writes the
project's layout identifier and service day when the run completes. The
identifier is the app's own, derived from the bytes of the four stage
graphs the engine names, because protocol 1 returns paths and no identity.

Two things the issue asked for are not here, and the specification says why
in its Assumptions: an explicit re-layout, which cannot be made safe at this
engine, and an enforced promise that nothing re-runs the layout implicitly,
which the engine's own map build breaks. Detection replaces enforcement.

## Technical Context

**Language/Version**: TypeScript 5.9, React 19, Electron 44

**Primary Dependencies**: none added

**Storage**: the existing project record gains values in two fields it already declares, `layout` and `date`; the engine's output lands where the app already serves it

**Testing**: Vitest for the hash, the path validation, the store's new write and the run's state machine against a stub; Playwright for the run on screen; a gated test against the real engine that lays a project out for real, which the measurements show costs under a second with the stages cached

**Target Platform**: all three desktop platforms; the gated test needs an engine checkout and, for a cold cache, Docker

**Project Type**: desktop app, existing structure

**Performance Goals**: none of the app's own. A cached run is under a second; a cold first stage is about thirteen seconds, which is what the screen is built for

**Constraints**: the renderer holds no Node APIs, so nothing but the main process touches a path; the app sends no parameter outside protocol 1; no colour, size or duration literal in a component

**Scale/Scope**: eight stages, one new bridge method, one new screen state

## Constitution Check

_GATE: checked before Phase 0 and again after Phase 1._

| Principle                             | Verdict                                      | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. One renderer                       | Satisfied                                    | The app draws a progress line and a form. The map is the engine's page, written to disk and not rendered here; the viewer that embeds it is A3-02.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| II. The engine is the source of truth | Satisfied                                    | Every call is a generated method with generated parameters. The app computes no transit value: the stage summaries, the diagnostics and every sentence on screen are the engine's. The one thing the app derives is an identifier for bytes the engine produced, which is bookkeeping about the engine's output rather than a fact about transit.                                                                                                                                                                                                                                     |
| III. Determinism is a feature         | **Engaged, and honestly short of the ideal** | A project's layout is computed once and stored, and its service day is resolved once and stored: both keepable and kept. "Renders and exports read the stored layout and never re-run the layout stages" is **not** enforceable at this engine, because its map build rebuilds any missing stage without being asked (research). The app records what it drew from and reports a difference. This is a gap against principle III, it is named in the specification's Assumptions and in the research, and E04 is what closes it. It is not hidden and it is not claimed to be solved. |
| IV. No network without a reason       | Satisfied, with one named exception          | The app opens no connection. The engine downloads a feed's archive if it is absent, whichever way the cache flag is set; that is the feed the person asked for, which is the reason principle IV allows, and the specification names it.                                                                                                                                                                                                                                                                                                                                              |
| V. Hygiene enforced by tools          | Satisfied                                    | No path reaches a committed file or the screen. The stage paths cross the bridge inward only, from the engine's answer to the main process, which validates that each lies under the engine's home before opening it.                                                                                                                                                                                                                                                                                                                                                                 |
| VI. Accessible by default             | Satisfied                                    | The run is one button, the progress is a labelled image with a sentence, each completed stage is announced once through a polite live region, cancel is a real button beside the line, and nothing moves when motion is reduced.                                                                                                                                                                                                                                                                                                                                                      |
| VII. Decisions are recorded           | **One is owed**                              | Not by this feature, but exposed by it: ADR-023 and the project feature's specification disagree about when a service day is resolved. This plan follows the later document and flags the contradiction rather than quietly picking a side.                                                                                                                                                                                                                                                                                                                                           |

**Result: pass, with one named gap against principle III and one decision
record owed by the project.** The gap is the engine's to close and is
already scoped as E04; the plan's job was to find it and say so rather than
to write a requirement nobody could meet.

## Project Structure

### Documentation (this feature)

```text
specs/007-layout-run/
├── plan.md              # this file
├── spec.md
├── research.md          # what was measured, and what survived being refuted
├── data-model.md        # the run, the identifier, what the record gains
├── quickstart.md        # how to watch a real layout happen
├── contracts/
│   ├── bridge.md        # the one new bridge method
│   └── run.md           # the run's states and the progress mapping
└── checklists/
    └── requirements.md
```

### Source code

```text
src/shared/
├── layout.ts                 # new: the stage sequence, the identifier's shape, the run's states
├── api.ts                    # edited: one method under api.projects
└── project.ts                # edited: a validator for the service day, and the record now checks a layout identifier's shape

src/main/
├── layout.ts                 # new: validate the engine's paths, hash them, write the record
├── ipc.ts                    # edited: the new handler
└── projects.ts               # edited: the store writes layout and date together

src/preload/
└── index.ts                  # edited: the new method

src/renderer/src/
├── engine/layoutRun.ts       # new: the run's state machine, with no React in it
├── engine/runs.ts            # new: one run per project, one client for the renderer
├── LayoutRun.tsx             # new: the progress line, the sentence, cancel
└── ProjectView.tsx           # edited: the button, the run, the stored layout and day

tests/unit/
├── layout-identity.test.ts   # new: the hash, the path validation, the refusals
├── layout-run.test.ts        # new: the state machine against a stub client
└── projects-store.test.ts    # edited: the new write

tests/e2e/
└── layout.spec.ts            # new: the run on screen, and gated, a real layout
```

**Structure Decision**: the existing layout. The hash and the path
validation are in the main process because the renderer holds no Node APIs
and must not learn what a path is; the run's state machine is renderer code
because it is the thing the screen draws.

## Phase 0: research

Complete. `research.md` records what was measured on this machine and the
claims that survived being adversarially refuted. The four that changed this
plan: no hashed layout directory, a map build that rebuilds implicitly, a
cancelled re-layout that corrupts, and no source for a first service day.

## Phase 1: design

Complete: `data-model.md`, `contracts/bridge.md`, `contracts/run.md`,
`quickstart.md`.

## Phase 2: what comes next

`/speckit-tasks`. The order the design implies: the identifier and its
validation first, because everything else writes what it produces; then the
bridge method and the store; then the run's state machine against a stub;
then the screen; then the gated test that lays a project out for real.

## What this feature does not do

- No re-layout. The specification's Assumptions say why, and it is the maintainer's to overrule.
- No viewer. The page is written where A3-02 will embed it from.
- No service-day picker. The day is resolved once, from today, and A3-04 is where a person chooses a better one.
- No jobs drawer. A1-03 generalises this run into one; this feature draws its own progress on the project's screen, which is where the design document puts it anyway.
