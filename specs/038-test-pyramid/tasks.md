---
description: "Tasks for spec 038, the test pyramid: Part 1 in full, Parts 2 and 3 as they were built"
---

# Tasks: The test pyramid

**Input**: `specs/038-test-pyramid/` (spec.md, plan.md, research.md, data-model.md, contracts/ci-layers.md, quickstart.md)

**Tests**: every new or changed test is shown red under a named mutation before it is called done (the lanes' hazard 11).

**Organization**: by the three pull requests of research R7 for Part 1. Parts 2 and 3 were listed as their first tasks only and planned again when they started; each task says the pull request that built it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependencies)
- **[Story]**: US1 (the middle of the pyramid), US2 (the stand-in held to the engine), US3 (a merge waits only for what it must), US4 (mutations noticed)

## Phase 1: FR-001, the four shapes (pull request 1; US2)

- [x] T001 [US2] In `tests/unit/stand-in-shapes.test.ts`, add `answerProblems` checks of the stand-in's answers to `engine.info`, `engine.shutdown`, `feeds.inspect` and `feeds.service` against `vendor/protocol.schema.json`'s result types, using the harness the other eleven methods use.
- [x] T002 [US2] Show each of T001's four checks red under a mutation of the stand-in's answer in `tests/fake-engine/schematic/serve.py` (one field removed or mistyped), and record the mutations in the test's header in the file's existing form.

## Phase 2: FR-002, the real suites in `determinism.yml` (pull request 2; US2)

- [x] T003 [US2] Make the interpreter resolution of `protocol-real`, `feeds-real`, `layout-real`, `opening-real` and `sidecar-real` (`tests/unit/*-real.test.ts`) take `LEGIBLE_ENGINE_PYTHON` from the environment, as `determinism-real.test.ts` does. Do it through a shared helper in `tests/support/` if three or more would repeat it.
- [x] T004 [US2] Give `feeds-real` and `layout-real` a second source for what they need. Where no engine checkout supplies a feed or a stored layout, use a temporary `SCHEMATIC_HOME` seeded from `tests/fixtures/determinism/bart/data/` (R5 b). Keep their LA assertions for a checkout, and add BART equivalents that run in CI.
- [x] T005 [US2] Make `viewer-real` draw its page by a `map.build` from the seeded home when no checkout page exists (R5 c). Resolve the page template for the `PAGE_SEAMS` gate from the installed engine package when there is no checkout (R5 note).
- [x] T006 [US2] In `.github/workflows/determinism.yml`, run `npx vitest run tests/unit/*-real.test.ts` in place of the one file, with `LEGIBLE_DETERMINISM_TEST=1`. Prove it by dispatching the workflow on the branch with `repeats: 1`, with no suite skipped on any platform (contracts/ci-layers.md).
- [x] T007 [US2] Locally, run all seven with only `LEGIBLE_ENGINE_PYTHON` set (no checkout), per quickstart.md. All run, none skips.

## Phase 3: FR-003, the CI split (pull request 3; US3)

- [x] T008 [US3] In `.github/workflows/ci.yml`:
  - Make `ci (<os>)` the fast layer on three platforms: install, Electron binary, lint, typecheck, unit tests, build. Remove both e2e steps.
  - Add `e2e (<os>)` on `macos-15` and `windows-latest`, with `fetch-depth: 0`.
  - The e2e job's first step decides `docsOnly` by R3's denylist, from `git diff --name-only` between base and head, and prints its decision (data-model.md). Every later step is gated `if: steps.decide.outputs.run == 'true'`; on a push to `main` it always runs.
  - Then install, Electron binary, build, `npm run test:e2e`, and keep the failure evidence.
  - Timeouts are 20 and 60 minutes; the per-ref concurrency is kept.
- [x] T009 [US3] Test the decision step's rule as a script under `scripts/` with a unit test, or inline with a table in the workflow's comment. Cover: all docs; one `src/` file among docs; an empty diff (runs); a new top-level file (runs); `.claude/**` only. Show the denylist's widest entry removed turns a docs-only row to "runs".
- [x] T010 [US3] `docs/repository-settings.md`: list the seven required checks. `docs/ARCHITECTURE.md`, "Checks": correct "The smoke test". `CONTRIBUTING.md`: say what runs on a contributor's pull request (left to issue 488, which rewrites that file; the sentence is in lane 500's report).
- [x] T011 [US3] The coordinator changes branch protection to contracts/ci-layers.md's seven checks in the same hour as the merge, and proves quickstart.md's FR-003 steps 1-5: steps 1 and 2 on the pull request itself (#506); step 3 and SC-001 on #488, the first documentation-only pull request after it (both `e2e` jobs under 30 seconds, every required check green 6½ minutes after the push); step 4 on the pushes to `main` that followed; step 5 the same hour.

## Phase 4: Part 2, the DOM layer (US1)

- [x] T012 [US1] `/spike` with the question "which DOM layer for component tests", timeboxed, comparing the four candidates of FR-004 on R7-02's hold, a debounce and a focus hand-back. Its report is an ADR. Done: ADR-059, with the layer itself (#591), accepted in #604.
- [x] T013 [US1] R7-02's rendered test of `LineOrder`'s read-back hold, shown red with `settling` off (FR-005). Done: `cheap-edit.test.tsx`, which met it before the spike, moved to jsdom with a real press (#591).
- [ ] T014 [US1] Replace the source-regex sites file by file (FR-006). `panel-release.test.ts` is done with spec 037's issue 490. Begun: `cheap-edit.test.tsx` and `announcer-region.test.tsx` in #591, `panel-release.test.ts` with issue 490. Left, as of 2026-10-29, the sites the spec's Status names: `colours.test.ts` (the picker's `onChangeEnd` wiring), `export-choice.test.ts` (cell 06's planned choice), `layout-as-it-solves.test.ts` (the stage view's announcements), `rail.test.tsx` (the Outputs icon), `message-live-region.test.ts` (Settings' licence line), `cell-footer.test.tsx` (which cells draw a strip, the strip's making no request, the panels' own sentences, the sample page's builders), `icons.test.ts` (the Jobs icon), `settings-screen.test.tsx` (the folder buttons' icons), `theme-writes.test.ts` (the project screen's `setTheme`) and the one site `panel-release.test.ts` keeps for cell 02's sentence.

## Phase 5: Part 3, the mutation job (US4)

- [x] T015 [US4] Fix the mutation entry's form (data-model.md) and write the dispatch-only workflow (FR-008). Done: the form in ADR-059's Consequences, `scripts/mutations.mjs` and `mutations.yml` (#601).

## Phase 6: FR-007, the conformance table (US2)

- [x] T016 [US2] One table of the refusals the pinned engine gives without the network, a real LOOM or a long run, each sentence written once (`tests/support/conformance.ts`), with those not held yet named in it (`NOT_HELD`): the params rows of issue 473, and the refusals past the params (a key no feed has, a preset removed, a zip that is not a feed or is past a feed's limits, an address that is not public, a layout not stored, a capture not there, a plan the preset cannot take, a method no engine has). The stand-in's other tests import a sentence from it rather than spell one. `stand-in-params.test.ts` asks it of the stand-in on every pull request; `conformance-real.test.ts`, a `*-real` suite, asks it of the engine in `determinism.yml`. A row that needs a build in flight is the stand-in's alone, with its reason; each kind of error no row holds is named with why (`UNREACHED`). Where the stand-in answered otherwise it was made to answer as the engine does, and `stand-in-params.mutations.json` shows a changed sentence turn its row red.

## Dependencies

- Phases 1, 2 and 3 are independent in their files. R7 orders them by risk: 1 and 2 may be built in parallel; 3 lands last.
- T011 follows T008-T010's merge.
- Phase 4 follows Part 1, and T014's `panel-release` part follows issue 490.
- Phase 5 follows Phase 4.
- Phase 6 follows Phase 2, whose `*-real` glob runs its real-engine suite.

## Parallel opportunities

- T001-T002 [P] with T003-T007 (different files).
- T003, T004 and T005 touch different suites. One lane does them in order, because T004 and T005 share the seeding helper.
