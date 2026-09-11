# Implementation Plan: The export

**Branch**: `A5-02b-export` | **Date**: 2026-09-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/010-export/spec.md`; the
capture (`specs/009-capture`); the engine's `export.plan` and
`export.encode` at v0.3.0 (`vendor/protocol.schema.json`); the layout
run's pattern (`specs/007-layout-run`) and the engine bridge's
(`specs/004-sidecar-supervisor/contracts/bridge.md`).

## Summary

The export flow runs in the main process, where the capture lives, and is
driven from the page through a bridge shaped like the engine's: a token
the preload mints, an accept-or-refuse reply, progress as events and the
outcome as the last event. The orchestrator is a class with everything
Electron injected - the engine, the store, the capture, the two folders -
so its order and its cleanup are asserted against fakes; the page keeps a
plain state machine of what it is told, as it does for the layout run, and
the view over it reuses the progress line. The stand-in engine learns the
two methods in shape, so the whole flow runs in continuous integration
against the animated stand-in page; the real reel is an opt-in test.

## Technical Context

**Language/Version**: TypeScript 5, Electron 44.2.0, Node 22; the engine
at v0.3.0 (protocol 1) through the pinned interpreter.

**Primary Dependencies**: none new. `prettier` is now imported by the type
generator, so what it writes is what the lint checks.

**Storage**: frames under `<SCHEMATIC_HOME>/frames/<token>/` while the
export runs; the file and its sidecar under the export folder.

**Testing**: vitest over fakes (the order, the parameters, the cleanup,
the bridge's checks, the page's state machine); Playwright over the built
app with the stand-in engine and page; an opt-in Playwright test over the
real engine, the real page and ffmpeg.

**Target Platform**: macOS and Windows; Linux runs the tests under xvfb.

**Performance Goals**: a reel at the engine's standard quality in minutes;
the reel test records the figure.

**Constraints**: the page never sees a path; the capture is never exposed
to the page; nothing is written outside the engine home and the export
folder; ADR-024's capture is used as it is.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | The reel is the engine's page, captured; the app draws the progress line and a sentence. |
| II. The engine is the source of truth | The plan is the engine's, handed back unchanged; the file's name is the engine's; the sidecar is the engine's. The app adds the page's address and the project's service day, which only it knows. |
| III. Determinism is a feature | The capture of `specs/009`, from a plan whose first beat pins the clock; the reel test measures two exports against each other in RGB with the tolerance of 8. |
| IV. No network without a reason | Nothing new. |
| V. Hygiene by tools | Every path stays on the main side; a unit test reads every sentence the export emits for a separator, and the end-to-end test reads the screen. |
| VI. Accessible by default | The export is a section with a label, its progress line carries a sentence for assistive technology, cancel and reveal are labelled buttons. |
| VII. Records | ADR-024 and ADR-031 are the records this rests on; none is added. |

## Project Structure

### Documentation (this feature)

```text
specs/010-export/
├── spec.md
├── plan.md              # this file
├── tasks.md
├── quickstart.md
├── contracts/bridge.md  # api.export, the channels, the flow
└── checklists/requirements.md
```

### Source code

```text
src/shared/export.ts                  # new: the offered presets, the stages, the progress, result and settled shapes
src/shared/api.ts                     # edited: api.export, its channels, Accepted and Settled<T>
src/shared/engine.ts                  # edited: ERROR_CODES.exportFailed
src/preload/index.ts                  # edited: startJob, shared by the engine's requests and the export
src/main/ipc-shape.ts                 # new: the token rule, badCall and toShape, shared by the two job bridges
src/main/engine-ipc.ts                # edited: uses ipc-shape
src/main/export.ts                    # new: Exporter; themeFor, pageUrl, folderName, jobOf, normalise
src/main/export-ipc.ts                # new: registerExportHandlers
src/main/config.ts                    # edited: LEGIBLE_EXPORT_FOLDER, the desktop default
src/main/paths.ts                     # edited: RESERVED_NAME exported
src/main/index.ts                     # edited: the exporter, the frames folder cleared at start, abortAll on quit, the reveal
src/renderer/src/engine/exportRun.ts  # new: the page's state machine
src/renderer/src/engine/runs.ts       # edited: exportRunFor
src/renderer/src/ExportRun.tsx        # new: the view
src/renderer/src/LayoutRun.tsx        # edited: disabled while an export runs
src/renderer/src/ProjectView.tsx      # edited: the export below the layout run; delete disabled while either runs
src/renderer/src/useSnapshot.ts       # new: the hook the two views share
src/renderer/src/styles/app.css       # edited: the export run's rules beside the layout run's
scripts/protocol.ts                   # edited: emitFormatted; main async
tests/fake-engine/schematic/serve.py  # edited: export.plan, export.encode, four control keys
tests/unit/export.test.ts             # new
tests/unit/export-ipc.test.ts         # new
tests/unit/export-run.test.ts         # new
tests/unit/config.test.ts             # edited
tests/unit/protocol-generate.test.ts  # edited: emitFormatted
tests/e2e/export.spec.ts              # new: the stand-in flow
tests/e2e/reel.spec.ts                # new: opt-in, the real reel twice
docs/ARCHITECTURE.md, docs/DESIGN.md, CLAUDE.md, README.md, .claude/rules/main.md
```

**Structure Decision**: the orchestrator is a class with injected
collaborators, the pattern `sidecar.ts` and `capture.ts` set; the bridge
copies the engine bridge's shape rather than generalising it, except for
the three helpers both need. The page's state machine is separate from the
layout run's because the two report differently: the engine reports a
stage when it has finished, the export reports the stage it is in.

## Phase 0: research

Nothing to spike. Two things settled while building: the type generator
now formats its output with prettier, because an enumeration of sixteen
preset names is longer than a line and the committed module must pass the
same check as everything else; and the export folder is a configuration
key rather than a save dialog, because the issue says "the chosen export
folder", Settings (A1-04) will own the choice, and a native dialog would
have put the one thing a test cannot drive in the middle of the flow.

## Phase 1: design

- The frames live under the engine home rather than the system's temp
  folder, so the rule "the engine home or the export folder, nothing
  else" holds as written, and a start clears the folder.
- The reveal takes the token, never a path: the main process remembers
  what each finished export wrote.
- One export per project at a time; the layout run and the export of a
  project disable each other's button, and delete, while running.
- The stand-in engine's encode writes a partial file on every step so a
  cancel has something to prove it removed.

## Phase 2: what comes next

A5-01: the other presets and the export's options over this same path;
A1-04: the folder chooser; A1-03: the jobs drawer, which generalises the
two progress views.

## What this feature does not do

No preset chooser, no quality or storyboard options, no folder chooser, no
vendored ffmpeg (A0-10), no change to the engine.
