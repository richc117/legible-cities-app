# ADR-012: FFmpeg is bundled and encoding stays in Python

- **Status:** Accepted
- **Date:** 2026-09-06 (accepted); written up on 2026-09-13, with the
  sources A0-08 chose and measured
- **Supersedes:** none
- **Superseded by:** none

## Context

The engine's export is the deliverable's definition, and it is ffmpeg. At
the pinned tag (v0.8.2), `src/schematic/export.py` runs four ffmpeg
invocations and one ffprobe call, and the storyboards and presets are tuned
against their output:

- **MP4**: a PNG sequence (`image2`) and a silent stereo track (`lavfi`
  `anullsrc`), through `fade`, `scale` with `flags=lanczos` and
  `format=yuv420p`, into `libx264` at `-profile:v high -preset slow`, with
  `aac` at 96k, `-shortest`, and `-movflags +faststart`.
- **GIF**: `palettegen=stats_mode=diff` over the frames, then `scale` with
  lanczos and `paletteuse=dither=bayer:bayer_scale=3`.
- **Stills**: `scale` with lanczos into PNG, or JPEG (`mjpeg`) with `-q:v`.
- **Poster**: `-ss` into the MP4, one frame out.
- **Duration**: `ffprobe -show_entries format=duration`.

Progress comes from `-progress pipe:1`. The engine reads the binary from
`SCHEMATIC_FFMPEG`, else `ffmpeg` on `PATH`, and finds ffprobe **beside it
by name**, replacing "ffmpeg" in the file name; so whatever ships must be a
pair, `ffmpeg` and `ffprobe`, or `ffmpeg.exe` and `ffprobe.exe`. The app
already passes `SCHEMATIC_FFMPEG` from its configuration; in development
the engine finds ffmpeg on `PATH`.

A user's machine has no ffmpeg, so the app ships one or encodes another way.
A0-08 began as a spike weighing the two; the re-plan of 2026-09-10 kept the
decision below and moved the measurement of the alternative to after the
first release, leaving A0-08 as the vendoring.

## Options

**Bundle ffmpeg and call it from the sidecar.** No change to the encode
logic: the engine runs exactly what `bin/export` runs today, and an export
from the app is the same method as one from the command line. Costs the
installer's size, a GPL build (x264 is GPL, and so is every build that
links it), and a per-platform source of binaries with the obligations that
come with shipping them.

**Encode in the browser with WebCodecs and mediabunny** (MPL-2.0), in the
capture window. No ffmpeg at all. Unverified where it matters: whether an
H.264 encoder is available to WebCodecs inside Electron on every target,
and GIF would need a separate encoder (gifenc) and a palette pass of its
own. It would also move the encode out of the engine into the app, so the
engine would stop being the source of truth for what an export is.

Once bundling was chosen, the question was where each binary comes from.
Checked on 2026-09-12:

| Source | Targets | Pinnable as | Checksums | Build scripts | Found |
|---|---|---|---|---|---|
| martin-riedl.de | macOS arm64 and x64; Linux amd64 and arm64 | release 9.0.1, by a timestamped URL; history back to 5.0 (2022) still downloads | a `.sha256` per archive | public | macOS: `--enable-gpl --enable-version3`, no nonfree, links only `/usr/lib` and `/System`, signed with the builder's Developer ID. **Linux: `--enable-nonfree --enable-decklink`**, so it may not be redistributed. Intel release builds end in January 2027 |
| gyan.dev | Windows x64 | release 9.0.1, a GitHub release; releases back to 6.0 (2023) are kept | GitHub asset digests; `.sha256` on the site | not published; `README.txt` lists every library and version | `--enable-gpl --enable-version3`, no nonfree; the essentials build's `ffmpeg.exe` is 102.9 MB |
| BtbN/FFmpeg-Builds | Windows and Linux, x64 and arm64 | release-branch snapshots (`n9.0.1-11-ge47273f4d9`), not release tags; month-end builds kept for two years | `checksums.sha256` | public | `--enable-gpl --enable-version3`, no nonfree; the Windows `ffmpeg.exe` is 144.9 MB |
| evermeet.cx | macOS x64 only | release 9.0.1 | GPG signatures | not checked | no arm64 build, so a second builder on macOS |
| osxexperts.net | macOS arm64 9.0, x64 8.0 | the current file only | a sha256 on the page | a link to the source | no common version across the two, unsigned, "for educational purposes only" |

## Decision

Bundle a pinned static GPL ffmpeg and ffprobe per platform, passed to the
sidecar as `SCHEMATIC_FFMPEG`; WebCodecs is deferred until after the first
release. Every target is FFmpeg 9.0, and the three that ship are the n9.0.1
release: martin-riedl.de's builds on both macOS targets, one builder and one
configure line for both; gyan.dev's essentials build on Windows, the
smaller of the two that carry the exact release; and, for tests only,
BtbN's release/9.0 build on Linux, because martin-riedl.de's Linux build
of the release is nonfree. `vendor/pins.json` pins each archive by URL and
a sha256 computed on download, which matched what each builder publishes.
`scripts/vendor-ffmpeg.sh` fails on a checksum mismatch, refuses a build
without `--enable-gpl`, `--enable-version3` or `--enable-libx264` or with
`--enable-nonfree`, requires every encoder, decoder, filter, muxer,
demuxer, device and protocol listed above, and encodes a one-second MP4 and
GIF through the engine's own filter graphs and reads both back with ffprobe
before anything is put in place. The `ffmpeg` job in `vendor.yml` runs it on
all four targets and, on macOS, refuses any link outside `/usr/lib` and
`/System`.

## Consequences

**The installer grows by far more than the 30 to 80 MB this record first
estimated.** Measured, ffmpeg and ffprobe together, uncompressed:

| Target | ffmpeg | ffprobe | Both | Download |
|---|---|---|---|---|
| darwin-arm64 | 66.3 MB | 66.2 MB | 132.5 MB | 56.8 MB, two zips |
| darwin-x64 | 94.7 MB | 94.5 MB | 189.2 MB | 67.6 MB, two zips |
| win-x64 | 102.9 MB | 102.7 MB | 205.5 MB | 111.3 MB, one zip with ffplay |
| linux-x64 (tests) | 145.9 MB | 145.6 MB | 291.5 MB | 126.6 MB, one tar.xz with ffplay |

Each binary carries the whole of the libraries: ffprobe, which the engine
calls once to read a duration, is nearly as large as ffmpeg. These are
general-purpose builds with AV1, HEVC, VVC, subtitle rendering and network
protocols the export never touches. A build of our own configured for the
components above would be a fraction of the size and is the lever if size
becomes the complaint; it would also be the only way to ship an ffmpeg that
truly has no freetype. **These builds have freetype**, fontconfig, HarfBuzz
and libass, and so the `drawtext` and `subtitles` filters: the export needs
none of them, because the page draws every word, but the engine's docstring
saying its ffmpeg has none is not true of what ships.

**The GPL obligation is wider than FFmpeg.** Every build is
`--enable-version3`, so FFmpeg as shipped is GPL-3.0-or-later, and each
statically links x264, x265 and some thirty other libraries under their own
terms, which `THIRD_PARTY_NOTICES.md` lists. The corresponding source a
release must offer is FFmpeg at `n9.0.1` and every one of those libraries
at the version the build lists. martin-riedl.de publishes its build
scripts; gyan.dev does not, so for Windows the release assembles that
source from the library list in the build's own `README.txt`. Neither build
ships the libraries' licence texts, so the Licences screen has to.

**Three builders, one of them for tests.** Each has its own lifetime:
martin-riedl.de stops Intel release builds in January 2027, so the next
darwin-x64 pin after that needs another source or our own build; BtbN's
month-end build is kept until August 2028; gyan.dev's releases have stayed
up since 2023. A changed or vanished archive fails the job rather than
shipping something else, which is the point, and the artefact is kept for
30 days.

**A0-10 inherits the rest.** The macOS binaries are signed with their
builder's Developer ID and have to be re-signed with the app's own under
the hardened runtime; the artefact zip drops the executable bit, as ADR-038
found for the Python runtime; and the configuration has to default
`SCHEMATIC_FFMPEG` to the bundled binary. Patent licensing for H.264 and AAC
encoders is not assessed here.
