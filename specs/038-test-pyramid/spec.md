# Feature Specification: The test pyramid

**Feature Branch**: `427-test-pyramid`

**Created**: 2026-10-24

**Status**: Partly implemented. Part 1 is built: FR-001 (#503, 2026-10-24), FR-002 (#504, 2026-10-24) and FR-003 (#506, 2026-10-25). Part 2 (the DOM layer) is built but for FR-006: FR-004 is decided by ADR-059 (#591, 2026-10-26; accepted in #604: jsdom by default, Vitest's browser mode in Chromium for the kit's tests); FR-005 was met before the spike by `cheap-edit.test.tsx` and is kept, now in jsdom with a real press; FR-006 is begun and not met: #591 converted `cheap-edit.test.tsx` and `announcer-region.test.tsx` to jsdom through `tests/support/render.tsx` and added the first browser test (`export-run-handback.browser.test.tsx`) and a render count (`cell-renders.test.tsx`), and issue 490 retired `panel-release.test.ts`'s source guards, but as of 2026-10-29 `colours.test.ts`, `export-choice.test.ts`, `layout-as-it-solves.test.ts` and `rail.test.tsx` still hold a component's wiring by a match over its source with no reason why a rendered test cannot; FR-007 is built (2026-10-29): `tests/support/conformance.ts` holds every refusal sentence once, read by `stand-in-params.test.ts` against the stand-in and by `conformance-real.test.ts` against the pinned engine, which `determinism.yml` runs with the other `*-real` suites. Part 3 is built: FR-008 (#601, 2026-10-27), `scripts/mutations.mjs` and the dispatch-only `mutations.yml`. Issue 427 stays open on FR-006.

**Input**: Issue 427, "Spec: the test pyramid (DOM layer, conformance, CI split)", from the codebase review of 15 Oct 2026 (findings R7-01, R7-02, R7-04, R7-05, R4-05, R8-01). The review read 667b48c. Every claim below about the code as it stands was re-checked at a3c775d on 24 Oct 2026. Where the review has been overtaken, as #441 overtook it on the CI step's name, timeout and concurrency, this spec says so.

## Why

The tests are good at the top and thin in the middle, and the middle is where most faults live.

- **The unit layer has no DOM.**
  - `vitest.config.ts` runs in `node`. No jsdom, happy-dom or Testing Library is installed.
  - Of 155 unit files, 25 render to a string with `renderToStaticMarkup`, where no effect runs. Five hand-build a stand-in document under React's real client (`announcer-region.test.tsx` is the template). One walks an element tree.
  - Every press, focus move and debounce is therefore tested end to end or by a hand model of Chromium.
- **Where a rendered test was too hard, tests read the source.**
  - There are 34 `it` sites in 10 files, about 56 tests at run time, that `readFileSync` a component and match it with a regular expression. The review counted 26.
  - They guard wiring: that `mustWait` is called, that `settling` is passed, that a panel flushes or cancels on unmount.
  - A source match passes over code that is never reached. R7-02 is the proof: the line order's hold while a record is read back (`LineOrder.tsx:167, 301`) is guarded only by `source.includes`. No unit or end-to-end test fails with it switched off, and no unit test renders `LineOrder`, `StyleFields` or `LineColours`.
- **The stand-in engine is held to the real one only by its answers' shapes.**
  - `stand-in-shapes.test.ts` checks 11 of the schema's 15 methods. `engine.info`, `engine.shutdown`, `feeds.inspect` and `feeds.service` are unchecked.
  - Its refusal sentences are written twice, once in the stand-in and once in the test.
  - The suites that drive the real engine (`protocol-real`, `feeds-real`, `layout-real`, `opening-real`, `sidecar-real`, `viewer-real`) run in no workflow. Only `determinism-real` runs, in `determinism.yml`.
  - Five of them hard-code `enginePython: null`, so they cannot be pointed at a vendored engine the way `determinism-real` can.
- **Every pull request runs everything, everywhere.**
  - `ci.yml` runs lint, types, units, build and all 303 end-to-end tests on Ubuntu, macOS and Windows for every pull request and every push, with no paths filter.
  - The required checks are the three `ci` legs, `gitleaks` and `preflight`, and branches must be up to date.
  - On 24 Oct the end-to-end step took 17-19 minutes on Ubuntu, 19-21 on Windows and 27-35 on macOS. `main`'s merges are serial behind the slowest leg.
  - #441 has since named the step truthfully and added `timeout-minutes` and a per-ref `concurrency`. The split into a fast and a long layer, and the Ubuntu end-to-end leg, are still as the review found them.
- **The mutation lists are prose.**
  - Specs and tests carry about 266 "Mutation" notes, and five e2e spec headers have lists written for "the coordinator".
  - Nothing runs them, so a test whose mutation no longer turns it red is not noticed.

## User Scenarios & Testing *(mandatory)*

The people here are contributors and the maintainer. What they get is a test that fails when the thing it covers breaks, and a merge that does not wait half an hour for what a faster layer could have said.

### User Story 1 - The middle of the pyramid exists (Priority: P1)

As a contributor changing a panel's press, focus or debounce, I want a unit test that renders the real component, presses it and reads what happened. I want that test, not a regular expression over the source and not a 40-second end-to-end launch, to fail when I break it.

**Why this priority**: R7-02 shows a guard nothing can fail. Every source-regex test is a place where the same can be true.

**Independent Test**: R7-02's case first. A rendered unit test of `LineOrder` holds a move while the record is read back. With `settling` switched off it goes red. Today nothing does.

**Acceptance Scenarios**:

1. **Given** the DOM layer the spike chooses (FR-004), **When** a unit test renders `LineOrder` with a run just ended and the record being read back, and a move is made, **Then** the move is held until the read-back lands, and the test fails with the hold removed.
2. **Given** the DOM layer, **Then** each of the 34 source-regex sites is replaced by a rendered test of the behaviour it guards, or is kept with a one-line reason. Of those kept, CSS, token and literal readers are a different and legitimate group (research-427.md section 2).
3. **Given** the replaced tests, **Then** each is shown red under the mutation its source match stood for.
4. **Given** a kit element's focus ring and geometry, **Then** those stay end to end. A DOM layer computes no layout, and the kit's tests in `design.spec.ts`, `notebook-a11y.spec.ts` and `accessibility.spec.ts` are where they belong.

---

### User Story 2 - The stand-in cannot drift from the engine unnoticed (Priority: P1)

As a contributor relying on the stand-in for the end-to-end suite, I want every method it answers to be held to the real engine. That means the shape of what it answers, what it refuses, and the sentences it refuses with. A change on either side should then fail a test rather than pass every e2e test and break against the real engine.

**Why this priority**: issue 473 (this wave) was the stand-in accepting nulls v0.19.0 refuses. Shapes alone could not catch it.

**Independent Test**: one conformance table, from method to params to the expected answer or refusal (code, kind, sentence), run against the stand-in on every pull request and against the real pinned engine in `determinism.yml`. Change one sentence in the stand-in and the table fails.

**Acceptance Scenarios**:

1. **Given** the shape checks, **Then** they cover all 15 methods, including the four unchecked today.
2. **Given** the conformance table, **When** it runs against the stand-in in `ci` and against the pinned engine in `determinism.yml`, **Then** both pass, and the refusal sentences live in the table once, not in the stand-in and a test separately.
3. **Given** the six `*-real` suites and `viewer-real`, **Then** they run in `determinism.yml` against its vendored engine. The five that hard-code `enginePython: null` take `LEGIBLE_ENGINE_PYTHON` as `determinism-real` does. `layout-real` and `viewer-real` get the cached layout and the page they need from a step that makes them, rather than skipping.

---

### User Story 3 - A merge waits only for what it must (Priority: P2)

As the maintainer merging a queue of pull requests one after another, I want the required check to be the fast layer, with the long layer where it earns its time. Then a documentation change does not wait 35 minutes on macOS, and a change to the app still gets the end-to-end suite where it matters.

**Why this priority**: the review's "hard cost": seven to ten merges is a day of waiting. It matters less than P1, because it changes what runs, not what is tested.

**Independent Test**: a documentation-only pull request is mergeable after the fast layer alone. A pull request touching `src/` gets the long layer per Q1.

**Acceptance Scenarios**:

1. **Given** any pull request, **Then** the fast layer runs on three platforms and is required: lint, types, units (with the DOM layer and the stand-in conformance) and build.
2. **Given** a pull request that touches what the app is made of (the same paths `determinism.yml` already filters on), **Then** the long layer, the end-to-end suite, runs on macOS and Windows and is required on both. Ubuntu runs the fast layer only.
3. **Given** a documentation-only pull request, **Then** the long layer does not run, and the required checks still report, so branch protection is satisfied.
4. **Given** a push to `main`, **Then** both layers run on every platform the long layer covers, so `main` is never less tested than a pull request.

---

### User Story 4 - A mutation that no longer bites is noticed (Priority: P3)

As the maintainer, I want the mutations the specs and tests list to be run by a job I can dispatch. Each one should be applied, its test run, and red expected. A test that has gone vacuous should then show up without someone remembering to try it.

**Why this priority**: valuable, but it follows the DOM layer, which changes what most of the lists say.

**Independent Test**: dispatch the job on `main`. It applies each listed mutation in turn, runs the named test, and reports each one that stayed green.

**Acceptance Scenarios**:

1. **Given** a mutation written in the agreed form (a file, a search, a replacement, the test it should fail), **When** the job runs, **Then** it reports red or green for each, and fails if any stayed green.
2. **Given** the existing lists, **Then** the ones the job can run are rewritten in that form. The rest stay as prose with a reason.

### Edge Cases

- **A required check that does not run** (a paths filter skipping it) leaves branch protection waiting for ever. Every required check reports on every pull request, even when it has nothing to do, for instance by a job that runs and passes with "nothing to test".
- **`determinism.yml`'s new real-engine suites fail on a platform** where `determinism-real` passes: they report like `determinism-real`, not required, and the failure says which suite.
- **A source-regex test whose behaviour cannot be rendered** (a guard on the main process's source, or a security rule such as "no `allow-same-origin` in `StageView.tsx`") stays a source test with its reason. A security rule read from the source is a fair test of a rule about the source.
- **The DOM layer changes timing:** a rendered test with real timers and debounces uses fake timers or the hand-built frame driver the `TripSummary` and announcer tests use, never a wall-clock wait.
- **Flake history:** the e2e tests registered as flaky (#327, #330, #464 closed on loop runs; #481 this wave) keep their loop workflow. Moving them between layers does not close anything.

## Requirements *(mandatory)*

### Functional Requirements

**Part 1, mechanical (before 1.0)**

- **FR-001**: The shape checks MUST cover `engine.info`, `engine.shutdown`, `feeds.inspect` and `feeds.service`.
- **FR-002**: The five `*-real` suites that hard-code `enginePython: null` MUST honour `LEGIBLE_ENGINE_PYTHON` as `determinism-real` does. `determinism.yml` MUST run all seven real suites against its vendored engine on its three platforms. The suites make the stored layout `layout-real` needs and the page `viewer-real` needs themselves, from the committed BART fixture, where no engine checkout supplies them (research R5).
- **FR-003**: `ci.yml` MUST be split into a fast layer and a long layer, as User Story 3 says:
  - the fast layer runs on Ubuntu, macOS and Windows and is required;
  - the long layer, the end-to-end suite, runs on macOS and Windows and is required there, for a pull request that touches the app;
  - Ubuntu's end-to-end leg is dropped;
  - a push to `main` runs both layers on macOS and Windows.

  The required checks are renamed to match, and `docs/repository-settings.md` and branch protection move with them. "The smoke test" in `docs/ARCHITECTURE.md`'s "Checks" is corrected. *As of 24 Oct 2026:* the maintainer chose macOS and Windows (Q1, A).

**Part 2, the DOM layer (may follow 1.0)**

- **FR-004**: A timeboxed spike (`/spike`, its report a decision record) MUST choose the DOM layer, comparing:
  - the hand-built container pattern already in five files;
  - jsdom;
  - happy-dom;
  - Vitest's browser mode.

  It judges them on R7-02's case and two others (a debounce, a focus hand-back), on the time the unit suite takes, and on the licence and size of what is added. A dependency it adds is a `devDependency`, listed in `THIRD_PARTY_NOTICES.md`.
- **FR-005**: R7-02's case MUST be the first rendered test, shown red with `settling` off.
- **FR-006**: Each of the 34 source-regex sites MUST be replaced by a rendered test or kept with a one-line reason, one file per pull request or in small groups. `panel-release.test.ts` (12 sites) is the largest. Its wiring is what spec 037's hook replaces, so it is re-aimed with that work and not done twice.
- **FR-007**: The conformance table (User Story 2) MUST hold every refusal sentence once, read by the stand-in's test and by a real-engine suite. Issue 473's schema-driven refusals (this wave) are its first rows.

**Part 3, the mutation job (after the DOM layer)**

- **FR-008**: A dispatch-only workflow MUST run the mutations written in the agreed form and fail on any that stays green. The form is defined in the plan; it is machine-readable and lives beside the test.

**Throughout**

- **FR-009**: The end-to-end suite MUST lose no test in the split. A test moved to the unit layer is removed from e2e only when its rendered replacement has been shown red under the same mutation, and the pull request names both.
- **FR-010**: Issue 436's sweeps, which follow this spec, MUST land in the layer this spec puts them in: the disclosures' names and Tab order in the DOM layer where it can see them, and the focus ring's measured width and contrast end to end.

### Key Entities

- **Fast layer**: lint, types, units (including the DOM layer and stand-in conformance) and build. Minutes, every platform, required.
- **Long layer**: the end-to-end suite, launching the built app against the stand-in.
- **Real layer**: the `*-real` suites, `determinism.spec.ts` and `typeface.spec.ts` against the pinned engine, in `determinism.yml`.
- **Conformance table**: method, params, and the expected answer or refusal (code, kind, sentence), run against the stand-in and the real engine.
- **Mutation entry**: a file, a change, and the test that must fail under it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A documentation-only pull request is mergeable in under 10 minutes from its push. Today it is about 35 minutes, bound by macOS's end-to-end step.
- **SC-002**: A pull request touching the app has its required checks done in no more than today's time, bound by macOS's end-to-end leg. The runner minutes per such pull request fall by about a third, with Ubuntu's leg gone.
- **SC-003**: All 15 protocol methods are held by shape and by conformance. Today 11 are, by shape only.
- **SC-004**: All seven real suites run in a workflow on three platforms. Today one does.
- **SC-005**: R7-02's hold has a test that fails with it removed. Every remaining source-regex site has a written reason, and no behavioural guard is left as a source match.
- **SC-006**: The end-to-end suite has at most as many tests as today (303) once Part 2 is done, and each test removed has a named rendered replacement.

## Clarifications

### Session 2026-10-24

- Q: Where does the end-to-end suite run on a pull request? → A: Required on macOS and Windows, not run on Ubuntu (A). FR-003, User Story 3.

The question as it was put, kept for the reasoning:

### Q1: Where the end-to-end suite runs on a pull request

Today it runs on all three platforms and is required on all three. The installers are macOS and Windows; Linux is CI's only.

| Option | Answer | Implications |
|---|---|---|
| A | **Required on macOS and Windows; not run on Ubuntu** (recommended) | It runs on the two platforms people install. That cuts a third of the minutes, but macOS still sets the wait (about 30 min for an app change). Docs-only PRs skip it (SC-001). |
| B | **Required on Windows only; macOS and Ubuntu on pushes to `main` and nightly** | An app change waits about 22 minutes. A macOS-only fault is found after merge, on `main`. |
| C | **Required on all three, as today, with only the docs-only skip** | The safest and the slowest. Only SC-001 improves. |

## Assumptions

- Part 1 is what the path to 1.0 calls M4's mechanical half, and is built before `v1.0.0-rc.1`. Parts 2 and 3 may follow 1.0.
- The loop workflow (`e2e-loop.yml`) and the determinism gate keep their roles. Nothing here weakens the evidence a release is cut on.
- No test framework replaces Playwright or Vitest.
- Spec 037 (the record session) re-aims `panel-release.test.ts` and the other mechanism tests. This spec does not touch them twice.
- The constitution's workflow holds: the spike in Part 2 ends in a decision record.
