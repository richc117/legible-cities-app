# ADR-043: The source of Electron's FFmpeg library is attached to every release

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** none
- **Superseded by:** none

## Context

Electron ships its own FFmpeg as a shared library inside the app:
`libffmpeg.dylib` in `Electron Framework.framework/Versions/A/Libraries/` on
macOS, `ffmpeg.dll` beside the executable on Windows. It is Chromium's media
decoder. The app never calls it, and it is not the FFmpeg this repository
builds for exports (ADR-040). Issue 109 asked what it is, under which
licence, and how that licence's source obligation is met before `v0.1.0`.
The research was done on 2026-09-13 from Electron 44.2.0's published zips,
read and never run:

- **What it is.** The Mac arm64 library is 2,317,968 bytes, x64 2,555,716 and
  the Windows DLL 3,113,472, each zip matching Electron's `SHASUMS256.txt`.
  The Mac library says `FFmpeg version git-2026-07-15-6cfe2122b0` and
  `libavcodec license: LGPL version 2.1 or later`. Electron 44.2.0's DEPS
  names Chromium **152.0.7977.76**, whose DEPS names
  `chromium/third_party/ffmpeg` at **`2b68d2babae7`** (tree `c60e6b597c31`).
  Electron's `build/args/all.gn` sets `ffmpeg_branding = "Chrome"` and
  `proprietary_codecs = true`; `release.gn` sets `is_component_ffmpeg = true`,
  and one Electron patch changes FFmpeg's `BUILD.gn` (a macOS install name).
- **Its configuration.** Chromium's `chromium/config/Chrome/{mac,win}/*/config.h`
  at that commit has `CONFIG_GPL 0`, `CONFIG_NONFREE 0`, `CONFIG_VERSION3 0`
  and `FFMPEG_LICENSE "LGPL version 2.1 or later"`, and its configure line
  has no `--enable-gpl`. It enables 29 components: the decoders h264, aac,
  flac, mp3, vorbis, libopus and nine PCM formats, seven parsers and seven
  demuxers. The Mac library's symbol table holds exactly those 29 on both
  architectures, and only the shipped Windows DLL, not Electron's
  Chromium-branded one, has the H.264 and AAC decoders' class names. libopus
  (BSD-3-Clause) is linked statically inside it: FFmpeg's `BUILD.gn` depends on
  `//third_party/opus`, and the library imports no `opus_*` symbol.
- **What the licence asks.** LGPL-2.1 section 4: whoever distributes the
  Library in object code must "accompany it with the complete corresponding
  machine-readable source code", or offer "equivalent access to copy the
  source code from the same place". Section 4 has no written-offer route;
  section 6's (c) covers the work that uses the library, not the copy of the
  library itself, which every installer of ours carries. Section 0 defines
  the source as "all the source code for all modules it contains ... plus
  the scripts used to control compilation and installation of the library."
- **What the notice covers.** Electron's `LICENSES.chromium.html` has
  FFmpeg's notice and the full LGPL-2.1 text. electron-builder deletes that
  file from the Mac app (`app-builder-lib`'s `electronMac.js`), and the
  published `v0.1.0-rc.2` arm64 dmg does not carry it; issue 108 carries it
  back into the Mac app, separately from this decision.
- **What others do.** VS Code's `cgmanifest.json` points at the googlesource
  repository and a commit; Signal Desktop (also on Electron 44.2.0) and
  Electron itself attach nothing. Electron's maintainers hold that its
  tagged public source suffices for its own distribution
  (electron/electron#34236, open since 2022), which is not ours.
- **`v0.1.0-rc.2` was already published**, with the three installers and no
  source for this library.

## Options

**(a) Attach the source to every Release**, built in the same run as the
installers. The parts measured on 2026-09-13: FFmpeg's tree at the commit
(11,015 files, 11.6 MB as xz), Chromium's `third_party/opus` (715 files,
3.3 MB as xz), `media/ffmpeg` (the scripts that generate the configuration,
105 KB) and `build` (the GN configuration `BUILD.gn` imports, 1.9 MB),
Electron's patch and gn args. Meets section 4 literally, from the same place
as the installers, and keeps ADR-041's rule that a Release carries every
copyleft component's source. Costs one short job and a pin to move with
every Electron bump.

**(b) A written offer, valid three years.** Nothing attached; the
maintainer keeps the exact source of every Electron ever shipped, release
candidates included, for three years after the last distribution, and
answers requests. In practice the same archive as (a), kept privately and
unchecked, and it leaves section 4's own requirement open.

**(c) Point to Electron's and Chromium's published sources.** Under
LGPL-2.1 a third party's server is not "the same place". Taken under
LGPL-3.0, which "or later" allows, GPL-3.0 §6(d) permits a third-party
server with clear directions, while "you remain obligated to ensure that it
is available". Cheapest, and depends on hosting this project does not control
for as long as the installers are offered.

## Decision

**(a)**, chosen by the maintainer on 2026-09-13. `vendor/pins.json` gains an
`electron_ffmpeg` block keyed to the Electron version: Electron's version,
tag and commit; Chromium's version, tag and commit; the FFmpeg commit and
its tree id; the tree ids of Chromium's `build`, `media/ffmpeg`,
`third_party/opus` and `tools/generate_stubs` at that commit; nasm's
repository, revision and tree, a DEPS entry of that commit; the blob ids of
Electron's `patches/ffmpeg/.patches`, `link_with_loader_path.patch`,
`build/args/all.gn`, `build/args/release.gn`, and `patches/chromium/.patches`
with the eight patches it lists that change files under Chromium's `build/`;
the 29 components; and the licence.

**What goes in** is what FFmpeg's `BUILD.gn` and the `.gni` files it imports
name outside themselves, read at the pinned commit: `//build` (compiler,
sanitizer and toolchain configuration), `//third_party/opus`,
`//third_party/nasm/nasm_assemble.gni`, for the x86-64 assembly on
darwin-x64 and win-x64, whose nasm Chromium builds from source, and
`//tools/generate_stubs/generate_stubs.py`, which writes the Windows DLL's
export list; with `media/ffmpeg`, whose scripts generate FFmpeg's
configuration. Of Electron's 179 patches to Chromium, eight change files
under `build/` and none change `third_party/ffmpeg`, `third_party/opus`,
`third_party/nasm`, `media/ffmpeg` or `tools/generate_stubs`. **What stays
out**, as `BUILD.txt` says, is the toolchain and the rest of a Chromium
checkout: Chromium's clang, GN, Python and the platform SDKs,
`build_overrides/`, `buildtools/` and the `gclient_args.gni` gclient
writes, the PGO profiles gclient's hooks download, and Electron's other
patches. That line is this project's reading of section 0's "scripts used
to control compilation", not a lawyer's.

`scripts/electron-ffmpeg-source.sh`, run by vendor.yml's
`electron-ffmpeg-source` job on `ubuntu-22.04`:

- refuses a `package-lock.json` that installs another Electron than the
  block is for, naming both and what to move, before anything is fetched;
- checks that Electron's tag still names the pinned commit and its DEPS at
  that commit names the pinned Chromium, and that Chromium's tag still names
  its pinned commit and its DEPS names the pinned FFmpeg revision;
- shallow-fetches FFmpeg at its commit, checks the commit's tree id, exports
  it and checks the exported files' tree id;
- checks that gitiles lists each Chromium directory at the pinned commit
  as the pinned tree, and that Chromium's tree records nasm's pinned
  repository and revision; fetches each directory as a gitiles archive,
  retried with backoff on a 5xx, a 429 or a failed transfer (a truncated
  body included), and checks the tree id its files make. googlesource's archives are written at download time and are never
  the same bytes twice, so an archive's hash cannot be pinned, but the tree
  can. Every tree id is taken with no git configuration but its own,
  `core.autocrlf=false`, and every conversion attribute unset in the
  repository's `info/attributes`, so an in-tree `.gitattributes` cannot
  change what files hash to;
- fetches Electron's files at the pinned commit and checks each blob id;
- writes `BUILD.txt`: what each part is, the pins, how Electron's gn args
  build the library, what is left out, and what this project takes to be
  the complete source in LGPL-2.1 section 0's terms;
- packs `electron-ffmpeg-<electron version>-source.tar.xz` with GNU tar
  (names sorted, owner and group 0, modes normalised, every time the FFmpeg
  commit's) and one xz thread, and uploads it as `electron-ffmpeg-source`.

**No installer without its source.** Electron's library is not built here,
so no vendor job needs this one as the ffmpeg jobs need `ffmpeg-source`.
Instead each packaging job in `build.yml`, before `npm ci`, downloads the
artefact and refuses to go on unless it holds the archive for the Electron
`package-lock.json` installs. The artefact exists only when the source job
succeeded, so a run whose sources did not verify makes no installer. The
chain works through `build.yml`'s existing `workflow_call` of `vendor.yml`
without an output or a change to how the call is made; it is the one
vendor job whose failure stops every target, not only its own.

`scripts/release.mjs` adds the archive to the assets as it was packed,
never archived again, refuses an artefact holding anything but exactly
`electron-ffmpeg-<pinned version>-source.tar.xz`, and refuses a run whose
`package-lock.json` installs another Electron than the pins are for. The
archive goes into `SHA256SUMS.txt` and the read-back digest check like every
other asset. The notes template gains a row in "What is inside" and a line in
"Source code"; `THIRD_PARTY_NOTICES.md` gains a row and an obligation.

## Consequences

**The archive is 17,738,076 bytes** (14,631 files), beside installers of
160 to 208 MB and `ffmpeg-9.0.1-source.tar` of 19.8 MB. Measured on
2026-09-13 by running the script twice in an `ubuntu:22.04` container
(git 2.34.1, GNU tar 1.34, xz 5.2.5): each run took about a minute and a
half, googlesource answered 503 to between one and three requests per run
and the retries recovered, and both runs made the same bytes (sha256
`08deabe3dc`). Refused in the same container: a `package-lock.json` for
Electron 44.3.0, a Chromium version the DEPS does not name, a wrong tree id
for `media/ffmpeg` and for `tools/generate_stubs`, a nasm revision Chromium
does not record, a pins block with no Electron files, and a work folder that
is not empty.

**Every Electron bump moves the whole block**, forced by the check: the new
tag's commit, the Chromium version and commit in its DEPS, the FFmpeg
commit in Chromium's DEPS, and every tree and blob id. The pins' note says
where each is read. A Dependabot Electron pull request fails its installer
build until someone does this, which is the point.

**googlesource can hold a run back.** Its 503s are frequent and the retries
absorb them, but an outage fails the source job and so every packaging job,
where it once failed nothing.

**The reading of the licence is this project's**, not a lawyer's: that
section 4 applies to the library copy the installers carry, whatever
section 6 says of Electron's executable. If that reading is wrong the cost is
18 MB per Release.

**`v0.1.0-rc.2` is to be given the archive after publication.** Once this
change merges, the archive from the first build on `main` is uploaded to
that pre-release by hand, and its sha256 is written into rc.2's notes:
rc.2's `SHA256SUMS.txt` was made at publication and cannot list an asset
added afterwards, and `docs/install.md` says so. rc.2 ships the same Electron
44.2.0, so it is the same source; its `BUILD.txt` names the later commit that
made it.

**Signing (A6-05).** The LGPL-2.1 asks, for the work that uses the library,
that a person can use a modified library. Today the Mac app is signed ad
hoc with the hardened runtime and electron-builder's default entitlements,
`com.apple.security.cs.disable-library-validation` among them, and
`libffmpeg.dylib` is sealed in the framework's `CodeResources`: replacing it
breaks the seal, and a person can re-sign the app ad hoc
(`codesign --force --deep --sign -`) with no identity. That the re-signed
app then starts was not checked, since Electron was not run. On Windows,
replacing `ffmpeg.dll` in an unsigned install is a file copy. A Developer ID
signature and notarisation would break on the same replacement, and an
ad-hoc re-sign runs locally only while library validation stays disabled;
A6-05 should keep that entitlement, or say how a person replaces the
library. LGPL-2.1 has no installation-information clause, and LGPL-3.0's
applies only to consumer hardware, so signing is not itself a breach. An
Authenticode signature does not stop Windows loading a replaced DLL by
default; whether Smart App Control or WDAC would is unmeasured.

**Patent licensing for the H.264 and AAC decoders is not assessed**, as for
this repository's own FFmpeg. Electron publishes a Chromium-branded library
without them (`ffmpeg-v44.2.0-<platform>.zip`, 1.26 MB on arm64), under the
same licence; swapping it in is a separate decision.
