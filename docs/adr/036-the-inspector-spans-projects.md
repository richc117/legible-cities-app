# ADR-036: The inspector spans projects

- **Status:** Accepted
- **Date:** 2026-09-12
- **Supersedes:** none
- **Superseded by:** ADR-045, in part (the left rail's deferral)

## Context

Four kinds of long work exist, each drawn where it started: the layout run
and the rebuilds that follow a chosen day, a recolour or a reorder on the
project screen; the export in the project's Export tab (A5-01); and a feed
add in the Library's dialog (A2-01). The runs already outlive the views
that started them (`src/renderer/src/engine/runs.ts`), so a person can
start an export of one project, open another and lay it out. Nothing on
the second screen says whether the first is still going, how far it has
got, or that it failed.

`docs/DESIGN.md` section 9 planned three regions for a project: a left
rail for navigation, the main region, and a right inspector "for the
project's fields, diagnostics and jobs". Issue A1-03 asked for a jobs
drawer. The maintainer settled two questions before the spec
(`specs/024-jobs`): the inspector starts collapsed, with a running count on
its toggle and a polite announcement when a job ends, and finished jobs are
kept for the session only, at most twenty.

Two facts shaped where it lives. Jobs belong to no single screen: an export
of Los Angeles is still running while the Library or Settings is open, and
a feed add belongs to no project at all. And a project's fields and
diagnostics are read beside that project's map, which only the project
screen shows.

## Options

**(a) An inspector per project screen, as section 9 drew it.** The fields,
the diagnostics and the jobs together. A job would be visible only while
its own project is open, which is the problem the issue exists to solve,
and the Library and Settings would have no view of jobs at all.

**(b) The window's inspector, holding only the jobs.** Rendered from
`App.tsx` beside all three screens. Every job is reachable from anywhere.
The fields and diagnostics stay where they are; the left rail waits.

**(c) A jobs page, a fourth screen.** Reachable from the header, but
leaving the screen a person is working on to look at a job is the
interruption the issue describes, and a screen cannot show a run moving
beside the map it is rebuilding.

**(d) A toast or a notification per job.** Nothing to follow, cancel or
diagnose; and section 8.2 already rules out a toast for anything a person
must act on.

## Decision

The inspector is the window's, not a project's. It is rendered from
`App.tsx` beside the Library, a project and Settings, 320px wide and
collapsible, collapsed until a person opens it from a header toggle that
carries the running count; below 900px it covers the main region rather
than squeezing it. Its first and only content is the session's jobs: every
layout run, rebuild, export and feed add, each on its run's own progress
line with Cancel, the engine's hint and its detail, and "Copy log" through
the main process's redaction. The runs do not move and do not change
behaviour; the inspector is a second view of them. The left rail, and
moving the project's fields and diagnostics into the inspector, are
deferred, and section 9 lists both as deliberately absent.

## Consequences

**A job is visible, cancellable and diagnosable from every screen**, and a
running job's view cannot drift from the run's own screen, because it is
derived from the run's snapshot each time it is read. What is kept beside
the runs are copies: a job that has ended, frozen at the moment it ended,
and each project's name, since a run knows its project only by id. Copies
can go stale, so each has one source that updates it - the moment of the
end for a job, the list read or a rename for a name - and a project's jobs
leave only when its own screen has deleted it.

**Section 9's three regions are now two.** The inspector's width is taken
from the main region on a wide window, so the viewer subtracts it; on a
narrow one the inspector is an overlay and takes nothing.

**The inspector has one tenant.** If the fields or the diagnostics move in
later, they arrive as a section beside the jobs and bring a reason; the
jobs stay first, since they are the one thing that spans projects.

**Names are the renderer's to find.** The window reads the project list
when a name is needed, and only then. Each such read is still a store read
that can overlap a record being renamed into place, a Windows hazard; a
read on every screen change would add many more for nothing.

**Nothing is persisted.** A relaunch starts with an empty list; what the
engine said is already in `engine.log` (A6-03), which "Copy log" points at
when a job's own 200 lines were not enough.
