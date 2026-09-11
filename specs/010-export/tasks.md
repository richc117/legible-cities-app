# Tasks: The export

**Input**: `specs/010-export/` (spec.md, plan.md, contracts/bridge.md)

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Move the pin to v0.3.0; teach the generator `minLength`, `minItems`, `maxItems`; regenerate (`vendor/`, `src/shared/protocol.ts`).
- [x] T002 The generator formats its output with prettier (`scripts/protocol.ts`, `emitFormatted`); the reproducibility test follows.
- [x] T003 The shared shapes: offered presets, stages, progress, result, settled (`src/shared/export.ts`); `api.export` and its channels (`src/shared/api.ts`); `startJob` in the preload.
- [x] T004 `LEGIBLE_EXPORT_FOLDER` with the desktop default (`src/main/config.ts`); its line in `.env.example` is the maintainer's to add, since the assistant's tools do not open `.env*` files.

## Phase 2: Foundational

- [x] T005 `ipc-shape.ts`: the token, `badCall`, `toShape`; `engine-ipc.ts` uses it.
- [x] T006 [P] The stand-in engine's `export.plan` and `export.encode`, with `export_seconds`, `export_refuses`, `encode_delay_ms`, `encode_fails`.

## Phase 3: User Story 1 - one click gives the reel (P1)

- [x] T007 [US1] `Exporter` in `src/main/export.ts`: read the record, plan, validate, capture, encode, remember the file; `folderName`, `pageUrl`, `themeFor`, `jobOf`.
- [x] T008 [US1] `registerExportHandlers` in `src/main/export-ipc.ts`; wiring, the frames folder cleared at start, the reveal through `shell.showItemInFolder` (`src/main/index.ts`).
- [x] T009 [US1] The page's `ExportRun` state machine and `exportRunFor`; the `ExportRun` view with the progress line, the sentence, Cancel and Reveal; the shared `useSnapshot`.
- [x] T010 [US1] Unit tests: the order and the parameters (`tests/unit/export.test.ts`), the bridge's checks (`tests/unit/export-ipc.test.ts`), the state machine (`tests/unit/export-run.test.ts`).
- [x] T011 [US1] End to end against the stand-in: one click, the three stages, the file and its sidecar with the project's day, no path on screen, the reveal (`tests/e2e/export.spec.ts`).

## Phase 4: User Story 2 - stopped, and nothing left (P1)

- [x] T012 [US2] Cancel wherever the export is: the request in flight, the capture's signal; `abortAll` on quit; the frames removed in every outcome.
- [x] T013 [US2] Tests: cancel during the capture and during the encode, a failed encode, a quit mid-export and a start with a stale frames folder, unit and end to end.

## Phase 5: User Story 3 - the page never learns a path (P1)

- [x] T014 [US3] The result carries the file's name; the reveal takes the token; every sentence the export emits is read for a separator in the unit test and on screen in the end-to-end test.

## Phase 6: User Story 4 - a layout and an export never overlap (P2)

- [x] T015 [US4] Each button disabled while the other runs, and delete with them (`ProjectView.tsx`, `LayoutRun.tsx`, `ExportRun.tsx`).

## Phase 7: Polish

- [x] T016 The real reel, twice, compared in RGB (`tests/e2e/reel.spec.ts`, opt-in); run once and its figures recorded in the pull request.
- [x] T017 `docs/ARCHITECTURE.md` (the bridge, the configuration, an export section, the absent table), `docs/DESIGN.md` 8.2, `CLAUDE.md`, `README.md`, `.claude/rules/main.md`.
- [x] T018 Lint, typecheck, unit, build, the end-to-end suite, `bin/preflight`, `gitleaks dir .`, the reviewer; the pull request.

## Dependencies

T001-T004 first; T005 and T006 before T007; T007 before T008; T008 before T011.

## Implementation strategy

The orchestrator against fakes until every step's parameters and every
outcome's cleanup are pinned; then the bridge and the page; then the
stand-in engine and the end-to-end flow; the real reel last.
