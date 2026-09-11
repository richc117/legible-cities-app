# Implementation Plan: The Library adds and removes feeds

**Branch**: `A2-01-feeds` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

Pin v0.7.0 and regenerate. A `feeds` bridge with one method, `pickZip`,
over a native open dialog whose answers the main process remembers; the
engine bridge gains a guard that refuses a `feeds.add` from a path it did
not hand out and a `feeds.remove` of a feed a project names. A `FeedAdd`
run (no React) drives `feeds.add` with its two stages. The Library lists
feeds under the projects with per-row actions; an Add feed dialog with
file or URL; the create dialog's feed becomes a select; the empty state
gains its action. The stand-in answers the three methods.

## Constitution Check

| Principle | Reading |
|---|---|
| II | The list, the check and the refusals are the engine's; the app shows `cached`, never guesses. |
| IV | The engine downloads the URL a person typed, and nothing else new touches the network. |
| V | A path crosses from a native dialog to the page and back to the engine, checked against what was handed out; the page shows the name. |
| VI | Rows named for a screen reader, the dialogs native `<dialog>`, the select native, the progress line as it is. |

## Source code

```text
vendor/pins.json, vendor/protocol.schema.json, src/shared/protocol.ts   # v0.7.0
src/shared/api.ts, src/preload/index.ts       # feeds.pickZip; channels
src/main/feeds-ipc.ts                         # the dialog, the remembered paths, the guard
src/main/engine-ipc.ts, src/main/index.ts     # the guard hook; wiring
src/renderer/src/engine/feedAdd.ts, runs.ts   # the add as a run
src/renderer/src/Library.tsx, FeedList.tsx, AddFeedDialog.tsx, CreateProjectDialog.tsx
src/renderer/src/styles/app.css
tests/fake-engine/schematic/serve.py          # feeds.list/add/remove
tests/unit/{feeds-ipc,engine-ipc,feed-add,project}.test.ts; tests/e2e/feeds.spec.ts
docs/ARCHITECTURE.md, specs/003 spec's typed-key note, CLAUDE.md
```
