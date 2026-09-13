# Implementation Plan: The diagnostics panel

**Branch**: `A3-03-diagnostics-panel` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

`map.build`'s answer is thrown away today. `#draw` keeps the three parts
a person can read - `diagnostics`, `caveats`, `issues` - with the day, as
`report` on the run's snapshot, cleared when a run begins; nothing
reaches the record. A `Diagnostics` panel between the run and the service
day renders the caveats verbatim, the score, and the figures as a table
whose every row carries an explanation on a small control reachable by
pointer and keyboard, exposed through `aria-describedby`. The formatting
is pure functions in `engine/diagnostics.ts`, tested without React: the
percentage the engine itself prints, the three matching methods by name,
the rows, and the plain-text block "Copy as text" writes. The write goes
through one new bridge method, because the app refuses every permission
request and `navigator.clipboard.writeText` is one.

## Constitution Check

| Principle | Reading |
|---|---|
| I | The caveat sentences are the engine's, word for word. |
| II | Every figure is the engine's block, formatted and never derived; the unmatched ids are examples, not a count. |
| III | The panel describes the build that just ran, from the stored layout; it triggers nothing. |
| V | No path on the snapshot or the screen; a path-shaped stop id is withheld. |
| VI | A labelled table, a focusable explanation with a description, visible focus, no transition under reduced motion. |

## Source code

```text
src/renderer/src/engine/layoutRun.ts       # RunReport on the snapshot, bound in #draw
src/renderer/src/engine/diagnostics.ts     # the formatting, the rows, the copy block
src/renderer/src/Diagnostics.tsx           # the panel
src/renderer/src/ProjectView.tsx           # one line, between the run and the service day
src/renderer/src/styles/app.css            # .diagnostics; docs/DESIGN.md 8.2 gains its row
src/shared/api.ts, src/preload/index.ts, src/main/ipc.ts, src/main/index.ts   # api.clipboard.write
tests/fake-engine/schematic/serve.py       # caveats and issues, and the control keys for them
tests/unit/{diagnostics,layout-run,ipc,layout-real}.test.ts; tests/e2e/layout.spec.ts
```

## What was considered and refused

- **Storing the block on the record.** `parseRecord` drops unknown
  fields and `RECORD_VERSION` is 1; bumping it makes every record
  read-only to an older app, for numbers that go stale as soon as
  another project re-lays out the set (A3-06).
- **Computing the unmatched count** as `total - matched`. It is right
  arithmetic and the wrong principle: the engine sends eight ids and the
  caveat sentence carries the true count.
- **`navigator.clipboard.writeText`.** The app answers every permission
  check with `false` on purpose (`src/main/index.ts`), and Chromium
  routes a clipboard write through one.
