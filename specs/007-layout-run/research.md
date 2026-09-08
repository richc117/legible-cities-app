# Research: the layout run

Phase 0. Everything below was measured or read on 2026-09-07 and 2026-09-08
against the engine at the pinned tag. Five parallel readings of the engine,
the app, the governance documents, the feasibility and the interface
produced the claims; the surprising ones were then handed to independent
agents told to refute them. Twenty of twenty-one survived. What follows is
what survived, with the one that did not.

## 0. What was measured on this machine

Docker is running. 45 feed archives are downloaded, including la-metro-rail
(1.6 MB). 22 feeds have cached stage graphs.

## The cache is flat and per feed key, with no hash

    data/graphs/<key>/00_gtfs2graph.json
                      01_topo.json
                      02_loom.json
                      03_octi.json

No hash directory. The A3-01 draft's `graphs/<key>/<hash>/` does not exist;
that is E04's, and E04 is not done. Existence-only caching, keyed by the
feed alone, so **two projects on the same feed share one set of stages**.

## Timings, with the stages already cached

| Call                                             | Wall clock | Steps it reports                                                        |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------- |
| `pipeline.schematize('la-metro-rail')`           | 0.24 s     | 4: gtfs2graph, topo, loom, octi at 0.25/0.50/0.75/1.00                  |
| `pipeline.run('la-metro-rail', date=2026-09-02)` | 0.54 s     | 8: the same four, then schedule, render, animate, write, at 0.12 … 1.00 |

A cold run needs Docker and LOOM and is not measured here. Every app test
can therefore drive a real layout in well under a second, provided the
stages are already cached; nothing may depend on a cold run.

## What map.build writes

    <out>/la-metro-rail.html            538 KB, the self-contained page
    <out>/la-metro-rail.positions.json  409 KB
    <out>/la-metro-rail.svg              52 KB

## The progress messages are sentences, not numbers

    gtfs2graph  114 nodes (114 stations, 0 junctions), 112 edges, lines: A, B, C, D, E
    schedule    1236 trips on Wednesday 2 September 2026; matched 114/114 stops (100%)
    render      3 labels dropped
    animate     28 distinct paths
    write       <the output directory>

## The design question this raises

`map.build` runs the four layout stages itself before its own four steps.
Calling `graph.build` and then `map.build` would report the layout stages
twice. The spec has to decide whether the app calls one or both, and what
identifies the stored layout given the engine hands back paths rather than
an identifier.

## One oddity, chased and dismissed

`run` looked as though it reported one line fewer than `schematize` for the
same cached stages. It does not: my probe truncated the message at 70
characters and cut the last line off. `pipeline.run` calls `schematize`
itself and only rescales the fraction, which is also why the layout stages
appear inside a map build.

## The project's mode cannot reach the engine

`GraphBuildParams` is `{ key, force }` and `MapBuildParams` is
`{ key, date, out, width, line_order, force }`, both closed. Neither takes
a mode or an agency, deliberately: the engine keys its cache by the feed
alone until E04, and the schema refuses the parameters so the app's
generated types cannot send them. The mode lives in the engine's own
registry instead (`feeds.py:100`, `mode="all"` for Los Angeles).

The A3-01 draft says the layout runs "for the project's feed and mode".
It cannot. A project's `mode` and `agency` fields are recorded and unused
until E04, and the spec has to say so rather than imply the app is
choosing something it is not.

## Where the output goes, and why it fits

`map.build` with `out: <token>` writes into `<home>/out/<token>/`, and the
app's origin already serves `app://local/projects/<id>/` from
`<SCHEMATIC_HOME>/out/<id>/`. Passing the project's id as the token puts
the generated page exactly where the viewer will look for it, with no
copying. The files are named after the feed, `<key>.html`, not `index.html`.

## Verified by trying to break it

Each claim below was checked by an agent instructed to refute it, reading
the code itself rather than trusting the claim.

### The map build re-runs the layout without being asked

`serve.py`'s map handler calls the pipeline's `run`, which opens by calling
`schematize`, which builds any stage whose file is missing. The generated
types carry the engine's own words for it: "from the cached stages (built
first if missing)". ADR-023 forbids exactly this, so the app cannot enforce
that promise; it rests entirely on the files happening to be there.

**Consequence for this feature**: detection replaces prevention. The app
records which layout it drew from and reports a difference, rather than
claiming to have stopped something it cannot stop.

### A cancelled re-layout corrupts the layout

Forcing a rebuild rewrites each stage file in place as its tool returns, so
the first three are replaced before the fourth starts. An agent reproduced
this rather than reasoning about it: with a complete layout on disk, it
raised the engine's cancellation inside the fourth stage and found three new
files and one stale one, with no rollback. A later ordinary build then read
that mixed set, ran nothing, and reported success, mixing new statistics
with the old graph.

**Consequence**: re-layout is cut from this feature. The issue's acceptance
criterion, that cancelling during the fourth stage leaves the previous
layout intact, is not satisfiable at this engine.

### Cancelling has almost no window anyway

The first stage takes about thirteen seconds on a large feed; the other
three are under a second each, and the engine's own cancellation test has to
force a rebuild and sleep a second to catch the first stage at all. So
cancellation matters, but the stage a person can realistically cancel during
is the first.

### No project has a service day, and the records disagree about whose job it is

A project is created with no day. The engine refuses a map build without
one, deliberately, and no method at protocol 1 can resolve one: the feed's
service window arrives with two unbuilt engine issues. Meanwhile ADR-023
says the day is resolved when a project is created, and the project
feature's specification and the architecture page say it is resolved at the
first layout.

**Consequence**: this feature resolves it at the first layout, from the
machine's own today, and stores it at once. The contradiction is flagged for
a decision record.

### A run can reach the network whichever way the cache flag is set

The map build reads the feed's tables, which downloads the archive when it
is not on disk. The cache flag reaches only the layout stages, so it neither
causes nor prevents the download. An offline person asking for a map of a
feed they have never built gets a network failure.

**Consequence**: the specification names this as the only network a run can
cause, and the failure is the engine's own sentence rather than being
described as a rendering problem.

### Progress arrives only when a stage finishes, and describes the stage that finished

The engine's own schema says "once per step as it finishes", and every
emission sits after the work it names. The progress component draws the
current stage's message, so wiring the two naively would attribute a
finished stage's sentence to the stage now running.

**Consequence**: an explicit rule in the specification. A report for a stage
marks that stage done and carries its sentence; the next stage becomes the
running one with no sentence until it finishes.

### The one claim that did not survive

An agent proposed that the progress component discards the fraction the wire
carries. It does not: nothing routes progress to the component yet, and the
fraction survives the whole path from the engine to the renderer. The
component takes a stage list rather than a fraction on purpose, because a
fraction cannot say which stage is running. The claim was about a wiring
that does not exist rather than about a defect.
