# Implementation Plan: The service day, chosen by the engine and changed by a person

**Branch**: `A3-04-service-date` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

The pin is at v0.6.0 already. The record grows a `service` block, the
engine's answer as stored; every layout run asks `feeds.service` between
the two engine calls and draws the map for the engine's day when the
project has none; the bridge gains `completeRebuild`, which writes a
chosen day after a `map.build` from the stored layout, refusing a day
outside the window; the project screen shows the day and the window and
offers a native date control bounded by them; the stand-in answers the
method; the viewer reloads when a run has drawn.

## Constitution Check

| Principle | Reading |
|---|---|
| II. The engine is the source of truth | The day is the engine's rule from a stored anchor; the window is the engine's answer, stored and never derived. |
| III. Determinism is a feature | A chosen day is `map.build` from the stored id, never `graph.build`; the record's day changes only when the build finishes. |
| IV. No network without a reason | The window is read from the record on open; `feeds.service` runs only inside a layout run, when the feed is cached. |
| V. Hygiene by tools | Four dates cross the bridge inward and a record outward; nothing is a path. |
| VI. Accessible by default | A labelled native date control with `min` and `max`, the message referenced by the control, the engine's day offered as a button. |
| VII. Records | ADR-031 already holds the decision; this feature completes it, and no new record is needed. |

## Design

**The record.** `service: { start, end, busiest, anchor } | null`, four
calendar days with `start <= end`. Read with the same tolerance as the
rest: a block that is not four valid days reads as `null`. Version stays
1 (`contracts/record.md` in spec 003 gains the field).

**The run.** After `graph.build` answers, and before `map.build`, the run
asks `feeds.service` with `{ key, anchor: today(), lines:
built.stages.octi.lines }`. The day is `project.date ?? busiest_weekday`.
The stage line has no stage for it: the octi tick is done, the schedule
tick is running, and the sentence says the day is being chosen. Cancel
between the calls is caught as it is today. `complete` carries the
window; `LayoutDone.service` is required.

**The rebuild.** `run.rebuild(project, engine, date)`: `map.build` from
`project.layout` for `date`, the same eight-tick line (the map call
repeats the four layout stages), then `completeRebuild(id, { date })`.
The snapshot says `rebuilt` so the sentences can. A cancelled or failed
rebuild says the page may be the old map.

**The bridge.** `api.projects.completeRebuild(id, { date })` → the record.
The main side checks the shape; the store checks the day is inside the
stored window and the project has a layout, and writes `date` and
`modified`.

**The screen.** A `ServiceDay` component under the fields: the stored day
and the window in prose; a form with a native `<input type="date">`
bounded by `min`/`max`, a "Use the engine's day" button when that differs
from the value, and "Draw for this day". Disabled while a run or an
export runs; absent until the project has a layout; a project with a
layout and no window says to lay out again. The viewer gets a key that
changes when a run has drawn, so the new page loads.

**The stand-in.** `feeds.service` answers `service_window` (default
`["2026-01-01", "2026-12-31"]`), `busiest` (default `2026-06-16`) and the
anchor it was given, after `service_delay_ms`, honouring a cancel;
`service_refuses` makes it refuse with a `feed` error, as the engine does
for a feed without a calendar.

## Source code

```text
src/shared/project.ts                      # ServiceWindow, record.service, validateServiceWindow, RebuildDone
src/shared/layout.ts                       # LayoutDone.service
src/shared/api.ts, src/preload/index.ts    # completeRebuild
src/main/projects.ts, src/main/ipc.ts      # the window stored; completeRebuild and its gate
src/renderer/src/engine/layoutRun.ts       # feeds.service in the run; rebuild()
src/renderer/src/engine/runs.ts            # the bridge call
src/renderer/src/ServiceDay.tsx            # the day, the window, the control
src/renderer/src/LayoutRun.tsx             # the rebuild's sentences
src/renderer/src/ProjectView.tsx           # ServiceDay; the viewer's key
src/renderer/src/styles/app.css            # the date control
tests/fake-engine/schematic/serve.py       # feeds.service
tests/unit/{project,projects-store,ipc,layout-run,layout-real}.test.ts
tests/e2e/layout.spec.ts                   # the window stored; a chosen day; a refused day; a cancelled rebuild
docs/ARCHITECTURE.md, docs/DESIGN.md 8.2, CLAUDE.md, specs/003 contracts, specs/007 contracts/bridge.md
```
