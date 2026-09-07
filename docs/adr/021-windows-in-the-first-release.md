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

**Keep Windows and take LOOM as a prebuilt binary there.** Transport for
Cairo publish a built `loom-binaries-windows-x64.zip`. Pinned by checksum in
`vendor/pins.json` alongside everything else, it removes the unbounded item
while keeping the platform. It means shipping a binary this project did not
build.

## Decision

Windows stays in the first release. LOOM is **not** built from source there:
the Windows binaries come from Transport for Cairo's published archive,
pinned by SHA-256 in `vendor/pins.json` exactly as the source pins are, and
recorded as debt to be repaid when the build is worth the time.

A Windows job stays in the build matrix from the beginning, even before any
Windows acceptance testing happens. It exists to fail when someone writes a
POSIX assumption, which is the only thing that keeps "add Windows later"
genuinely available.

Windows *polish* is deferred rather than the platform: code signing stays
behind ADR-008's gate, and hands-on acceptance is a Phase 6 concern.

## Consequences

The largest unbounded item in Phase 0 is removed without changing what the
product is or contradicting what the repository already says it does.

**This project will ship a GPL-3.0 binary it did not compile.** LOOM is
GPL-3.0, so the obligation to offer corresponding source for the exact
binary shipped now covers an archive built by someone else.
`THIRD_PARTY_NOTICES.md` must record the archive, its checksum, its origin
and the commit it was built from, and a release must be able to point at
that source. If the upstream archive is ever published without a traceable
source commit, this option stops being available and the source build
returns.

It is also a supply-chain dependency: a binary from a third party, verified
only by a checksum we recorded, on the platform where users are least likely
to notice something wrong. The checksum makes changes visible; it does not
make the original trustworthy.

**Nothing is known about determinism on Windows.** ADR-019 found `topo`
irreproducible on macOS and stable on Linux, on the strength of the standard
library's allocator behaviour. A third party's Windows build is a third data
point nobody has taken, and A5-04's determinism gate will have to take it
before Windows can be called supported rather than shipped.

The Windows build job is worth less than it looks until there is something
to build. Until the Electron skeleton lands it can only compile the sidecar
and check the vendored artefacts, and it should be kept honest about that
rather than presented as coverage.

If the prebuilt archive proves unusable - wrong architecture, missing
binaries, or no traceable source - the decision reverts to building from
source, and the estimate for that work is unknown rather than large.
