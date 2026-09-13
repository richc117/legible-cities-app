# ADR-041: Releases are drafted from a tag

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** none
- **Superseded by:** none

## Context

By 2026-09-13 `.github/workflows/build.yml` built a dmg for each Mac and an
nsis installer for Windows in one run from that run's vendor artefacts,
launched each packaged app and checked the Mac signature (ADR-035), and the
vendor workflow uploaded FFmpeg's Corresponding Source beside the binaries
it built (ADR-040). Nothing turned a run into something a person could
download from the repository's Releases page, nothing attached the source
of LOOM or of the engine, and nothing told a person how to open an app
that is not signed. The installers were artefacts, kept 7 or 30 days.

What shaped the answer:

- **The installers are GPL binaries.** LOOM is GPL-3.0, the engine
  GPL-3.0-or-later, and this FFmpeg GPL-3.0-or-later with x264. Conveying
  them obliges the Corresponding Source, which for LOOM means its
  submodules at the commits its tree records and, for Windows, the port
  and the script that applies it, and the libraries linked into the tools.
- **The Windows LOOM tools are linked `-static`** by MSYS2 UCRT64's GCC
  (`scripts/loom-windows-patch.py`): the tools of build run 34750505248
  carry zlib 1.3.2 and bzip2 1.0.8 by their version strings (in `topo`,
  `loom` and `octi`), GCC's runtime with `libstdc++`, and mingw-w64's CRT
  and winpthreads. MSYS2 is a rolling distribution installed with
  `update: true`, so those versions are whatever it ships that day.
  ADR-040 put the Windows ffmpeg's static zlib into its source artefact.
- **The pins record LOOM's commits and the engine's tag and version, not
  the engine's commit.** The python job already checks that the tag holds
  the pinned version.
- **An artefact carries no pin** (ADR-035), but each installer artefact
  carries the manifest `scripts/check-vendored.mjs` wrote, with the pins'
  sha256, the app's version and the run.
- **GitHub does not evaluate path filters for a tag push**, and a push
  trigger that lists tags and no branches stops running for branches
  (GitHub's workflow syntax reference, read 2026-09-13).
- **A release job cannot be exercised without a tag**, and a bad tag
  pushed to test it is a tag someone may fetch. Its decisions have to be
  testable without GitHub.
- The maintainer decided on 2026-09-13 that the first release is `v0.1.0`,
  that the notes are a fixed template, that a `-rc.N` tag drafts a
  prerelease so the release can be rehearsed, and that the installers stay
  unsigned until A6-05.

## Options

**Publish on a tag.** One push makes a public Release. Nothing a person
reads stands between the build and the download, and a Release with a
wrong note or a missing asset is public until someone notices.

**Draft on a tag, publish by hand.** The workflow makes everything a
Release carries and stops; the maintainer reads the draft and publishes
it. One more step per release, and a draft that nobody publishes is
invisible.

**Build the Release by hand from a run's artefacts.** No new job, and every
release depends on a person gathering seven files correctly under a
deadline of 7 days.

For the sources: **GitHub's own tag archives of LOOM and the engine** carry
no submodules, so LOOM's would not be its source; **links to the upstream
repositories** are a copy only for as long as the upstream keeps it, and
the GPL asks for the source as long as the binaries are offered;
**archives built in the
same run from the pins, checked against the recorded commits** cost two
short jobs and make the source part of the same run as the binaries it
describes.

For the decisions: **shell in the workflow**, untestable without pushing
tags; or **a script with unit tests**, in the house style of
`scripts/check-vendored.mjs`, that decides and leaves the workflow only to
do what it answers.

## Decision

A pushed tag starting with `v` runs `build.yml` in full, and a `release`
job runs after it only for a push to a tag and only when the vendor jobs
and all three packaging jobs succeeded. It is the only job with
`contents: write`. The token reaches three places in it: `actions/checkout`
and `actions/setup-node` take `github.token` as their default token input
(checkout to fetch, leaving none in git's configuration since
`persist-credentials` is off; setup-node to read Node's version list), and
the one step of this repository's own that talks to GitHub.
`actions/download-artifact` reads the run's artefacts with the runner's
own token. Every action in the job is pinned to a full commit, the version
in a comment. `scripts/release.mjs` decides everything before the step
with the token: it refuses a tag that is neither `v<version>` nor
`v<version>-rc.<N>` for `package.json`'s version, a tag that no longer
names this run's commit on the remote (the checkout forces the local tag
to the run's commit, so `git ls-remote origin` is asked, and a run for a
tag moved or deleted since its push drafts nothing), or a commit not
reachable from `origin/main`, before anything is downloaded (the remote is
asked three times, a few seconds apart, before a failure to reach it is a
refusal); it refuses an
installer artefact that is missing, holds other than one installer, or
whose manifest was written from other pins, for another version or in
another run; it names the installers for their machine and archives each
Corresponding Source artefact as one tar, names sorted, owner and group 0
and every time the tagged commit's; it writes `SHA256SUMS.txt`; and
it fills the notes from `.github/release-notes.md` and the pins. The step
with the token then lists the Releases and does what the script answers:
create a **draft** for the tag with the notes, or update the one draft
there is (its title, prerelease flag and assets, **not its notes**, which
the maintainer may have edited) and remove any asset this run does not
attach; refuse a published Release for the tag, or two drafts, touching
nothing. It uploads with replacement and reads the draft back, and the script compares every asset's name, size and
GitHub's sha256 digest with the files. A `-rc.N` draft is a prerelease. No
Release is published and none is marked latest by the workflow.

The vendor workflow gains `loom-source` and `engine-source` beside
`ffmpeg-source`, which is unchanged, and its push trigger names branches,
so a pushed tag does not start it a second time beside `build.yml`'s call.
`loom-source` clones LOOM at the pinned commit with its submodules and
refuses a checkout at another commit, a submodule not at the commit LOOM's
tree records, or an unclean tree; clones the Windows port at its pinned
commit; fetches the upstream release tarballs of zlib and bzip2 at the
versions `vendor/pins.json` pins under `loom_windows_static`, checking each
against its sha256 and verifying its signature against the pinned primary
key fingerprint with the same `signed()` `ffmpeg-source` uses, now in
`scripts/vendor-signature.sh` (a good signature by an expired key is
accepted, a revoked key refused); and uploads both trees as tars
without git's metadata, with names sorted and owners and times fixed,
beside the tarballs and their signatures, `scripts/loom-windows-patch.py`,
the pins, the workflow and a `BUILD.txt`. **The LOOM jobs need
`loom-source`**, as the ffmpeg jobs need `ffmpeg-source`: no LOOM binary is
uploaded in a run whose sources did not verify. The tools do not link
upstream's zlib and bzip2 but MSYS2's packages, built with MSYS2's patches,
so `loom-windows` refuses, before it builds, an MSYS2 zlib or bzip2 whose
full package revision (`1.3.2-2`, `1.0.8-4`) is not the one pinned, which
makes a new revision, a new patch included, fail loudly with the pin to
move; then it fetches MSYS2's source package for each pinned revision (its
PKGBUILD, patches and upstream tarball) from `repo.msys2.org`, checks it
against the sha256 in the pins and its signature with the shared
`signed()` against the pinned fingerprint of the MSYS2 key that made it,
and uploads `loom-windows-toolchain`: those source
packages and a `pacman -Q` record of the zlib, bzip2, GCC runtime, CRT,
headers and winpthreads packages it linked. The release job puts both
inside LOOM's source archive (`msys2-sources/`, `TOOLCHAIN-win-x64.txt`).
LOOM's archive therefore carries the upstream tarballs verified by their
publishers' signatures, and MSYS2's source packages, recipe and patches,
for the exact revisions linked. `engine-source` clones the engine at the
pinned tag, refuses a tag whose version is not the pinned one or that has
submodules, and uploads the tree the same way with
`scripts/vendor-python.sh` and a `BUILD.txt` naming the commit; the
`python` jobs need it, so no runtime carrying the engine is uploaded in a
run without the engine's source. Both source jobs run on every vendor run,
so a change that breaks them fails on a branch rather than on a tag. The app's own
source is GitHub's archive of the tag. `docs/install.md` is the document a
person follows, at the address the first-run dialog opens.

## Consequences

**A release is four acts by the maintainer**: move the version in a pull
request, merge, push the tag, publish the draft. The rehearsal is the same
with `-rc.1`, and the draft and tag are deleted after.

**The whole build runs again on the tag**, about an hour of runners,
because the Release takes artefacts only from its own run. A tag for the
wrong version is refused only at the end of that hour: the release job
checks first, but the release job runs last. Checking at the start would
mean a gate the vendor jobs need, which the spec did not ask for.

**A tag that starts with `v` but is not a release tag** (`v1`, `v0.1.0-beta`)
builds the installers and then fails the release job with the reason; no
Release is drafted. A tag without the `v` does not start the build.

**Every vendor job must pass, the Linux test builds included.** The release
job reads the called workflow's result, and a Linux LOOM or ffmpeg failure
skips it, although no installer carries either. A Release comes from a run
that was green throughout, and a flaky test job costs a rerun.

**A dispatch on a tag drafts nothing**; rerunning the tag's run does. A
rerun keeps the draft's notes, so a change to the template reaches a draft
only when the draft is deleted and the job run again.

**A new MSYS2 revision of zlib or bzip2 fails the Windows LOOM build**
until `msys2_revision` and `msys2_source` under `loom_windows_static` are
moved, with the upstream tarball's pin too when its version moved; that is
the price of attaching the source of what is linked, patches included. The
source package's signature is judged against a pinned fingerprint, checked
on 2026-09-13 to be a key in MSYS2's own keyring, and not by that keyring:
`pacman-key --verify` needs write access to the runner's keyring, which the
first CI run refused, and this job does not initialise or change it. A new
revision signed by another MSYS2 key needs its fingerprint moved with the
revision. GCC's runtime and `libstdc++` are under
the GCC Runtime Library Exception and mingw-w64's CRT and winpthreads under
permissive licences, so their notices, not their sources, are carried
(`THIRD_PARTY_NOTICES.md`).

**The source archives are about 50 MB beside the installers**: LOOM 12 MB,
the Windows port 38 MB (it vendors older copies of LOOM's submodules), zlib
and bzip2 2.3 MB, the engine under 1 MB, measured on 2026-09-13 in an
`ubuntu:22.04` container running the two jobs' scripts; two runs of the
engine's made the same bytes, and a wrong pinned fingerprint for bzip2 was
refused there. FFmpeg's is its three release archives.

**The engine's commit is not pinned, only its tag, and that is an accepted
limit.** A tag moved on the engine's repository would be archived at its
new commit; the version check catches a moved tag only if the version moved
with it. `BUILD.txt` records the commit that was archived. Comparing it with
the commit the python job installed would take a record from that job on
three targets carried to the release, more than this decision changes; the
engine's tags are the maintainer's own and pushed by hand.

**The digest check depends on GitHub recording one.** An asset without a
digest is compared by size and reported as a warning.

**What python-build-standalone's `install_only` asset does not carry** - the
licence files of the libraries it links statically, which ADR-035 says the
Licences screen and the release owe - is not attached by this decision; it
is issue 108. Electron's own bundled FFmpeg library is issue 109.

**A source job failing now holds back binaries**: `ffmpeg-source` the
ffmpeg jobs, `loom-source` the LOOM jobs and `engine-source` the runtime,
so an unreachable upstream (GitHub, sourceware, a keyserver,
`repo.msys2.org`) fails the vendor run where it once failed only the
release.

**Unsigned until A6-05.** macOS shows its malware warning and Windows
SmartScreen its own; `docs/install.md` walks through both, and no person has
yet followed it on a machine that never had the checkout (SC-003, A6-04).
