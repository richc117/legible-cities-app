# Feature Specification: The capture

**Feature Branch**: `A5-02a-capture`

**Created**: 2026-09-10

**Status**: Draft

**Input**: Planned issue A5-02a, "Capture: an offscreen window takes a
page's frames (ADR-024)". The first half of the first reel: the app takes
the frames of a project's page itself, in its own process, the way spike
A0-07 measured and ADR-024 decided. The other half, one preset exported over
the engine's `export.plan` and `export.encode`, is A5-02b.

## Overview

An export is a sequence of frames of the engine's animation page, one per
`1/fps` of the page's own clock, encoded afterwards. The engine's recorder
takes them with Playwright; the app does not ship Playwright or a second
browser, so it takes them with the Chromium it already has: a hidden
offscreen window, navigated to the project's page, emulated to the preset's
size and scale through the DevTools protocol, stepped by hand and
screenshotted at a CSS-pixel clip of the stage. Two runs of one job are
byte-identical; what the machine is plugged into does not matter; nothing in
the window can reach the app.

This feature is that capture and nothing around it: no preset, no plan from
the engine, no encode, no button. It takes a job in the recorder's own shape
and a directory, and it fills the directory with PNGs or leaves nothing.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The same job gives the same frames (Priority: P1)

A person exports the same project twice, a week apart, and the two files
are the same file. The frames underneath them are byte-identical, on the
machine they used and on any other, whatever display is attached.

**Why this priority**: it is the constitution's third principle, and the
whole reason capture was spiked before it was built.

**Independent Test**: capture sixty frames of a page twice into two
directories and compare every file.

**Acceptance Scenarios**:

1. **Given** a laid-out project and a job of two seconds at thirty frames
   per second, **When** it is captured twice, **Then** the two directories
   hold sixty frames each and every pair is byte-identical.
2. **Given** a display whose own scale factor is 2, **When** a job asks for
   scale 2, 1 or 3, **Then** the frames are the stage's CSS size times that
   factor, and the display's factor appears nowhere.
3. **Given** the interface's session carries a persisted zoom level for the
   app's origin, **When** a capture runs, **Then** the frames are the size
   the job asked for and not half of it.

---

### User Story 2 - A capture can be stopped, and leaves nothing behind (Priority: P1)

A person cancels an export a third of the way through, or the page breaks,
or the app quits. Nothing is left: no window, no debugger session, no
half-written directory of frames.

**Why this priority**: an export is the longest thing the app does, and a
window nobody can see is the easiest thing to leak.

**Independent Test**: cancel after ten frames and count windows, live
captures and directories.

**Acceptance Scenarios**:

1. **Given** a running capture, **When** it is cancelled, **Then** the
   promise rejects as cancelled, the window is destroyed, and the frames
   directory no longer exists.
2. **Given** a page whose renderer dies mid-capture, **When** the capture
   notices, **Then** it fails with a sentence naming the cause and cleans
   up the same way.
3. **Given** a page that never exposes its seam, **When** the page timeout
   passes, **Then** the capture fails naming the step, and cleans up.
4. **Given** a running capture, **When** the app quits, **Then** the window
   is destroyed before the engine is stopped.

---

### User Story 3 - The page cannot reach the app (Priority: P1)

The page is a feed's text as a top-level document. It runs in a window that
has no preload, no bridge and no node, in a session that is not the
interface's, and it cannot open a window or navigate anywhere.

**Why this priority**: ADR-028 keeps this page off the app inside the
viewer's frame; an export window that gave it a bridge would undo that
through the back door (ADR-024).

**Independent Test**: read the window's options; drive a page that tries.

**Acceptance Scenarios**:

1. **Given** the capture window's options, **When** they are read, **Then**
   there is no preload, node integration is off, context isolation and the
   sandbox are on, and the partition is the capture's own and not
   persistent.
2. **Given** a page that calls `window.open` or navigates itself, **When**
   it does, **Then** nothing opens and the page stays where it was loaded.

---

### User Story 4 - A bad job is refused before it costs a window (Priority: P2)

A job with the wrong shape - a page off the app's origin, a scale of 4, a
first beat that does not pin the clock, a clock outside the service day -
is refused with a sentence a person can act on, and no window is created
for it.

**Independent Test**: a table of bad jobs against the validator; a page
loaded at 02:00 against the preflight.

**Acceptance Scenarios**:

1. **Given** a job whose first beat names no time, **When** it is
   validated, **Then** the sentence says a beat that does not name a time
   is not reproducible.
2. **Given** a page whose clock shows no trains, **When** the preflight
   reads its state, **Then** the capture fails with the engine's own
   sentence, "no trains at HH:MM; this feed runs T0-T1", and no frame is
   taken.

### Edge Cases

- A beat that sweeps in hours starts wherever the clock already is, so a
  storyboard never jumps backwards; a sweep over a named span seeks along
  it.
- The settle wait happens with the clock already stopped. The recorder
  waits with it running on its still path, and its stills are not
  reproducible (engine notes).
- `Page.captureScreenshot` returns the last painted frame, not the state
  just set; two animation frames sit between every step and its capture.
- A preload added to the capture window later is the thing this
  specification exists to forbid.
- DevTools opened on the window detaches the debugger; nothing opens it.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The capture MUST take a job in the recorder's shape (url,
  width, height, scale, fps, settle, beats as `export.beat_payload` builds
  them) and a directory, and write `000000.png` onwards into it.
- **FR-002**: The window MUST be hidden and offscreen, with background
  throttling off, no preload, node integration off, context isolation and
  the sandbox on, and a partition of its own that is not persistent.
- **FR-003**: The capture MUST navigate before it attaches the debugger or
  emulates anything.
- **FR-004**: The capture MUST emulate the job's width, height and scale
  factor through `Emulation.setDeviceMetricsOverride`, and reduced motion
  as "no-preference".
- **FR-005**: The capture MUST call `setCapture(true)` before any wait,
  then wait for the fonts and the job's settle, then read the page's
  bounds and state, refuse a clock that shows no trains with the engine's
  sentence, measure the stage, and `settle()` before the first beat.
- **FR-006**: Every frame MUST be preceded by a step of the clock (`advance`
  of `1/fps`, or a `seek` for a sweep) and two animation frames, and taken
  with `Page.captureScreenshot` at the stage's CSS-pixel clip with scale 1
  and `captureBeyondViewport` off; never with `capturePage`.
- **FR-007**: Progress MUST be reported after every frame as done and
  total; cancellation MUST be honoured between frames.
- **FR-008**: On cancel or failure the window MUST be destroyed and the
  frames directory removed; on success the directory is the caller's.
- **FR-009**: A quit MUST destroy every capture window before the engine
  is stopped.
- **FR-010**: A job MUST be validated before a window exists: a project
  page on the app's origin, whole pixels, a scale of 1 to 3, a first beat
  that names a time or sweeps a named span.
- **FR-011**: The capture session MUST serve project pages and nothing
  else, and refuse every permission.
- **FR-012**: Every step MUST have a timeout that names the step when it
  passes.
- **FR-013**: Nothing about the capture MAY be exposed to the renderer by
  this feature; the export flow that runs it is A5-02b.

### Key Entities

- **Capture job**: the page's URL with its present-mode query, the viewport
  in CSS pixels, the scale factor, fps, the settle in milliseconds, and the
  beats. `src/shared/capture.ts`.
- **Beat**: a stretch of video with one set of state, as the engine defines
  it; fields left null carry over.
- **Frames directory**: `000000.png` onwards, the caller's on success.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Sixty frames of the stand-in page captured twice are
  byte-identical in every run of the end-to-end suite on three platforms;
  sixty frames of the real Los Angeles page are byte-identical on a machine
  with an engine checkout.
- **SC-002**: With a zoom level of 2 persisted for the app's origin in the
  interface's session, a capture at scale 2 still produces 1080 by 1920
  frames from a 540 by 960 stage.
- **SC-003**: A cancel after ten frames leaves zero windows, zero live
  captures and no frames directory.
- **SC-004**: Removing the two-frame paint wait, or the page's
  `cancelAnimationFrame` in `setCapture`, is checked once each against the
  real page and the result recorded. *Checked 2026-09-10: neither produced a
  differing frame - six runs without the paint wait, sixty frames each, and
  two without the page's cancel, all byte-identical. The reasons are known
  rather than lucky: `Page.captureScreenshot` requests a fresh compositor
  frame itself, where the spike's one-in-sixty was measured through
  `capturePage()`; and the first beat's `seek` comes hundreds of
  milliseconds after `setCapture`, so a queued frame that escapes the cancel
  moves a clock the seek then resets. Both waits stay: the rule asks for
  them, the second costs two frames' time per frame, and the page's cancel
  is the engine's test to keep.*
- **SC-005**: A real Electron that emulates before it navigates dies, and
  one that navigates first does not, checked by an opt-in test.

## Assumptions

- The engine's page exposes `window.__present` as at v0.2.1; a gated test
  in the viewer feature already asserts the methods the app uses.
- A job's first beat pins the clock. Every storyboard in the engine does;
  the validator refuses one that does not.
- The reel's numbers - 1080 by 1920, thirty frames per second - are the
  preset's; this feature does not know presets.
- Playwright is a test dependency only; nothing here ships it (ADR-024).

## Dependencies

- A3-02 (done): a project has a page under `app://local/projects/<id>/`.
- A0-07 (done, ADR-024): how the frames are taken.
- Nothing on the engine.
