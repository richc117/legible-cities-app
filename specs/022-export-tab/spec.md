# Feature Specification: The export tab

**Feature Branch**: `A5-01-export-tab`

**Created**: 2026-09-12

**Status**: Draft

**Input**: Planned issue A5-01, "Export tab: presets and storyboards from
the engine, options, live preview with frame and safe zones". A5-02b built
the whole path - `export.plan`, the capture in its own window, then
`export.encode`, with progress, cancel, the sidecar JSON and "Reveal" - for
one preset, `instagram-reel`, from one button. `OFFERED_PRESETS` in
`src/shared/export.ts` is the only thing keeping the other presets out. The
engine already answers `export.presets` and `export.storyboards`, and
`export.plan` already takes every option below.

## Overview

A project can be exported today as one reel with the engine's defaults.
After this feature the project panel has two tabs, **Map** and **Export**.
Map holds what it holds now: the diagnostics, the line colours, the line
order and the theme. Export holds a chooser for the preset, grouped by
platform; a storyboard chooser for video presets; the options a preset
takes; and the export itself, with the same progress line, cancel and
"Reveal" as today.

While the Export tab is open, the map's own frame becomes the preview. It
is navigated to the address `export.plan` returns for the current choices,
with the platform's safe zones drawn. So a person sees the frame, the
title, the clock and the region the platform covers with its own
interface, before anything is captured. Leaving the tab puts the plain map
back.

The choices are the project's own. The last preset, storyboard and options
are written to the project record, the way the theme is, so reopening a
project shows what it was last set to export.

The engine is the source of every list and every refusal. The app offers
thirteen of its sixteen presets, the social ones, and says nothing about a
preset or storyboard of its own.

## Decisions taken before this spec

Answered by the maintainer on 2026-09-12:

- **Which presets.** The thirteen social presets: `instagram-post`,
  `instagram-square`, `instagram-story`, `instagram-reel`,
  `instagram-reel-gif`, `linkedin`, `linkedin-link`, `linkedin-video`,
  `linkedin-gif`, `bluesky`, `bluesky-video`, `bluesky-gif` and `x`. The
  three `portfolio-*` presets are the published site's own deliverables,
  and `portfolio-svg` is vector, which `export.plan` refuses.
- **Where the preview is.** In the map's own sandboxed frame, re-navigated
  while the Export tab is open, at the preset's aspect ratio. Not a second
  frame: the viewer's bridge holds one frame per project.
- **Remembered.** Per project, in the record.
- **The tab strip** is a `Tabs` control in `src/renderer/src/kit/`
  following the WAI-ARIA tabs pattern, inside the project panel. `App.tsx`
  is not restructured; the three-region layout of `docs/DESIGN.md`
  section 9 is A1-03's.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Exporting any social preset (Priority: P1)

A person opens a laid-out project, opens the Export tab, picks "LinkedIn -
video", and presses Export. A LinkedIn video is written to the export
folder with its sidecar beside it. They pick "Instagram - post", press
Export again, and get a still.

**Why this priority**: it is the issue; everything else dresses it.

**Independent Test**: against the stand-in engine, export one still, one
video and one GIF preset from the tab, and read the files, the sidecars and
the requests the stand-in received.

**Acceptance Scenarios**:

1. **Given** the Export tab, **When** it opens, **Then** the preset chooser
   lists the thirteen offered presets that `export.presets` returns,
   grouped by platform, each named with its size and kind; a preset the
   engine does not return is not offered.
2. **Given** any offered preset, **When** Export is pressed, **Then**
   `export.plan` is asked for that preset with the chosen options, the
   capture runs, `export.encode` writes the file, and the sidecar JSON
   carries the same fields `bin/export` writes.
3. **Given** a reel, a post and a GIF for each of Instagram, LinkedIn and
   Bluesky, **When** each is exported, **Then** each takes one press, and
   each file has the preset's dimensions and format.
4. **Given** an export running, **When** Cancel is pressed, **Then** it
   stops as it does today and nothing is written.

---

### User Story 2 - Seeing the export before making it (Priority: P1)

A person picks "Instagram - story". The map's frame reshapes to a tall
frame, the title and the clock appear where the export will put them, and
the top and bottom bands Instagram covers are shaded. They turn the title
off; the preview loses it.

**Why this priority**: an export takes minutes, and a story whose title
sits under Instagram's own interface is only found after them.

**Independent Test**: against the stand-in, change each option and read
the address the frame is navigated to.

**Acceptance Scenarios**:

1. **Given** the Export tab, **When** it opens, **Then** the map's frame is
   navigated to the address `export.plan` returns for the current choices
   with `safe` on, and it keeps the preset's aspect ratio inside the space
   the map had.
2. **Given** a preset whose `safe_zones` is true (the stories and reels),
   **When** it is previewed, **Then** the safe zones are drawn; for one
   whose `safe_zones` is false, the address does not ask for them.
3. **Given** any option, **When** it changes, **Then** the preview's
   address is planned again and reflects it.
4. **Given** the Map tab, **When** it is chosen again, **Then** the frame
   returns to the plain map with the page's own controls.
5. **Given** an export, **When** it is captured, **Then** the capture's
   plan never has `safe` on, whatever the preview showed.

---

### User Story 3 - Choosing how a video plays (Priority: P2)

A person picks a video preset. A storyboard chooser appears, set to the
preset's own storyboard. They pick "tour" and export.

**Why this priority**: the storyboard decides what a video is about, but
every video preset already has a sensible default.

**Independent Test**: against the stand-in, choose a storyboard and read
`export.plan`'s parameters.

**Acceptance Scenarios**:

1. **Given** a video or GIF preset, **When** the tab is read, **Then** a
   storyboard chooser lists `export.storyboards`, each named with its views
   and length, and is set to the preset's own storyboard.
2. **Given** a still preset, **When** the tab is read, **Then** there is no
   storyboard chooser.
3. **Given** a storyboard that visits the geographic view and a feed with
   no geographic geometry, **When** it is previewed or exported, **Then**
   the engine's refusal is shown in its own sentence where the choice was
   made, and Export is not offered until the choice changes.

---

### User Story 4 - The options (Priority: P2)

A person turns the clock off, keeps only two lines, starts a still at
07:30, chooses draft quality to check it quickly, and adds a tag so the
draft does not overwrite the last good file.

**Acceptance Scenarios**:

1. **Given** the tab, **When** it is read, **Then** it offers view,
   labels, title, clock, the start time (`at`), the lines to keep, quality
   (draft, standard, high) and a filename tag, each defaulting to what
   `export.plan` does when the option is not sent. View and the start time
   are offered for still presets only (see "Decided during review").
2. **Given** the lines option, **When** it is opened, **Then** it lists the
   project's own lines by the same labels the line colours use; none chosen
   means every line.
3. **Given** a tag, **When** it is typed, **Then** it is held to the
   engine's `Token` pattern before it is sent, and a refusal says why.
4. **Given** the project's theme, **When** anything is exported or
   previewed, **Then** it is the project's (A4-03); the tab does not offer
   a theme of its own.

---

### User Story 5 - The choices are remembered (Priority: P3)

A person sets up a LinkedIn video with the "day" storyboard, closes the
project, and opens it a week later. The Export tab still says LinkedIn
video, "day".

**Acceptance Scenarios**:

1. **Given** a change to the preset, storyboard or an option, **When** it
   is made, **Then** the record is written with it and `modified`; a text
   field is written when it is committed, not on every keystroke.
2. **Given** a record from before this feature, **When** it is opened,
   **Then** the tab starts on `instagram-reel` with the engine's defaults,
   which is what the one button did.
3. **Given** a record naming a preset or storyboard the engine no longer
   returns, **When** the tab opens, **Then** it falls back to
   `instagram-reel` and its default storyboard, and says the saved choice
   is no longer offered. A record naming a preset outside the app's
   thirteen is reset to the reel when it is read, without a notice.

---

### Edge Cases

- **A project never laid out** has no page, so there is nothing to
  preview. The Export tab says so and offers no Export, as the button does
  today.
- **A run in flight.** A layout run, re-layout, chosen day, recolour or
  reorder rewrites the page in place. The preview is not reloaded during
  one, and Export is disabled as it is today.
- **An export in flight.** The choices are disabled. The export planned
  from the record as it was, and a change now could not reach the file
  being made. Leaving the tab does not cancel the export.
- **Changing tabs during an export** keeps the export's progress where the
  export was started, and returning to the tab shows it.
- **Planning is slow or refused.** The preview keeps its last good address
  and shows the refusal in a sentence; a refused plan never blanks the
  frame.
- **Many changes in a row** (a person tabbing through a group of
  checkboxes) plan once when they stop, not once per change.
- **The engine is away.** The tab says the engine is not running and offers
  nothing, as the layout panel does.
- **A read-only record** shows the tab with its choices disabled, and is
  not exportable: the main process refuses to export a record a newer app
  wrote, and the tab says so rather than offering a button that fails.
- **`speed`** is in the issue's list of options, but not in the engine's
  `ExportOptions`: the page plays a storyboard at the speed its beats say.
  It is not offered, and no engine issue is filed yet (see Assumptions).
- **`fade`** is in `ExportOptions` but not in the issue. It is not offered.

### Decided during review

These were decided while the build was reviewed, and change what the sections above first said:

- **View and the start time are stills-only.** Every storyboard's first
  beat names its own view and clock, and the capture applies them, so
  either option beside a video or GIF changed the preview and not the file.
  A record that holds them for a playing preset keeps them; they are not
  sent.
- **JPEG stills are standard quality only.** The app captures PNG, and at
  draft and high the engine keeps the capture unchanged, which would put
  PNG bytes under a `.jpg` name. Which presets are JPEG is read from
  `export.presets`.
- **A read-only project is not exportable**, and **a preset outside the
  thirteen is reset on read without a notice** (above).

## Requirements _(mandatory)_

- **FR-001**: The project panel MUST have two tabs, Map and Export, built
  from a `Tabs` kit control that follows the WAI-ARIA tabs pattern (arrow
  keys move between tabs, one tab stop, `aria-selected`, `aria-controls`).
- **FR-002**: The Export tab MUST offer exactly the thirteen social presets
  named above that `export.presets` also returns, grouped by `platform`.
  `OFFERED_PRESETS` MUST list them, checked against the generated
  `PresetName` type.
- **FR-003**: The storyboard chooser MUST appear for video and GIF presets
  only, list `export.storyboards`, and default to the preset's own.
- **FR-004**: The options MUST be view, labels, title, clock, `at`, lines,
  quality and tag, sent as `ExportOptions`, with an option left at its
  default not sent. View and `at` MUST be offered and sent for still
  presets only; a still the engine's table says is `jpg` MUST be offered
  and sent at standard quality only. The main process applies both rules
  when it builds a plan, whatever the record holds.
- **FR-005**: While the Export tab is open and the project has a page, the
  map's frame MUST show the address `export.plan` returns for the current
  choices with `safe: true`, sized to the preset's aspect ratio. The frame
  MUST keep `sandbox="allow-scripts"` and nothing else, and MUST still be
  attached through the main process (ADR-028).
- **FR-006**: An export MUST be planned with `safe` absent or false.
- **FR-007**: A refusal from `export.plan`, for the preview or the export,
  MUST be shown in the engine's own sentence, and MUST NOT blank the
  preview.
- **FR-008**: The preset, storyboard and options MUST be written to the
  project record, validated in the main-side handler and in the store, and
  read back with defaults for a record that lacks them.
- **FR-009**: Preview planning MUST be debounced, and a plan that answers
  after a newer one has been asked for MUST be dropped.
- **FR-010**: Every control MUST be keyboard-reachable and labelled; the
  tab MUST honour reduced motion (no animated resize of the frame when it
  is set); new text and control pairs MUST be in the contrast test; the
  `Tabs` component MUST be added to `docs/DESIGN.md` section 8.2.
- **FR-011**: The stand-in engine MUST answer `export.presets`,
  `export.storyboards` and `export.plan` for every offered preset, so the
  end-to-end tests run without Docker.

## Success Criteria _(mandatory)_

- **SC-001**: Each of the thirteen offered presets can be exported from the
  tab with one press, and its file and sidecar match what `bin/export`
  writes for the same preset and options.
- **SC-002**: The preview's address changes with every option, and shows
  safe zones exactly for the presets whose `safe_zones` is true.
- **SC-003**: No exported file is ever made with safe zones drawn.
- **SC-004**: A project reopened shows the preset, storyboard and options
  it was left with.
- **SC-005**: The tab strip and every control can be operated from the
  keyboard alone, and pass the existing accessibility checks in the
  end-to-end suite.

## Assumptions

- `export.plan` is pure and instant (its description says so), so planning
  on each settled change is cheap enough for a preview.
- The address `export.plan` returns for a project's page, with its `page`
  set to the project's `app://local` address, matches the prefix the viewer
  bridge attaches by, so the preview frame is attached as the map is.
  Checked against `src/main/viewer.ts` rather than assumed.
- The page's `safe=1` draws the safe zones as the engine's presentation
  mode draws them (`present.js`); the app draws nothing of its own
  (principle I).
- A `speed` option would be an engine change (E-series), not an app one.
  It is left out rather than filed, because nothing in the issue says a
  person has asked for it.
