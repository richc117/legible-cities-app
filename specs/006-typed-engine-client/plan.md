# Implementation Plan: Typed engine client

**Branch**: `A1-02-typed-protocol-client` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-typed-engine-client/spec.md`

## Summary

Bring the engine's own description of its protocol into the app as
committed data, generate types from it, and put those types behind a client
so that a method name, its parameters and its result are checked when the
app is built rather than when a person clicks something. Two checks keep
the copy honest: a fingerprint that runs everywhere, and a comparison
against a live engine that runs where a checkout exists and reports itself
skipped where none does. The vendoring workflow's engine placeholder is
replaced by the pin, which ticks one of A0-06's three boxes. That issue
stays open: its other two want the engine's tag published and the job green
on darwin-x64 and win-x64, neither of which this feature can do.

The approach is deliberately small: no new runtime dependency, no change to
the bridge A1-01 built, and no interface. The generator is short because the
description uses a closed set of sixteen JSON Schema keywords, ten of which
shape a type (research §2), and writing it avoids making the generated file
depend on a formatter's version, which a library would.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22 or newer (the generator, run through Node's type stripping), Python 3.12 in the engine checkout (read only, for its description)

**Primary Dependencies**: none added. The generator is hand-written; `json-schema-to-typescript` was measured and rejected (research §2)

**Storage**: nothing at run time. Three committed files: the description, its fingerprint in the existing pin, and the generated module

**Testing**: Vitest. Three tests that need no engine (fingerprint, reproducibility, coverage of the description), one drift test and one contract test gated on a checkout, and unit tests for the client against a stub bridge

**Target Platform**: the app's renderer, all three desktop platforms; the generator runs on a developer's machine only

**Project Type**: desktop app, existing structure

**Performance Goals**: none. The generator runs by hand; the client adds one map lookup per notification

**Constraints**: the generated file must be byte-identical on every machine; the renderer must not import from `src/main`; CI has no engine and no Python

**Scale/Scope**: four methods and three notifications today, seventeen definitions; the app names none of them, so the count follows the engine

## Constitution Check

_GATE: checked before Phase 0 and again after Phase 1. Both passes are recorded._

| Principle                             | Verdict                             | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. One renderer                       | Not engaged                         | Nothing here draws. No SVG, no canvas, no geometry.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| II. The engine is the source of truth | **This feature is the principle**   | The protocol's types are generated from the engine's own description, never written by hand; the description is obtained from the engine at the pinned tag; a change on the engine's side is a build error here. FR-001 to FR-005 are this principle made testable. The client diverges from the description nowhere: the one divergence this plan expected, the map's service day, turned out to be already required by the description (research §4), so the client is a projection with no exception. |
| III. Determinism is a feature         | Engaged, and satisfied              | Not about capture here but about the build: the same description must produce the same file on every machine (FR-003, SC-006). That is why the description is stored verbatim and why the library that would have made the output depend on a Prettier version was rejected.                                                                                                                                                                                                                             |
| IV. No network without a reason       | Satisfied                           | The client makes no connection. The vendoring workflow fetches the pinned engine when it runs, which is the reason and it is in the pin. No telemetry, no update check.                                                                                                                                                                                                                                                                                                                                  |
| V. Hygiene enforced by tools          | Satisfied                           | The generator writes no path into any committed file; the header names the pinned tag, which is data. `bin/preflight` and `gitleaks` run as always. The description's contents are the engine's, already public.                                                                                                                                                                                                                                                                                         |
| VI. Accessible by default             | **Not applicable, and not claimed** | This feature adds no interface: no screen, no control, no announcement. Saying it is accessible would be saying nothing. The first screens over this client are A1-03 and A3-01, and each carries the line itself.                                                                                                                                                                                                                                                                                       |
| VII. Spikes end in a record           | Satisfied                           | No spike. Two decisions worth a reader's time are in research §2 (why no library) and §4 (the one divergence); neither reverses an ADR, so neither needs a new record. The engine-side fix for §4 is noted for the engine's board.                                                                                                                                                                                                                                                                       |

**Result: pass, both before and after design.** No violation, so the
Complexity Tracking table is omitted rather than left empty.

One note for the reviewer rather than a gate: FR-015 and SC-003 deliberately
do not claim that `graph.build` and `map.build` are run. They are proven at
their refusals, which is what a machine without the layout tools can reach
(research §7). A plan that claimed otherwise would be describing a test
nobody can write.

## Project Structure

### Documentation (this feature)

```text
specs/006-typed-engine-client/
├── plan.md              # this file
├── spec.md
├── research.md          # Phase 0: the eight decisions and what was measured
├── data-model.md        # Phase 1: the three artefacts, the module, the client
├── quickstart.md        # Phase 1: how to see the boundary being checked
├── contracts/
│   ├── client.md        # what app code may rely on
│   └── generation.md    # the command, its guarantees, the three checks
└── checklists/
    └── requirements.md
```

### Source code

```text
scripts/
└── protocol.ts               # new: the generator; reads the engine, writes three files

src/shared/
├── protocol.ts               # new, generated, committed: the types
├── engine.ts                 # edited: JobProgress, JobLog, ErrorData derived from the generated ones
└── api.ts                    # edited: the comment saying A1-02 will type this, now that it has

src/renderer/src/engine/
└── client.ts                 # new: EngineClient and the request handle

vendor/
├── protocol.schema.json      # new, committed: the engine's description, verbatim
└── pins.json                 # edited: engine.schema_sha256

tests/unit/
├── protocol-generate.test.ts # new: reproducibility, coverage, the emitter's refusals
├── engine-client.test.ts     # new: routing, cancellation, release, against a stub bridge
├── protocol-real.test.ts     # new, gated: the contract tests and the drift check
└── pins.test.ts              # edited: the fingerprint check

.github/workflows/
└── vendor.yml                # edited: the python job checks out the pinned engine
```

**Structure Decision**: the existing layout, unchanged. The generated types
are `shared` because both the preload's contract and the renderer's client
refer to them; the client is `renderer` because it speaks through
`window.api.engine` and the renderer may not reach `src/main`. The
generator is a script, beside the FigUI3 guard, and is type-checked by the
tests project as that one is.

## Phase 0: research

Complete. `research.md` records eight decisions, four of which were settled
by measurement rather than judgement:

1. the engine's description is a static file and its printed form is
   byte-stable (hashed three times, identical), so it is committed verbatim;
2. the emitter is hand-written, because the library would make the output
   depend on a Prettier version and brings eight transitive dependencies,
   and because the description uses a closed set of eleven keywords, all
   enumerated;
3. pattern-constrained strings stay strings;
4. the divergence this feature expected does not exist: the description
   already requires the map's service day, so the client tightens nothing;
5. a method with no parameters is called with none, through a rest tuple;
6. notification routing fans out from the bridge's global streams and must
   not disturb the ordering A1-01 established;
7. a contract test proves the two long methods at their refusals;
8. the vendoring job can be wired now and goes green when the tag is
   published.

## Phase 1: design

Complete: `data-model.md`, `contracts/client.md`,
`contracts/generation.md`, `quickstart.md`.

## Phase 2: what comes next

`/speckit-tasks` writes `tasks.md`. The order the design implies:

1. the generator and the description, with its two engine-free tests;
2. the generated module, and the bridge's three shapes derived from it;
3. the client and its unit tests against a stub bridge;
4. the gated drift and contract tests;
5. the vendoring workflow;
6. documentation: `ARCHITECTURE.md`'s engine section, the notices only if a
   dependency were added, which it is not.

## What this feature does not do

- It does not run a layout or build a map. The two long methods are proven
  at their refusals; A3-01 runs one for real.
- It does not change the bridge, the supervisor, the framing or the
  ordering. Every one of those is A1-01's and stays as it is.
- It does not add an interface, so it adds no accessibility surface.
- It does not make the contract tests run in continuous integration. It
  makes them ready and honest; publishing the engine's tag is the
  maintainer's action.
