# Implementation Plan: The record session

**Branch**: `426-record-session` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/037-record-session/spec.md`

## Summary

Main already serialises every record writer per project (`ProjectStore.#serial`). What makes `drawn` untrue, and needs five renderer mechanisms, is three gaps:
- `drawn` is composed from the record at the write;
- `get` skips the queue;
- a run reads its inputs from the renderer's copy.

Part 1 (#489) closes all three:
- every completion carries the **sent set** its `map.build` was built from, and `drawn` is made from that;
- `get` joins the queue;
- every run reads its inputs with a queued `get` after flushing the debounced controls;
- the five mechanisms and three serialisers go.

All of it rests on one property an Electron test establishes first: `invoke`s from one frame reach main's queue in send order. Parts 2-4 are outlined in research.md R5-R7: #490 (the cheap-edit hook), #491 (the invariants in main) and #492 (the split).

## Technical Context

**Language/Version**: TypeScript 5, Electron 44 (main, preload, renderer), React 19.

**Primary Dependencies**: none new.

**Storage**: the project record (`projects/<id>/project.json`), written by `writeAtomic` inside `#serial`. It gains `revision` under ADR-056's additive rule.

**Testing**:
- unit: `projects-store`, `layout-run`, `project-state-writes`, `ipc`, and the re-aimed mechanism suites;
- a new Electron test of invoke ordering under load;
- the end-to-end suites for 388, 399 and 407, unchanged, as the regression;
- the `e2e-loop` workflow for SC-004.

**Target Platform**: macOS, Windows (shipped); Linux (CI).

**Project Type**: desktop app.

**Performance Goals**: none new. A queued `get` waits only for writes already in main, milliseconds each.

**Constraints**:
- the renderer is less trusted, so main validates every field of a sent set as it validates a setter's argument;
- no behaviour change a person sees beyond the spec's FR-016.

**Scale/Scope (part 1)**:
- `src/main/projects.ts`: the writers, `get`, `drawn`;
- `src/main/ipc.ts`: the payload readers;
- `src/shared/layout.ts` and `src/shared/project.ts`: the payload types, `drawnFrom`;
- `src/renderer/src/engine/layoutRun.ts`: the mechanisms removed, the sent set built;
- `src/renderer/src/notebook/useProjectState.ts`;
- the serialisers: `themeWrites.ts`/`themeChooser.ts`, `ExportTab.tsx`, `LayoutTuning.tsx`;
- the tests above.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it |
|---|---|
| I. One renderer | Nothing draws. `map.build` is sent as today. |
| II. The engine is the source of truth | No protocol change. The sent set is what was sent to the engine, recorded. |
| III. Determinism | A stored layout is still read, never re-run. `drawn` becomes exact about which layout and day a map carries. |
| IV. No network | None added. |
| V. Hygiene | No change. |
| VI. Accessible by default | No control changes. The truthful "not drawn yet" is said in the existing words, and part 2's status-line refusal uses the existing polite region. |
| VII. Decisions recorded | ADR-056's rule covers `revision`. The ordering property is held by a test and written in `docs/ARCHITECTURE.md`, "The record session". If R3's test fails and sequence numbers are needed, that choice gets an ADR. |
| Constraint: the renderer holds no Node APIs | Unchanged. |

**Result:** pass. Re-checked after design: pass.

## Project Structure

### Documentation (this feature)

```text
specs/037-record-session/
├── spec.md
├── plan.md            # this file
├── research.md        # R1-R7
├── data-model.md      # revision, the sent set, drawn
├── contracts/
│   └── bridge.md      # the changed projects:* payloads and the ordering property
├── quickstart.md
└── tasks.md
```

### Source Code (part 1)

```text
src/main/projects.ts                          # get queued; writers take `sent`; drawnFromSent; revision
src/main/ipc.ts                               # payload readers for `sent`; no await before the store
src/shared/layout.ts                          # LayoutDone.sent
src/shared/project.ts                         # RebuildDone.sent, redraw payloads, SentSet, drawnFromSent; RECORD_FACTS gains revision
src/renderer/src/engine/layoutRun.ts          # mechanisms removed; inputs from a queued get; sent built where map.build is
src/renderer/src/notebook/useProjectState.ts  # run.writing callers removed
src/renderer/src/{themeWrites,themeChooser}.ts, ExportTab.tsx, LayoutTuning.tsx  # serialisers removed
docs/ARCHITECTURE.md                          # "The record session"
tests/e2e/record-order.spec.ts                # new: FR-008
tests/unit/...                                # re-aimed, and User Story 1's matrix
```

**Structure Decision**: no new module in part 1. The session is the existing queue, extended.

## Phase 0: Research

See [research.md](research.md):
- R1: what is really missing;
- R2: the sent set;
- R3: inputs via a queued `get`, and FR-008's test;
- R4: the serialisers;
- R5-R7: parts 2-4.

## Phase 1: Design

[data-model.md](data-model.md), [contracts/bridge.md](contracts/bridge.md), [quickstart.md](quickstart.md).

## Delivery

As FR-017 says, four issues:
1. **#489**, part 1. Opus, with the reviewer twice. FR-008's test is its first commit; if it fails, the lane stops and reports before building on it.
2. **#490**, part 2, after #489. Opus.
3. **#491**, part 3, after #489. Sonnet; it can run beside #490.
4. **#492**, part 4, after #489. Sonnet; it can run beside #490. Its file moves conflict with every open branch, so it merges when no other record-touching branch is open.

## Complexity Tracking

None.
