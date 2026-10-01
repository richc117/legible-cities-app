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

Each was an open question in the first draft; the answers below were taken
on 1 Oct 2026, on the maintainer's instruction to go with the researched
recommendations (see "Decisions taken" and "Evidence and its limits").

- **A project with no layout, or whose map is not drawn.** The block is
  still there, so nothing shifts by a whole map when one arrives later: a
  frame at a reduced height holding the sentence "This project has no map
  yet. Lay it out in cell 02." and a link that scrolls to and focuses cell
  02. There is no second Run button. The container, with `role="status"`,
  is always in the document, so the map's arrival is announced politely.
- **A read-only project** (made by a newer version of the app). It gets the
  map block when it has a layout, since viewing is not editing. It does
  not get cell 06's export preview or the export's options, which promise
  an export that cannot happen; the screen's one plain sentence says why
  it is read-only. With no layout it gets the empty state above without
  the link to lay it out, since that is unavailable. A control that stays
  visible but unavailable is `aria-disabled` with its reason in its
  accessible description.
- **Windows narrower than 900px**, where the rail collapses and the
  inspector covers the region. The block fills the column at every width
  and the same cap and floor apply; below the width where the ratio's
  height exceeds the cap, the ratio binds first.
- **A preset whose aspect ratio is very tall** (a vertical video). Cell
  06's preview is fit-scaled into a bounded box, centred, and never taller
  than the box (FR-004).
- **A run starts in cell 02 while cells 01 and 02 are collapsed.** A running
  cell does not open itself (FR-017).
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
- **FR-002**: The block MUST be as wide as the column, with an explicit
  height bound and not a shape left to resolve: `width: 100%`, a 16:9 ratio,
  a cap of 48svh (it was proposed as about 70svh and the measurement
  below replaced it) and a floor of about 240px, and never taller than
  the viewport. (An earlier measurement in this repository shrank the map
  to 546px wide where it had been 1024 when a `max-height` was set against
  an `aspect-ratio` on an element whose width was automatic; the bound is
  therefore on the height, with the width definite.) The fraction is
  confirmed by measurement on the built app before the work is accepted:
  at 640x480, 800x600, 1024x640, 1280x720, 1440x900, 1920x1080, 2560x1080
  and 700x900, with cell 01 collapsed and open, record the map's height as
  a fraction of the window and the strip of the next cell that shows with
  no scrolling; the largest fraction that keeps a heading line of the next
  cell on screen from 720px of height up, with the map at least 240px high
  at 480px, wins. Both a very wide and a very tall feed are tried, since
  the engine's refit changes how much of the box the content uses.
- **FR-003**: The map's frame element MUST be the same element across a
  scroll, every cell toggling, a redraw, a theme change and cell 06 opening
  and closing, and MUST never be sent to an address carrying `safe=1`.
- **FR-004**: Cell 06 MUST hold a preview of its own inside the cell, a
  second frame mounted only while cell 06 is open, at the address
  `export.plan` returns for the current choices, with `safe: true` where the
  preset has safe zones and sized to the preset's aspect ratio. An export's
  own plan MUST still never carry `safe` (specs/022 FR-006).
  The preview is fit-scaled: the whole frame sits inside a box bounded at
  about the smaller of 60svh and 640px, at the preset's aspect ratio, with
  the cap binding first and the width following from the ratio, centred in
  the cell, with a 1px outline at the frame's edge and a caption naming the
  ratio and the size ("9:16, 1080 x 1920"). Where there are safe zones the
  caption says they are guidance and are not in the export.
- **FR-005**: Every frame MUST carry `sandbox="allow-scripts"` and nothing
  else, and MUST be attached through the main process (ADR-028).
- **FR-006**: The main process MUST hold two frames per window keyed by
  role, `map` and `export`. `attach(projectId, role)` MUST match the
  project's address prefix and the query, once, at attach, and never at
  use: an address with `safe=1` is the export's, the app's own `controls=1`
  is the map's, and a planned address with neither (a preset without safe
  zones) reads as the export's. A frame belongs to the role it was first
  held in, by its place in the frame tree, so a map page that sends itself
  to an address without `controls=1` is never adopted as the export's. `call(role, method, ...args)` MUST drive the
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
  frame, and MUST land on cell 03's heading, which takes focus by
  `tabindex="-1"` and an explicit `focus()` as the app's other cell headings
  do. It lands on the heading and not the cell's first control because the
  heading exists whether or not the cell is open.
- **FR-012**: Whether the export frame takes keyboard focus MUST be measured
  with a Tab walk and recorded (measured on 1 Oct 2026 with the real planned
  page: 0 stops; the map's own page takes 4). If the frame takes
  five or more focus stops, cell 06 MUST get "Skip past the preview" before
  its frame; if fewer, nothing is added, provided the frame has a title and
  is never a keyboard trap. (The threshold is a judgement, recorded so it is
  not rediscovered; no standard sets one.) A frame that can take focus is
  never `aria-hidden`.
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

- **FR-017**: A cell that is running MUST NOT open itself, move focus or
  scroll the page. Its collapsed row MUST show the state and a one-line
  status of what it is doing (the stage and its place among the stages, as
  the jobs inspector says it). A failure MUST be said in the row and in the
  header's status line, assertively, and MUST NOT open the cell.
  **Built so far: the row and the header's polite status line; the
  assertive announcement is not done**, because the header's line is a
  `role="status"` and an assertive one needs an alert region of its own.
  [NEEDS CLARIFICATION: implement the alert region, or relax this
  requirement to a polite failure sentence?]
- **FR-018**: The map block's container MUST be present in the document
  whether or not there is a map, and MUST hold the empty state of Edge
  Cases, so the block's arrival does not insert content above what is
  already on screen without room reserved for it.
- **FR-019**: For a read-only project the export's preview and options MUST
  NOT be drawn, and the map block MUST be drawn if the project has a layout;
  every control that stays visible but unavailable MUST be focusable with
  `aria-disabled="true"`, its action suppressed, and its reason in its
  accessible description and not in a tooltip alone.

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

- **SC-007**: With no layout, the block's container is in the document with
  the empty sentence and a link that moves focus to cell 02; when the map
  arrives the container is the same element and its change is announced.
- **SC-008**: A read-only project with a layout shows the map block and no
  export preview; with none it shows the empty state without the link.
- **SC-009**: A run started with cell 02 collapsed leaves it collapsed, leaves
  focus and scroll where they were, and shows the stage in its row; a failed
  run says so in the row and the header and still leaves it collapsed.
- **SC-010**: The map's height at each measured window size, and the fraction
  chosen, are written into ADR-046; at 640x480 it is at least 240px.
- **SC-011**: Cell 06's preview for a 9:16 preset is never taller than its
  box and is centred and captioned; for a landscape preset it fills the
  column up to the box.

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

## Decisions taken (1 Oct 2026)

The first draft marked six questions and left them. They were researched
(see below) and answered on the maintainer's instruction to go with the
recommendations; each can be reversed by amending this spec.

1. **What the block shows before there is a map**: a reduced-height frame
   with a sentence and a link to cell 02, in an always-present status
   container (FR-018). Trade-off: a shorter empty box still pushes cell 03
   down on a project not yet laid out, and there is one shift when the map
   arrives.
2. **Read-only projects**: the map block yes; cell 06's export preview and
   options no (FR-019). Trade-off: a read-only person cannot see which
   export settings the project holds; showing them as plain text would keep
   that and is not done here.
3. **The block's height**: 48svh cap, 240px floor, explicit height bound,
   measured (see ADR-046); the same below 900px. The first proposal was
   70svh; the measurement found about 307px of header and collapsed rows
   above the map, which at 1280x720 leaves none of cell 03's heading in view
   at 70svh and a 55px strip at 48svh.
4. **Cell 06's preview**: fit-scaled into a box of about the smaller of
   60svh and 640px, centred, outlined, captioned (FR-004). Trade-off: a 9:16
   preview is about a third of the column wide, so small text on the map is
   hard to judge; a "View larger" action was considered and left out.
5. **A running cell**: never opens itself; the row says what it is doing;
   a failure is said in the row and the header and does not open the cell
   (FR-017). Trade-off: a person who collapsed cell 02 does not see the
   engine log scroll by during a run.
6. **The skip**: cell 03's heading; cell 06 gets its own skip only if the
   export frame takes five or more focus stops (FR-011, FR-012).

## Evidence and its limits

Nine questions across this spec and ADR-047 were researched on 1 Oct 2026.
Two things to know before relying on it. The pages were read through a tool
that returns a model's summary of each page, so a quotation is as returned
and should be checked against the page before it goes into a record. And
the sources give principles and almost no numbers: every figure above (70svh,
240px, 60svh, 640px, five stops) is a judgement, to be settled by the
measurements named, not a finding.

What the sources do support:

- *Empty states* give the state, a learning cue and a direct path to the
  next step: https://www.nngroup.com/articles/empty-state-interface-design/
  and https://carbondesignsystem.com/patterns/empty-states-pattern/. Space
  for content that arrives later is reserved, because inserting content above
  what is on screen shifts it most: https://web.dev/articles/optimize-cls.
  A live region exists in the document before its content changes:
  https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role.
- *Read-only is not disabled.* Carbon separates a disabled control (blocked
  by a prerequisite), read-only (relevant, not editable) and hidden:
  https://carbondesignsystem.com/patterns/disabled-states/. Cloudscape says
  to hide disabled items that are redundant and cannot be enabled, and to
  give reasons: https://cloudscape.design/patterns/general/disabled-and-read-only-states/.
  GOV.UK avoids disabled buttons: https://design-system.service.gov.uk/components/button/.
  The ARIA practices say `aria-disabled` keeps a control discoverable:
  https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/.
  No source addresses a project that is read-only because a newer version
  made it; that mapping is inference.
- *Viewport units.* In browsers with no dynamic browser chrome, such as
  desktop Chromium, `vh`, `svh`, `lvh` and `dvh` are identical:
  https://web.dev/blog/viewport-units. The interaction of `max-height` with
  `aspect-ratio` is in https://drafts.csswg.org/css-sizing-4/#min-max-transfer;
  the spec's note says definite sizes are unaffected, which is the reason
  FR-002 keeps the width definite, but this repository measured the
  opposite for an automatic width, so it is tested in the built app.
- *Fit scaling.* Video editors fit the whole frame in a box with bars where
  the ratios differ (DaVinci Resolve's default is documented at
  https://www.miracamp.com/learn/davinci-resolve/how-to-change-aspect-ratio-in-davinci-resolve);
  no tool was found that shows a vertical frame at true scale. Primary pages
  from Adobe and Meta would not load, and the safe-zone figures found are
  from third parties.
- *A running step.* WCAG treats an expanding region as not itself a change
  of context (https://www.w3.org/WAI/WCAG22/Understanding/on-input.html) and
  asks that a status message be announced without taking focus
  (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html); GitHub
  Actions expands failed steps
  (https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs).
  Jupyter, Colab and Observable were not verified. Opening a cell on failure
  was weighed against moving the map down at the worst moment, and declined.
- *Skip links.* Skipping a block mid-page is a sanctioned technique
  (https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html); one skip
  link is usually enough (https://webaim.org/techniques/skipnav/). **A pinned
  element is the typical way focus is obscured**
  (https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html),
  which is a reason in favour of ADR-046 that its first draft did not give.
