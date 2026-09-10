# Tasks: The capture

**Input**: `specs/009-capture/` (spec.md, plan.md, contracts/capture.md)

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 The job and beat types and `frameTotal` in `src/shared/capture.ts`.
- [x] T002 `registerAppScheme` in `src/main/scheme.ts`, used by `src/main/index.ts`.
- [x] T003 `registerAppProtocol` takes a session and `projectsOnly` (`src/main/protocol.ts`).
- [x] T004 A second main entry in `electron.vite.config.ts`; an ESLint environment for `tests/**/*.cjs`.

## Phase 2: Foundational

- [x] T005 `captureWindowOptions`, `validateCaptureJob`, `CaptureError` and the `CapturePage` interface in `src/main/capture.ts`.
- [x] T006 [P] The animated fixture page with the real seam, `tests/fixtures/capture-page.html`, honouring `?at=`.

## Phase 3: User Story 1 - the same job gives the same frames (P1)

- [x] T007 [US1] `runCapture`: navigate, attach, emulate, wait for the seam, `setCapture`, fonts, settle, bounds and state, the clip, `settle()`, then per beat and per frame with two animation frames and `Page.captureScreenshot`.
- [x] T008 [US1] Unit tests over a fake page: the order, sixty frames for two seconds, the clip at scale 1, sweeps, the seam wait (`tests/unit/capture.test.ts`).
- [x] T009 [US1] `ElectronCapturePage`, `configureCapture`, `capture` in `src/main/capture-window.ts`; the harness `tests/e2e/capture-harness.cjs`.
- [x] T010 [US1] End-to-end: twice byte-identical on the fixture; the zoom trap; the real Los Angeles page when a checkout is present (`tests/e2e/capture.spec.ts`).

## Phase 4: User Story 2 - stopped, and nothing left (P1)

- [x] T011 [US2] Cancel, the renderer dying and a step that never answers, each destroying the window and removing the directory; `abortCaptures` on `before-quit`.
- [x] T012 [US2] Tests: cancel after ten frames leaves no window, no live capture and no directory (unit and end to end); the page stopped; the timeout names the step.

## Phase 5: User Story 3 - the page cannot reach the app (P1)

- [x] T013 [US3] No preload, node off, isolation and sandbox on, the capture partition, offscreen, hidden: asserted over `captureWindowOptions`.
- [x] T014 [US3] The window denies `window.open` and `will-navigate`; the session refuses every permission and serves project pages only.

## Phase 6: User Story 4 - a bad job is refused first (P2)

- [x] T015 [US4] The validator's table, and the preflight refusal with the engine's sentence, unit and end to end.

## Phase 7: Polish

- [x] T016 The crash the order avoids, reproduced by an opt-in test (`tests/unit/capture-crash.test.ts`, `tests/fixtures/emulate-order.cjs`); run once.
- [x] T017 The two negative checks on the real page (the paint wait removed; the page's `cancelAnimationFrame` removed), reported in the pull request.
- [x] T018 `docs/ARCHITECTURE.md`, `CLAUDE.md` and `.claude/rules/main.md` say what exists and that the session is a partition.
- [x] T019 Lint, typecheck, unit, build, the whole end-to-end suite, `bin/preflight`, `gitleaks dir .`, the reviewer; the pull request.

## Dependencies

T001-T004 first; T005 before T007; T009 before T010; the rest in story order.

## Implementation strategy

The orchestrator first, against the fake page, until every step's order is
pinned; then the Electron half, and the harness that proves it in a real
window; then the negative checks, whatever they show.

## As landed

The reviewer read the working tree before the pull request and found ten
things, three of them blocking: `capture()` built the window before
validating the job, so a refused job leaked one; a beat's `lo`, `hi`,
`hours` and `sweep` were typed only in part, so a string could reach the
seek script; and the harness seeded a zoom level into the machine-wide
bare-Electron profile, the very trap the spike fell into. All ten were
fixed: the orchestrator's steps are thunks so a step is never started once
the capture has ended, a destroy from outside ends the capture, a missing
page fails at once, what the page reports is cut to printable text, and the
harness has a profile of its own. Three end-to-end runs then taught two
things about Electron: the last window closing quits a bare Electron unless
`window-all-closed` is subscribed, and a page that navigates while its
parser is still running never finishes its own script.
