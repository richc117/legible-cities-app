# 027. The layout a project stores, and what the engine cannot yet promise

Status: Accepted

Date: 2026-09-08

Supersedes: -

Superseded by: -

## Context

ADR-023 decided that a project's layout is computed once and stored, that
every render and export reads the stored layout, and that re-running the
layout stages is an explicit action which says it may produce a different
map. The constitution's third principle says the same. The first feature
that had to keep those promises was the layout run, and building it meant
finding out what the engine at the pinned version can actually support.

Four things turned out not to hold, each checked against the engine rather
than assumed, and two of them by running it.

**There is no addressable layout.** ADR-023 describes stage graphs under
`graphs/<key>/<hash>/` beside a `.meta.json`, and attributes them to engine
issue E04. E04 is not built. The engine writes four files flat under
`graphs/<key>/`, caches them by existence alone, and imports no hashing of
any kind. A layout therefore has no identity the app can record, and every
project on a feed shares one layout.

**The map build re-runs the layout without being asked.** Its own
description says so: "from the cached stages (built first if missing)". So
"renders read the stored layout and never re-run the layout stages" is not
something the app can enforce; it holds only while the files happen to be
there.

**Forcing a rebuild can destroy a layout.** Each stage's file is rewritten
in place as its tool returns, so the first three are replaced before the
fourth runs. Cancelling during the fourth leaves three new files and one
stale one, with no rollback, and the next ordinary build reads that mixture,
runs nothing and reports success. This was reproduced, not inferred.

**No project has a service day, and the record disagrees with itself about
whose job it is.** The engine refuses to draw a map without one and will
never choose one. Nothing at protocol 1 can report a feed's service window.
Meanwhile ADR-023 says the day is resolved when a project is created, while
the project feature's specification and the architecture page say it is
resolved at the first layout. Neither is implemented.

## Options

**Wait for E04.** The engine grows a hashed, content-addressed cache and
the app stores the engine's own identifier. This is the right end state and
it is already scoped. It also puts the first map on the far side of an
engine feature that is not on the path to the first reel, and leaves the
app unable to draw anything until then.

**Have the app compensate for the engine.** The app copies stage files
aside before forcing a rebuild and restores them if the run does not
finish, and reads the engine's cache directory to detect changes. This
makes a forced re-layout safe today, at the cost of the app reaching into
the engine's own directory and encoding the engine's file layout in a
second place. It is the sort of arrangement that survives one refactor of
the engine and not two.

**Store what can honestly be stored, and detect what cannot be prevented.**
The app derives an identifier from the contents of the four stage graphs
the engine names, records it with the project, and reports when a completed
run differs from what the project had. It does not offer a forced rebuild,
because that cannot be made safe here. It resolves the service day at the
first layout and stores it at once.

## Decision

We took the third. A project records a layout identifier that the app
derives from the bytes of the stage graphs the engine named, and its
service day, resolved once at the first layout from the machine's own date
and never recomputed. A run that finishes reports whether the layout
differed from the one the project had stored. There is no forced rebuild;
"Lay out again" re-runs without forcing, which reuses the cache and cannot
destroy it.

On the contradiction about the service day, we followed the later of the
two documents and resolve it at the first layout. This record does not
settle which document was right, because that is a decision about ADR-023
and belongs in its own record; it settles only what the code does now, and
says plainly that one of the two is stale.

## Consequences

What this costs. The app's identifier is not the engine's, so it is
replaced when E04 lands, and any project laid out before then records a
value that means the same thing but is computed differently. Two projects
on one feed share a layout and record the same identifier, which is true
and which the interface says rather than hides. The promise that nothing
re-runs the layout implicitly is not kept: the app notices afterwards
instead, so a person can be told that the map they are looking at came from
a layout that has since changed, but cannot be prevented from getting
there. This is a real gap against the constitution's third principle, it is
named in the feature's specification and in the architecture page, and it
is the reason E04 matters more than its position in the roadmap suggests.

The service day is chosen from the machine's date, which may be a day the
feed does not serve. It is stable from the moment it is stored, which is
the half of ADR-023 that can be kept; choosing a good day needs the feed's
service window and belongs to the service-date issue.

What this makes easier. A layout has an identity today, without waiting for
the engine, and that identity is exactly what a later determinism test
compares. Nothing in the app can quietly destroy a layout, because nothing
in the app forces a rebuild.

What to watch. When E04 lands, the identifier changes hands and this record
is superseded rather than amended. Until then, a person who re-lays out one
project changes what every other project on that feed was drawn from, and
the only signal is the sentence the next run shows. If that turns out to
mislead anyone in practice, the answer is E04 sooner, not a cleverer
message.
