# ADR-031: The service day is resolved once, at the first layout

- **Status:** Accepted
- **Date:** 2026-09-10
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-023](023-per-project-determinism.md), whose decision says
  the service date is resolved when a project is created. It is resolved at
  the first layout. That record's decision, that the layout is computed once
  and stored and that the engine is always told the date, stands.

## Context

A map is drawn for one service day: the timetable of that day is what the
animation runs. The engine chooses a day by its busiest-weekday rule, which
anchors on today's date when the feed's window covers it, so the same feed
can pick a different day next month. ADR-023 therefore said the day is
resolved when a project is created and stored, and that the engine is
always told the date rather than left to choose one.

The project feature (`specs/003`, FR-012) resolved it at the first layout
instead, and the layout run (`specs/007`, ADR-027) built that. ADR-027
named the contradiction and declined to settle it, because settling it is
a decision about ADR-023 and belongs in a record of its own. This is that
record.

The facts that decide it. When a project is created the app knows a feed
key and nothing else: the feed may not have been downloaded, and nothing at
protocol 1 reads a feed's calendar without running the pipeline. Creation
must not wait on a download. The engine refuses to choose a day when asked
over the protocol, and says why in its own error: its choice would depend on
the day you asked. So what the app can do at creation is nothing, and what
it does at the first layout today is pass the machine's date, which the
feed may not serve: a Sunday on a weekday-only feed, or any day outside a
window that has expired. The run then reports a trip count of zero and the
map shows no trains, which is honest and not helpful.

What is wrong today, then, is not the moment but the source.

## Options

**Keep "at creation" and make creation read the feed.** The create dialog
would download and inspect the feed before the project exists. That needs
the engine's registry and inspection over the protocol (E07, E08), and it
puts a network wait inside a dialog that today completes in a keystroke.
It buys nothing the person can see: the day matters only when a map is
drawn.

**Resolve at the first layout from the machine's date, as built.** Stable
from the moment it is stored, which is the half of ADR-023 that matters.
It can store a day the feed does not serve, and nothing tells the person a
better day exists until the service-date picker (A3-04) arrives.

**Resolve at the first layout from the engine's rule, given a reference
date, and store what it chose.** The engine grows one small, additive
method that takes an anchor date and returns the feed's window and the day
its rule picks from that anchor (engine issue E21). The first layout asks
it with the machine's date as the anchor and stores the answer. The choice
is the engine's rule, the anchor is recorded, and every later build reads
the stored day.

## Decision

The third, with the second as what holds until E21 lands. A project's
service day is resolved once, at its first layout, and stored; it is never
recomputed. Changing it is the service-date picker's explicit action, which
re-renders and never re-lays out. Until the engine can report a window the
source is the machine's date; after E21 it is the day the engine returns
for that anchor. A project laid out before E21 keeps the day it has.

ADR-023's timing sentence is corrected by this record; its decision stands.
`specs/003` FR-012 and ADR-027 are right as written.

## Consequences

Nothing built changes. The project record, the layout run and the
architecture page already describe the first layout; the engine issue E21
is small and additive at protocol 1, so the app's pin moves without a
protocol bump.

Until E21 lands a project can hold a day its feed does not serve. The trip
count for that day is in the engine's schedule-stage sentence and in
`map.build`'s diagnostics, which the app does not yet surface (A3-03); an
empty map is the visible sign, and the fix is one explicit action once the
picker exists.

What to watch: a feed whose window has expired, as Mexico City's has, gets
a day inside its window from the engine's mid-window fallback; the app
must not "correct" that to today, which the feed does not cover. And the
engine's own site has the same dependence on the clock, which is its own
issue (E22), not this record's.
