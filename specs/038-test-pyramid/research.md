# Research: The test pyramid

The state of the code these decisions rest on is in the spec's "Why" and was re-checked at a3c775d on 24 Oct 2026. Each decision below is for Part 1 unless it says otherwise.

## R1. What the required checks are after the split

- **Decision:** Keep the job `ci (<os>)` on Ubuntu, macOS and Windows, and make it the fast layer: install, lint, types, units, build. Add a job `e2e (<os>)` on `macos-15` and `windows-latest` that installs, builds and runs the end-to-end suite. The required checks become `ci (ubuntu-22.04)`, `ci (macos-15)`, `ci (windows-latest)`, `e2e (macos-15)`, `e2e (windows-latest)`, `gitleaks` and `preflight`, with branches required to be up to date as today.
- **Rationale:**
  - Keeping the `ci` names means three of the five branch-protection entries do not move, and the one rename is an addition. The maintainer's answer (Q1, A) puts the long layer on the two platforms people install.
  - A separate job, rather than a step, is what lets the fast layer's result arrive in minutes and stand on its own as a check.
- **Alternatives considered:**
  - Rename everything to `fast`/`long`: more branch-protection churn for no gain.
  - One job with the e2e step gated by OS: the fast result would arrive only when the slow step ends.
  - Reusing a build artefact across jobs (upload/download): saves about two minutes a leg. It adds an artefact round trip and its failure mode (the 24 Oct `upload-artifact` hiccup on #493 is the example). Not worth it in Part 1.

## R2. A required check that has nothing to do

- **Decision:** `e2e (<os>)` always runs and always reports. Its first step decides whether the pull request touches the app (R3). If it does not, every later step is skipped by an `if:`, and the job passes with a notice: "documentation only; the end-to-end suite did not run". On a push to `main` it always runs the suite.
- **Rationale:** GitHub leaves a required check that never starts as "expected" for ever, which blocks the merge. A `paths:` filter on the workflow does exactly that, so it cannot be used for a required job. A job that runs and passes quickly can.
- **Alternatives considered:**
  - A workflow-level `paths-ignore`: blocks docs-only merges.
  - A second "stand-in" workflow with the same check name that passes on docs paths: two workflows reporting one name is fragile, and is what GitHub's own docs warn against.

## R3. What "touches the app" means

- **Decision:** It is the inverse of a short list of paths that cannot change the app's behaviour. A pull request is documentation only when **every** changed path matches one of:
  - `*.md` anywhere, `docs/**`, `specs/**`;
  - `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md`;
  - `LICENSE`, `.claude/**` (the assistant's rules and skills, read by no build).

  Anything else runs the suite. The list is computed with `git diff --name-only` between the pull request's base and its head, from a checkout with `fetch-depth: 0`, in a plain shell step. It uses no third-party action.
- **Rationale:**
  - An allowlist of what runs (src, tests, configs…) fails open when a new kind of file appears. A denylist of what may skip fails closed, which is right for a required check.
  - The workflows already pin every action by commit; a paths-filter action would be one more to pin and watch.
- **Alternatives considered:**
  - `determinism.yml`'s paths list (`src/**`, `tests/support/**`, the configs…): it is right for the determinism gate's narrower question, but too narrow for "anything the end-to-end suite could notice", since `tests/e2e/**` and `tests/fake-engine/**` are not on it.
  - `dorny/paths-filter`: a third-party action, rejected for the reason above.

## R4. Ubuntu

- **Decision:** Ubuntu keeps the fast layer (`ci (ubuntu-22.04)`), and its end-to-end leg and the `xvfb-run` step are removed from `ci.yml`. `determinism.yml` and `e2e-loop.yml` keep Ubuntu as an option.
- **Rationale:** The maintainer's answer (Q1, A). Linux is not a shipped platform, and its leg was the cheapest of the three but still about 18 minutes of runner time per pull request.

## R5. The real-engine suites in `determinism.yml` (FR-002)

- **Decision:**
  - (a) `protocol-real`, `feeds-real`, `layout-real`, `opening-real` and `sidecar-real` take their interpreter as `determinism-real` does: `LEGIBLE_ENGINE_PYTHON` first, then `LEGIBLE_ENGINE_CHECKOUT`'s `.venv`, by passing `enginePython` from the environment into `resolveInterpreter` instead of `null`.
  - (b) Where a suite needs a stored layout or a feed and today finds them in a developer's engine checkout, it gains a second source: a temporary `SCHEMATIC_HOME` seeded from the committed BART fixture (`tests/fixtures/determinism/bart/data/`). It is used when no checkout supplies one.
  - (c) `viewer-real` reads a page from a checkout's `out/` where a checkout is named and holds one carrying the seam, and otherwise draws its page by a `map.build` from that seeded home, which is what the runner does.
  - (d) `determinism.yml` runs `npx vitest run tests/unit/*-real.test.ts` in place of the one file, with `LEGIBLE_DETERMINISM_TEST=1` and the `LEGIBLE_ENGINE_PYTHON` it already exports.
  - A suite whose assertions are about LA Metro specifically, such as `layout-real`'s cached LA graph, keeps them for a developer's checkout, and gains BART equivalents for CI. It never skips in CI.
- **Rationale:**
  - The runner has the pinned engine pip-installed and the BART fixture committed. It has no engine checkout and must not download agency feeds, which is the rule the determinism gate already lives by.
  - `determinism-real` proves the fixture's layout id is the one the pinned engine addresses, so the fixture is a valid stored layout for that engine.
- **Alternatives considered:**
  - Run the engine's pipeline on LA in CI to make a cache: it downloads a 100 MB feed and needs LOOM, which is minutes and a network dependency.
  - Keep the suites checkout-only: SC-004 would not hold.
- **Note:** lane 465's gated template test in `viewer-real` (which holds `PAGE_SEAMS` to the engine's `page.html`) needs the template's source. Under a pip-installed engine that is `schematic/page/page.html` inside the installed package, found through the interpreter. Resolve it that way, so the gate runs in CI too.

## R6. The four unchecked shapes (FR-001)

- **Decision:** Add `answerProblems` checks for `engine.info`, `engine.shutdown`, `feeds.inspect` and `feeds.service` to `stand-in-shapes.test.ts`, each against the schema's result type. Issue 473 (merged in this wave) holds their **params**; this holds their **answers**.
- **Rationale:** Same harness, same schema file; the cheapest way to make SC-003's "by shape" true for all 15.

## R7. Order of the Part 1 work

- **Decision:** One pull request per FR, in this order:
  - FR-001 (shapes), which is small and needs no CI change;
  - FR-002 (the real suites in `determinism.yml`), which is not required, so it can land and be watched;
  - FR-003 (the CI split), last, with the branch-protection change made by the coordinator in the same hour as its merge.
- **Rationale:** FR-003 is the only one that changes what blocks a merge, and it should land when the other two have shown their runs green.

## Part 2 and Part 3 (outline; may follow 1.0)

- **The DOM layer** (FR-004 to FR-007): a `/spike` with its report as an ADR, comparing:
  - the hand-built container pattern (five files today);
  - jsdom and happy-dom, as `devDependencies`, with their licences in the notices;
  - Vitest's browser mode.

  The cases are R7-02's hold, a debounce and a focus hand-back. It is judged on what each can fail on, the unit suite's time, and what it adds. The source-regex sites are then replaced file by file, `panel-release.test.ts` with spec 037's issue 490.
- **The mutation job** (FR-008): a machine-readable entry beside each test (file, search, replacement, the test that must fail). A dispatch-only workflow applies each to a clean checkout, runs the named test, and fails on any that stays green. The form is decided when the DOM layer has settled what most lists say.
