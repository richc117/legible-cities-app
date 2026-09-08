# Tasks: The layout run

**Input**: Design documents from `specs/007-layout-run/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/bridge.md, contracts/run.md, quickstart.md

**Tests**: wanted (spec FR-015, SC-001 to SC-007).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Write `src/shared/layout.ts`: the eight stage names in order with the comment that they mirror the engine's pipeline at protocol 1 and are asserted against it by a gated test, the `LayoutStageState` and `RunState` unions, the `LayoutDone` and `LayoutResult` shapes from contracts/bridge.md, and `isLayoutId` (64 lower-case hexadecimal characters)

---

## Phase 2: Foundational

**Blocking: the identifier is what every later phase writes or reads.**

- [x] T002 Write `src/main/layout.ts`: `layoutIdentity(paths, engineHome)` which refuses unless there are exactly four paths, each absolute, each an existing regular file whose real path lies under the engine's home (the containment check `src/main/protocol.ts` already uses), then hashes each file's byte length and its bytes in order into one SHA-256 and returns the hex digest. Every refusal is a sentence, never a path
- [x] T003 [P] Write `tests/unit/layout-identity.test.ts`: the digest is stable for the same bytes and changes when any file changes; length-prefixing means two different splits of the same bytes differ; refuses three paths, five paths, a relative path, a path outside the home, a symbolic link pointing outside, a directory, a missing file; no refusal message contains a path separator
- [x] T004 Extend `src/main/projects.ts` with `completeLayout(id, done)` per contracts/bridge.md: validate the date and the paths, derive the identifier, write `layout`, `date` and `modified` in one atomic replacement, keep a date the project already has, and answer with the record and whether the identifier changed
- [x] T005 [P] Extend `tests/unit/projects-store.test.ts`: a completed run writes all three fields together; a project that already has a date keeps it; a second run with the same layout reports `changed: false` and with different bytes reports `changed: true`; a refused write leaves the record byte-identical

**Checkpoint**: the identifier exists and is proven; nothing draws yet.

---

## Phase 3: User Story 1 - A map comes out (P1)

- [x] T006 [US1] Add `completeLayout` to `src/shared/api.ts`, the preload bridge and `src/main/ipc.ts`, with the top-frame check every handler has; extend `tests/unit/ipc.test.ts`'s channel count
- [x] T007 [US1] Write `src/renderer/src/engine/useLayoutRun.ts`: the state machine of contracts/run.md over the typed client. Refuse when the engine is not ready or a run is in flight; resolve the service day once; `graph.build` then `map.build`; map each progress report to the stage it names per data-model.md's progress rule, ignoring a repeat for a stage already done; cancel; then the bridge call. It holds no path beyond passing the engine's answer through
- [x] T008 [US1] Write `tests/unit/layout-run.test.ts` against a stub client and a stub bridge: the two calls in order with the right parameters; a report marks its own stage done and the next running; the map call's repeat of the first four is ignored; the sentence shown is always the last completed stage's; cancel leaves nothing written; a failure marks the running stage failed and keeps the engine's hint; a second run while one is in flight is refused
- [x] T009 [US1] Write `src/renderer/src/LayoutRun.tsx`: the progress line, the last completed stage's sentence, a cancel text button beside it, the failure's hint in the error colour, all from the tokens and the kit; and its rules in `app.css` if any are new
- [x] T010 [US1] Wire it into `src/renderer/src/ProjectView.tsx`: a "Lay out" button for a project with no layout, the run while it runs, and the stored identifier (shortened) and service day when there is one

---

## Phase 4: User Story 2 - The project remembers (P1)

- [x] T011 [US2] Make the run's completion report whether the layout changed, and show the sentence for it; confirm by doing that two projects on one feed record the same identifier
- [x] T012 [US2] Write `tests/e2e/layout.spec.ts` against the stand-in engine: pressing the button runs, the stages appear, the record gains a layout and a date, a second press is not offered, and cancelling leaves the record untouched

---

## Phase 5: User Story 3 - Nothing is left behind (P2)

- [x] T013 [US3] Extend `tests/e2e/layout.spec.ts`: quitting during a run leaves no engine process and an unchanged record; a run refused because the engine is unavailable writes nothing and says why
- [x] T014 [US3] Add the gated half of `tests/e2e/layout.spec.ts` or a gated unit test against the **real** engine: lay a project out for real, assert the eight stage names in order (the coupling data-model.md names), assert the page is on disk where the origin serves it, and assert the identifier is 64 hexadecimal characters and reproducible; skip, saying why, with no checkout

---

## Phase 6: Polish

- [x] T015 Update `docs/ARCHITECTURE.md`: the layout run, the identifier and why it is the app's, the gap against principle III that the engine closes in E04, and the project record's two newly written fields
- [x] T016 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `bin/preflight`, `gitleaks dir .`; then the `reviewer` subagent over the branch; fix what it finds
- [x] T017 Walk quickstart.md end to end, including the cancel and the changed-layout steps, record what was checked by hand, and open the pull request (closing keyword in the body only)

---

## Dependencies

Phase 2 blocks everything. US1 needs T002 and T004. US2 needs T007. US3
needs T012. Phase 6 last. T003 and T005 are parallel with each other.

## Implementation strategy

Phases 2 and 3 are the feature: a map comes out and the project remembers
what it came from. Phases 4 and 5 are what makes the promise trustworthy
rather than merely made.

The thing to resist is adding a re-layout button because the issue asks for
one. It is cut for a reason the research reproduced by running it, and
shipping it would ship a way to destroy a project's layout by cancelling.

## As landed

**The issue draft could not be built as written, and this is where that was
found.** Five parallel readings of the engine, the app, the governance
documents, the feasibility and the interface, with their surprising claims
handed to independent agents told to refute them, established four things:
there is no hashed layout directory, the map build re-runs the layout
without being asked, forcing a rebuild corrupts a layout when it is
cancelled, and no project has a service day nor any way to get one. Two were
reproduced by running rather than read. `research.md` records them and
ADR-027 records the decision they forced.

**Three things landed differently from this list.** The run is a plain class
rather than a React hook, because the repository's own renderer rules say
logic belongs in something callable without rendering, and a React testing
library would have been a new dependency for no gain. The run is held per
project outside the view, with one engine client for the whole renderer,
because a person can leave a project while it runs. And a project that has a
layout is offered "Lay out again", which re-runs without forcing: safe,
useful, and the only way the changed-layout sentence can be reached at all.

**Checked by hand, on macOS 15 arm64**, following quickstart.md. A warm
layout of Los Angeles takes 0.8 s and writes the page where the origin
serves it; two projects on one feed record the same identifier; a cold run
cancelled during the first stage leaves the record untouched, writes no
stage files, can be run again, and leaves no process after quitting.

**What the review pass changed.** The reviewer found seven things, four of
them real defects that tests had missed. The worst was mine twice over: the
run replaced any progress message containing a slash, which threw away the
engine's most informative sentence ("matched 114/114 stops") on every run,
and the test I wrote used a truncated version of that sentence, so it
passed. The rule now keys on the write stage, which is the only one that
reports a path, and the tests use the engine's real sentences. Cancelling
was a no-op in two windows, between the two requests and while the record
was being written, so a cancelled run could still write; a run-level flag
now holds. Leaving a project mid-run and returning made a second run for the
same project writing the same folder, and leaked two bridge subscriptions
each time; runs are now held per project with one shared client. A
filesystem failure inside the identifier put an absolute path on screen, and
so did the engine's own hint for an input or output failure, which the main
process now strips as the error crosses. The rest were documentation
claims corrected to what the code does, a stand-in whose diagnostics had the
wrong shape, and three deferrals with no decision record, which is ADR-027.
