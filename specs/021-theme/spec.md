# Feature Specification: The theme a project's map is drawn in

**Feature Branch**: `A4-03-theme`

**Created**: 2026-09-12

**Status**: Draft

**Input**: Planned issue A4-03, "Theme: warm-dark and sepia from the site's
tokens, persisted, pushed into the viewer". The engine's page has taken
`?theme=` since the first generated page, applied before paint so nothing
flashes the wrong theme; the project record has carried `theme` since A1-05
and nothing has written it; the export has passed `themeFor(project.theme)`
since A5-02b, which has meant warm-dark for every project ever made.

## Overview

The engine's page draws itself in one of two themes: warm-dark, which is
the default, and sepia, which is the cream of the pocket map. Today the map
on screen follows the *interface's* theme, which follows the operating
system, and that was always a placeholder: the viewer says so in a comment
naming this issue. It is the wrong model. The theme is a property of the
thing being made, not of the room the maker is sitting in - it is exported,
it is published, and a person choosing sepia for a map does not thereby
want a sepia interface, nor the other way round.

After this feature the project screen carries a theme switch: two named
options, the project's own, written the moment it is pressed. The map
reloads in it, every later export is made in it, and reopening the project
draws it again. The interface keeps its own theme in Settings (A1-04),
unchanged and independent.

Nothing is rebuilt for a theme. The engine's SVG carries its colours as CSS
variables with literal fallbacks, so the page restyles its furniture from
the address alone; the line colours are not themed and do not move. A theme
is not even a render, let alone a layout.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Choosing the theme a map is drawn in (Priority: P1)

A person opens a project, presses "Sepia", and the map is redrawn in it a
moment later. They close the project and open it again; it is still sepia.

**Why this priority**: it is the issue.

**Independent Test**: against the stand-in engine, press each option and
read the frame's address and the record on disk.

**Acceptance Scenarios**:

1. **Given** a project, **When** the screen is read, **Then** the theme
   switch shows which of the two the project is drawn in.
2. **Given** the switch, **When** the other theme is pressed, **Then** the
   record's `theme` is written at once, the viewer's frame reloads with
   `theme=` naming it, and no engine request is made at all.
3. **Given** a themed project, **When** it is closed and opened again,
   **Then** the same theme is shown and the map is drawn in it.
4. **Given** a project that has never been laid out, **When** the theme is
   changed, **Then** the record is written and nothing else happens; there
   is no map to redraw yet.

---

### User Story 2 - The theme the export is made in (Priority: P1)

A person sets a project to sepia and exports it. The reel is sepia.

**Why this priority**: the export is the deliverable, and a map that looks
one way on screen and another in the file is the worst of both.

**Independent Test**: against the stand-in, export a sepia project and read
the `export.plan` the stand-in received and the sidecar it wrote.

**Acceptance Scenarios**:

1. **Given** a sepia project, **When** it is exported, **Then**
   `export.plan` is asked for `theme: "light"`, which is the engine's name
   for it, and the page the capture drives carries `theme=sepia`.
2. **Given** a warm-dark project, **When** it is exported, **Then**
   `export.plan` is asked for `theme: "dark"`, as it has been since A5-02b.

---

### User Story 3 - The interface's theme is a separate thing (Priority: P2)

A person works in a light interface and makes dark maps, or the other way
round, and neither follows the other.

**Why this priority**: it is the behaviour this feature changes, so it is
the one most likely to surprise. Until now the map followed the interface.

**Independent Test**: set the interface to sepia in Settings, open a
warm-dark project, and read the frame's address.

**Acceptance Scenarios**:

1. **Given** a warm-dark project, **When** the interface is sepia, **Then**
   the map is drawn warm-dark.
2. **Given** a sepia project, **When** the interface follows a dark system,
   **Then** the map is drawn sepia.

---

### Edge Cases

- **A record from before this feature** carries `theme: "warm-dark"`,
  because that is what every project was created with, so nothing a person
  has already made changes appearance.
- **A record naming a theme the app does not know** reads as warm-dark, as
  it already does, and the switch shows warm-dark.
- **A run in flight.** A layout run, a re-layout and a chosen day all end
  in `map.build`, which writes the project's page **in place** rather than
  into a scratch file and renaming: `animate.write` is a plain
  `write_text`. A theme change reloads the frame that reads that page, so a
  press mid-run can load half a document, and the viewer then says the map
  is not there - which is false and alarming, and clears itself when the
  run finishes. The switch is disabled while a run is going.
- **An export in flight.** The switch is disabled then too, for a different
  reason: the export read the record's theme when it planned, so a change
  now could not reach the reel being made. The capture never reads the
  viewer's frame - it drives a window of its own in its own session
  (ADR-024) - so it is not the frame that is at stake here, only the
  agreement between what a person sees and what they get.
- **What a theme press costs.** The theme rides on the page's address, so
  the press is a navigation rather than a restyle: the page starts again,
  with its clock back at the hour it opens on and the view, the scrub
  position and the line toggles a person had chosen gone with it. It is
  cheap next to a build and it is not nothing. The seam the app drives the
  page through has no theme method, so there is no cheaper route today;
  that is engine issue 29, filed, and not this feature's to fix.
- **Two presses inside one write.** The second is kept and applied when the
  first settles, rather than dropped: a press a person cannot see refused
  is indistinguishable from a dead button, and the button that would undo
  it already reads as chosen.
- **A read-only record**, written by a newer version of the app: the switch
  is absent, as the rest of the project's editing is.

## Requirements _(mandatory)_

- **FR-001**: The project screen MUST offer the two themes, showing which
  one the project is drawn in.
- **FR-002**: Pressing one MUST write the record's `theme` at once, with
  `modified`, and MUST make no engine request.
- **FR-003**: The viewer MUST draw the project's theme, and MUST NOT follow
  the interface's.
- **FR-004**: A theme MUST reach the page as `theme=` on its address, so it
  is applied before the first paint.
- **FR-005**: An export MUST be made in the project's theme.
- **FR-006**: The theme crossing the bridge MUST be one of the two the
  record can hold, checked in the main-side handler and in the store.
- **FR-007**: The switch MUST be keyboard-reachable, named, and say which
  option is chosen to a screen reader; both themes MUST hold their contrast,
  which the token tests already assert.
- **FR-008**: The switch MUST be disabled while a run or an export is
  going, and MUST say so where the switch is. The run's own panel is
  elsewhere on the screen and is tied to this section by nothing an
  assistive technology can follow, so a person who arrives here during a
  debounced rebuild would otherwise meet two dead buttons and no reason.
  Focus MUST be handed to the section's heading before the buttons go,
  because a run can start from a timer rather than a press.
- **FR-009**: A press that arrives while a write is in flight MUST be
  applied when that write settles, not dropped.

## Success Criteria _(mandatory)_

- **SC-001**: A project set to sepia is drawn sepia on screen, in its
  export, and again when it is reopened.
- **SC-002**: A theme change makes no request of the engine and no write
  outside the record.
- **SC-003**: The interface's theme and a project's theme move
  independently.
- **SC-004**: Two exports of one project under one theme agree. **This is
  A5-04's gate, not this feature's**: the pixel comparison runs app against
  app on three runners, and nothing here changes the capture path. What is
  asserted here is that the theme reaches the plan and the page.

## Assumptions

- The engine's page reads `?theme=`, treats anything but `sepia` as
  warm-dark, and applies it before paint. Checked against the pinned engine
  rather than assumed.
- The engine's export vocabulary is `dark` and `light`, and it turns
  anything that is not `dark` into `theme=sepia` on the page's address. The
  app's `themeFor` has mapped the record's two onto those since A5-02b.
