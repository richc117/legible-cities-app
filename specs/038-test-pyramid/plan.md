# Implementation Plan: The test pyramid

**Branch**: `427-test-pyramid` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/038-test-pyramid/spec.md`

## Summary

Part 1, built before 1.0, is mechanical:
- the four protocol methods the stand-in's shapes do not yet check (FR-001);
- the seven real-engine suites run in `determinism.yml` against its vendored engine, using the committed BART fixture rather than a developer's checkout (FR-002);
- `ci.yml` split into a fast layer on three platforms and an end-to-end layer on macOS and Windows. Both are required; the e2e job always reports and skips its suite for a documentation-only pull request (FR-003).

Part 2 (a spiked DOM layer, then the source-regex sites replaced) and Part 3 (a mutation job) are outlined here and planned when they start. They may follow 1.0.

## Technical Context

**Language/Version**: TypeScript 5 (Node 22 in CI); Python 3.12 for the stand-in engine; GitHub Actions YAML.

**Primary Dependencies**: Vitest and Playwright, as today. No new dependency in Part 1. Part 2's spike may add jsdom or happy-dom as a `devDependency`.

**Storage**: N/A. A temporary `SCHEMATIC_HOME` is seeded from `tests/fixtures/determinism/bart/data/` for the real suites.

**Testing**: the unit suite (`npm test`), the real suites (`tests/unit/*-real.test.ts`), the end-to-end suite (`npm run test:e2e`), and the workflows' own runs as the test of the CI change (quickstart.md).

**Target Platform**: GitHub-hosted runners: ubuntu-22.04, macos-15, windows-latest.

**Project Type**: desktop app (Electron); this feature touches only tests and CI.

**Performance Goals**: a documentation-only pull request mergeable in under 10 minutes (SC-001); an app pull request no slower than today (SC-002).

**Constraints**:
- every required check must report on every pull request;
- no third-party action beyond those already pinned;
- no network beyond the engine install `determinism.yml` already does: no agency feed downloads.

**Scale/Scope**: `ci.yml` (one workflow), `determinism.yml` (one step), seven real suites, one shape test file, `docs/repository-settings.md`, `docs/ARCHITECTURE.md`'s "Checks", and branch protection.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan meets it |
|---|---|
| I. One renderer | Nothing draws. `viewer-real` draws its page through the engine's `map.build`. |
| II. The engine is the source of truth | The real suites run against the pinned engine itself. The conformance (Part 2) holds the stand-in to it. |
| III. Determinism | The determinism gate is untouched; its workflow gains suites, and its export comparison is unchanged. |
| IV. No network without a reason | No new outbound call. The BART fixture replaces any feed download (R5). |
| V. Hygiene by tools | Required checks are only added. `gitleaks` and `preflight` stay required, and every action stays pinned by commit. |
| VI. Accessible by default | The accessibility sweeps stay end to end and required on the two shipped platforms. Issue 436 lands after this, in the layer this spec puts it (FR-010). |
| VII. Decisions recorded | Part 2's spike ends in an ADR. Part 1's choices are in research.md. |

**Result:** pass, with no violations. Re-checked after design: pass.

## Project Structure

### Documentation (this feature)

```text
specs/038-test-pyramid/
├── spec.md
├── plan.md              # this file
├── research.md          # R1-R7, and Parts 2-3 in outline
├── data-model.md        # the e2e job's decision, the conformance row, the mutation entry
├── quickstart.md        # how to prove Part 1
├── contracts/
│   └── ci-layers.md     # the jobs, the required checks, branch protection
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/
├── ci.yml               # FR-003: the fast `ci (<os>)` job and the new `e2e (<os>)` job
└── determinism.yml      # FR-002: the unit step runs tests/unit/*-real.test.ts

tests/unit/
├── stand-in-shapes.test.ts     # FR-001: engine.info, engine.shutdown, feeds.inspect, feeds.service
├── protocol-real.test.ts       # FR-002 (a): LEGIBLE_ENGINE_PYTHON
├── feeds-real.test.ts          # FR-002 (a), (b): the BART fixture's feed
├── layout-real.test.ts         # FR-002 (a), (b): the BART fixture's stored layout
├── opening-real.test.ts        # FR-002 (a)
├── sidecar-real.test.ts        # FR-002 (a)
├── viewer-real.test.ts         # FR-002 (c): a page drawn from the fixture; the template gate's source
└── determinism-real.test.ts    # unchanged

tests/support/
└── realEngine.ts (new, if shared)   # resolving the interpreter and seeding a home from the fixture, once

docs/
├── repository-settings.md      # the seven required checks
└── ARCHITECTURE.md             # "The smoke test", in "Checks", corrected
```

**Structure Decision**: tests and workflows only. A shared helper in `tests/support/` is made only if three or more real suites would otherwise repeat the interpreter resolution and the fixture seeding.

## Phase 0: Research

See [research.md](research.md). Every unknown is decided there:
- R1: the required checks' shape;
- R2: a required check with nothing to do;
- R3: what counts as documentation only;
- R4: Ubuntu;
- R5: how the real suites run without a checkout;
- R6: the four shapes;
- R7: the order of the three pull requests.

## Phase 1: Design

- [contracts/ci-layers.md](contracts/ci-layers.md): the jobs and the checks.
- [data-model.md](data-model.md): the e2e job's decision.
- [quickstart.md](quickstart.md): how each part is proven.

## Delivery

Three pull requests, in R7's order. Each is its own lane under issue 427, or under issues filed for them:
1. **FR-001**, the four shapes. Sonnet; small.
2. **FR-002**, the real suites. Sonnet or Opus; it reads seven suites and changes how two of them find their inputs.
3. **FR-003**, the CI split. The coordinator writes it, because it is a workflow and a branch-protection change together, made by the maintainer's decision of 24 Oct 2026.

Part 2 and Part 3 are planned again when they start (`/speckit-plan` on this spec, extended).

## Complexity Tracking

None.
