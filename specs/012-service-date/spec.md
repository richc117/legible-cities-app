# Feature Specification: The service day, chosen by the engine and changed by a person

**Feature Branch**: `A3-04-service-date`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A3-04, "Service date: busiest weekday by default, a
picker bounded by the service window, times past midnight preserved".
Engine v0.6.0 (E21) makes the service day data: `feeds.service` takes a
feed key, an anchor day and the map's lines, and answers the feed's
service window and the busiest weekday scanning from that anchor, the same
on every machine. ADR-031 decided that a project's day is resolved once,
at its first layout, from the engine's rule once the engine could report
one, and that changing it is an explicit action which re-renders and never
re-lays out. This feature builds the second half of that record.

## Overview

Today the first layout stores the machine's date, which the feed may not
serve: a Sunday on a weekday-only feed, or any day at all on a feed whose
window has expired. The map then shows no trains, and nothing says a
better day exists.

After this feature the first layout asks the engine which day to draw. It
passes the machine's date as the anchor and the lines the layout drew, and
stores what the engine answers: the window, the day, and the anchor the
choice was made from. The project screen shows the day beside the window
it comes from, and offers a picker that cannot leave the window. Choosing
another day rebuilds the map from the stored layout for that day; the
layout itself is never run again. Times past midnight are the engine's
business and the app never touches a time of day.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The first layout draws a day the feed serves (Priority: P1)

A person lays a project out for the first time. The map is drawn for the
weekday with the most trips on the map's lines, as the engine chooses it
from today's date, and the screen says which day that is and which days
the feed covers.

**Why this priority**: it is the reason the issue exists. A map of an
empty day is honest and useless; a map of the busiest day is the map
people expect.

**Independent Test**: against the stand-in engine, lay out a new project
and read the record and the screen; against the real engine, lay out Los
Angeles and compare the day with what the engine's CLI chooses for the
same anchor.

**Acceptance Scenarios**:

1. **Given** a project with no layout and no day, **When** it is laid out,
   **Then** the run asks `feeds.service` after `graph.build` with the feed
   key, the machine's date as the anchor and the octi stage's lines; draws
   the map for the day answered; and the record stores the window, the
   day, and the anchor, together with the layout's id or not at all.
2. **Given** the record written, **When** the project is opened again,
   **Then** nothing runs and the screen shows the stored day and the
   window, exactly as stored, on every open.
3. **Given** a feed whose window has ended (Mexico City), **When** it is
   laid out, **Then** the day is the one the engine picks from the middle
   of the window, the screen shows it inside the window, and the app never
   substitutes today.
4. **Given** a project laid out before this feature, holding a day and no
   window, **When** it is laid out again, **Then** it keeps the day it has
   (ADR-031), gains the window and the engine's day from `feeds.service`,
   and the picker offers the engine's day as a suggestion rather than
   changing anything by itself.

---

### User Story 2 - Choosing another day, inside the window (Priority: P1)

A person wants Saturday's timetable. They pick the date; the picker refuses
anything before the window's first day or after its last. The map is
rebuilt from the stored layout for the chosen day, behind the same
progress line the layout run uses, and the screen then names the new day.
The stations do not move.

**Why this priority**: a chosen day is the picker's whole purpose, and
"rebuild, never re-lay out" is principle III in practice.

**Independent Test**: against the stand-in, choose a day inside the
window, a day outside it and the day already stored; against the real
engine, choose a Saturday for Los Angeles and read the schedule stage's
sentence for the trip count.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** a day inside the window is
   chosen and confirmed, **Then** the app calls `map.build` with the
   stored layout's id and that day, never `graph.build`; the four map
   stages report; and the record's day changes only when the build has
   finished.
2. **Given** the picker, **When** a day outside the window is typed or
   picked, **Then** it cannot be submitted, the message says which days
   the feed covers, and nothing is built. The main process refuses the
   same day if it is asked directly.
3. **Given** the day already stored, **When** it is chosen again, **Then**
   nothing runs.
4. **Given** a rebuild in progress, **When** it is cancelled or fails,
   **Then** the record keeps the previous day and the layout's id is
   unchanged; the screen says the page may be the old map until the next
   build.
5. **Given** a chosen day, **When** the export runs, **Then** the export's
   provenance carries that day, as it carries the stored day today.
6. **Given** a Saturday chosen for Los Angeles, **When** the build
   finishes, **Then** the schedule stage's sentence reports the trips of a
   Saturday timetable, and a trip that runs past midnight keeps its
   `25:44`-style time in the page, because the app passed a day and
   nothing else.

---

### User Story 3 - The pin moves to v0.6.0 (Priority: P1)

The app runs the engine that has `feeds.service`, its types know the
method, and every test that talks to an engine, real or stand-in, still
passes.

**Acceptance Scenarios**:

1. **Given** `vendor/pins.json` at v0.6.0 and the types regenerated,
   **When** the checks run, **Then** the fingerprint matches the engine's
   own description, `feeds.service` is a method the typed client names,
   and the protocol number is still 1.
2. **Given** the stand-in engine, **When** it is asked `feeds.service`,
   **Then** it answers a fixed window, day and the anchor it was given, so
   the end-to-end suite has a picker to bound on every platform.

### Edge Cases

- `feeds.service` is a long request when the feed is not cached. At the
  first layout it always is, because `graph.build` has just downloaded it;
  the run reports nothing new while it waits, and a cancel that lands
  during it stops the run before the map is drawn.
- A feed with neither calendar table is refused by the engine with its
  own hint; the run fails with that sentence and writes nothing.
- The engine's mid-window fallback can answer a day before the anchor.
  The app stores what it is given.
- A window of one day: the picker has one choice and the control says so.
- A project's window is stored once and read from the record; the app
  never asks the engine for it on open (principle IV, and the record is
  what makes the screen the same on every machine). A re-layout refreshes
  it, because a fresh feed may carry a new calendar.
- The stored day is what every later `map.build`, capture and export is
  told; the anchor is stored so the choice can be reproduced, and read by
  nothing else yet.
- The page keeps times past midnight on its own; the app parses no time
  of day, converts none, and shows only calendar days.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The pin MUST move to engine v0.6.0 and the types MUST be
  regenerated; `feeds.service` MUST be reachable through the typed client.
- **FR-002**: A layout run for a project without a stored window MUST
  call `feeds.service` after `graph.build` and before `map.build`, with
  the feed key, the machine's date as `anchor`, and the octi stage's
  `lines`, and MUST draw the map for the day answered when the project has
  no day. A project that has a day MUST keep it.
- **FR-003**: The record MUST store the engine's answer, `{start, end,
  busiest_weekday, anchor}`, beside the day, and MUST write it together
  with the layout's id or not at all. The record version stays at 1: a
  record without it reads as before.
- **FR-004**: The project screen MUST show the stored day and the window,
  and MUST offer a date control bounded by the window, keyboard-reachable
  and labelled, with the engine's day offered as a suggestion.
- **FR-005**: Choosing a day MUST build with `map.build` from the stored
  layout's id and MUST NOT call `graph.build`. The record's day MUST change
  only when the build finishes, and a cancelled or failed build MUST leave
  the record unchanged.
- **FR-006**: A day outside the stored window MUST be refused in the
  interface and again in the main process, which is the gate; the day
  already stored MUST start nothing.
- **FR-007**: A layout or a rebuild MUST NOT run while an export runs, and
  the reverse, as today.
- **FR-008**: The app MUST NOT parse, convert or display a time of day.
- **FR-009**: The stand-in engine MUST answer `feeds.service` with a fixed
  window and day, echoing the anchor.

### Key Entities

- **Service window**: the first and last day the feed's calendar covers,
  as `feeds.service` answers them; stored with the project.
- **Engine's day**: the busiest weekday from the stored anchor; stored so
  the picker can offer it and a reader can reproduce the choice.
- **Service day**: the calendar day the map is drawn for. The engine's day
  at the first layout, or the one a person chose since.

## Success Criteria _(mandatory)_

- **SC-001**: Against the stand-in, a first layout stores the window and
  the day, a chosen day rebuilds without a layout call, a day outside the
  window is refused, and a cancelled rebuild changes nothing, in the
  end-to-end suite on three platforms.
- **SC-002**: Against the real engine with Los Angeles, the day stored at
  the first layout equals what `feeds.service` answers for the same anchor
  and lines, and a Saturday build reports Saturday's trips in the schedule
  stage's sentence.
- **SC-003**: A project laid out before this feature opens unchanged and
  gains its window at its next run without losing its day.
- **SC-004**: The fingerprint test, the contract tests and the unit tests
  pass at the new pin.

## Assumptions

- **A-001**: The lines passed to `feeds.service` are `stages.octi.lines`
  from the `graph.build` that just answered, so the day counts trips the
  way the map does.
- **A-002**: The record's window is refreshed at every layout run and
  never on open. A calendar that changes under a stored layout is
  noticed at the next re-layout, not before.
- **A-003**: The date control is the platform's native one, as the design
  system prefers for selects (`docs/DESIGN.md` 8.2 gains the rule in the
  same change).
- **A-004**: The trip count for the built day is the engine's schedule
  sentence, shown as the run shows it today; a panel for the diagnostics
  block is A3-03.

## Dependencies

- E21 (engine v0.6.0).
- ADR-031, which this feature completes; ADR-033 for the layout id the
  rebuild draws from.
