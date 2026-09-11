# Feature Specification: The export

**Feature Branch**: `A5-02b-export`

**Created**: 2026-09-10

**Status**: Draft

**Input**: Planned issue A5-02b, "Export one preset: plan → capture →
encode, with progress, cancellation, the sidecar JSON and reveal in
Finder/Explorer". The second half of the first reel: the capture (A5-02a,
`specs/009-capture`) between the engine's `export.plan` and
`export.encode` (engine E10 and E09b, pinned at v0.3.0), from one button on
the project screen.

## Overview

A person opens a laid-out project and presses "Export reel". The app asks
the engine to plan the `instagram-reel` preset for that project's page and
service day, takes the frames itself in its offscreen window, asks the
engine to encode them, and ends with the file's name on screen and a button
that shows the file in the platform's file browser. The three stages are on
the progress line, the export can be stopped at any of them, nothing is
left behind when it is stopped or fails, and two exports of one project are
the same reel.

This feature is the flow and its screen: one preset, no options, no chooser
for the folder. The other presets and the export's options are A5-01; the
folder chooser is A1-04's Settings.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - One click gives the reel (Priority: P1)

A person with a laid-out project presses one button and, some minutes
later, has the reel and its sidecar in a folder they can find.

**Why this priority**: it is the first reel, the milestone the whole path
since the 7 September re-plan leads to.

**Independent Test**: press the button against the stand-in engine and the
stand-in page; read the file and the sidecar.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** "Export reel" is pressed, **Then**
   the progress line shows plan, capture and encode in turn, with a
   sentence for each, and ends with "Exported <file>." and a "Reveal"
   button.
2. **Given** the export finished, **When** the folder is opened, **Then** it
   holds the file under the export folder in a folder named after the
   project, with the sidecar beside it carrying the project's own service
   day.
3. **Given** the export finished, **When** "Reveal" is pressed, **Then** the
   platform's file browser shows the file.
4. **Given** the real Los Angeles page and the real engine, **When** the
   reel is exported twice, **Then** the two files decode to the same frames
   within a channel tolerance of 8 in RGB.

---

### User Story 2 - It can be stopped, and leaves nothing (Priority: P1)

A person changes their mind during the plan, the capture or the encode.
Whatever stage it was in, the export ends as cancelled, no file and no
sidecar exist, and no frames are left under the engine home. The same
holds when the export fails, and when the app quits.

**Why this priority**: an export is minutes long and writes hundreds of
frames; a stop that leaves a half-written reel or a folder of frames is
worse than no stop.

**Independent Test**: cancel during the capture and during the encode
against the stand-in; quit during the capture; count what is left.

**Acceptance Scenarios**:

1. **Given** a running capture, **When** cancelled, **Then** the export ends
   cancelled, the frames folder is gone, and the encode is never asked.
2. **Given** a running encode, **When** cancelled, **Then** the engine's
   request is cancelled, the partial file and its sidecar are removed, and
   the frames folder is gone.
3. **Given** an encode that fails, **When** it does, **Then** the engine's
   own sentence is on screen, nothing is written, and the frames are gone.
4. **Given** a running export, **When** the app quits, **Then** the capture
   window is destroyed before the engine stops, and the next start removes
   whatever frames a crash would have left.

---

### User Story 3 - The page never learns a path (Priority: P1)

The interface shows the file's name and offers to reveal it; it never shows
or holds the path. The folder the file went to is the main process's
knowledge, from the configuration.

**Why this priority**: constitution V, and the rule every earlier screen
kept.

**Independent Test**: read every sentence the export puts on screen.

**Acceptance Scenarios**:

1. **Given** any state of the export, **When** the region's text is read,
   **Then** it contains no path separator.
2. **Given** a finished export, **When** the page asks to reveal it,
   **Then** it names the export by its token and the main process opens the
   file it remembers writing.

---

### User Story 4 - A layout and an export never overlap (Priority: P2)

An export reads the project's page; a layout run rewrites it. While one
runs, the other's button is disabled, and so is delete.

**Independent Test**: start one, read the other's button.

### Edge Cases

- A project that is read-only, or has no layout or no service day, is
  refused before the engine is asked, with a sentence.
- The engine's plan is checked by the capture's own validator before a
  window exists: a page off the app's origin, a scale the capture does not
  do, a first beat that pins no clock, are refused with the validator's
  sentence.
- A file name in the plan that could be a path is refused.
- A project's name becomes a folder name: what a filesystem refuses becomes
  a hyphen, and a name with nothing left, or one Windows reserves, falls
  back to the identifier.
- A second export of the same project replaces the first, as the engine's
  own command line does; the pipeline is deterministic, so it is the same
  file.
- A second export of the same project while one runs is refused; a second
  project may export at the same time. Two projects with one name and one
  feed resolve to one file: a later export replaces the earlier, as it does
  for one project, and while one is writing the file the other is refused
  with a sentence.
- The engine can die while writing the file. Its own cleanup dies with it,
  so the screen says so and offers to export again, rather than promising
  that nothing was written.
- On macOS the window can be closed and reopened while an export runs. The
  reopened page's export starts from nothing and is told the project is
  already being exported; the running export finishes in the main process,
  but that page cannot stop it. The same holds for a layout run; the jobs
  drawer (A1-03) is where a page learns about jobs that predate it.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The export MUST run in the main process, over the capture of
  `specs/009`, and the page MUST reach it only through `api.export`: run,
  cancel, reveal, and a progress subscription.
- **FR-002**: `export.plan` MUST be asked for the project's feed, the
  offered preset, the project page's address on the app's origin, the
  project's stored service day and the record's theme; nothing else.
- **FR-003**: The capture half of the plan MUST be validated by the
  capture's validator before a window exists, and the plan's file name MUST
  be a bare name.
- **FR-004**: The frames MUST go under the engine home, in a folder of the
  export's own, and MUST be removed when the export ends, whichever way;
  a start of the app MUST remove the whole frames folder.
- **FR-005**: `export.encode` MUST be given the plan unchanged, the frames
  folder, the destination under the export folder in a folder named after
  the project with the plan's file name, and the project's service day as
  provenance.
- **FR-006**: The export folder MUST be `LEGIBLE_EXPORT_FOLDER` when set,
  and a `Legible Cities` folder on the desktop otherwise; nothing MUST be
  written inside the user-data folder or the bundle (ADR-016).
- **FR-007**: Progress MUST be reported per stage, with a fraction and a
  sentence, on the same ordered channel as the outcome, and the outcome
  MUST arrive after the last report.
- **FR-008**: Cancellation MUST reach the export wherever it is: the plan
  request, the capture's signal, or the encode request; and MUST end the
  export as cancelled, distinct from failed.
- **FR-009**: The page MUST be told the file's name and never its path;
  the reveal MUST take the export's token.
- **FR-010**: Every argument over the bridge MUST be validated on the main
  side: a token, a project identifier, an offered preset; only the window's
  top frame may call.
- **FR-011**: A quit MUST cancel every export before the engine is stopped.
- **FR-012**: The export's control MUST be keyboard reachable and labelled,
  its progress line MUST be the design system's, and reduced motion MUST
  be honoured.

### Key Entities

- **Export**: one preset of one project's page, from plan to file; known to
  the page by a token.
- **Plan**: the engine's `CaptureJob`: the recorder's job and what the
  encode needs back, handed back unchanged.
- **Frames folder**: `<SCHEMATIC_HOME>/frames/<token>/`, while the export
  runs.
- **Deliverable**: `<export folder>/<project>/<file>` and its sidecar
  `<file>.json`.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Against the stand-in engine and page, one click ends with the
  file, its sidecar carrying the project's service day, an empty frames
  folder and no path on screen, in every run of the end-to-end suite on
  three platforms.
- **SC-002**: A cancel during the capture and a cancel during the encode
  each leave no file, no sidecar and no frames; a failed encode shows the
  engine's sentence and leaves the same nothing; a quit mid-export and a
  start with a stale frames folder leave the folder empty.
- **SC-003**: The Los Angeles reel exported twice on a machine with the
  engine checkout and ffmpeg decodes to the same number of frames with no
  channel differing by more than 8; the run's timings and whether the two
  files are byte-identical are recorded in the pull request. *Run
  2026-09-10 on an Apple Silicon laptop against engine v0.3.0 and ffmpeg
  9.0.1: the two exports took 120 s and 123 s (750 frames at 2160 by 3840,
  encoded to 1080 by 1920), the file is 1.95 MB, the two files are
  byte-identical, and the 4.67 GB of decoded RGB differ in no channel at
  all.*
- **SC-004**: The sidecar beside the real reel carries the fields
  `bin/export` writes: file, bytes, feed, city, network, preset, platform,
  size, view, storyboard, theme, alt, service_date, caveats.

## Assumptions

- The engine at v0.3.0 answers `export.plan` with a job whose first beat
  pins the clock (every storyboard in its tables does) and whose page is the
  one the app passed.
- In a development build ffmpeg is on the PATH the supervisor passes; the
  vendored binary is A0-10's.
- Standard quality is the engine's default: frames at scale 2, resampled
  to the preset's size. The cost is minutes per reel; the export's options,
  quality among them, are A5-01's.

## Dependencies

- A5-02a (done): the capture.
- E10, E09b (done, engine v0.3.0): `export.plan` and `export.encode` over
  the protocol; the app pins v0.3.0.
