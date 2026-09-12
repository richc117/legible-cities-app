# Implementation Plan: Line colours, the feed's and a person's

**Branch**: `A4-01-line-colours` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

The pin is at v0.8.0 already and the record already carries `colors` and
`defaultColor`. Every `map.build` the run makes gains the project's
palette; the run gains a third kind, a recolour, which draws from the
stored layout for the stored day and then writes the palette through a new
bridge method; the project screen gains a Colours panel over the feed's
inspection, with a picker per line, a reset per line, a reset for all and a
default colour, its changes debounced by one pure function; the main side
validates the palette before the store sees it, and the store validates it
again.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One picture | The panel draws swatches beside names and nothing else; the map, the chips and the chart are the engine's page, redrawn by the engine. |
| II. The engine is the source of truth | The labels and the feed's colours are `feeds.inspect`'s; the resolution of override over feed over default is the engine's own (`render.line_colors`), and the app sends it the same two fields the CLI does. |
| III. Determinism is a feature | A colour change is `map.build` from the stored layout's id, never `graph.build`; the stations do not move, and the record changes only when the map has been drawn. |
| IV. No network without a reason | The palette is read from the record on open; the inspection is the one already cached this session. |
| V. Hygiene by tools | A label and six hex digits cross the bridge inward, a record outward; nothing is a path. |
| VI. Accessible by default | Every control named for its line, keyboard-reachable, focus-visible; a typed hex field is the pointer-free path; nothing animates under reduced motion. |
| VII. Records | ADR-023 and ADR-031 already hold the decision that a render is not a layout. No new record is needed. |

## Design

**The palette.** `Palette = { colors: Record<string, string>; defaultColor:
string }` - exactly the record's two fields, and exactly `map.build`'s
`colors` and `default_color`. The record's shape and version do not move.

**The engine call.** `LayoutRun.#draw` takes the palette and passes
`colors` and `default_color` to `map.build`. `start()` and `rebuild()` pass
the project's stored palette, so a layout, a re-layout and a chosen day all
draw the stored colours; `recolour()` passes the one being tried.

**The run's third kind.** `run.recolour(project, engine, palette)`:
refuses without a stored layout or a stored day; draws with the palette;
then `completeColors(id, palette)`. The snapshot gains `recoloured`, so
the progress panel's sentences can say what stopped. Cancel, failure and
the "nothing is written until the map is drawn" discipline are A3-04's,
unchanged.

**The bridge.** `api.projects.completeColors(id, palette)` - named for
when it is called, after the draw, as `completeRebuild` is. The main side
checks the shape (`validatePalette`, shared with the form); the store
checks it again and writes `colors`, `defaultColor` and `modified`, refusing
a project with no layout.

**The lines.** `linesOf(inspection, inputs)` in
`src/renderer/src/colours.ts`: the inspection's routes narrowed by the
layout's agency and mode with `routesOf` and `keeps`, which `Inspect.tsx`
already exports, then grouped by `label` - one row per label, the first
`route_color` the feed publishes for it, `#`-prefixed, or null. The
layout's `built` is the filter when there is one, the record's mode and
agency otherwise.

**The resolution.** `shownColour(line, palette)` answers the colour and
which of the three it came from: override, feed, default. That is the
engine's own order (`render.line_colors`), held here so the panel can say
it in words and the tests can hold it.

**The deferral.** `nextStep(next, stored, busy)`: build, wait, or nothing
at all. `busy` is the rendered state *or* the run's own at the moment of
the call, because a run can start between a render and the timer firing.

**The debounce.** `debounce(fn, delay)` in
`src/renderer/src/debounce.ts`: a plain function with `cancel`, tested
with fake timers. The panel holds one, made once, cancelled on unmount.

**The screen.** `LineColours.tsx` under `ServiceDay`: a prose sentence, the
default-colour row, a list with one row per line - swatch, label, where the
colour came from, "Choose colour" (a disclosure, one open at a time) and
"Reset" - and "Reset every line" in a toolbar. The picker is
`react-colorful`'s `HexColorPicker` in a named group, with the app's own
`TextInput` beside it for a typed hex. Nothing is disabled while a run or
an export is going: `commit` holds the change and builds once the way is
clear, so no control disables itself under a person's hands and no change
is lost. Absent without a layout or on a read-only record.

**The stand-in.** Nothing to add: `map.build` already draws, and the
`fake-engine.received` log is what the end-to-end test reads the palette
out of.

## Source code

```text
package.json, THIRD_PARTY_NOTICES.md               # react-colorful, a devDependency, MIT
src/shared/project.ts                              # Palette, validatePalette, isHexColor
src/shared/api.ts, src/preload/index.ts            # completeColors
src/main/ipc.ts, src/main/projects.ts              # the palette validated, then stored
src/renderer/src/engine/layoutRun.ts               # the palette on every map.build; recolour()
src/renderer/src/engine/runs.ts                    # the bridge call
src/renderer/src/colours.ts                        # linesOf, shownColour, the palette's edits
src/renderer/src/debounce.ts                       # debounce, pure
src/renderer/src/LineColours.tsx                   # the panel
src/renderer/src/LayoutRun.tsx                     # the recolour's sentences
src/renderer/src/ProjectView.tsx                   # one line for the panel
src/renderer/src/styles/app.css, docs/DESIGN.md    # the colour control's rule (8.2)
tests/unit/{colours,debounce,layout-run,ipc,projects-store}.test.ts
tests/e2e/colours.spec.ts                          # the panel, the rebuild, the record, reopening
docs/ARCHITECTURE.md, CLAUDE.md, specs/003 contracts
```
