# Spike: native LOOM binaries

- **Question:** Can CI produce LOOM binaries for macOS arm64, macOS x86_64 and
  Windows x64 that run on a clean machine - no Homebrew, no MSYS2 - built from
  one pinned commit, and do they produce the same graph as the Docker build the
  published maps were made with?
- **Timebox:** three sessions. Ends when the question is answered or the third
  session closes, whichever comes first.
- **Started:** 2026-09-07
- **Ended:** 2026-09-07 (sessions one and two of three; see Recommendation)
- **Branch:** `spike/loom-native` (deleted when this lands; the report is the
  deliverable)

## Method

One machine, an Apple Silicon MacBook Pro on macOS 15 (Darwin 25.6), Apple
clang 21.0.0. Everything below is at LOOM commit
`1e4757838104d1e4d22186c9b77d5fc4b98681a0`, which was the head of upstream
`master` on 2026-09-07; `vendor/pins.json` records it and the Transport for
Cairo Windows port at `8c521a1815759a64b46a5f876dd84b1d8b0878d4`.

**The CI matrix was not run.** This repository has no CI: there is no public
mirror, so the workflows written in A0-02 have never executed, and the
self-hosted runner is a single arm64 host. macOS arm64 is therefore measured
here on a developer machine, and macOS x86_64 and Windows x64 are not
measured at all. What that costs the answer is in *What we ruled out*.

1. **Native build.** `brew install cmake glpk protobuf libzip cbc`, then
   `cmake .. -DCMAKE_BUILD_TYPE=Release && make -j`. Recorded what cmake
   found, and `otool -L` on each of the four binaries.
2. **Solver-free build.** The same commit configured with
   `-DCMAKE_DISABLE_FIND_PACKAGE_{GLPK,COIN,Gurobi,LibZip}=ON`, to test
   whether the optional dependencies can simply be left out rather than
   bundled.
3. **Parity.** `gtfs2graph -m all | topo | loom | octi` on
   `la-metro-rail.normalized.zip`, with each stage compared against the
   graph committed in the engine at `data/graphs/la-metro-rail/`, which is
   what the published maps were built from. Compared with
   `scripts/loom-parity.py`, written for this spike.
4. **Input format.** The same `gtfs2graph` run against an unzipped
   directory instead of the zip.

The comparison is by graph, not by file. Feature order, key order and
coordinate precision are all free to differ; what is compared is the node
set keyed by station, the edge set keyed by the stations it joins, the order
of line labels along each edge, and node positions within a tolerance.

**The instrument needed fixing before its numbers meant anything**, which is
worth recording because the first run looked like a catastrophic mismatch
and was not. LOOM writes the in-memory pointer as the `id` of every node,
edge and line, so `0x10370a150` in one process is `0xaaaafbd128e0` in
another. A comparison keyed on those ids reports every edge as different. It
also reported 120 of 121 edges as unmatched at the `topo` stage, because the
first version keyed edges by their coordinates and `octi` moves every vertex
by design. Keys are now `station_id` for nodes, the endpoint pair for edges,
and the line `label` - the route's short name - for ordering.

## Measurements

### What the binaries link against (macOS arm64, Homebrew build)

`otool -L`. Anything under `/opt/homebrew` must be bundled or removed before
the binary runs on a machine without Homebrew.

| Binary | Libraries outside `/usr/lib` | Which |
|---|---|---|
| `topo` | **0** | already self-contained |
| `gtfs2graph` | **1** | `libzip` |
| `loom` | **10** | `glpk`, `CbcSolver`, `Cbc`, `Cgl`, `OsiClp`, `ClpSolver`, `Clp`, `Osi`, `CoinUtils`, `openblas` |
| `octi` | **10** | the same ten |

### Whether those ten are used at all

| Question | Answer | Evidence |
|---|---|---|
| `loom` default optimisation method | `comb-no-ilp` | `loom --help`: `-m [ --optim-method ] arg (=comb-no-ilp)` |
| `octi` default optimisation mode | `heur` | `octi --help`: `-m [ --optim-mode ] arg (=heur)` |
| What the engine passes | nothing | `pipeline.py` `STAGES = (("topo", ()), ("loom", ()), ("octi", ()))` |

So at the settings this project actually runs, no ILP solver is invoked.
GLPK and COIN-OR are linked and unused.

### Input format

| Question | Answer |
|---|---|
| Does `gtfs2graph` accept an unzipped directory? | Yes |
| Does it produce the same graph as from the zip? | Yes - 114 nodes, 112 edges, 0 moved, 0 ordering differences |

### Parity: native build at the pin, against the committed reference

`scripts/loom-parity.py`, tolerance 1e-6 degrees.

| Stage | Nodes (native vs reference) | Nodes only on one side | Moved beyond tolerance | Worst offset | Verdict |
|---|---|---|---|---|---|
| `00_gtfs2graph` | 114 vs 114 | 0 / 0 | 0 | - | **agree** |
| `01_topo` | 119 vs 118 | 9 / 8 | 91 | 3.98e-4 deg (~44 m) | differ |
| `02_loom` | 119 vs 118 | 9 / 8 | 91 | 3.98e-4 deg | differ |
| `03_octi` | 111 vs 110 | 1 / 0 | 110 | 3.20e-2 deg | differ |

`gtfs2graph` agrees exactly, so the input to `topo` is identical and the
divergence is inside `topo` and everything downstream of it. Edge counts
match at every stage; line ordering along edges matches at every stage. The
difference is one extra node and a systematic shift, not a different map.

### The solver-free build

Configured with the four optional packages disabled, the same commit builds
and every binary is self-contained:

| Binary | Libraries outside `/usr/lib` |
|---|---|
| `gtfs2graph`, `topo`, `loom`, `octi` | **0** |

It costs one capability: without libzip, `gtfs2graph` cannot read a zip at
all (exit 1, "Could not parse input GTFS feed"). Given a directory it
produces a graph identical to the full build's.

### Determinism, which is where this spike actually went

The solver-free build appeared to disagree with the full build from `topo`
onward. Before believing that, the same binary was run twice on the same
input. It disagreed with itself.

`topo`, one macOS-native binary, one input file, five runs:

| Run | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Nodes | 118 | 117 | 119 | 117 | 116 |

46 to 64 nodes move beyond 1e-6 degrees between runs; the worst offset is
3.7e-4 degrees, about 41 m.

Per stage, from a fixed input, compared as graphs rather than bytes:

| Stage | Deterministic on macOS native? |
|---|---|
| `gtfs2graph` | yes, 3/3 runs agree |
| `topo` | **no** |
| `loom` | yes, 3/3 runs agree |
| `octi` | **no** - 2 of 3 runs agreed, the third differed |

The same test against the Docker build (Ubuntu 24.04, GCC, linux/arm64) at
the same commit:

| Build | `topo` node count over N runs |
|---|---|
| Docker linux/arm64 | 117 on all 8 runs, and the 8 graphs agree with each other |
| macOS arm64 native | 116-119 over 5 runs |

The Docker row was re-checked as graphs in session two, not only as counts,
after counts proved misleading elsewhere in this report.

Comparing bytes here would have been wrong in both directions, and was: LOOM
writes pointer addresses as ids, so `loom` and `octi` look different every
run under `cmp` while being identical as graphs.

### Cross-build parity, on the one stage where the question is answerable

| Comparison | Result |
|---|---|
| Docker linux/arm64 vs macOS native, `gtfs2graph`, same commit | **agree** - 114 nodes, 112 edges, 0 moved, 0 ordering differences |
| macOS native vs the committed reference, `gtfs2graph` | **agree** |
| Anything after `topo` | not answerable by a single run, because `topo` does not agree with itself |

### Timing

| What | Time |
|---|---|
| `gtfs2graph` on LA (114 nodes) | 12.9 s |
| `topo`, `loom`, `octi` on LA | under 1 s each |
| Native build, 10 cores, from clean | about 3 minutes |

## What surprised us

**`topo` does not agree with itself.** The spike was set up to compare
builds, and spent its first hour attributing differences to build
configuration - the solver-free build "broke" parity, the native build
"disagreed" with the reference - before the obvious control was run. Same
binary, same input, twice: 118 nodes then 117. Every cross-build difference
measured before that point was noise.

This is the finding, and it is not the one the spike went looking for. It
lands directly on principle III of the constitution: determinism is a
feature, two exports of the same job agree within a published threshold, and
a test says so. Today, on macOS, they do not, and no threshold on node
*count* can absorb a station appearing and disappearing.

**But the Docker build is stable.** Eight runs, 117 nodes every time. The
same commit, the same input, a different compiler and standard library. So
this is not "LOOM is nondeterministic" in the abstract - it is something
about the macOS build, and it is plausibly an uninitialised value or an
iteration over a hash container whose order the two standard libraries do
not share. That is a bug to find, not a property to accept.

**The measuring instrument was wrong twice, in opposite directions.**
Keyed on LOOM's ids, every edge looked different, because those ids are
pointer addresses. Keyed on coordinates, 120 of 121 edges looked different,
because `octi` moves every vertex by design. Both produced confident,
precise, meaningless numbers. A parity script is itself something that has
to be tested, and the test that caught it was the trivial one: a graph must
agree with itself.

**The optional dependencies are not needed at all.** `loom` defaults to
`comb-no-ilp` and `octi` to `heur`, and this project passes no flags, so the
ten linked libraries are never called. Dropping them turns a bundling
problem into no problem: zero non-system libraries, nothing to relocate, no
`dylibbundler`, no rpath surgery.

## Session two: where the nondeterminism comes from

**Root cause: the graph stores its nodes in `std::set<Node*>`.**
`util/graph/Graph.h:38` declares `const std::set<Node<N, E>*>& getNds()`, so
every pass that walks the graph walks it in **heap-address order**. `topo`
does that at 163 call sites.

That explains why Linux is stable and macOS is not. Both randomise the base
address, but glibc's allocator lays these objects out in the same relative
order every run, so pointer order is stable and only the base shifts. macOS's
allocator does not: run to run, the same objects land in a different relative
order.

Evidence, the first three node ids from three runs of each build:

| Build | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Docker | `…4730`, `…74a50`, `…03df0` | `…b730`, `…5ba50`, `…eadf0` | `…a730`, `…31aa50`, `…a9df0` |
| macOS | `…dd080`, `…e8000`, `…e80c0` | `…a6280`, `…bbd80`, `…df900` | `…b83c0`, `…c0000`, `…c00c0` |

The offsets between Docker's ids are identical every run; macOS's are not.

**How that reaches the output.** In `MapConstructor::ndCollapseCand`, a
candidate node wins on `d < dBest` - strictly less, so **the first neighbour
at the minimum distance wins** - and when nothing wins, `g->addNd(point)`
creates a node instead. Change the order the candidates arrive in and you
change whether a node is merged or created, which is the node count moving.

The order they arrive in traces back through the RTree's insertion order to
`collapseShrdSegs`, which builds its work list by iterating `getNds()` and
then sorts `std::pair<double, LineEdge*>` - so **edges of equal length are
ordered by pointer address**. The input graph has no equal-length edges, but
the pass calls `densify(..., SEGL)`, which manufactures uniform-length
segments from the second iteration onward.

**Testing it, and a result that did not survive its own sample size.**
Patching only that comparator to break ties by geometry instead of by
address (`loom-topo-tiebreak.patch`, 18 lines) and rebuilding gave 117 on
all eight runs, matching Docker. Written up as a fix for the node count.

At ten runs it gives `118 117 117 117 117 117 117 117 118 117`. The eight-run
sample was luck. **The patch reduces the variance and does not remove it**,
not even for the count, and the earlier claim in this report was wrong.

A second measurement failed the same way and is worth recording. Run against
the raw feed, the unpatched solver-free build gave 117 ten times, which read
as "the solver-free build is deterministic". It is not: that run changed two
variables at once - build *and* input - and node count is a weak proxy.
Compared as graphs, its ten runs disagree with each other too.

The corrected picture, ten runs each, compared as graphs rather than counts:

| Build | Node counts | Agree as graphs? |
|---|---|---|
| macOS, full (GLPK + COIN-OR linked) | 118 117 117 117 117 117 117 117 118 117 | no |
| macOS, solver-free | 117 x10 | **no** - the count is stable, the graph is not |
| macOS, full + tie-break patch | 118 117 117 117 117 117 117 117 118 117 | no |
| Docker linux/arm64 | 117 x8 | **yes** - checked as graphs, not only counts |

So: both macOS builds are nondeterministic, the Linux build is
deterministic, and the tie-break is at most one contributor among the 163
pointer-ordered iterations. Nothing here is a fix.

**Node count is not a determinism test.** It caught the loudest symptom and
hid the rest; the solver-free build looked clean by that measure while 6 or 7
nodes existed on one side only and 60 to 70 moved beyond tolerance between
runs. Any determinism gate this project builds - A5-04 - has to compare
graphs, and has to run more than a handful of times before it is believed.

An allocator experiment supports the same story without fixing it:
`MallocNanoZone=0`, which moves small allocations out of macOS's nano zone,
gave 117 on five of six runs instead of the usual spread.

**The patch is evidence, not a change we are making.** It is kept beside this
report for an upstream report; this project does not fork LOOM, and carrying
a partial determinism patch would be worse than the problem - it would make
the build look deterministic while it is not.

## What we ruled out

**Bundling the Homebrew dylibs** (`dylibbundler`, rpath rewriting, static
archives). Not because it fails, but because it became unnecessary: the ten
libraries it would have bundled are never called. Reconsider only if a
future feature needs an exact ILP solution, at which point the bundling
question returns with it.

**Keeping libzip.** Costs one dylib to let `gtfs2graph` read a zip, when the
app already has the feed on disk and the engine already normalises it.
Passing a directory produces an identical graph. If a future path needs to
hand LOOM a zip directly, this reverses cheaply.

**Byte comparison as the parity test.** Guaranteed to fail on every run,
because ids are pointer addresses. Not a judgement call - it cannot work.

**Judging cross-build parity on stages after `gtfs2graph`, for now.** Not
abandoned, deferred: it is not a meaningful measurement while `topo`
disagrees with itself, and it becomes meaningful the moment that is fixed.

**Answering the Windows and Intel-macOS halves of the question.** Not
attempted. There is no CI and no such hardware here, so anything said about
them would be a guess with a table around it.

## Recommendation

**Build LOOM with the optional dependencies disabled, and do not ship the
macOS native build until `topo` is deterministic.**

Concretely:

1. Configure with `-DCMAKE_DISABLE_FIND_PACKAGE_{GLPK,COIN,Gurobi,LibZip}=ON`.
   Four binaries, zero non-system libraries, nothing to bundle or relocate.
   `otool -L` shows only `/usr/lib` on every one.
2. Feed `gtfs2graph` a directory, not a zip. The engine already has the feed
   unpacked; the graph is identical either way.
3. Treat the nondeterminism as a blocking bug, not a tolerance to widen. It
   is the next piece of work, and until it is closed the honest answer to
   "can we ship native macOS binaries" is **not yet** - not because they
   cannot be built or made self-contained, both of which are now shown, but
   because they do not produce the same map twice.
4. Keep the Docker build as the reference for what output is *correct*. It
   is stable across eight runs and it is what the published maps were made
   with.

**What would change our mind.** If `topo`'s nondeterminism turns out to be
inherent to the algorithm rather than to the macOS build, then determinism
has to be bought elsewhere - by caching the graph stages as artefacts and
shipping those, rather than by re-running the pipeline per export - and
principle III needs restating in terms of the cached graph rather than the
binary. If it turns out to be a one-line fix upstream, this recommendation
becomes uncontroversial and the spike's remaining question is only the
Windows build.

**The timebox is not spent.** One session of three used. The question is
answered for macOS arm64 and unanswered for the other two targets, which
need CI that does not exist yet. That is a dependency, not a failure of the
method: the same build recipe should work on `macos-13` and under MSYS2, and
`vendor.yml` is written so it can be run the day there are runners.

## Follow-up

- Decision record: `docs/adr/019-loom-binaries.md`
- **Done in session two**: the cause is `std::set<Node*>` iterated in heap
  order, at 163 sites in `topo`. Not uninitialised memory, and not a hash
  container - an *ordered* container whose key is the address.
- **Reported upstream**: https://github.com/ad-freiburg/loom/issues/44, with
  the ten-run counts, the Linux control, and the analysis labelled as
  analysis. No pull request: the patch is not a fix and saying otherwise
  would waste a maintainer's time. `loom-topo-tiebreak.patch` is kept here as
  evidence only.
- Until then, treat Linux as the only build whose output is reproducible, and
  prefer shipping cached graph stages over re-running the pipeline per export.
- Still open, needing CI: macOS x86_64 and Windows x64 builds, and the
  `otool`/`ldd` check on each.
- The engine's committed reference graphs under `data/graphs/` predate this
  pin and cannot be reproduced exactly by any build, because the stage that
  produced them is not reproducible. They remain useful as a shape, not as a
  fixture.
