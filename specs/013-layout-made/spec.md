# Feature Specification: Notice a layout laid out again from another project

**Feature Branch**: `A3-06-layout-made`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A3-06 (#69), found by the reviewer of A3-05. Since
ADR-033 a project records the engine's layout id, the hash of the layout's
inputs. Two projects with the same inputs share one id, and a re-layout
from one replaces the stored set both draw from. The other project's
record still names the id, so its next "Lay out again" draws from the new
set, and `changed`, which compares ids, says nothing. The re-layout's
warning says this may happen; nothing afterwards says it did.

## Overview

The engine writes `made`, an ISO timestamp, beside every stored layout and
answers it in `graph.build`'s `meta`: repeated for an unforced answer,
rewritten for a forced one. The record keeps `made` beside the id. A run
whose answer carries the same id and a different `made` was drawn from a
layout laid out again since the project last drew from it, and the screen
says so. Principle III: a different map is announced, never silent.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Told when the layout changed under the project (Priority: P1)

Two projects share a feed and settings. From one, a person re-lays out.
Later, from the other, they press "Lay out again". The run finishes and
the screen says the layout was laid out again elsewhere since this
project was last drawn, so the map may place stations differently.

**Independent Test**: against the stand-in, whose forced answer carries a
new `made`; against the real engine, that an unforced answer repeats it.

**Acceptance Scenarios**:

1. **Given** projects A and B on one feed, both laid out, **When** A
   re-lays out and B runs "Lay out again", **Then** B's record's `made`
   moves to the new value and B's screen says the layout was laid out
   again elsewhere.
2. **Given** a laid-out project, **When** it runs "Lay out again" and
   nothing has changed, **Then** the record's `made` is unchanged and the
   screen says only "Laid out."
3. **Given** a project that re-lays out itself, **When** the run finishes,
   **Then** the screen says it was laid out again from scratch, as today,
   and nothing about elsewhere.
4. **Given** a record from before this feature (no `made`), **When** it is
   laid out again, **Then** it gains `made` and is told nothing changed,
   as the id's first comparison behaves.

### User Story 2 - The screen shows when the layout was made (Priority: P2)

The project's fields show, beside the layout's short id, when the layout
was made, in the person's locale with the exact time kept on the element.

### Edge Cases

- A rebuild for a chosen day draws from the stored set as it is and asks
  no layout call, so it cannot notice; the next "Lay out again" does.
- A record's `made` that is not a timestamp reads as `null`.
- The main process checks `made` for shape: a string that parses as a
  time, at most 64 characters; nothing is opened.
- A different id and a different `made` at once is a different layout;
  the id's sentence wins, as it says more.
- A re-layout from this project moves `made` too; the store answers
  `relaid` for it, and the run, which knows it forced, clears the flag.
- Two runs overlapping across projects: if another project's forced
  layout call answers between this project's layout call and its map
  call, the map is drawn from the new set while the record stores the
  `made` this run was answered, and the sentence comes one run late.
  `map.build` answers the id and not `made`, so the app cannot close
  this alone; an engine issue would have `map.build` answer the `made` it
  drew from.

## Requirements _(mandatory)_

- **FR-001**: The record MUST store `made` beside `layout`, written by
  `completeLayout` from `graph.build`'s `meta.made`, together with the id
  or not at all; version stays 1.
- **FR-002**: `completeLayout` MUST answer `changed` (a different id, as
  today) and `relaid` (the same id and a different `made`); both false
  when the record had no id or no `made`.
- **FR-003**: The screen MUST say when a run was drawn from a layout laid
  out again elsewhere; a forced run's own sentence takes precedence.
- **FR-004**: The stand-in MUST repeat `made` for an unforced answer and
  rewrite it for a forced one, as the engine does.
- **FR-005**: The project's fields MUST show the layout's `made` beside
  its id.

## Success Criteria _(mandatory)_

- **SC-001**: End to end against the stand-in: scenario 1.1 through 1.4.
- **SC-002**: Against the real engine, two unforced `graph.build` answers
  for one layout carry the same `made`.

## Dependencies

- A3-05 (ADR-033); the engine's `LayoutMeta.made`, present since v0.5.0.
