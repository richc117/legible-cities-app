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

Added after acceptance because the record above ended on a conjecture, and
the first version of this addendum then overstated how far the spike had got
past it. The decision is unchanged by either correction - it is better
supported now than when it was written.

**The conjecture was wrong.** Consequences supposed "uninitialised memory or
... iteration order over a hash container". It is neither.
`util/graph/Graph.h` stores a graph's nodes in `std::set<Node*>` - an
*ordered* container whose key is the pointer - and `topo` iterates it at 163
sites, so every pass runs in heap order. glibc lays those objects out in a
stable relative order run to run; macOS's allocator does not.

**But the cause is not settled, and this addendum first said it was.** It
claimed a patch that "fixes the node-count symptom". At eight runs that
looked true; at ten it is not - the patched build varies exactly as the
unpatched one does. The tie-break in `collapseShrdSegs` is one contributor
among 163 pointer-ordered iterations, and no fix has been demonstrated.

What is established: both macOS builds are nondeterministic when compared as
graphs, the Linux build is deterministic across eight runs on the same test,
and the solver-free build's stable node count is a stable *count* over a
graph that still changes. That last point strengthens the decision above
rather than weakening it - the build this record chose to ship is no more
reproducible than the other, and node count is not a determinism test.

Reported upstream as https://github.com/ad-freiburg/loom/issues/44.
`docs/adr/spikes/loom-native.md` has the numbers and the retraction.

## Second addendum, 2026-09-07 (evening)

The mirror's runners built all three POSIX targets from the pin, and
session four of the spike ran and compared them. Two corrections to the
record above, neither changing the decision:

**"No non-system dependencies" was true of the macOS builds and false of
the Linux one.** LOOM's CMake picks up OpenMP wherever the compiler offers
it; GCC does and Apple clang does not, so the Linux `octi` linked
`libgomp.so.1` and the Linux gate - which only printed `ldd` - let it
through. OpenMP is now disabled at configure time on every platform, in the
same spirit as the four packages above, and the Linux gate fails on any
library outside the C and C++ runtime, `libz` and `libbz2`.

**`octi` is nondeterministic on macOS in its own right**, not only
downstream of `topo`: three runs on one identical input, two agree and the
third moves stations by up to 1.4 km on arm64, and no two agree on x64. It
is the stage whose variance a person sees. `loom` is deterministic on every
build. And no two builds agree past `gtfs2graph`, including two Linux
builds with different compilers, each stable with itself - deterministic is
not portable. ADR-023 is the answer to both.

---

*(Written before the mirror existed.)* Two of the three targets remain
unmeasured. The recipe should carry to Intel macOS unchanged and to Windows
through the Transport for Cairo patches, but "should" is doing work in that
sentence, and the spike says so. *Since measured: it did carry to Intel; see
the second addendum.*
