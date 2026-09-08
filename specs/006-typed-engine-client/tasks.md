# Tasks: Typed engine client

**Input**: Design documents from `specs/006-typed-engine-client/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/client.md, contracts/generation.md, quickstart.md

**Tests**: wanted (spec FR-014, FR-015, SC-001 to SC-007).

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [x] T001 Add `"typegen": "tsx scripts/protocol.ts"` (or the runner the repository already has for a TypeScript script; `scripts/figui-guard.ts` is imported by the build rather than run, so this is the first script executed directly, and a plain `node --experimental-strip-types` is preferred over adding a dependency) to `package.json`, and add a permission rule for it in the private `.claude/settings.json` if the checks gain it
- [x] T002 [P] Extend `tsconfig.tests.json`'s include so `scripts/protocol.ts` is type-checked, as `scripts/figui-guard.ts` already is

---

## Phase 2: Foundational

**Blocking: everything else reads the description or the types.**

- [x] T003 Write `scripts/protocol.ts` part one, the reader: resolve the engine checkout from `LEGIBLE_ENGINE_CHECKOUT` (`.env.local` or the environment) with the same resolution `tests/unit/sidecar-real.test.ts` uses, run `<checkout>/.venv/bin/python -m schematic.serve --schema` with an argument array and a timeout, and stop with the sentence naming the key to set when no checkout exists, changing nothing
- [x] T004 Write `scripts/protocol.ts` part two, the emitter, per contracts/generation.md and data-model.md's construct table: `$ref`, object with `properties`/`required`, `items`, the seven primitives, type-arrays as unions, `oneOf`, `enum`, `const`, `description` as a doc comment; ignore `minimum`, `maximum`, `exclusiveMinimum`, `pattern`, `format` and `default`; **throw on any other keyword, naming the keyword and its path**. Emit one export per `$defs` entry, then `Methods`, `Method`, `Notifications`, `NotificationName` and `PROTOCOL`
- [x] T005 Write `scripts/protocol.ts` part three, the writer: `vendor/protocol.schema.json` verbatim from the engine's bytes, `engine.schema_sha256` into `vendor/pins.json`, and `src/shared/protocol.ts` with a header naming the command, the pinned tag and that edits are lost. All three or none
- [x] T006 Run `npm run typegen` against the engine checkout and commit `vendor/protocol.schema.json`, the updated `vendor/pins.json` and the generated `src/shared/protocol.ts`

**Checkpoint**: the description and the types exist and are committed.

---

## Phase 3: User Story 1 - The boundary is checked when the app is built (P1)

**Goal**: a change on the engine's side stops the app's checks, with the command that fixes it.

**Independent test**: rename a parameter in the engine checkout, run `npm test`, read the failure; restore and run again.

- [x] T007 [P] [US1] Extend `tests/unit/pins.test.ts`: `engine.schema_sha256` is 64 hex characters and equals the SHA-256 of `vendor/protocol.schema.json`; the failure names `npm run typegen`
- [x] T008 [P] [US1] Write `tests/unit/protocol-generate.test.ts`: regenerate the module from the committed description with the emitter imported from `scripts/protocol.ts` and compare byte for byte with `src/shared/protocol.ts` (SC-006); assert every key of the description's `methods` and `notifications` appears in the generated `Methods` and `Notifications`, counted rather than listed (SC-002); assert the emitter throws on an unknown keyword, on a `$ref` that resolves to nothing, and names the path in both
- [x] T009 [US1] Write the drift half of `tests/unit/protocol-real.test.ts`: gated on a checkout exactly as `sidecar-real.test.ts` gates, run the engine's `--schema` and compare with the committed copy; on a difference fail with the first differing line and `npm run typegen`; with no checkout, `it.skip` with a sentence saying why (SC-004)

**Checkpoint**: the boundary is guarded; two of the three checks need no engine.

---

## Phase 4: User Story 2 - Asking the engine something, in types (P1)

**Goal**: a wrong method, parameter or result assumption stops the build; an error keeps its sentence.

**Independent test**: write the four calls in quickstart.md §2 and confirm which compile.

- [x] T010 [US2] Derive the hand-written `JobProgress`, `JobLog` and `ErrorData` in `src/shared/engine.ts` from the generated ones (FR-012), naming the two differences the bridge genuinely has; leave `EngineState`, `EnginePin`, `EngineError`, `ERROR_CODES` and `describeState` as they are, and fix any resulting type error in `src/main/engine-ipc.ts`, `src/preload/index.ts` and the renderer
- [x] T011 [US2] Write `src/renderer/src/engine/client.ts` per contracts/client.md: `EngineClient` taking the bridge in its constructor, `request` with the rest-tuple parameters so a `NoParams` method is called with none, and `Params`/`Result` derived from `Methods`. The client tightens nothing: the description already requires the map's service day (research §4)
- [x] T012 [US2] Update `src/shared/api.ts`'s comment on the engine bridge: it is still deliberately untyped at the bridge, and the typed client over it is now `src/renderer/src/engine/client.ts`, not "A1-02 will do this"

---

## Phase 5: User Story 3 - Watching and stopping a long request (P2)

**Goal**: one request's progress reaches only its own listener, and cancelling is safe at any point.

**Independent test**: drive a stub bridge with two requests in flight.

- [x] T013 [US3] Implement the request handle in `client.ts`: subscribe once to the bridge's `onProgress` and `onLog`, fan out by token, release a request's listeners when its promise settles and **not before** (research §6: the bridge already delivers the answer after the last notification; do not undo that), and make `cancel()` after settling a no-op
- [x] T014 [US3] Write `tests/unit/engine-client.test.ts` against a stub bridge: a result resolves typed; an error rejects with code, message and `data` unchanged; two requests in flight never cross; progress and log reach only their own request; listeners are released on settle; a listener added after settling is never called and leaks nothing; `cancel()` forwards once, and after settling does nothing and does not throw; `dispose()` releases the two global subscriptions

**Checkpoint**: the client is complete and proven without an engine.

---

## Phase 6: User Story 4 - The types describe the engine that is actually there (P2)

**Goal**: the contract tests run against the real engine, and the vendoring job names the pin.

**Independent test**: `npm test -- protocol-real` with and without a checkout.

- [x] T015 [US4] Write the contract half of `tests/unit/protocol-real.test.ts`, gated as in T009 and spawning the sidecar with `Sidecar` from `src/main/sidecar.ts` (a test may import from `src/main`; only the renderer may not): `engine.info` returns the pinned version and `protocol` 1; `engine.shutdown` answers and the process ends; `graph.build` with an unregistered feed key is refused; `map.build` without `date` is refused; each refusal carries a code and `data` of `{kind, detail, hint}` with `hint` a sentence (SC-003, SC-007). Do not attempt a full run of either long method (research §7)
- [x] T016 [US4] Replace the placeholder in `.github/workflows/vendor.yml`'s python job ("The engine pin lands with A1-02; until then this job needs a path") with a checkout of `engine.repo` at `engine.tag` from `vendor/pins.json` into `$ENGINE_PATH`; note in the step's comment that it goes green once the engine's tag is published, which closes A0-06

---

## Phase 7: Polish

- [x] T017 Update `docs/ARCHITECTURE.md`'s engine section: the committed description, the generated types, the client the renderer uses, and the three checks (fingerprint and reproducibility everywhere, drift where a checkout exists). `THIRD_PARTY_NOTICES.md` needs no row: no dependency is added, which is the point of research §2
- [ ] T018 Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `bin/preflight` and `gitleaks dir .`; then the `reviewer` subagent over the branch; fix what it finds
- [ ] T019 Walk quickstart.md end to end, including the rename in §3 and the no-checkout run in §4, and record what was checked by hand; open the pull request (closing keyword in the body only, never in the commit message)

---

## Dependencies

Phase 1 then Phase 2 first: every later phase reads the description or the
generated types. US1 needs T003–T006. US2 needs T006. US3 needs T011. US4
needs T011 and, for its drift half, T009's gating helper. Phase 7 last.

T007 and T008 are parallel with each other. T016 touches only the workflow
and is parallel with everything in Phase 6.

## Implementation strategy

Phases 2 and 3 are the minimum that delivers the feature's point: the
description is committed and drift fails the checks. The client (Phases 4
and 5) is what later issues consume, and the contract tests (Phase 6) are
what prove the types describe a real engine rather than a snapshot.

The one thing to resist: making the two long methods run in the contract
test. They need Docker and a downloaded feed, the spec says plainly that
they are proven at their refusals, and a test that skips half the time for
an environmental reason is worse than one that asserts less and always
runs.

## As landed

**One premise in the plan was wrong, and the code found it.** The plan and
the first research pass assumed `map.build`'s service day was optional in
the engine's description and that the client would have to tighten it
(ADR-023 being the reason the engine refuses the request without one). It
is already required: `MapBuildParams` lists `["key", "date"]`. The
generated module had it right before anything was asked of it. The spec,
the research, the data model, both contracts, the plan and this list were
corrected the moment the generator printed the truth; the design is
simpler for it, because a client that diverges from the description
nowhere cannot drift from it later. Research section 4 records this rather
than hiding it.

**Three things landed differently from this list.** The generator emits in
the repository's own style (single quotes, no semicolons), so Prettier
checks the generated file rather than being asked to skip it: if a future
Prettier disagrees, lint fails loudly and the emitter is adjusted, and the
committed file never changes silently underneath the reproducibility test.
`src/shared/engine.ts` derives its three shapes from the generated types
instead of re-exporting them (T010), because two of the three are
deliberately not the engine's: a notification's id is the preload's token,
and an error's kind may be one of the app's three. One hand-written value
survives, the runtime list of the engine's error kinds, because a kind
arriving over the wire has to be checked before it is trusted; a test
compares that list with the description's enum, so it cannot drift.

**Checked by hand, on macOS 15 arm64**, following quickstart.md: renaming
`key` to `feed` in the engine's `v1.json` made the drift test fail naming
line 162 and the command to run; regenerating then broke every call site
that said `key`, which is the feature's whole claim; restoring the engine
and regenerating returned the fingerprint to
`33b19cbb…`, byte for byte. With the checkout pointed at a path that does
not exist, the eight engine-dependent tests reported themselves skipped
and the other nineteen still ran.

**Not done here, and not claimed**: the two long methods are never run.
They need Docker and a downloaded feed. A3-01 runs one for a project.

**What the review pass changed.** The repository's reviewer read the branch
before the pull request; one finding was blocking and the rest were real.
The workflow's new checkout could not have run: `vendor/pins.json` stores
the engine as a URL, for the tools that clone it with git, and
`actions/checkout` wants `owner/repo`, so User Story 4 rested on a step
that would have failed on its first run. The pin is now trimmed to
`owner/repo` and the step refuses a pin that is not a GitHub URL. Beyond
that: the wire's error kind is checked against the engine's seven rather
than all ten, because an engine claiming one of the app's three would be
indistinguishable from the supervisor's own, and the whole of what the
engine sent is kept in `detail` again rather than two fields of it; the
`engine.shutdown` test goes through the same helper as every other, so a
readiness that never comes is bounded and the process is always stopped and
its home removed; the generator reads `.env.local` with the app's own
parser, so two parsers cannot disagree about which of two lines wins; a
disposed client refuses a request instead of answering it and never
reporting a stage; the child that prints the schema gets an allowlisted
environment, as the app's own children do. Three claims in these documents
were corrected to what the code does: the bridge's shapes are derived from
the generated types rather than re-exported, the fingerprint test rather
than the drift test is what catches a half-update, and the emitter knows
sixteen keywords rather than eleven. Two success criteria were reworded to
what is provable: the client holds the two casts the untyped bridge forces
at its edge, and an error's sentence is proven for the kinds a machine
without the layout tools can provoke.
