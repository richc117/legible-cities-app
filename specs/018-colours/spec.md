# Feature Specification: Line colours, the feed's and a person's

**Feature Branch**: `A4-01-line-colours`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A4-01, "Line colours: the project's lines with the
GTFS swatch, an override picker, reset per line and for all, and a default
for lines the feed leaves blank". Engine v0.8.0 (E06) makes line colour
data: `render.line_colors` resolves every line once and the resolved colour
reaches the page's `data.lines`, so the map, the chips and the time chart
all draw from one table. `map.build` takes `colors` (a colour per line
label, over the feed's own `route_color`) and `default_color` (what a line
the feed leaves uncoloured is drawn in). The project record has carried
`colors` and `defaultColor` since A1-05; nothing has written them.

## Overview

Today a line is drawn in whatever `route_color` its feed publishes, and a
line whose feed publishes none is drawn in the engine's grey. Some feeds
publish no colours at all; some publish colours that collide, or that a
person simply does not want. There is no way to say so.

After this feature the project screen carries a Colours panel: every line
the project's feed offers, with the colour the feed gives it beside the
colour it is drawn in; a picker that sets an override; a reset for one line
and a reset for all; and one default colour for the lines the feed leaves
blank. A change is debounced and then redrawn - `map.build` from the stored
layout, the same rebuild a chosen day is - so the map, the chips and the
time chart move together and the stations never do. The choice lives in
`project.json`, so reopening the project shows the same colours, and every
later build, capture and export draws them.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Overriding one line's colour (Priority: P1)

A person opens a laid-out project, sees its lines listed with the colours
the feed gave them, opens the picker on one line and chooses another
colour. A moment after they stop, the map is redrawn in the new colour, and
so are the chips over it and the bars of the time chart.

**Why this priority**: it is the issue. Everything else here is the
scaffolding that makes one override honest.

**Independent Test**: against the stand-in engine, open the panel on a laid
out Los Angeles project, override line A, and read the `map.build` the
stand-in recorded and the record on disk; against the real engine, do the
same and look at the page.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** the Colours panel is opened,
   **Then** every line the feed offers under the layout's mode and agency
   is listed once, with the feed's own colour beside it, and a line the
   feed leaves uncoloured says "no colour in feed".
2. **Given** the panel, **When** a colour is chosen for one line, **Then**
   after the debounce exactly one `map.build` runs, from the stored
   layout's id and the stored day, carrying `colors` with that one entry
   and `default_color`; `graph.build` is not called.
3. **Given** that build, **When** it finishes, **Then** the record's
   `colors` holds the override, `modified` moves, and the viewer reloads
   the page the build just wrote.
4. **Given** a person dragging through a range of colours, **When** they
   stop, **Then** one build runs, not one per frame.
5. **Given** an override, **When** the project is closed and opened again,
   **Then** the panel shows the same colours and nothing is rebuilt.

---

### User Story 2 - Reset, one line and all of them (Priority: P1)

A person changes their mind. Reset on a line puts it back to the colour
the feed publishes - or, if the feed publishes none, to the default. Reset
for all clears every override and the default together.

**Why this priority**: an override a person cannot undo is worse than no
override. The feed's colour is the ground truth and must always be
reachable.

**Independent Test**: against the stand-in, override two lines, reset one,
reset all, and read the record after each.

**Acceptance Scenarios**:

1. **Given** a line with an override, **When** Reset is pressed on it,
   **Then** its entry leaves `colors`, the map is rebuilt, and the line is
   drawn in the feed's colour again.
2. **Given** a line with no override, **When** the panel is read, **Then**
   its Reset is disabled and nothing can be rebuilt by pressing it.
3. **Given** several overrides and a changed default, **When** "Reset every
   line" is pressed, **Then** `colors` is empty and `defaultColor` is the
   record's default again, in one rebuild.
4. **Given** no override anywhere, **When** the panel is read, **Then**
   "Reset every line" is disabled.

---

### User Story 3 - A default for the lines the feed leaves blank (Priority: P2)

A feed publishes no `route_color` for some or all of its routes. The panel
says so, line by line, and offers one colour that every such line takes.

**Why this priority**: a whole feed of grey lines is the common case for
small operators, and one control fixes all of them at once. It is second
only because a per-line override already covers it, line by line.

**Independent Test**: against the stand-in, a user feed whose single route
has no colour; change the default and read the record and the `map.build`.

**Acceptance Scenarios**:

1. **Given** a feed with an uncoloured line, **When** the panel is read,
   **Then** that line says "no colour in feed" and shows the default as
   what it is drawn in.
2. **Given** the default control, **When** another colour is chosen,
   **Then** one `map.build` runs carrying `default_color`, and every line
   with neither an override nor a feed colour changes.
3. **Given** a line with an override and no feed colour, **When** the
   default changes, **Then** that line does not change: an override wins
   over the default, which wins over nothing.

---

### User Story 4 - Reachable without a mouse (Priority: P1)

Every control in the panel is reachable by keyboard, named for a screen
reader, and shows where focus is. A colour can be set by typing its hex
value, which is the path that does not need a pointing device at all.

**Why this priority**: principle VI, and a colour picker is the component
most likely to fail it.

**Acceptance Scenarios**:

1. **Given** the panel, **When** it is walked with Tab, **Then** each
   line's Choose and Reset, the default's control, and "Reset every line"
   are reached in order, each with a name that says which line it acts on,
   each with a visible focus ring in both themes.
2. **Given** an open picker, **When** a hex value is typed and submitted,
   **Then** the colour is taken as if it had been picked, and a value that
   is not a colour is refused beside the field without rebuilding.
3. **Given** `prefers-reduced-motion`, **When** the panel opens and closes
   a picker, **Then** nothing animates.

### Edge Cases

- Several routes of a feed share one line label (a feed with a route per
  direction, or per pattern). The map draws one line per label, so the
  panel lists one row per label and takes the first colour the feed
  publishes for it.
- A label the stored layout does not carry is ignored by the engine, which
  is what lets an override survive a narrower mode: the app sends what it
  has and the engine keeps what it draws (protocol, `MapBuildParams.colors`).
- A project whose layout was made with a different mode or agency than the
  record now names: the panel lists the layout's inputs (`built`), because
  that is the map on screen, and falls back to the record's when a layout
  predates `built`.
- The panel needs the feed read (`feeds.inspect`) for the labels and the
  feed's colours. The engine may not be ready; the panel says so and shows
  nothing rather than guessing. The inspection is the one the Inspect view
  already cached this session, so nothing is asked twice.
- A rebuild that is cancelled or fails writes nothing; the panel goes back
  to the record's colours and the run's own sentence says the map on
  screen may be the old one.
- A colour change cannot start a build while a layout, a rebuild or an
  export is running, and neither can start while a colour rebuild is: they
  share the project's page. A change made during one is not refused or
  dropped - it waits, and the panel builds once when the way is clear, so
  no control has to disable itself under a person's hands.
- A project with no layout has no Colours panel: there is nothing to draw
  the colours on.
- The record's colours are read on open and never asked of the engine, so
  the panel is the same on every machine (principle IV).
- A read-only record (written by a newer app) shows no panel.
- Leaving the project screen inside the debounce window abandons the change
  that was waiting. The run outlives the view on purpose, because it is work
  already begun; a colour not yet sent is not, and a build started as
  someone walks away would rewrite a page they are no longer looking at.
- A feed may publish a line label the record cannot hold - longer than the
  cap, carrying a control character, or `__proto__`. The panel does not
  offer such a line at all, rather than drawing the map and then being
  refused on the way to disk, which would leave the screen disagreeing with
  the page.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The layout run MUST pass the project's `colors` and
  `defaultColor` to `map.build` on every draw - a first layout, a
  re-layout, a chosen day and a colour change alike - so the stored
  choice is what is drawn whatever redrew it.
- **FR-002**: The project screen MUST offer a Colours panel for a
  laid-out, writable project: one row per line label the feed offers under
  the layout's mode and agency, with the feed's own colour, what the line
  is drawn in, an override control and a reset; a default-colour control;
  and a reset for every line.
- **FR-003**: A line's colour MUST be the person's override if there is
  one, else the feed's `route_color` if the feed publishes one, else the
  default. A line the feed leaves uncoloured MUST say so in words.
- **FR-004**: A change MUST be debounced into one `map.build` from the
  stored layout's id and the stored day. `graph.build` MUST NOT run.
- **FR-005**: The record MUST be written only when the map has been drawn,
  through a bridge method of its own, as a chosen day is (A3-04). A
  cancelled or failed build MUST leave the record unchanged and the panel
  MUST return to the record's colours.
- **FR-006**: The bridge's main side MUST refuse a malformed colour map -
  a value that is not `#rrggbb`, a key that is not a line label, a map too
  large - before the store sees it, and the store MUST check again.
- **FR-007**: Reset on a line MUST remove that entry only; reset for all
  MUST empty `colors` and return `defaultColor` to the record's default;
  both MUST rebuild once.
- **FR-008**: Every control MUST be keyboard-reachable, named for the line
  it acts on, focus-visible in both themes, and MUST honour
  `prefers-reduced-motion`. A colour MUST be settable by typing a hex
  value.
- **FR-009**: A colour rebuild MUST NOT start while a layout run, a day
  rebuild or an export runs, and none of those MUST start while it does. A
  change made in the meantime MUST wait and build once, not be dropped.
- **FR-010**: The panel MUST NOT draw a map, a line or a schematic of its
  own: a swatch is a colour block beside a name (`docs/DESIGN.md` 3.2 and
  8.2), and the picture is the engine's page.
- **FR-011**: `lineOrder` MUST be left as it is. Stacking order is issue
  #28 and another change.

### Key Entities

- **Palette**: what a project chooses - `colors`, a line label to
  `#rrggbb`, and `defaultColor`. Stored on the record; sent to `map.build`
  as `colors` and `default_color`.
- **Line**: one label the map draws, with the colour the feed publishes for
  it or none. Read from the feed's inspection, not invented here.
- **Shown colour**: what a line is drawn in, and which of the three it came
  from: the override, the feed, the default.

## Success Criteria _(mandatory)_

- **SC-001**: Against the stand-in, an override on one line rebuilds once,
  carries `colors` and `default_color` to `map.build`, writes the record,
  and survives closing and reopening the project - in the end-to-end suite
  on three platforms.
- **SC-002**: Reset restores the feed's colour and reset-for-all clears
  everything, each in one rebuild, with nothing written until the build
  finishes.
- **SC-003**: A line the feed leaves uncoloured reads "no colour in feed"
  and follows the default; an override on it wins over the default.
- **SC-004**: The main-side validator refuses a malformed colour map, and
  a unit test proves it before the store is reached.
- **SC-005**: The design tokens still clear the contrast test, no component
  file carries a colour literal, and the panel is walked by keyboard with
  every control named.

## Assumptions

- **A-001**: The line labels and the feed's own colours come from
  `feeds.inspect`'s `routes[]` (`label`, `color`), filtered by the
  layout's mode and agency with the functions the Inspect view already
  exports, and grouped by label. The alternative - the layout's own
  `stages.octi.lines` - names exactly the lines the map draws but carries
  no colour, and is only in hand during a run, never on open; the record
  does not store it. The engine ignores a colour for a label the layout
  does not carry, which is what makes the wider list safe, and is what
  lets an override outlive a narrower mode.
- **A-002**: A line's own colour is data, not a design token: it arrives
  from the record or the feed as an inline style value and never as a
  literal in a stylesheet (`docs/DESIGN.md` 3.2).
- **A-003**: The picker is `react-colorful` (MIT, no dependencies), a
  `devDependency` because the renderer's packages are build inputs that
  vite bundles and electron-builder would otherwise ship whole - the same
  reasoning that keeps the control kit out of `dependencies`. It is
  keyboard-operable (`role="slider"`, arrow keys, `aria-valuetext`); the
  typed hex field beside it is the app's own kit input, and is the path
  that needs no pointing device.
- **A-004**: The debounce is one pure function with its own test, not a
  timer buried in a component.
- **A-005**: The record's two fields and its version are unchanged: A1-05
  defined `colors` and `defaultColor` and `parseRecord` has validated them
  since. This feature writes them for the first time.

## Dependencies

- Engine v0.8.0, pinned since #80: `map.build`'s `colors` and
  `default_color`, and `render.line_colors` behind them (E06).
- A3-04's rebuild path (`map.build` from the stored layout, the record
  written only when the map is drawn) and A2-02's inspection cache.
- ADR-023 and ADR-031: the layout is stored and never recomputed; a colour
  change is a render, never a layout.
