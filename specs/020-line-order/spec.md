# Feature Specification: Line order, and what is drawn over what

**Feature Branch**: `A4-02-line-order`

**Created**: 2026-09-12

**Status**: Draft

**Input**: Planned issue A4-02, "Line order with up/down controls (keyboard
accessible); debounced re-render from the stored layout; persisted in
`project.json`". The numeric `Style` fields named in the same issue are in
the post-MVP backlog and are not in this feature. `map.build` has taken
`line_order` since engine v0.2.1; the project record has carried
`lineOrder` since A1-05 and nothing has written it.

## Overview

Where two lines share track the map draws one over the other, and the page
lists a project's lines in rows under the map. Both follow one order, and
today that order is the engine's default: the labels sorted. A person who
wants the busiest line on top, or the line their story is about listed
first, cannot say so.

After this feature the project screen carries a Line order panel under the
Colours panel: the project's lines in the order they are drawn, each with
"Move up" and "Move down", a position said in words, and one control that
puts the arrangement back to alphabetical. A change is debounced and then
redrawn - `map.build` from the stored layout, the same rebuild a chosen day
and a colour change are - so the stations never move. The arrangement lives
in `project.json`, so reopening the project draws it again, and every later
build, capture and export draws it too.

**The engine's half was a defect, and is fixed.** `line_order` was
documented as "the stacking on shared track; the rest follow" and behaved
as a whitelist: a label the list left out was not drawn at all, on the map,
in the page's rows and in the time chart alike. Measured on the stored Los
Angeles layout: six lines drawn with no order, two drawn with an order
naming two. Engine issue 28 fixed it on the engine's `main`, so an order is
a preference again - the lines it names first, then everything else in the
order it would have had anyway, with a label the layout does not carry
ignored. **This feature waits on the release that carries that fix** and
pins it; without it every order the app sends would have to be a complete
list of every label the layout carries, which the app cannot promise for a
label its own record refuses to hold.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Putting a line on top (Priority: P1)

A person opens a laid-out project, sees its lines in the order they are
drawn, and moves one down the list until it is last. A moment after they
stop, the map is drawn again with that line over the others where they
share track, and the page's rows follow the same order.

**Why this priority**: it is the issue.

**Independent Test**: against the stand-in engine, open the panel on a laid
out Los Angeles project, move a line, and read the `map.build` the stand-in
recorded and the record on disk; against the real engine, do the same and
look at the page.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** the Line order panel is opened,
   **Then** every line the feed offers under the layout's mode and agency
   is listed once, in the order it is drawn, each with its position and the
   colour it is drawn in.
2. **Given** the panel, **When** a line is moved, **Then** after the
   debounce exactly one `map.build` runs, from the stored layout's id and
   the stored day, carrying `line_order` as the whole arrangement on
   screen; `graph.build` is not called.
3. **Given** that build, **When** it finishes, **Then** the record's
   `lineOrder` holds the arrangement, `modified` moves, and the viewer
   reloads the page the build just wrote.
4. **Given** a person pressing "Move up" four times in a row, **When** they
   stop, **Then** one build runs, not four.
5. **Given** an arrangement, **When** the project is closed and opened
   again, **Then** the panel shows the same order and nothing is rebuilt.
6. **Given** an arrangement, **When** the project is laid out again, a day
   is chosen, or a colour is changed, **Then** that build carries the same
   `line_order`, so the arrangement survives every other kind of draw.

---

### User Story 2 - Back to alphabetical (Priority: P1)

A person changes their mind, and one control puts every line back where the
engine would have drawn it.

**Why this priority**: an arrangement a person cannot undo is worse than no
arrangement, and the alphabetical order is the ground truth to come back
to.

**Independent Test**: against the stand-in, move two lines, press the
control, and read the record and the request.

**Acceptance Scenarios**:

1. **Given** an arrangement, **When** "Back to alphabetical" is pressed,
   **Then** one build runs carrying no `line_order` at all, the record's
   `lineOrder` is emptied, and the panel lists the lines alphabetically.
2. **Given** lines already in alphabetical order, **When** the panel is
   read, **Then** the control is disabled and nothing can be rebuilt by
   pressing it.
3. **Given** a line moved down and then moved back up, **When** the
   debounce fires, **Then** nothing is built, because the arrangement is
   the one the record already holds.

---

### User Story 3 - The keyboard, and a person who cannot see the list (Priority: P1)

Every move is a button, each named for its line and its direction, and the
list says where each line stands. Nothing here needs a pointing device.

**Why this priority**: principle VI, and the issue names it. A drag handle
would have made this feature unreachable for half its users; two buttons
make it reachable for all of them, which is why the issue defers dragging.

**Independent Test**: keyboard only, from the heading to the last control
and back; then VoiceOver over the list.

**Acceptance Scenarios**:

1. **Given** the panel, **When** it is walked with the keyboard, **Then**
   every control is reachable in the order it is read, and each is named
   for its line and what it does ("Move line A down").
2. **Given** a line moved with the keyboard, **When** the move lands,
   **Then** focus stays with that line - on the button that moved it, or on
   its opposite when the line has reached an end and that button is now
   disabled - and a polite status says the line's new position.
3. **Given** the first line, **When** the panel is read, **Then** its "Move
   up" is disabled, and so is the last line's "Move down".

---

### Edge Cases

- **A project that has never been laid out.** The panel is absent, as the
  Colours panel is: there is no stored layout to draw from, and the lines
  the map draws are not known until one exists.
- **An arrangement made before the mode narrowed.** The record's order may
  name lines the feed no longer offers under the layout's mode, and may
  miss lines it does. The panel lists what the feed offers now, the named
  lines first in their order, then the rest alphabetically; the record is
  rewritten to what is on screen at the next move. The engine ignores a
  label its layout does not carry, so a stale order never draws a line
  twice or drops one.
- **A label the record cannot hold** - empty, over-long, carrying a control
  character, or literally `__proto__`. It is not offered for arrangement,
  as it is not offered a colour: the panel would have to write a record the
  store refuses. It still draws, because the engine draws every line the
  order leaves out.
- **A run or an export in flight.** Nothing in the panel disables itself: a
  move made while a layout, a rebuild or an export is going waits on the
  same timer and builds once the way is clear, as a colour change does. The
  one thing a draw may never do is rewrite the page a capture is reading.
- **A colour change and a move in the same few hundred milliseconds.** Both
  panels debounce separately and the run takes one at a time, and each draw
  sends the record's half beside the one being tried, so the second build
  normally carries both. There is one window it does not: a draw begun in
  the milliseconds between the first build's record write and the screen
  reading that record back sends the half the screen still holds, and the
  record then names a colour the page does not show until something draws
  again. It is A4-01's window as much as this feature's, it needs a press
  inside a few milliseconds of four hundred, and the next draw of any kind
  clears it.
- **A move waiting on the timer when the project is left.** The run outlives
  the screen and the debounce does not: a move still waiting - which is what
  a move made during an export is, since it re-arms until the way is clear -
  is dropped when the panel goes, with nothing said. Inherited from the
  Colours panel, and named here so it is a decision rather than a surprise.
- **A build that is cancelled or fails.** Nothing is written, and the panel
  goes back to the record's order, as the Colours panel does.
- **A read-only record**, written by a newer version of the app: the panel
  is absent rather than disabled, as the rest of the project screen's
  editing is.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The project screen MUST show the project's lines in the order
  they are drawn, once each, with the position and the colour each is drawn
  in.
- **FR-002**: The list MUST be the feed's lines under the layout's own mode
  and agency, arranged by the record's order first and the rest
  alphabetically.
- **FR-003**: "Move up" and "Move down" MUST move one line one place, and
  MUST be disabled only at the end of the list they cannot move towards.
- **FR-004**: A change MUST be debounced into exactly one `map.build` from
  the stored layout and the stored day, carrying the whole arrangement as
  `line_order`; the layout stages MUST NOT run.
- **FR-005**: The arrangement MUST be written to the record only after the
  map has been drawn with it, and `modified` MUST move with it.
- **FR-006**: Every other draw - a layout, a re-layout, a chosen day, a
  colour change - MUST carry the record's arrangement.
- **FR-007**: "Back to alphabetical" MUST empty the record's order in one
  build, and MUST be disabled when there is nothing to undo.
- **FR-008**: A move that returns the arrangement to the record's MUST
  build nothing.
- **FR-009**: No control in the panel may disable itself because a run or
  an export is going; a change made then waits and builds once the way is
  clear.
- **FR-010**: A cancelled or failed build MUST leave the record alone and
  the panel MUST return to it.
- **FR-011**: Every control MUST be keyboard-reachable and named for its
  line; focus MUST stay with the line that moved; the new position MUST be
  announced politely.
- **FR-012**: The order crossing the bridge MUST be validated in the panel,
  in the main-side handler and in the store: line labels the record can
  hold, no duplicates, and no more of them than a feed could draw. A feed
  with more lines than that MUST be refused in the panel, with a word, and
  never drawn and then refused on the way to disk.
- **FR-014**: The list MUST be in the order the engine would draw when it is
  told nothing, which sorts labels by code point, and not the numeric order
  a person would write: `10` before `2`. The Colours panel's list sorts the
  other way on purpose, because there the order is only a list.
- **FR-013**: The app MUST pin the engine release carrying issue 28's fix,
  because an order that names some lines is safe only there.

### Key Entities

- **The order**: `string[]`, the record's `lineOrder`, exactly
  `map.build`'s `line_order`. Empty means the engine's own alphabetical
  order, and the request carries no `line_order` at all.

## Success Criteria _(mandatory)_

- **SC-001**: A line moved to the end of the list is drawn over the others
  where they share track, and the page's rows list it last.
- **SC-002**: Four presses in a row cause one `map.build` and one record
  write.
- **SC-003**: A project reopened draws the same order, with no build.
- **SC-004**: An order naming two lines of six draws six.
- **SC-005**: The whole panel is operable from the keyboard, and a screen
  reader hears each line's name, position and what each button does.
- **SC-006**: A layout run after an arrangement draws the arrangement.

## Assumptions

- The lines a person can arrange are the ones `feeds.inspect` reports under
  the layout's mode and agency, which is the Colours panel's list and a
  superset of the labels the stored layout carries. A position therefore
  counts lines the page may not draw, on a feed whose mode drops some.
- The engine draws later lines over earlier ones, and lists them in the
  same order in the page's rows. Both follow one list, which is why one
  control serves both.
