# ADR-019: LOOM ships without its optional solvers, and not on macOS until it is deterministic

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

The app runs LOOM's four tools - `gtfs2graph`, `topo`, `loom`, `octi` - as
native binaries, built in CI from a pinned commit, so a user needs neither
Docker nor a compiler. ADR-011 settled that they are built rather than
downloaded. This record settles *how* they are built, and it reports
something the question did not anticipate.

The spike is `docs/adr/spikes/loom-native.md`. It measured macOS arm64 on a
developer machine; there is no CI yet, so macOS x86_64 and Windows x64 are
unmeasured.

Built the obvious way, with Homebrew's dependencies, the binaries are not
self-contained: `loom` and `octi` each link ten libraries outside
`/usr/lib` - GLPK, the COIN-OR stack, OpenBLAS - and `gtfs2graph` links
libzip. On a machine without Homebrew they do not start.

Then the same binary was run twice on the same input, and disagreed with
itself.

## Options

**Bundle the libraries** with `dylibbundler` and rewritten rpaths, the
approach the spike was designed around. It works, and it means shipping ten
libraries, a relocation step per platform, and a licence obligation for each.

**Build without them.** `loom` defaults to `comb-no-ilp` and `octi` to
`heur`; this project passes no optimisation flags, so the solvers are linked
and never called. Disabling them at configure time leaves four binaries with
no non-system dependencies at all. It costs the ability to request an exact
ILP solution later, and - because libzip goes too - `gtfs2graph` can no
longer read a zip, only a directory.

**Ship the Docker image** instead of native binaries. Reliable and stable,
and rejected by ADR-011 for the reason that still holds: a desktop app
cannot require Docker.

## Decision

Build with `-DCMAKE_DISABLE_FIND_PACKAGE_{GLPK,COIN,Gurobi,LibZip}=ON`, and
feed `gtfs2graph` an unpacked directory. This produces four binaries linking
only `/usr/lib`, verified with `otool -L`, with no bundling step. The engine
already normalises feeds to disk, so the directory requirement costs nothing.
`.github/workflows/vendor.yml` implements it and checks it, failing the build
if any binary links a Homebrew path.

**Native macOS binaries are not shipped yet.** `topo` is nondeterministic in
the macOS build: five runs on one input produced 116, 117, 118, 119 and 117
nodes, with stations appearing and disappearing between runs. The same commit
built for Linux in Docker produced 117 nodes on all eight runs. This is a bug
in a build we control, not a property of the algorithm, and it is blocking
because principle III of the constitution - determinism is a feature, and a
test says so - cannot be satisfied by a binary that does not agree with
itself. `octi` shows the same fault intermittently.

Until that is found, the Docker build remains the reference for correct
output, and the app's first releases either use it or ship the cached graph
stages rather than re-running the pipeline.

## Consequences

Packaging gets simpler than expected: nothing to bundle, nothing to relocate,
no per-library licence obligation beyond LOOM's own GPL-3.0, and the
`otool`/`ldd` gate in CI is a one-line grep rather than a bundling pipeline.

An exact ILP solution is no longer available without a rebuild. Nothing asks
for one today, and the flag that would is not passed anywhere; if a future
feature needs it, this decision is revisited along with the bundling question
it defers.

`gtfs2graph` requires a directory. Any code path that hands it a zip will
fail with a parse error rather than a clear message, so the sidecar unpacks
before calling it and says so where it does.

The determinism finding lands on more than this record. A5-04's determinism
test cannot pass on macOS while `topo` varies, the engine's committed
reference graphs under `data/graphs/` cannot be reproduced exactly by any
build, and the schedule for native macOS binaries now depends on a debugging
task nobody had planned. Finding it is the next piece of work; the Docker
build being stable is the strongest clue, and points at uninitialised memory
or at iteration order over a hash container differing between libstdc++ and
libc++.

## Addendum, 2026-09-07

Added after acceptance because the record above ended on a conjecture that
the spike then settled. The decision is unchanged; only the guess about the
cause was wrong, and leaving it would send the next reader the wrong way.

The Consequences section supposed "uninitialised memory or ... iteration
order over a hash container". It is neither. `util/graph/Graph.h` stores a
graph's nodes in `std::set<Node*>` - an *ordered* container whose key is the
pointer - and `topo` iterates it at 163 sites, so every pass runs in heap
order. glibc lays those objects out in a stable relative order run to run and
macOS's allocator does not, which is the whole of the difference between the
two builds. `docs/adr/spikes/loom-native.md` has the evidence and a patch
that fixes the node-count symptom without fixing the cause.

---

Two of the three targets remain unmeasured. The recipe should carry to
`macos-13` unchanged and to Windows through the Transport for Cairo patches,
but "should" is doing work in that sentence, and the spike says so.
