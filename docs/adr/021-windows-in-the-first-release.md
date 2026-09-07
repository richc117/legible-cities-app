# ADR-021: Windows stays in the first release; LOOM is not built from source there

- **Status:** Proposed
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none

## Context

Two spikes have now measured what shipping this app actually costs.
ADR-019 found that LOOM's four binaries need no bundling, and that `topo` is
not reproducible in the macOS build. ADR-020 chose a pinned
python-build-standalone runtime for the sidecar. Both measured macOS arm64
and neither measured Windows, because there is no continuous integration in
this repository and no Windows host attached to it.

That leaves Windows as the largest unmeasured surface in the project, and it
raised a fair question: would dropping it from the first release reduce
scope enough to be worth doing, with Windows added afterwards?

The costs are not evenly spread. The Python sidecar looks cheap - the same
python-build-standalone release publishes `x86_64-pc-windows-msvc` assets,
so the recipe should carry unchanged. Adding a Windows job to the build
matrix is one job. Code signing and hands-on acceptance are genuinely
expensive and are already behind a release gate by ADR-008.

The expensive, unbounded item is a single one: **building LOOM from source on
Windows.** It needs an MSYS2 UCRT64 toolchain and a third party's patched
fork of the source, and no part of it has been attempted. It is the reason
A0-05 is the largest issue in Phase 0, and it is the item that prompted the
question.

Two constraints bear on the answer. `README.md` already tells the public
this is "a desktop app for macOS and Windows". And the rules that keep the
code portable - argument arrays rather than shell strings, `windowsHide`,
no assumptions about path separators or case - are written down in the
constitution and in `.claude/rules/main.md`, but **nothing currently
verifies them**, because the workflows that would have run them have never
run.

## Options

**Drop Windows from the first release and add it afterwards.** Removes the
MSYS2 work, one build target, one installer format, one signing regime and
one acceptance pass. It also contradicts a public promise, and it makes the
portability rules unverified by anything at all - which is the part that
does not stay cheap. Retrofitting a platform is not adding a build target;
it is finding every assumption that accumulated while nothing was checking.

**Keep Windows and build LOOM from source there.** The original plan. It
answers the question properly and it may take arbitrarily long, because the
patched fork is a third party's and its state is unknown.

**Keep Windows and take LOOM as a prebuilt binary there.** The roadmap
assumed Transport for Cairo publish a `loom-binaries-windows-x64.zip`. They
do not: that repository has no releases and no such archive. What they do
have is a directory of built binaries committed into the source tree at
`bin/windows` - 42 files, 81.1 MB, containing `gtfs2graph.exe`, `topo.exe`,
`loom.exe` and `octi.exe` among others. Pinnable, but by commit and per-file
checksum rather than by release asset.

That directory also contains `KERNEL32.DLL`, `KERNELBASE.dll`,
`ADVAPI32.dll`, `RPCRT4.dll`, `msvcrt.dll` and `ucrtbase.dll` - Microsoft's
own system libraries, almost certainly swept up by a dependency walk that did
not exclude them. Those must not be redistributed, and shipping system DLLs
beside an executable is a sideloading hazard as well as a licensing one. The
option is therefore "take the executables and the genuinely redistributable
runtime, and drop the rest", not "ship the directory".

## Decision

Windows stays in the first release, and a Windows job stays in the build
matrix from the beginning, before any Windows acceptance testing happens. It
exists to fail when someone writes a POSIX assumption, which is the only
thing that keeps "add Windows later" genuinely available. Windows *polish* is
deferred rather than the platform: signing stays behind ADR-008's gate and
hands-on acceptance is a Phase 6 concern.

**How LOOM reaches Windows is not decided here.** The cheap option this
record was written to adopt - pin a published archive - does not exist in the
form the roadmap assumed, and what does exist cannot be shipped as it stands.
Two candidates remain, and choosing between them needs a measurement nobody
has taken:

1. **Take the port's committed executables**, pinned by commit and per-file
   checksum, shipping only the executables and the redistributable runtime
   and excluding Microsoft's system DLLs. Removes the MSYS2 work. Ships
   binaries this project did not build, carrying solver libraries that
   ADR-019 established are never called.
2. **Build from the port's patches in CI**, with the optional dependencies
   disabled exactly as ADR-019 does for macOS and Linux. Consistent with the
   other platforms, licence-clean, and far smaller - ADR-019's configuration
   produced binaries with no non-system dependencies at all. Costs the MSYS2
   work this record was trying to avoid.

The second is where this should end up. Whether the first is worth doing as
an interim depends on how much of the MSYS2 work the port has already
absorbed, which is A0-05's remaining question rather than this record's.

## Consequences

The largest unbounded item in Phase 0 is removed without changing what the
product is or contradicting what the repository already says it does.

**A dependency walk that collects system libraries is a trap this project
was about to fall into.** The `loom-windows` job in `.github/workflows/vendor.yml`
says "collect DLLs by `ldd`" - the same procedure that put `KERNEL32.DLL` in
the port's binary directory. Whichever option is chosen, the Windows job needs
an explicit exclusion list and a check that fails the build when a Microsoft
system library appears in the output, in the same spirit as the readline check
ADR-020 added for the Python runtime.

**If the port's executables are used, this project ships a GPL-3.0 binary it
did not compile.** The obligation to offer corresponding source for the exact
binary shipped would then cover someone else's build.
`THIRD_PARTY_NOTICES.md` would have to record the origin, the commit and the
per-file checksums, and a release would have to point at the patch set that
produced them. It is also a supply-chain dependency verified only by a
checksum we recorded, on the platform where a user is least likely to notice
something wrong.

**Nothing is known about determinism on Windows.** ADR-019 found `topo`
irreproducible on macOS and stable on Linux, on the strength of the standard
library's allocator behaviour. A third party's Windows build is a third data
point nobody has taken, and A5-04's determinism gate will have to take it
before Windows can be called supported rather than shipped.

The Windows build job is worth less than it looks until there is something
to build. Until the Electron skeleton lands it can only compile the sidecar
and check the vendored artefacts, and it should be kept honest about that
rather than presented as coverage.

The port itself is reassuring on one point that matters for parity: its
`PATCHES.md` states the changes are Windows compatibility shims only, with no
modification to LOOM's algorithms, data structures or output. If that holds,
a Windows build should be comparable to the others by the same parity script
A0-05 wrote - which is the measurement that would let Windows be called
supported rather than merely shipped.
