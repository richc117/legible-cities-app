# Implementation Plan: Project

**Branch**: `A1-05-project` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-project/spec.md`, clarified 2026-09-07.

## Summary

The project object: a versioned record under `<engine home>/projects/<id>/project.json`,
a store in the main process that lists, reads, creates, renames and deletes
it with atomic writes, five bridge methods validated on the main side, and a
Library that shows projects, creates one from a name and a typed feed key,
opens it into a view, and renames or deletes it through labelled, keyboard
operable dialogs. The service day stays empty until the first layout; the
layout field stays empty until A3-01. No engine, no network, nothing drawn.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22 on the runners; the skeleton's toolchain unchanged.

**Primary Dependencies**: none added. Electron 44's Chromium implements the
native `<dialog>` element with modal focus management; React 19 renders it.
`node:crypto` for identifiers, `node:fs/promises` for the store.

**Storage**: JSON files, one per project, under the engine home's `projects/`
folder; the project's output folder under `out/<id>/` is removed with it.

**Testing**: Vitest over the store against a temporary directory (create,
list, get, rename, delete, atomicity, versioning, unreadable records); the
Playwright Electron smoke test extended over the lifecycle from the Library
and over the served output of a real project.

**Target Platform**: as the skeleton: macOS and Windows targets, Linux verification.

**Project Type**: desktop app; this feature touches all three processes.

**Performance Goals**: the Library lists a few hundred projects without a
visible pause (`readdir` plus one small read each); create, rename and
delete feel immediate (SC-001's 30 s is end to end including a relaunch).

**Constraints**: nothing written outside the engine home; the renderer never
sees a path (FR-015); the bridge grows by exactly five methods (FR-014);
identifiers satisfy the origin's rule and are never derived from names.

**Scale/Scope**: one record type, one store module, five IPC handlers, three
screens' worth of React (list, create dialog, project view with rename and
delete), one stylesheet extension, two test files extended and one added.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design below.*

| Principle or constraint | How this plan complies |
|---|---|
| I. One renderer | Lists, forms and dialogs only. No geometry, no map library. |
| II. The engine is the source of truth | The two places the engine would answer are left to it: the feed key is typed and validated for form only until `feeds.list` (A2-01), and the service day is resolved at first layout (A3-01). Defaults for style, colours, order and theme mirror the engine's own values and are stored, not interpreted. |
| III. Determinism is a feature | The record carries `layout` and `date`, the two fields ADR-023 makes the unit of determinism; neither is set by this feature, and the store never re-resolves either. |
| IV. No network, no telemetry | Nothing reaches the network. |
| V. Hygiene by tools | The tests write only under a temporary directory; nothing in the tree carries a machine path. |
| VI. Accessible by default | Native `<dialog>` for create and delete (modal, focus trapped and returned by the browser, Escape cancels); every control labelled; list entries are buttons; reduced motion already disables transitions globally. User Story 4 is a manual check recorded in the pull request. |
| VII. Decisions recorded | ADR-016 (the home) and ADR-023 (the stored layout and the date) are the records this builds on; the record's versioning rule is in `data-model.md`. No new ADR: nothing here is hard to reverse. |
| Never write inside the bundle | Every write is under the engine home (`projects/`, and the removal under `out/`). |
| `app://local` is one origin | Unchanged; the served-output scenario now runs against a real project. |
| The renderer holds no Node APIs | Five typed bridge methods; identifiers only, never paths. |
| Child processes | None. |
| GPL-3.0-or-later, third parties listed | No new dependency. |

**Post-design re-check**: `data-model.md` and `contracts/` add nothing beyond
the above. The one judgement call is the typed feed key (principle II): it
is the user's own text, validated for shape, and the form says the list is
coming; it copies nothing from the engine.

## Project Structure

### Documentation (this feature)

```text
specs/003-project/
├── plan.md              # This file
├── research.md          # Phase 0: atomic writes, identifiers, the dialog element, record versioning
├── data-model.md        # Phase 1: the record, its defaults, validation, versioning, the Library
├── quickstart.md        # Phase 1: what to run and what it proves
├── contracts/
│   ├── bridge.md        # the five new methods and their channels
│   └── record.md        # project.json, field by field, with the version rule
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── api.ts                    # Api gains projects.{list,get,create,rename,delete}; CHANNELS gains five
│   └── project.ts                # ProjectRecord (versioned), ProjectSummary, defaults, validators (pure)
├── main/
│   ├── projects.ts               # ProjectStore: root-scoped fs operations, atomic write, id generation
│   ├── ipc.ts                    # registers the project handlers with main-side validation (replaces library.ts)
│   └── index.ts                  # wires the store with config.home
├── preload/
│   └── index.ts                  # exposes the five methods
└── renderer/src/
    ├── App.tsx                   # Library ⇄ project view routing (local state, no router)
    ├── Library.tsx               # the list, the empty state, the create button
    ├── CreateProjectDialog.tsx   # <dialog>: name, feed key, validation messages
    ├── ProjectView.tsx           # fields, rename (inline form), delete (confirm dialog)
    ├── ConfirmDialog.tsx         # <dialog>: a labelled confirmation
    └── styles/app.css            # list, form, dialog styles from tokens
tests/
├── unit/
│   ├── project.test.ts           # validators, defaults, versioning (pure)
│   └── projects-store.test.ts    # the store against a temp dir: lifecycle, atomicity, unreadable records
└── e2e/
    └── smoke.spec.ts             # extended: create → list → open → rename → served output → delete
docs/ARCHITECTURE.md              # the bridge section and the "deliberately absent" table updated
```

**Structure Decision**: the store is a class over an injected root so the
unit tests run against a temporary directory without Electron; the IPC
layer is a thin, validating adapter; the renderer keeps navigation as local
state because there are two screens and no URL to preserve.

## Complexity Tracking

No constitution violations to justify. A router, a state library and a
component library were each considered and left out: two screens, one
list and two dialogs do not need them, and each would be a dependency to
list and a licence to carry.
