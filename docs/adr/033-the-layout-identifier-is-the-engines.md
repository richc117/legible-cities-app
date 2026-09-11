# ADR-033: The layout identifier is the engine's, and re-layout is a button

- **Status:** Accepted
- **Date:** 2026-09-10
- **Supersedes:** ADR-027
- **Superseded by:** none

## Context

ADR-027 recorded what the app had to do while the engine had no
addressable layout: derive an identifier from the bytes of the four stage
graphs the engine named, report a changed layout after the fact, and offer
no forced re-layout, because a forced rebuild rewrote the stage files in
place and a cancel could leave a mixture the next build read as valid.

Engine v0.5.0 (issue E04b) closes that. A layout is stored at
`data/graphs/<feed>/<id>/` with a `.meta.json`, and `<id>` is the sha256 of
everything that went into it: the feed's bytes, the mode, the agency, the
label options, the LOOM build and the stage arguments. The same inputs name
the same layout before anything runs. A layout is written whole into a
scratch directory and moved into place, so a cancel or a failure leaves
nothing that looks finished; `force` replaces a stored layout only once the
new set is whole. `graph.build` answers with the id and the meta;
`map.build` takes the id and never lays a feed out.

Two projects on one feed therefore name the same layout unless their inputs
differ, and a forced rebuild cannot destroy the layout it replaces.

## Options

**Keep the app's digest beside the engine's id.** Two identifiers for one
thing, computed differently, and the constitution's third principle served
by the one the engine does not know.

**Store the engine's id and nothing else.** The app relays what
`graph.build` answered; the main process checks its shape and writes it. A
record from before carries the app's digest, the same shape and a different
value, which the next run replaces and says so.

## Decision

The second. A project records the engine's layout id. The run passes it to
`map.build`, so a map is always drawn from the layout the project names and
the engine never lays out on the way to one. `completeLayout` takes the id
and the day; it reads no file and needs no path.

"Re-layout" is a button on the project screen behind a warning that the
layout engine is heuristic and a new layout may place stations differently.
It runs `graph.build` with `force`. The engine keeps the stored layout until
the new set is whole, so a cancel or a failure leaves the project exactly
as it was, and the record is written only when both calls have returned.
"Lay out again" stays for the unforced case, which reuses the stored
layout.

The registry entry's mode and agency still apply: the app passes neither
until a person can choose them (A2-02), and until then the record's are
placeholders.

## Consequences

The app's `src/main/layout.ts` and its tests go. A record written before
this carries the app's digest; the next run records the engine's id and the
screen says the layout differs from the one recorded, once.

A re-layout runs every stage again under the same id, because the id names
the inputs and not the output. Its map may differ while the id does not,
which the screen says in its own words rather than through the changed
flag. That is the honest reading of "the same inputs name the same layout":
`octi` is not deterministic, and what reproduces a map is the stored set,
not the id alone.

Two projects with the same inputs share one layout, and a re-layout from
one of them replaces the set both draw from. The other project's record
still names the id, so its next "Lay out again" draws from the new set and
the changed flag, which compares ids, says nothing. The warning says so
before a re-layout. The honest fix is small and is its own change (A3-06):
record the layout's `made` beside its id, which an unforced answer repeats
and a forced one rewrites, and compare both.

A re-layout that stops after the layout call has answered - a cancel
during the map, a failed map - has already replaced the stored set. The
record is untouched and still names the id; the map on screen is the old
one until the next run draws the new, and the screen says exactly that
rather than "the project is as it was".

The error kind `layout` joins the engine's kinds: a map asked for from a
layout that is not stored. The app's validators for mode and agency now
follow the engine's own rules (what `gtfs2graph -m` takes; at most 64
characters), since the engine now checks them.

The constitution's third principle holds as written: renders and exports
read the stored layout and never re-run the layout stages. The gap ADR-027
named is closed, and the architecture page no longer has a section on it.
