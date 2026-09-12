# Feature Specification: The diagnostics panel, what the build had to fudge

**Feature Branch**: `A3-03-diagnostics-panel`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A3-03 (#25). Engine v0.8.0 answers `map.build`
with three things beside the files: `diagnostics`, the build's numbers as
data (`Result.summary()` as a dict); `caveats`, the same numbers as
sentences a reader can act on; and `issues`, one weighted proportion the
atlas is ordered by, where 0 is clean. All three are built once in the
engine's `schematic/diagnostics.py`, so the terminal, the website and this
app cannot drift from each other (engine E05).

## Overview

A project whose map has just been drawn gains a panel saying what the
build had to fudge: the engine's caveat sentences verbatim, the issues
score, and a table of the numbers - octilinearity, stop matching by
method, the stops that matched nothing, trips and paths, unrouted and
degraded counts, dropped labels, peak concurrent trains - each with an
explanation a person can call up without leaving the row, and a "Copy as
text" that hands over exactly what is on screen. The app formats; it
neither counts nor recomputes (principle II), and a sentence is the
engine's word for word (principle I).

The panel describes the run that has just happened, and lives only as
long as it. It is **not** written to the project record: `parseRecord`
drops what it does not know and `RECORD_VERSION` is 1, so a new field
would make every record of this app unreadable-as-writable to an older
one; and a stored block would go stale the moment another project re-laid
out the set this one draws from (A3-06). A rebuild for a chosen day is a
`map.build` like any other, so a person who changes the day gets that
day's numbers for free.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Learn what the map is not telling the truth about (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a layout run that has finished, **When** the project screen
   is read, **Then** the panel shows every caveat sentence the engine
   sent, verbatim and in the engine's order, and the issues score as the
   engine rounded it.
2. **Given** the same run, **Then** every figure in the table equals the
   engine's `diagnostics` block for the layout the project was drawn
   from: no number is derived, summed or re-scaled by the app.
3. **Given** a clean network, **Then** the panel says there are no
   caveats and the score reads 0.
4. **Given** a run that failed, was cancelled, or has not happened in
   this session, **Then** there is no panel: the app never shows the
   numbers of a build it did not just watch.

### User Story 2 - Understand a word the engine uses (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the row "Trips on borrowed track", **When** the pointer
   rests on its explanation control, the control is focused from the
   keyboard, or it is pressed - which is the only way a touch user can
   ask - **Then** the explanation appears and the control says so; it is
   the control's accessible description in every case, so a screen reader
   reads it without a pointer.
2. **Given** reduced motion, **Then** the explanation appears without a
   transition.

### User Story 3 - Take the numbers somewhere else (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the panel, **When** "Copy as text" is pressed, **Then** the
   clipboard holds a plain-text block with the project's name, the day,
   every row of the table with its figure, the caveat sentences and the
   score, and the panel says it was copied.
2. **Given** the clipboard refuses, **Then** the panel says so and
   nothing else changes.

### Edge Cases

- `stops.unmatched` is the first few ids only (the engine sends at most
  eight), so the app shows them as examples and never as a count: the
  number that did not match is not derivable from the block, and
  inventing it would break "the numbers are the engine's". The caveat
  sentence carries the true count, which is why the sentences matter.
- A stop id comes from a feed and is shown as the engine sent it; ids
  are feed-derived, never paths, and anything path-shaped is withheld
  rather than drawn (constitution V, `readableMessage`'s rule).
- `degraded.skipped_calls` counts **trips** that skip an unmatched stop,
  not calls; the label says trips, whatever the protocol field is named.
- `issues` is a weighted sum of proportions with weights totalling ten,
  not a percentage: it is shown as the number the engine sent.
- A rebuild for a chosen day replaces the panel with that day's numbers;
  a run that starts clears it, so a half-finished run never shows the
  previous run's figures.

## Requirements _(mandatory)_

- **FR-001**: The run MUST keep `map.build`'s `diagnostics`, `caveats`,
  `issues` and `date` on its snapshot, taken from the map call's answer
  and set when the run finishes, so a layout run and a rebuild both
  produce them and neither shows figures before the map they describe or
  for a run whose record could not be written; and MUST clear them when a
  run begins.
- **FR-002**: The snapshot MUST NOT carry the result's file paths, and
  the record MUST NOT gain a field: the panel is ephemeral.
- **FR-003**: Every figure the panel shows MUST come from the
  `diagnostics` block unchanged, formatted only (grouping, a percentage
  the engine itself prints as one); the caveat sentences MUST be shown
  verbatim, in order.
- **FR-004**: The figures MUST be a real `<table>` with a `<caption>`,
  `<th scope>` and the tabular-figures token, per the design document's
  table rule.
- **FR-005**: Each row MUST offer an explanation reachable by pointer, by
  keyboard and by a press, exposed as the control's accessible
  description and its pressed state as `aria-expanded`, with no transition
  under reduced motion.
- **FR-006**: "Copy as text" MUST put what the panel shows on the
  clipboard through a narrow bridge method, because the app refuses every
  permission request and a page's own clipboard write is one.
- **FR-007**: The stand-in engine MUST answer `map.build` with `caveats`
  and `issues` beside `diagnostics`, and MUST let a test choose them, so
  the clean case and the fudged case are both reachable end to end. A
  chosen figure MUST merge into the block a level at a time: a stand-in
  that answers a shape the engine cannot produce is worse than no
  stand-in.

## Success Criteria _(mandatory)_

- **SC-001**: Unit: the map call's answer reaches the snapshot, with the
  finished run, for a layout run and for a rebuild; is cleared by a new
  run, by a run that fails or is cancelled, and by a record that could not
  be written; and a result whose block is absent or not whole at any level
  leaves the panel empty and the run unharmed, because the panel reads
  four levels in and the renderer has no error boundary.
- **SC-002**: Unit: the formatting helpers - percentage, matching method,
  the rows, the copy block - hold their output, and the panel's markup
  carries no colour, size or duration.
- **SC-003**: End to end against the stand-in: the caveats, the score and
  the figures appear after a run; the clean case says no caveats and a
  score of 0; "Copy as text" fills the clipboard; the panel is absent
  before a run.
- **SC-004**: Against the real engine, Los Angeles's `map.build` answers
  a `diagnostics` block whose stop matching adds up to its total and
  whose caveats are sentences, and the app's own helpers render them.

## Dependencies

- A3-01, A3-04, A3-06 (the run and its snapshot); engine v0.8.0 (E05);
  the pin moved in the same milestone.
