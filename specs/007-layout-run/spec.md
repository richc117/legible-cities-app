# Feature Specification: The layout run

**Feature Branch**: `A3-01-layout-run`

**Created**: 2026-09-08

**Status**: Draft

**Input**: Planned issue A3-01, "Run the four LOOM stages and the map build with per-stage progress; cache reuse; force rebuild".

## Overview

A project can be created, opened, renamed and deleted, and the app can ask
the engine anything in types. What it cannot do is produce a map. This
feature is the first time a person presses something and a map comes out:
one action on the project view runs the layout and the map build, reports
each stage as it finishes, and leaves a page the viewer will load.

It is also the first feature to store something the app must keep a promise
about. The constitution says a project's layout is computed once and
stored, and that every later render reads it rather than re-running it. The
engine at the pinned version cannot enforce that: its cache is keyed by the
feed alone and its map build rebuilds any missing stage without being asked.
So this feature does what it can honestly do, which is to record exactly
which layout a project was drawn from and to say so plainly when that
layout has changed underneath it. The enforcement arrives with the engine's
own hashed cache (E04); the detection is useful with or without it, because
it is what a later determinism test compares.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A map comes out (Priority: P1)

Someone opens a project that has never been laid out and presses "Lay out".
The stages appear one after another as each finishes, each with the
engine's own sentence about what it produced. When the run ends the project
shows that it has a layout and a service day, and the generated page exists
where the viewer will look for it.

**Why this priority**: It is the feature. Everything else here qualifies it.

**Independent Test**: Create a project on a preset feed, press the button,
watch the stages, and confirm the page is on disk and the record names a
layout.

**Acceptance Scenarios**:

1. **Given** a project with no layout, **When** the person lays it out, **Then** each stage appears as it finishes with the engine's sentence, and the last one leaves the project showing a layout and a service day.
2. **Given** a run in progress, **When** the person cancels it, **Then** no engine process survives, the project keeps whatever it had before, and the screen says the run was cancelled.
3. **Given** a run that the engine refuses, **When** the failure arrives, **Then** the stage it failed on is marked failed and the engine's own sentence for a person is shown, not a code and not a path.
4. **Given** a laid-out project, **When** it is opened again, **Then** nothing runs and the stored layout and service day are shown as they were.

---

### User Story 2 - The project remembers which layout it was drawn from (Priority: P1)

A project records an identifier for the layout it was drawn from, and its
service day. Both are written once and not recomputed. Opening the project
later shows the same map, from the same stored layout, without running
anything.

**Why this priority**: This is the constitution's third principle in
practice, and it is what a later determinism test compares. Without it the
map is a thing that happened once rather than a thing the project has.

**Independent Test**: Lay a project out, read its record, lay out a second
project on the same feed, and confirm the first project's stored identifier
is unchanged and still describes what is on disk.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** the record is read, **Then** it carries an identifier derived from the layout's own contents and a service day, and neither changes on a later open.
2. **Given** two projects on the same feed, **When** both are laid out, **Then** both record the same identifier, because they were drawn from the same layout.
3. **Given** a project whose layout has changed on disk since it was drawn, **When** the person lays it out again, **Then** the app reports that the layout it was drawn from is not the one there now, and the new identifier replaces the old one only when the run completes.

---

### User Story 3 - Nothing is left behind (Priority: P2)

A run that is cancelled, fails, or is interrupted by quitting leaves no
engine process, no half-written record, and no claim in the project that is
not true of what is on disk.

**Why this priority**: The supervisor already guarantees no process
outlives the app. What is new here is a record that could disagree with the
disk, and that is a promise this feature introduces and must therefore keep.

**Independent Test**: Cancel during a run and confirm the record is
untouched; kill the app during a run and confirm the same on the next
launch.

**Acceptance Scenarios**:

1. **Given** a run in progress, **When** it is cancelled, **Then** the record is not written at all, and the previous layout and service day remain.
2. **Given** a run in progress, **When** the app quits, **Then** no engine or layout-tool process survives and the record is unchanged.
3. **Given** a run that fails at any stage, **When** the failure is handled, **Then** the record is not written.

---

### Edge Cases

- The engine is not ready when the button is pressed: the action is refused with the state's own sentence, and nothing is written.
- The feed's archive is not on the machine: the engine downloads it, which can be slow and can fail without a network. The failure is the engine's sentence; the app does not describe it as a rendering problem.
- The layout stages are already cached: the run still reports them, each finishing immediately, because the person asked for a layout and deserves to see what was reused rather than a screen that does nothing for a second.
- Two runs at once, on the same project or on two projects: only one run per project, and the second is refused rather than queued.
- The project's stored layout identifier no longer matches what is on disk: the next run says so. Nothing checks on open, because the only way to ask the engine is a request that would rebuild whatever is missing, which is the thing this feature exists not to do behind a person's back.
- The service day the app resolves has no service in the feed: the engine still produces a map, and its own sentence for the schedule stage says how many trips it found, which may be none. Choosing a better day is the service-date picker's job, not this feature's.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: A person MUST be able to run the layout and the map build for a project from the project's own screen, in one action, without choosing anything first.
- **FR-002**: The app MUST report each stage as the engine finishes it, in order, with the engine's own sentence about what that stage produced. It MUST NOT invent a sentence for a stage the engine has not reported.
- **FR-003**: Because the engine reports a stage only when that stage finishes, and the sentence describes the stage that finished, the app MUST attribute each sentence to the stage it describes, and MUST show the next stage as running without a sentence of its own until it too finishes.
- **FR-004**: A person MUST be able to cancel a run at any point, and cancelling MUST leave no engine or layout-tool process and MUST leave the project's record exactly as it was.
- **FR-005**: The app MUST write the project's record only when a run completes, and MUST write the layout identifier, the service day and the modification time together or not at all.
- **FR-006**: The app MUST derive the layout's identifier from the layout's own contents, so that two projects drawn from the same layout record the same identifier and a changed layout produces a different one. It MUST NOT use a timestamp, a counter or a path.
- **FR-007**: The app MUST resolve the project's service day once, at its first layout, store it, and use the stored day for every later build. It MUST NOT recompute it, because a day chosen afresh would depend on when the person asked (ADR-023).
- **FR-008**: The app MUST compare the layout it has just built against the identifier the project stored, and MUST report a difference in a sentence when the project was drawn from a different layout than the one now on disk. The comparison MUST happen when a run is made, not when a project is opened: asking the engine for the layout's identity would rebuild any stage that is missing, which is the thing this feature exists not to do behind a person's back.
- **FR-008a**: The project's screen MUST show the stored layout identifier and the stored service day, so a person can see what the map was drawn from without running anything.
- **FR-009**: The generated page MUST be written where the app already serves a project's output, so that the viewer needs no copying and no second location.
- **FR-010**: The app MUST refuse a second run for a project that is already running, and MUST say why rather than queueing it.
- **FR-011**: A run MUST be refused with the engine state's own sentence when the engine is not ready, and nothing MUST be written.
- **FR-012**: A failure MUST show the engine's sentence written for a person, and MUST NOT show a path, a code or a stack trace on screen; the detail belongs in the log.
- **FR-013**: The run's progress MUST be drawn with the design system's progress component and its tokens, and MUST be keyboard-reachable, labelled, announced politely to assistive technology, and free of motion when motion is reduced.
- **FR-014**: The app MUST NOT send the engine a parameter the protocol does not define. In particular the project's mode and agency MUST NOT be sent, because protocol 1 does not carry them; they stay recorded and unused.
- **FR-015**: The run's behaviour MUST be testable without the engine, against a stand-in, and the tests that need the real engine MUST run where a checkout exists and skip, saying so, where it does not.

### Key Entities

- **Layout**: the four stage graphs the engine produced for a feed, taken together. It lives in the engine's home under the engine's own id, and is shared by every project on that feed with the same inputs.
- **Layout identifier**: what the project stores to say which layout it was drawn from. Since ADR-033 (A3-05) it is the engine's id, the hash of the layout's inputs, as `graph.build` answers it; before that it was the app's digest of the four stage graphs' bytes.
- **Service day**: the calendar day the map is drawn for. Resolved once at the first layout and stored; the engine never chooses one.
- **Run**: one layout and map build for one project. Has a stage list, a current stage, an outcome, and a token that cancels it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From a project with a cached layout, a person sees a finished map in under 5 seconds on a developer machine, with every stage reported.
- **SC-002**: Every stage the engine reports for a run appears on screen exactly once, in the order the engine sent them, and no stage appears that the engine did not report.
- **SC-003**: Cancelling a run leaves no engine or layout-tool process within 3 seconds, and the project's record is byte-identical to what it was before the run.
- **SC-004**: Two projects on the same feed, laid out in turn, record the same layout identifier. *Amended by ADR-033: the identifier is the engine's and names the layout's inputs, so a change to the stored set under the same id is not reported by this run; a re-layout says so itself.*
- **SC-005**: A project's service day, once stored, is the same on every later read and is what the engine is told for every later build.
- **SC-006**: Nothing in this feature sends the engine a parameter outside the protocol's own definition, proven by the types and by a test that asks the engine and reads its refusal.
- **SC-007**: A screen-reader user hears the run start, hears each stage as it completes, and hears the outcome, each once (checked by a person).

## Assumptions

These are choices the issue did not make and the ground forced. Each is
recorded here rather than buried, because two of them narrow what the issue
said it would deliver.

- **The map build is the run.** The engine's map build already runs the four
  layout stages before its own four, so the app makes one request for the
  map and one for the layout's identity rather than asking for the layout
  twice. The four layout stages are reported once, by whichever call reaches
  them first; a repeat for a stage already finished is ignored rather than
  drawn again.
- **The layout's identifier is the app's, not the engine's.** Protocol 1
  returns the stage files' paths and no identifier. The app derives one from
  those files' contents. When the engine grows its own hashed cache (E04),
  that identifier becomes the engine's and this one is replaced.
- **The service day is resolved at the first layout, not at creation.** The
  project's own records disagree about this: ADR-023 says the day is
  resolved when the project is created, while the project feature's
  specification and the architecture page say it is resolved at the first
  layout. Nothing implements either, and a project is created today with no
  day at all. This feature follows the later of the two and resolves the day
  at the first layout. **The contradiction is a governance item, not a
  detail: one of the two documents is wrong and a decision record should say
  which.**
- **The first day is the machine's today.** With no way to ask the engine
  for a feed's service window at protocol 1, there is no better source. It
  is stored the moment it is chosen, so the project is stable from then on,
  which is the part of ADR-023 that can be kept. Choosing a good day, rather
  than merely a fixed one, is the service-date picker's issue.
- **Re-layout is not in this feature.** The issue asks for an explicit
  "Re-layout" button. Forcing a rebuild at the pinned engine overwrites the
  first three stage files before the fourth runs, so a cancelled or failed
  re-layout leaves a mixed set that the engine then reads as a valid cache.
  This was verified by running it, not inferred. A button that can quietly
  destroy a project's layout is not one to ship; the engine's hashed cache
  (E04) is what makes it safe, and the alternative, having the app copy the
  stage files aside and restore them, is the app compensating for the engine
  in the engine's own directory. **This is a scope cut and the maintainer
  should decide it rather than inherit it.**
- **"Nothing re-runs the layout implicitly" cannot be enforced here.** The
  engine's map build rebuilds any missing stage without being asked. The app
  can only notice afterwards, by comparing the stored identifier with what
  is on disk, which is what FR-008 does.
- A layout that is not cached is not fast: the first stage takes about
  thirteen seconds for a large feed, the rest under a second each. The
  screen is built for a run that takes a while, not for one that returns at
  once.
- The engine may download a feed's archive during a run, whichever way the
  cache flag is set, and that is the only network this feature can cause.

## Dependencies

- A1-02, the typed client and its request handle, for the call and its progress.
- A1-05, the project record and its store, for what a completed run writes.
- A2-00, the progress component, the tokens and the control kit.
- The engine at the pinned version, for the layout and the map build.
- Not E04, deliberately: this feature is specified to work without it, and says where that costs something.
