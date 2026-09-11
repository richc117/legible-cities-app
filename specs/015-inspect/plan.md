# Implementation Plan: The Inspect view

**Branch**: `A2-02-inspect` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

Engine: `route_types[].mode` (done, awaiting its tag). App: pin and
regenerate; `projects.setInputs(id, { mode, agency })` on the bridge; an
`Inspect` component with a routes table, the histogram with mode and
agency controls, the facts and the warnings, over a per-session
inspection cache; the run passes the record's mode and agency; the
create dialog seeds them from the feed record; the stand-in answers
`feeds.inspect`; a Tables rule in the design document.

## Constitution Check

| Principle | Reading |
|---|---|
| I | The swatch is a colour block beside a name; no geometry. |
| II | Every number, name, mode and sentence is the engine's; the app sorts and filters what it was given. |
| V | Keys, names and counts cross; no path. |
| VI | A real table with headers and sort buttons; native selects; the warnings a list. |

## Source code

```text
vendor/pins.json, vendor/protocol.schema.json, src/shared/protocol.ts
src/shared/api.ts, src/preload/index.ts, src/main/ipc.ts, src/main/projects.ts  # setInputs
src/renderer/src/Inspect.tsx, engine/inspections.ts, ProjectView.tsx, CreateProjectDialog.tsx
src/renderer/src/engine/layoutRun.ts               # mode and agency to graph.build
src/renderer/src/styles/app.css, docs/DESIGN.md     # tables
tests/fake-engine/schematic/serve.py                # feeds.inspect
tests/unit/{projects-store,ipc,layout-run,inspect}.test.ts, tests/unit/feeds-real.test.ts, tests/e2e/inspect.spec.ts
docs/ARCHITECTURE.md, CLAUDE.md, specs/003 contracts
```
