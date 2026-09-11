# Implementation Plan: Notice a layout laid out again from another project

**Branch**: `A3-06-layout-made` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

`made: string | null` on the record; `LayoutDone.made` from `meta.made`,
checked on the main side; `completeLayout` writes it with the id and
answers `relaid` beside `changed`; the run carries `relaid` in its
snapshot and `doneSentence` says it; the fields show the time; the
stand-in keeps a `made` per layout and rewrites it on `force`.

## Constitution Check

| Principle | Reading |
|---|---|
| II | `made` is the engine's; the app compares, never computes. |
| III | A different map is announced: same id, new set, said in words. |
| V | A timestamp crosses the bridge; no path. |

## Source code

```text
src/shared/project.ts, src/shared/layout.ts      # made; LayoutDone.made; LayoutResult.relaid
src/main/projects.ts, src/main/ipc.ts            # written with the id; the shape check
src/renderer/src/engine/layoutRun.ts             # relaid in the snapshot
src/renderer/src/LayoutRun.tsx, ProjectView.tsx  # the sentence; the time beside the id
tests/fake-engine/schematic/serve.py             # made per layout, rewritten on force
tests/unit/{project,projects-store,ipc,layout-run,layout-real}.test.ts; tests/e2e/layout.spec.ts
specs/003 record contract and data model; docs/ARCHITECTURE.md
```
