# Implementation Plan: Jobs, in an inspector that spans projects

**Branch**: `A1-03-jobs` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

The runs already outlive their views and live in `runs.ts`. This adds a
job shape each run can describe itself in, a registry over the runs that
exist this session, a log buffer per run, and one new region: an inspector
rendered beside every screen, collapsed by default, listing the jobs with
the same progress line, cancel and error handling the run views have.
"Copy log" goes through the main process so the redaction A6-03 built
applies to it.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | Nothing drawn but controls and text. |
| II. The engine is the source of truth | Stages, hints, details and log lines are the engine's, shown as it sent them, paths removed. |
| III. Determinism is a feature | No run changes behaviour; the capture path is untouched. |
| IV. No network without a reason | None. |
| V. Hygiene by tools | The copied log crosses inward as bounded text and is redacted in main before the clipboard. |
| VI. Accessible by default | A toggle with the running count in its name, polite announcements, focus to the heading on open and back on close, reduced motion, the narrow-window overlay closing on Escape. |
| VII. Records | ADR-036: the inspector is the window's and spans projects; the left rail and moving the fields are deferred. |

## Design

**The job shape.** `src/shared/jobs.ts` (no Electron, no React):
`JobKind`, `JobState` (`running | done | failed | cancelled`), and `Job`
with the fields in FR-001. `MAX_FINISHED = 20`, `MAX_LOG_LINES = 200`.

**Each run describes itself.**
- `LayoutRun`, `ExportRun` and `FeedAdd` gain a `job(): Job | null`, null
  while idle.
- They also gain a started time, an ended time, and a bounded log buffer
  fed by `EngineClient.onLog` for the request ids the run owns (layout,
  feed add), or by its own progress sentences (export).
- A rebuild is a `LayoutRun` in its rebuild path; its job kind is `rebuild`.
- Existing snapshots and methods are unchanged; the job is derived from them.

**The registry.** In `runs.ts`:
- `jobs(): Job[]` over the layout runs, the export runs and the one feed add;
- `subscribeToJobs(listener)`, which re-subscribes when a run is created, a
  gap the current `subscribeToRuns` has, since it only sees the runs that
  existed when it was called;
- `runningCount()`;
- a project's finished jobs dropped by `forgetLayoutRun` and its export
  counterpart on delete.

**The finished list.** Each run holds only its latest job, so the registry
keeps the earlier finished jobs itself. When a run's job reaches a final
state, the registry takes a copy into a session list, newest first, capped
at `MAX_FINISHED`.

**Names.** A job's project name comes from the projects list the Library
already reads, fetched when the inspector opens or a job starts. The run
itself knows only the id.

**The inspector.**
- `src/renderer/src/Inspector.tsx`: a region labelled "Inspector" with a
  "Jobs" heading, and `JobsList` / `JobItem` in `src/renderer/src/Jobs.tsx`.
- `JobItem` reuses `ProgressLine`, the kit's `Button` and a native
  `<details>` for the detail.
- `App.tsx` renders the toggle in the header (after the engine status,
  before Settings) and the inspector beside the screen.
- One polite live region in `App.tsx` announces a job's end.
- Styles are tokens only; the width is a size token, not a literal.

**Copy log.**
- `api.jobs.copyLog(text)`, validated in main: a string of at most 256 KB.
- It is written to the clipboard after `redactUrls` and the home-folder
  shortening from A6-03's `diagnostics-text.ts`.
- The page composes the text: label, state, stages, hint, detail, and log
  lines, with a note when lines were dropped.

**The stand-in engine.** It learns to fail `graph.build` with the engine's
route-type sentence when the test's control file asks. It emits a few
`job/log` lines during `graph.build`, and records that it ended its child
on cancel during `octi`.

## Source code

```text
src/shared/jobs.ts                                  # the job shape and caps (new)
src/renderer/src/engine/layoutRun.ts, exportRun.ts, feedAdd.ts   # job(), times, log buffer
src/renderer/src/engine/runs.ts                     # jobs(), subscribeToJobs(), runningCount(), finished list
src/renderer/src/Inspector.tsx, Jobs.tsx            # the region and the list (new)
src/renderer/src/App.tsx                            # toggle, region, announcement
src/renderer/src/styles/app.css                     # tokens only
src/shared/api.ts, src/preload/index.ts             # jobs.copyLog and its channel
src/main/index.ts or a small src/main/jobs-ipc.ts   # the handler: bounded, redacted, clipboard
docs/DESIGN.md                                      # section 9 sentence; 8.2 rules; deliberately absent row
docs/adr/036-the-inspector-spans-projects.md        # ADR-036, and its row
tests/fake-engine/schematic/serve.py                # route-type failure, job/log lines, child ended on cancel
tests/unit/{jobs,runs,layout-run,export-run,feed-add,jobs-ipc,contrast}.test.ts
tests/e2e/jobs.spec.ts                              # the scenarios, against the stand-in
docs/ARCHITECTURE.md, CLAUDE.md
```

## Must not touch

`vendor/`, `.github/`, `scripts/`, `electron-builder.yml` (A0-10 and A5-04's
lanes). `src/main/export.ts`, `src/main/capture*.ts`. Existing run
snapshots' fields and meanings.
