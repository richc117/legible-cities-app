# Feature Specification: The map in the notebook's flow

**Feature Branch**: `029-the-map-in-the-flow`

**Created**: 2026-10-01

**Status**: Draft

**Input**: Issue 286 (A7-14), "The map in the notebook's flow: a preview
where it is made, and another for the export", and ADR-046, which this
spec carries out and which supersedes ADR-045 in part (the pinned band and
the one frame per project) and amends `specs/022-export-tab/spec.md` FR-005.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read the notebook with nothing floating over it (Priority: P1)

As someone editing a project's line colours with a dozen lines open, I want
the cells to have the whole window to be read in, so that I am not reading
cell 05 through the lower half of the screen, and so that a control I reach
with the keyboard is never hidden behind something that does not scroll.

**Why this priority**: it is the maintainer's complaint, and it is what the
two recorded gaps (#213, #240) are caused by. Everything else here makes it
possible.

**Independent Test**: open a laid-out project in a window of the size the
accessibility specs use, scroll, and Shift+Tab through cell 05: every
control reached is fully in view, and the colour picker's drag test passes.

**Acceptance Scenarios**:

1. **Given** a project with a layout, **When** it opens, **Then** the map
   is a block in the column after cell 02 and before cell 03, its
   `position` is static, and its top moves with the scroll.
2. **Given** that project, **When** a rail step is pressed, **Then** its
   cell lands clear of the header and nothing else, in CI as well as
   locally.
3. **Given** cell 05 is open, **When** focus is moved backwards through its
   controls, **Then** each control is fully in view.

---

### User Story 2 - See the map where it is made, and keep its place (Priority: P1)

As someone who has just laid out a project, I want the map right after the
cell that made it, so that I see what I made without hunting for it, and I
want it to be the same running page as I scroll, toggle cells, change a
colour, or open the export.

**Why this priority**: a map that restarts its clock when an unrelated cell
opens would be a regression from today.

**Independent Test**: play the map from cell 03's transport, scroll away
and back, open and close cell 06, and read the page's clock: it has not
jumped, and no restore was sent.

**Acceptance Scenarios**:

1. **Given** a playing map, **When** it is scrolled out of view and back,
   **Then** it resumes without a jump (the page's clock advances by wall
   time capped per frame, and Chromium stops a cross-origin frame's
   animation while it is out of view).
2. **Given** the map, **When** every cell is toggled and a colour is changed
   and redrawn, **Then** the map's frame element is the same element
   throughout.
3. **Given** a project opened with the map out of view, **When** it is
   scrolled to, **Then** it is drawn correctly fitted.

---

### User Story 3 - Preview the export where it is chosen (Priority: P2)

As someone choosing an export preset, I want a preview of the frame inside
cell 06, with the safe zones where the preset has them, so that I see what
I am about to make beside the choices that make it, without the map I was
working on being taken over.

**Why this priority**: it replaces what the band did for cell 06, and it
is what lets the map stay put.

**Independent Test**: open cell 06: two frames are in the document, the
export's inside the cell at the planned address, the map's unmoved and its
clock within a second of where it was.

**Acceptance Scenarios**:

1. **Given** cell 06 is closed, **Then** there is one frame in the
   document, and it is the map's.
2. **Given** cell 06 is opened, **Then** there are two frames, each with
   `sandbox="allow-scripts"` and exactly that, the export's inside cell 06
   at the address `export.plan` returned with `safe=1` where the preset has
   safe zones; the map's frame is never sent to an address carrying
   `safe=1`.
3. **Given** cell 06 is open, **When** cell 03's transport is used,
   **Then** it drives the map's frame and not the export's.
4. **Given** cell 06 is closed again, **Then** the export's frame is gone
   and nothing is sent to the map's.

---

### User Story 4 - A laid-out project opens on its map (Priority: P3)

As someone returning to a finished project, I want the map to be the first
tall thing I see, so that I do not scroll past two open cells to reach it.

**Why this priority**: it follows from the map moving into the flow; on a
project with no layout the open cells are what a person needs.

**Independent Test**: open a project with a layout, and one without.

**Acceptance Scenarios**:

1. **Given** a project with a layout, **When** it opens, **Then** cells 01
   and 02 start collapsed and the others as before.
2. **Given** a project with no layout, **When** it opens, **Then** cells 01
   and 02 start open.

---

### User Story 5 - Skip the engine's page by keyboard (Priority: P3)

As someone using only the keyboard, I want one Tab to get me past the
engine's page, which puts about forty controls in the Tab order, so that I
can reach the cells after it.

**Why this priority**: the page has not changed; the thing that comes after
it has.

**Independent Test**: Tab from the rail to the map's skip control, press
it, and read where focus is.

**Acceptance Scenarios**:

1. **Given** the map in the flow, **When** Tab reaches the control before
   its frame, **Then** it is "Skip past the map" and it is one Tab before
   the frame.
2. **Given** that control is pressed, **Then** focus lands on cell 03's
   heading.

### Edge Cases

- A project with no layout, or whose map is not drawn: what the block shows
  in the map's place. [NEEDS CLARIFICATION: today the pinned band says the
  map is not there and offers to lay the project out again; does the block
  keep that sentence, collapse to nothing, or show an empty frame?]
- A read-only project (made by a newer version of the app): it may have a
  layout and a map. [NEEDS CLARIFICATION: does it get the block, and does
  cell 06's preview exist for a project that cannot export?]
- Windows narrower than 900px, where the rail collapses and the inspector
  covers the region. [NEEDS CLARIFICATION: the block fills the column at
  every width; is the height fraction the same there?]
- A preset whose aspect ratio is very tall (a vertical video): the export's
  preview inside a cell is bounded in height as the band's shape was.
  [NEEDS CLARIFICATION: the bound's fraction for the cell's preview.]
- A run starts in cell 02 on a project whose cells 01 and 02 opened
  collapsed: does the running cell open? [NEEDS CLARIFICATION: not stated
  in the issue; today a running cell does not open itself.]
- The map's frame has not loaded when cell 06 opens: the export's frame
  attaches independently, and the main process matches each at attach, not
  at use.
- Cell 06 opened and closed repeatedly: each open mounts a fresh export
  frame and each close releases it; the map's frame is never touched.
- A controls-free planned page: the planned address has no `controls=1`, so
  its header is hidden. Whether the export frame takes focus at all is
  measured, not assumed (FR-012).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The map's block MUST be a child of the notebook element, after
  cell 02 and before cell 03, as wide as the column, with a static
  `position` that scrolls with the notebook. Nothing in the notebook MUST be
  pinned.
- **FR-002**: The block's height MUST be bounded at a fraction of the
  viewport with the aspect ratio giving way, as the band's was. The
  fraction MUST be measured on the built app and recorded, not declared.
  [NEEDS CLARIFICATION: the fraction; the issue says "measured". The
  starting measurement is: in an 800px window with cells 01 and 02
  collapsed the map is about 400px tall and cell 05's first rows sit near
  the fold.]
- **FR-003**: The map's frame element MUST be the same element across a
  scroll, every cell toggling, a redraw, a theme change and cell 06 opening
  and closing, and MUST never be sent to an address carrying `safe=1`.
- **FR-004**: Cell 06 MUST hold a preview of its own inside the cell, a
  second frame mounted only while cell 06 is open, at the address
  `export.plan` returns for the current choices, with `safe: true` where the
  preset has safe zones and sized to the preset's aspect ratio. An export's
  own plan MUST still never carry `safe` (specs/022 FR-006).
- **FR-005**: Every frame MUST carry `sandbox="allow-scripts"` and nothing
  else, and MUST be attached through the main process (ADR-028).
- **FR-006**: The main process MUST hold two frames per window keyed by
  role, `map` and `export`. `attach(projectId, role)` MUST match the
  project's address prefix and whether `safe=1` is in the query, once, at
  attach, and never at use. `call(role, method, ...args)` MUST drive the
  named frame. The renderer's callers that drive the page MUST name `map`;
  the export frame MUST be asked only the load probe. The capture MUST be
  untouched.
- **FR-007**: Opening cell 06 MUST move the map's clock by no more than a
  second, and no restore MUST be sent. The viewer's restore stays for
  redraws and theme changes.
- **FR-008**: With cell 06 open, cell 03's transport MUST drive the map's
  frame and not the export's.
- **FR-009**: A project opened with the map out of view MUST draw it
  correctly fitted when it is scrolled to.
- **FR-010**: Which of cells 01 and 02 start open MUST be a function of the
  project's record: collapsed where it has a layout, open where it has none.
- **FR-011**: "Skip past the map" MUST remain, one Tab before the map's
  frame, and MUST land on cell 03's heading. [NEEDS CLARIFICATION: ADR-046
  and the issue name cell 03's heading as the target; confirm it over the
  footer's Rename, which is where it lands today.]
- **FR-012**: Whether the export frame takes keyboard focus MUST be
  measured. If it does, cell 06 MUST get "Skip past the preview" before
  its frame; if it does not, nothing is added.
- **FR-013**: A control reached with Shift+Tab MUST be fully in view at the
  window sizes `notebook-a11y.spec.ts` uses, and the colour picker's drag
  test MUST pass (issue 213's criteria). A rail step MUST land its cell
  clear of the header in CI (issue 240's criterion).
- **FR-014**: The rail's scroll clearance MUST be the header alone.
- **FR-015**: `specs/022-export-tab/spec.md` FR-005, which says the map's
  frame is the export's preview while the tab is open, MUST be amended by
  this spec's FR-004 and FR-007.
- **FR-016**: No colour, size or duration literal MUST be added outside the
  four token sheets, and the memory measurement MUST be written into
  ADR-046 before it is Accepted.

### Key Entities *(include if feature involves data)*

- **The map frame**: the engine's page for the project in a sandboxed
  frame, one per notebook, held by identity for the life of the screen; it
  keeps the page's clock, view and scrub position.
- **The export frame**: the engine's planned page for the current export
  choices, mounted while cell 06 is open, disposable, with no clock worth
  keeping.
- **Viewer role**: `map` or `export`, fixed at attach in the main process.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the end-to-end suite, the map block's computed `position`
  is `static` and its top changes by the scroll distance when scrolled.
- **SC-002**: With cell 06 closed the document holds one engine frame; open,
  two; no frame other than the export's carries `safe=1`.
- **SC-003**: Opening cell 06 changes the map's reported clock by at most one
  second, and the main process receives no restore.
- **SC-004**: The accessibility walk reaches every control over both frames
  and the Shift+Tab check finds none behind anything.
- **SC-005**: A person can check by eye, in both themes and at a narrow and
  a wide window: that nothing floats over the cells, the map sits where the
  layout cell ends, the export preview reads as part of cell 06, and a
  recolour is visible after scrolling up. These need a person.
- **SC-006**: The process metrics read by the end-to-end suite with cell 06
  closed and open are written into ADR-046, and if the map's frame still
  costs while out of view it is paused as it leaves the viewport.

## Out of scope

- The wide column and the retirement of the map's breakout (#277).
- A "keep the map in view" toggle, a threshold pin, and two columns at wide
  windows: weighed and declined in ADR-046, to be revisited on a person's
  complaint.
- Any change to the engine, to the capture, or to what an export makes.
- The front door's pictures (ADR-047).

## Assumptions

- The wide column (#277) and the section reset (#273) are in: the block
  fills the column, and the map's box is the column's content box.
- Chromium continues to stop a cross-origin frame's animation while it is
  out of view, and the engine's page continues to advance its clock by wall
  time capped per frame; both are what make a scrolled-away map pause and
  resume without a jump.
- One map frame per project is enough for the map and one for the export;
  `viewer.ts` can key two frames by role without a second window.
- The cells' states and the run graph (`specs/028-the-notebook`) are
  unchanged.

## Clarifications needed from the maintainer

These are collected from the markers above; none is resolved here.

1. What the map's block shows before there is a map to show.
2. Whether a read-only project gets the block and cell 06's preview.
3. The block's height fraction, and whether it differs below 900px.
4. The bound on cell 06's preview for a very tall preset.
5. Whether a running cell opens itself when cells 01 and 02 start collapsed.
6. Confirmation of cell 03's heading as the skip's target, and whether
   cell 06 needs a skip of its own if the export frame takes focus.
