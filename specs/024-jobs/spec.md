# Feature Specification: Jobs, in an inspector that spans projects

**Feature Branch**: `A1-03-jobs`

**Created**: 2026-09-13

**Status**: Draft

**Input**: Planned issue A1-03, "Jobs drawer: progress, cancellation, logs
and errors for people". Three kinds of long work exist today, each with its
own run class and its own place on screen: the layout run and the rebuilds
that follow a chosen day, a recolour or a reorder (`LayoutRun`, on the
project screen), the export (`ExportRun`, in the Export tab since A5-01),
and adding a feed (`FeedAdd`, in the Library's dialog). `runs.ts` already
keeps them past the view that started them and can count what is running
(`runsInProgress`, `subscribeToRuns`). Each draws a progress line, cancels,
and shows the engine's hint when it fails. None of them can be seen from
anywhere but its own screen.

## Overview

A person starts an export of one project, goes back to the Library, opens a
second project and starts laying it out. Today nothing on the second
project's screen says the export is still going, how far it has got, or
that it failed; to find out they must go back. After this feature the
window has a right-hand inspector, collapsed until opened, whose toggle
shows how many jobs are running and whose first content is a list of jobs:
every layout run, rebuild, export and feed add of this session, running
ones first, each with its stages on the same progress line, its last
sentence, a way to cancel, and when it fails the engine's hint in full with
the engine's detail behind a disclosure and a way to copy its log.

The runs themselves do not move and do not change behaviour. The project
screen, the Export tab and the add-feed dialog still show their own run
where they show it today. The inspector is a second view of the same
runs, not a second place they live.

## Decisions taken before this spec

Answered by the maintainer on 2026-09-13:

- **The inspector starts collapsed.** Its toggle carries a count of running
  jobs, and a job that finishes or fails is announced politely. Nothing
  opens by itself or moves the layout under a person's hands.
- **Finished jobs are kept for this session only**, newest first, at most
  twenty. Nothing new is written to disk; the logs from A6-03 already
  persist what the engine said.

And from the plan (ADR-036 records it):

- **The inspector is the window's, not a project's.** Jobs span projects,
  so it is rendered from `App.tsx` beside all three screens, 320 px wide
  and collapsible, and below 900 px it covers the main region rather than
  squeezing it. `docs/DESIGN.md` section 9 gains one sentence saying so.
- **Deferred:** the left rail, and moving the project's fields and
  diagnostics into the inspector. Both stay where they are, with a row in
  the design document's list of what is deliberately absent.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Seeing a job from anywhere (Priority: P1)

A person starts an export of Los Angeles, goes to Settings, and presses the
inspector's toggle, which says one job is running. The export is listed
with its three stages and its last sentence, and it moves as the export
moves.

**Why this priority**: it is the issue.

**Independent Test**: against the stand-in engine, start an export, leave
the project, open the inspector, and read the job.

**Acceptance Scenarios**:

1. **Given** no job has run, **When** the inspector is opened, **Then** it
   says there are no jobs this session.
2. **Given** a layout run, **When** the inspector is read, **Then** it lists
   the run under the project's name with the same stages the project
   screen shows (`gtfs2graph`, `topo`, `loom`, `octi`, then the later
   stages), the same state for each, and the same last sentence.
3. **Given** an export, a rebuild or a feed add, **When** the inspector is
   read, **Then** each is listed the same way, with its own stages.
4. **Given** a job running, **When** the inspector is collapsed, **Then** its
   toggle names the number of running jobs in text and to a screen reader.
5. **Given** a job finishing, failing or being cancelled, **When** it
   happens on any screen, **Then** one polite announcement says so, naming
   the project, whether or not the inspector is open.
6. **Given** jobs in two projects, **When** the inspector is read, **Then**
   both are listed; running jobs come first, then finished ones newest
   first.

---

### User Story 2 - Cancelling from the inspector (Priority: P1)

A person sees a layout run they started by mistake in another project and
presses its Cancel in the inspector.

**Acceptance Scenarios**:

1. **Given** a running job, **When** Cancel is pressed in the inspector,
   **Then** it is cancelled exactly as the Cancel on its own screen cancels
   it (`$/cancelRequest` through the run's own `cancel()`), and both views
   show it cancelled.
2. **Given** a layout run in its `octi` stage, **When** it is cancelled,
   **Then** no LOOM process is left running. With the stand-in engine this
   is the stand-in's own record that its child was ended; against the real
   engine it is the process table, checked by a person once (SC-004).

---

### User Story 3 - An error a person can act on (Priority: P1)

A layout run fails because the chosen mode keeps no routes. The inspector
shows the engine's sentence in full, and under "Details" the engine's
detail, and "Copy log" puts the job's log on the clipboard for an issue.

**Acceptance Scenarios**:

1. **Given** a failed job, **When** it is read, **Then** the engine's `hint`
   is shown as the job's message, and the engine's `detail`, when it
   differs, is behind a disclosure closed by default.
2. **Given** a layout run asked for a mode the feed's route types do not
   carry, **When** it fails, **Then** the hint is the engine's own sentence
   about route types (E04b made the request possible).
3. **Given** a job with log lines (`job/log` notifications), **When** "Copy
   log" is pressed, **Then** the clipboard holds the job's label, its final
   state, its stages and its log lines, with feed URLs redacted and the
   home folder written as `~`, as A6-03's copy does, and a sentence says
   it was copied.
4. **Given** no path in any hint or detail, **When** the job is shown,
   **Then** no absolute path is on screen, as the run views already
   guarantee (`withoutPaths`).

---

### User Story 4 - The list stays short (Priority: P3)

**Acceptance Scenarios**:

1. **Given** more than twenty finished jobs this session, **When** the list
   is read, **Then** the oldest finished jobs beyond twenty are gone;
   running jobs are never dropped.
2. **Given** a project deleted, **When** the list is read, **Then** its
   finished jobs are gone and a running one cannot exist (delete already
   refuses while a run is going).
3. **Given** the app quits, **When** it is launched again, **Then** the list
   is empty.

---

### Edge Cases

- **A job's log is long.** LOOM can print thousands of lines. A job keeps
  its last 200 log lines; "Copy log" says when earlier lines were dropped
  and points at `engine.log` for the rest.
- **Two views of one run.** The inspector subscribes to the same run
  snapshot the project screen does; there is no second state to drift.
  A cancel from either view is one cancel.
- **A run that exists but has never started** (a project visited but not
  laid out) is not a job and is not listed.
- **The reset.** While Settings is resetting the engine's data, the
  inspector's Cancel still works, and the reset's own refusal while a run
  is going is unchanged.
- **Focus.** Opening the inspector moves focus to its heading; closing it
  returns focus to the toggle. A job's Cancel that disables itself hands
  focus to the job's heading first, as the theme switch does.
- **Reduced motion.** The inspector opens and closes without a slide.
- **Narrow window.** Below 900 px the inspector overlays the main region
  and closes on Escape.

## Requirements _(mandatory)_

- **FR-001**: The runs MUST expose one read-only job shape: id, kind
  (`layout`, `rebuild`, `export`, `feed-add`), project id and name (none for
  a feed add), label, state, stages, last message, hint and detail when
  failed, log lines (last 200), started and ended times. The runs' own
  behaviour and their existing snapshots MUST NOT change.
- **FR-002**: A registry in `src/renderer/src/engine/runs.ts` MUST list the
  session's jobs from the runs it already keeps, including the feed add,
  running first then finished newest first, keeping at most twenty
  finished ones.
- **FR-003**: The window MUST render a right-hand inspector from `App.tsx`,
  collapsed by default, 320 px wide, with a toggle in the header that
  carries the running count in its accessible name.
- **FR-004**: Each job MUST show its label, its stages on the existing
  `ProgressLine`, its last sentence, and Cancel while running.
- **FR-005**: Cancel in the inspector MUST call the run's own `cancel()`.
- **FR-006**: A failed job MUST show the engine's hint, and its detail
  behind a closed disclosure when the detail differs.
- **FR-007**: "Copy log" MUST send the job's text to the main process, which
  applies `redactUrls` and the home-folder shortening before writing the
  clipboard. The page never writes the clipboard directly.
- **FR-008**: A job ending MUST be announced once, politely, on every screen.
- **FR-009**: The inspector MUST be keyboard-reachable, labelled, honour
  reduced motion, and follow section 9's narrow-window rule. New components
  MUST have rules in `docs/DESIGN.md` section 8.2, and new pairs in the
  contrast test.
- **FR-010**: Nothing new is written to disk.

## Success Criteria _(mandatory)_

- **SC-001**: A job started in one project can be followed, cancelled and
  diagnosed from any screen.
- **SC-002**: The inspector and the run's own view never disagree about a
  job's state.
- **SC-003**: A copied job log contains no feed URL's query values and no
  home folder.
- **SC-004**: Cancelling a real layout run during `octi` leaves no LOOM
  process. A person checks this once against the real engine; the suite
  checks the stand-in's record of it.

## Assumptions

- The engine's `job/log` notifications already reach the renderer through
  `EngineClient.onLog`; the runs start keeping the lines for their own
  request ids.
- The export's log lines are the main process's progress sentences; the
  export has no `job/log` stream of its own, and its job says so rather
  than showing an empty log.
- The stand-in engine can be told to fail `graph.build` with the engine's
  route-type sentence, as it already fails other methods on request.
