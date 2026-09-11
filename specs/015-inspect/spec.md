# Feature Specification: The Inspect view, and choosing mode and agency with the data in view

**Feature Branch**: `A2-02-inspect`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A2-02 (#20). Engine v0.7.x answers `feeds.inspect`:
the agencies, every route with its names, label, type, colours and trip
count, a histogram of route types with their GTFS names and the LOOM mode
that keeps each, stops by kind, the service window and the engine's day
from an anchor, a suggested mode, and warnings as sentences. Since E04b
`graph.build` takes `mode` and `agency`; the app has passed neither, so
the registry entry decided.

## Overview

Opening a project reads its feed through `feeds.inspect` and shows what
is in it: a routes table with a swatch, the label the map draws, the long
name, the type and the trips; the route-type histogram with the engine's
suggested mode; the agencies; the stops; the service window and the day
the engine would draw; the warnings. Beside the histogram a person
chooses the mode and, when the feed has more than one operator, the
agency; the histogram says which types the chosen mode keeps. The
choice is stored on the record and the next layout passes it to the
engine. The app computes nothing about the feed: every number and every
sentence is the engine's.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See what is in the feed (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a project opened with the engine ready, **When** the
   inspection arrives, **Then** the routes table lists every route with
   its swatch, label, long name, type name and trips, sortable by label,
   type and trips; the histogram shows each type's name, routes and
   trips; the agencies, the stops by kind, the service window and the
   engine's day, and the warnings are shown as the engine sent them.
2. **Given** Los Angeles, **Then** six routes and types tram and subway;
   **given** Mexico City, **then** more than one agency and the
   headway-based warning; **given** Chicago, **then** the suggested mode
   is subway.
3. **Given** the engine not ready, or the inspection refused, **When** the
   project opens, **Then** the rest of the screen works and the Inspect
   section says why it has nothing to show.

### User Story 2 - Choose the mode and the agency, and see what it means (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the histogram, **When** a mode is chosen, **Then** the types
   that mode keeps are marked and the rest are marked as left out; "all"
   keeps every type; a numeric mode keeps its own type.
2. **Given** a feed with several operators, **When** an agency is chosen,
   **Then** the routes table shows only its routes, and the record stores
   the agency; "every operator" stores none.
3. **Given** a chosen mode or agency, **When** the project is laid out,
   **Then** `graph.build` is asked with both, and the engine names a
   layout for those inputs (a different id from before, which the run
   already says).
4. **Given** a project created from the Library's list, **Then** its mode
   and agency start as the feed's registry entry's, not the app's
   defaults, so a preset draws as the engine's site draws it.

### Edge Cases

- The inspection is read once per feed per session and kept; opening
  another project on the same feed reads nothing. The anchor is the
  machine's date, as the first layout's is.
- A record from before this feature holds the app's defaults (`all`, no
  agency); the Inspect view shows them, and the next layout passes them.
  A preset whose registry entry is narrower (Mexico City's subway and its
  agency) draws every operator until the person chooses; the view says
  what the registry entry is so they can.
- A route type LOOM has no name for is shown and never kept by a named
  mode; its numeric code keeps it.
- Changing mode or agency after a layout does not re-lay out: the next
  "Lay out" does, and names a new layout.

## Requirements _(mandatory)_

- **FR-001**: The pin MUST move to the engine that answers a mode per
  route type; the types MUST be regenerated.
- **FR-002**: The project screen MUST call `feeds.inspect` for the
  project's feed and show the routes, the histogram, the agencies, the
  stops, the service window and day, the suggested mode and the
  warnings, computing none of them.
- **FR-003**: The mode and agency controls MUST write the record through
  a bridge method validated on the main side with the record's own
  rules, and the run MUST pass the record's mode and agency to
  `graph.build`.
- **FR-004**: The histogram MUST mark the types the chosen mode keeps,
  from the engine's `mode` per type.
- **FR-005**: The create dialog MUST seed a project's mode and agency
  from the chosen feed's registry entry when the list is available.
- **FR-006**: Tables MUST follow a rule added to the design document.
- **FR-007**: The stand-in MUST answer `feeds.inspect` for its presets
  with shapes that exercise every part of the view.

## Success Criteria _(mandatory)_

- **SC-001**: End to end against the stand-in: the view, the sort, the
  mode highlight, the agency filter, the stored choice, the run passing
  both, the engine-away case.
- **SC-002**: Against the real engine: Los Angeles's six routes, Mexico
  City's operators and warning, Chicago's suggestion, as the unit test
  reads them through the sidecar.

## Dependencies

- A2-01; E08 and its mode-per-type addition (engine after v0.7.0).
