# ADR-023: Determinism is per project; the layout is computed once and stored

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

Principle III of the constitution promised that two exports of the same job
agree within a published threshold. Spike A0-05 (`docs/adr/spikes/loom-native.md`)
found that the engine cannot keep that promise on macOS: `topo` produces a
different graph on each run from one input - 116 to 119 nodes over five
runs, stations appearing and disappearing - because LOOM iterates its nodes
in heap-address order and the macOS allocator does not lay objects out the
same way twice. The Linux build is stable. The cause is upstream
(ad-freiburg/loom#44) and the spike's partial patch reduced the variance
without removing it. `octi` shows the same fault intermittently.

Two things follow that the plan had not allowed for. The committed reference
graphs in the engine, and the maps published on the site, were produced by a
stage that is not reproducible, so no build reproduces them exactly and they
cannot serve as a fixture. And any test phrased as "run the pipeline twice
and compare" fails before a pixel is captured, at the graph stage, where no
RGB tolerance can absorb a station that exists on only one side.

Spike A0-07 (`docs/adr/spikes/offscreen-capture.md`) established the other
half: from a fixed page, capture *is* deterministic - byte-identical across
runs - provided it waits for the paint before each frame. So the
nondeterminism is confined to the layout stages, and everything downstream
of a stored graph is order-safe, with one exception: the engine's default
service date is chosen relative to today's date when the feed's window
covers it, so the same feed can pick a different day next month.

## Options

**Block native macOS until upstream fixes it.** Keeps principle III as
written. Ships nothing on the platform the maintainer develops on until a
third party rewrites a container's ordering, on no timeline. The escape
hatch - run the pipeline only where it is stable - is not available to a
desktop app.

**Carry a LOOM patch.** Fork at the pin, replace the pointer-ordered
`std::set<Node*>` with insertion-ordered ids through the graph library, and
maintain it. The spike's eighteen-line tie-break was not a fix; a real one
touches 163 iteration sites in `topo` alone and every other tool that shares
the library. It would also make the build *look* deterministic while any
site the patch missed was not, which is worse than the visible problem.

**Compute the layout once and store it.** Treat the layout as an artefact of
the project rather than a function of its inputs. Every render and export
reads the stored graphs; re-running the layout is an explicit action. The
engine already caches the four stage graphs on disk; what changes is that
the cache becomes the contract rather than a convenience, and that it is
keyed so it cannot be reused by accident or discarded by accident.

## Decision

The third. A project's layout is stored with the project: the four stage
graphs under `graphs/<key>/<hash>/`, beside a `.meta.json` carrying the
hash of the inputs and the LOOM pin that produced them (engine issue E04).
A stage is re-run only when that hash or the pin has changed, or when the
person asks. Every `map.build` and every export reads the stored layout and
never invokes the layout stages implicitly. The service date is resolved
when the project is created and stored in it, and the engine is always told
the date rather than left to choose one.

Re-layout is a button, not a side effect. It says, before it runs, that the
result may differ from the map the person has.

Principle III is restated accordingly in constitution 1.1.0: two exports of
the *same project* agree within the threshold, and a test says so.

## Consequences

`out/<id>/` and the stage graphs beneath it become inputs to an export
rather than derivatives of a feed. The data layout says so, and "Reset
engine data" now deletes layouts as well as caches; the app says that too.

The determinism gate (A5-04) compares two exports of a fixture project with
a stored layout, on every runner, and separately asserts that the layout's
hash did not move between them. It does not compare node counts, which the
spike showed to be stable over a graph that was not, and it does not re-run
the pipeline to see whether it agrees with itself - that is upstream's test
to pass, not ours.

The site's published maps and the engine's committed reference graphs are a
shape to compare against, not a fixture to match. The plan's "the LA map
matches the site's" criteria are replaced by "the app's output for a
project equals the engine's own output from the same stored layout".

The app never runs LOOM without being asked. That is a stronger rule than
the constraint on child processes required, and it is the one that keeps
the promise: a person who liked yesterday's map keeps it.

If upstream lands a fix, re-layout becomes stable on macOS and nothing here
has to change; the stored layout remains the right unit, because a person
who changes a colour should not wait for four stages to run again.
