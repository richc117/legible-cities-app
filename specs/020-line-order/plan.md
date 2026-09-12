# Implementation Plan: Line order, and what is drawn over what

**Branch**: `A4-02-line-order` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

The record already carries `lineOrder` and `map.build` already takes
`line_order`; this writes the one and sends the other. Every `map.build`
the run makes gains the project's arrangement; the run gains a fourth
kind, a reorder, which draws from the stored layout for the stored day and
then writes the order through a new bridge method; the project screen gains
a Line order panel over the same inspection the Colours panel reads, with
two buttons per line and one way back to alphabetical, its changes
debounced by the same pure function; the main side validates the order
before the store sees it, and the store validates it again.

The pin moves to the engine release carrying issue 28's fix, without which
an order that names some lines drops the rest.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One picture | The panel lists names and swatches; the stacking is the engine's, drawn on the engine's page. |
| II. The engine is the source of truth | The labels are `feeds.inspect`'s and the order is `map.build`'s own field; the app arranges nothing itself. |
| III. Determinism is a feature | A move is `map.build` from the stored layout's id, never `graph.build`; the record changes only when the map has been drawn. |
| IV. No network without a reason | Nothing new is fetched: the inspection is the one already cached this session. |
| V. Hygiene by tools | Line labels cross the bridge inward and a record comes out; nothing is a path. |
| VI. Accessible by default | Two named buttons per line rather than a drag; focus follows the line that moved; the new position is announced politely; nothing animates. |
| VII. Records | ADR-023 holds that a render is not a layout. No new record; the engine's contract change is engine issue 28 and its changelog. |

## Design

**The order.** `string[]`, the record's `lineOrder`, exactly `map.build`'s
`line_order`. Empty is the engine's alphabetical order and sends no field
at all, so a project with no arrangement makes byte-identical requests to
the ones it makes today.

**The engine call.** `LayoutRun.#draw` takes the order beside the palette
and passes `line_order` when it is not empty. `start()`, `rebuild()` and
`recolour()` pass the project's stored order, so a layout, a re-layout, a
chosen day and a colour change all draw the arrangement; `reorder()`
passes the one being tried.

**The run's fourth kind.** `run.reorder(project, engine, order)`: refuses
without a stored layout or a stored day; draws with the order; then
`completeOrder(id, order)`. The snapshot gains `reordered`, so the progress
panel can say what stopped. Cancel, failure and "nothing is written until
the map is drawn" are A3-04's, unchanged.

**The bridge.** `api.projects.completeOrder(id, order)` - named for when it
is called, after the draw, as `completeColors` is. The main side checks the
shape (`validateLineOrder`, shared with the panel); the store checks it
again and writes `lineOrder` and `modified`, refusing a project with no
layout.

**The arrangement.** `arrange(lines, order)` in
`src/renderer/src/order.ts`: the named lines that the feed still
offers, in the order given, then the rest in the order they came - which is
`linesOf`'s alphabetical. It is the app's copy of the engine's own
`ordered_labels`, held here so the panel can show what the engine will
draw.

**The move.** `move(lines, order, label, -1 | 1)` answers the whole
arrangement after the swap, so the record always holds a complete list of
what a person saw, and `sameOrder` decides whether that is a change at all.
`isAlphabetical` disables the way back when there is nothing to undo.

**The deferral.** `nextStep` from `colours.ts`, unchanged, over orders
instead of palettes: build, wait, or nothing at all. Both panels hold their
own debounce and the run takes one build at a time.

**The screen.** `LineOrder.tsx` under `LineColours`: a prose sentence, an
ordered list with one row per line - position, swatch, label, "Move up",
"Move down" - a polite status for the move that just happened, and "Back to
alphabetical" in a toolbar. Focus stays with the line that moved: the
button that moved it, or its opposite when that button has just become
disabled at an end, which is A3-04's lesson about Chromium blurring a
disabled element. Absent without a layout or on a read-only record.

**The stand-in.** Nothing to add: `map.build` already draws, and the
`fake-engine.received` log is what the end-to-end test reads `line_order`
out of.

## Source code

```text
vendor/pins.json, src/shared/protocol.ts           # the engine release with issue 28's fix
src/shared/project.ts                              # validateLineOrder, orderOf, a tightened read
src/shared/api.ts, src/preload/index.ts            # completeOrder
src/main/ipc.ts, src/main/projects.ts              # the order validated, then stored
src/renderer/src/engine/layoutRun.ts               # line_order on every map.build; reorder()
src/renderer/src/engine/runs.ts                    # the bridge call
src/renderer/src/order.ts                      # arrange, move, sameOrder, isAlphabetical
src/renderer/src/LineOrder.tsx                     # the panel
src/renderer/src/LayoutRun.tsx                     # the reorder's sentences
src/renderer/src/ProjectView.tsx                   # one line for the panel
src/renderer/src/styles/app.css, docs/DESIGN.md    # the row's rule (8.2)
tests/unit/{line-order,layout-run,ipc,projects-store,project}.test.ts
tests/e2e/order.spec.ts                            # the panel, the rebuild, the record, reopening
docs/ARCHITECTURE.md, CLAUDE.md, specs/003 contracts
```
