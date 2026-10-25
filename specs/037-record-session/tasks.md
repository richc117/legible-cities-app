---
description: "Tasks for spec 037, the record session: part 1 (#489) in full, parts 2-4 by their first tasks"
---

# Tasks: The record session

**Input**: `specs/037-record-session/` (spec.md, plan.md, research.md, data-model.md, contracts/bridge.md, quickstart.md)

**Tests**: every new or re-aimed test is shown red under a named mutation (the lanes' hazard 11). Each removed test is named in the pull request beside the test that now covers its case (FR-014).

## Format: `[ID] [P?] [Story] Description`

Stories: US1 (`drawn` is true), US2 (a choice is never lost), US3 (the cheap edits agree), US4 (main refuses), US5 (the split).

## Phase 1: Part 1, #489. First, the ordering property (blocking)

- [ ] T001 [US2] Write `tests/e2e/record-order.spec.ts`. From the renderer, interleave N `projects.setTheme`/`setExport` writes of increasing values with `projects.get` calls, with main kept busy (a CPU spin started in main through the test harness). Assert that each `get` sees every write sent before it, and that answers arrive in send order. Run it 10 times locally. **If it fails, stop and report (research R3).**
- [ ] T002 [US2] Audit every `projects:*` handler in `src/main/ipc.ts:344-393` for an `await` before the store call. Add a unit guard over the handlers' source that refuses one.

## Phase 2: Part 1, the session

- [ ] T003 [US2] `src/main/projects.ts`: `get` goes through `#serial`. Add a unit test that a `get` queued behind a slow write answers with the write. Mutation: `get` outside the queue.
- [ ] T004 [US1] `revision`: add it to `RECORD_FACTS` and the record type in `src/shared/project.ts`; `#save` writes `previous + 1`; absent reads as 0. Unit tests in `projects-store.test.ts` and `record-carries.test.ts`.

## Phase 3: Part 1, the sent set and `drawn` (US1)

- [ ] T005 [US1] `SentSet` and `drawnFromSent` in `src/shared/project.ts`, replacing `drawnFrom` and its comment. Add `sent` to `LayoutDone` (`src/shared/layout.ts`), `RebuildDone`, and the four redraw payloads.
- [ ] T006 [US1] `src/main/ipc.ts` payload readers validate `sent` field by field, with the record's validators. Unit tests in `ipc.test.ts` for each field refused.
- [ ] T007 [US1] `src/main/projects.ts`: `completeLayout`, `completeRebuild` and the four redraw writers build `drawn` with `drawnFromSent`. `completeLayout` no longer writes `record.date ?? done.date` over the record's date.
- [ ] T008 [US1] `src/renderer/src/engine/layoutRun.ts`: `#draw` returns the sent set it built its `map.build` from, and every completion carries it.
- [ ] T009 [US1] User Story 1's matrix in `tests/unit/layout-run.test.ts` and `projects-store.test.ts`: seven run kinds, each against each field written mid-run, with `drawn` equal to what was sent. Plus R3-02's probe. Mutation: `drawn` from the record again.

## Phase 4: Part 1, the inputs and the mechanisms removed (US2)

- [ ] T010 [US2] Every run's start (`start`, `rebuild`, `runAll`, `recolour`, `reorder`, `restyle`, `redrawLines`) flushes `beforeStart`, then plans from `await api.projects.get(id)`.
- [ ] T011 [US2] Remove `writing`, `writingFrom`, `#taken`, `#current`, `#ahead`, `#held`, `writtenAfter`, `RecordWrite`, `#writes` and `#afterWrites` from `layoutRun.ts`, and their callers in `useProjectState.ts` (about 429-432, 448, 490).
- [ ] T012 [US2] Remove the three serialisers (research R4): `themeWrites.ts`'s `writeThrough` and `themeChooser.ts`, `ExportTab.tsx`'s writing/waiting/sent, and `LayoutTuning.tsx`'s counter. Each control sends and takes the answer.
- [ ] T013 [US2] Re-aim `layout-run`, `project-state-writes`, `inspect-writes`, `service-day-writes`, `theme-writes`, `theme-chooser` and `run-all` at the queued read. List each removed test beside its replacement for the pull request.
- [ ] T014 [US2] Write "The record session" in `docs/ARCHITECTURE.md`: the ordering property, the sent set, and the rule a new control follows. Update `.claude/rules/main.md` and `.claude/rules/renderer.md` where they describe the old mechanisms.

## Phase 5: Part 1, verification

- [ ] T015 The coordinator runs the full end-to-end suite against the pinned engine, then `e2e-loop` with load on `tuning`, `inspect`, `layout`, `colours`, `order` and `style`, 10 times per platform (SC-004).

## Phases 6-8: Parts 2-4 (planned again when each starts)

- [ ] T016 [US3] #490: `useCheapEdit` per research R5, with the four panels moved onto it and one rendered table per panel.
- [ ] T017 [US4] #491: `ProjectActivity` per research R6; `Exporter.start` and `ProjectStore.delete` consult it; three main-side tests.
- [ ] T018 [US5] #492: the split per research R7, with the import-graph test.

## Dependencies

- T001-T002 block everything after them.
- T003-T004 come before T005-T009, and those before T010-T014. T015 is last.
- #490, #491 and #492 follow #489's merge. #491 and #492 may run beside #490. #492 merges when no other record-touching branch is open.
