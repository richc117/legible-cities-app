# Implementation Plan: Re-layout over the engine's addressed layouts

**Branch**: `A3-05-relayout` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

## Summary

Move the pin to engine v0.5.0, regenerate the types (the generator learns
tuples and `maxLength`), let the run pass the engine's layout id through to
the map and the record, drop the app's own digest and its file reading,
add "Re-layout" behind the existing confirm dialog, teach the stand-in
engine layouts, and record the change as ADR-033 superseding ADR-027.

## Constitution Check

| Principle | Reading |
|---|---|
| II. The engine is the source of truth | The id is the engine's; the app's digest goes. |
| III. Determinism is a feature | A map is always drawn from the layout the project names; nothing lays out on the way; a forced rebuild cannot lose the stored layout. |
| V. Hygiene by tools | The bridge carries an id and a day, no path in either direction; the main process opens nothing. |
| VI. Accessible by default | The warning is the page's own `<dialog>`, Cancel focused first, Escape cancels. |
| VII. Records | ADR-033. |

## Source code

```text
vendor/pins.json, vendor/protocol.schema.json, src/shared/protocol.ts   # v0.5.0
scripts/protocol.ts                        # prefixItems as a tuple; maxLength known
src/shared/engine.ts                       # the layout kind
src/shared/layout.ts                       # LayoutDone carries the id
src/shared/project.ts                      # mode and agency as the engine validates them
src/main/projects.ts, src/main/ipc.ts      # completeLayout takes the id; src/main/layout.ts removed
src/renderer/src/engine/layoutRun.ts       # layout to map.build and the record; force
src/renderer/src/LayoutRun.tsx             # Re-layout, the warning, the sentences
tests/fake-engine/schematic/serve.py       # graph.build answers a layout; map.build requires one
tests/unit/{layout-run,projects-store,ipc,project,layout-real,protocol-real}.test.ts
tests/e2e/layout.spec.ts                   # the re-layout and its cancel
docs/adr/033-*.md, docs/ARCHITECTURE.md, CLAUDE.md, .claude/rules/main.md, specs/007 contracts
```
