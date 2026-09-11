# Feature Specification: Re-layout over the engine's addressed layouts

**Feature Branch**: `A3-05-relayout`

**Created**: 2026-09-10

**Status**: Draft

**Input**: Planned issue A3-05, "Re-layout, explicit and warned, over the
engine's addressed layouts". Engine v0.5.0 (E04b) stores every layout under
the hash of its inputs, written whole or not at all; `graph.build` answers
with the id and `map.build` takes it. This feature moves the app onto that:
the record keeps the engine's id, the map is drawn from it, and the
"Re-layout" that A3-01 asked for and ADR-027 could not make safe exists.

## Overview

A project's layout is the engine's. Its id is the hash of the layout's
inputs, so two projects on one feed name the same layout unless their
inputs differ, and a layout is never rewritten in place. The run records
the id `graph.build` answered and passes it to `map.build`, which never lays
out on the way to a map. "Re-layout" runs every stage again behind a
warning; the engine keeps the stored layout until the new set is whole, so
cancelling leaves the project as it was.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A re-layout, warned, that cannot lose the layout (Priority: P1)

A person whose map came out awkwardly asks for a fresh layout. They are
told first that the layout engine is heuristic and a new layout may place
stations differently, and that nothing changes if they cancel. If they go
ahead, every stage runs again; if they cancel mid-run, the project opens to
the layout it had.

**Independent Test**: against the stand-in engine, press Re-layout, read
the warning, cancel it, then confirm it; and cancel a run mid-way.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** "Re-layout" is pressed, **Then** a
   dialog carries the warning, focuses Cancel, and cancelling it changes
   nothing.
2. **Given** the warning confirmed, **When** the run finishes, **Then** the
   engine was asked with `force`, every stage was reported, the record
   keeps the same id (the same inputs name the same layout), and the screen
   says the map came from a fresh layout.
3. **Given** a re-layout in progress, **When** it is cancelled, **Then** the
   record is byte-identical to before and "Re-layout" is offered again.

---

### User Story 2 - The record keeps the engine's id (Priority: P1)

The layout a project names is the one the engine stores, by the engine's
own id; the map is drawn from it and from nothing else.

**Acceptance Scenarios**:

1. **Given** a run, **When** `graph.build` answers, **Then** the run passes
   its `layout` to `map.build` and to the record, and never asks the engine
   to lay out on the way to a map.
2. **Given** two projects on one feed with the same inputs, **When** both
   are laid out, **Then** both records name the same id.
3. **Given** a record from before this feature, **When** the project is laid
   out again, **Then** the record names the engine's id and the screen says
   the layout differs from the one recorded, once.

### Edge Cases

- The registry entry's mode and agency still apply; the app passes neither
  until a person can choose them (A2-02).
- A re-layout runs under the same id, so `changed` is false; the screen's
  sentence is what says the map may differ.
- `map.build` for a layout the engine has not stored is refused with the
  kind `layout`; the run shows the engine's hint.
- The app's validators for mode and agency follow the engine's rules now:
  what `gtfs2graph -m` takes, and at most 64 characters.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The run MUST pass `graph.build`'s `layout` to `map.build` and
  to `completeLayout`; the main process MUST check its shape and write it,
  and MUST read no file to do so.
- **FR-002**: "Re-layout" MUST be offered only for a laid-out project, MUST
  warn first in the page's own dialog with Cancel focused, and MUST run
  `graph.build` with `force`.
- **FR-003**: A cancelled or failed re-layout MUST leave the record
  unchanged.
- **FR-004**: The pin MUST move to engine v0.5.0 and the types MUST be
  regenerated; `layout` MUST join the app's error kinds.
- **FR-005**: The app's mode and agency validators MUST follow the engine's.
- **FR-006**: A record supersedes ADR-027 (ADR-033).

## Success Criteria _(mandatory)_

- **SC-001**: Against the stand-in, the re-layout's warning, its cancel,
  its run and a cancelled run behave as the scenarios say, in every run of
  the end-to-end suite on three platforms.
- **SC-002**: Against the real engine with a stored Los Angeles layout,
  `graph.build` answers an id, `map.build` from that id writes the page and
  names it, and asking again answers the same id.

## Dependencies

- E04b (engine v0.5.0).
