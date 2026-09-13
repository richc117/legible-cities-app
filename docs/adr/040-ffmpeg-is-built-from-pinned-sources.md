# ADR-040: FFmpeg is built here, from pinned sources, with only what the export uses

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-012](012-ffmpeg-is-bundled-and-encoding-stays-in-python.md),
  whose decision - bundle a pinned static GPL ffmpeg and ffprobe per
  platform and keep encoding in the engine - stands, and whose choice of
  where the binaries come from does not: third-party builds from builders
  who publish their scripts are replaced by a build of this repository's
  own.

## Context

ADR-012 shipped martin-riedl.de's 9.0.1 release builds on macOS and a BtbN
release/9.0 snapshot on Windows and, for tests, Linux. They work, and the
vendor job proves them by encoding on every runner. Issue 95 recorded what
they cost, and the maintainer decided on 2026-09-13 that A0-10's installers
carry them as test artefacts and that this project's own build replaces
them before A6-01 tags a release:

- **Size.** ffmpeg and ffprobe together were 132.5 MB (darwin-arm64),
  189.2 MB (darwin-x64) and 289.5 MB (win-x64) unpacked, because each binary
  carries AV1, HEVC, VVC, subtitle rendering, network protocols and some
  eighty libraries the export never calls.
- **libdvdcss.** The Windows and Linux builds link it. Its purpose is
  reading copy-protected DVDs, which carries a legal risk under
  anti-circumvention law separate from the GPL.
- **The source obligation.** GPLv3's Corresponding Source for those
  binaries is FFmpeg, every statically linked library at its exact version,
  and the scripts that built them. For macOS the scripts' commit and x264's
  revision were inferred, not recorded.
- **freetype, fontconfig, HarfBuzz and libass** were in every build, so the
  engine's docstring saying its ffmpeg cannot draw a glyph was not true of
  what shipped. martin-riedl.de also ends Intel macOS release builds in
  January 2027.

What the export needs is known exactly: `src/schematic/export.py` at the
pinned engine tag (v0.8.3) runs four ffmpeg invocations and one ffprobe
call, and `scripts/vendor-ffmpeg.sh` already required every component they
name before anything was vendored. Three more users of the binary were found
while building this: the proof's own synthetic input (`-f lavfi -i
testsrc`), the determinism test (`tests/support/frames.ts` decodes GIFs and
PNG sequences to raw RGB on a pipe, and reads a PNG's size with ffprobe), and
the ffmpeg program itself, which inserts filters of its own.

## Options

**Keep the third-party builds.** Nothing to build, and all four costs above
stay.

**Build our own, configured for the export.** FFmpeg from its release
tarball and x264 from a commit, both verified by sha256, with
`--disable-everything --disable-autodetect` and only the components the
export, the proof and the determinism test use enabled back. Costs a build
per target in the vendor job and a toolchain to keep working on four
runners; buys a binary a tenth the size whose every source is three
archives this repository names and uploads.

For Windows, within that option:

**Cross-compile with mingw-w64 on Ubuntu.** Faster to configure (FFmpeg's
configure forks thousands of times, which MSYS2 emulates slowly), and
Ubuntu's toolchain is fixed by the runner image. But the proof must run on
`windows-latest` whichever way the binary is built, so it would be two
jobs with an intermediate artefact between them, itself a conveyed GPL
binary for as long as it is kept; ubuntu-22.04's mingw-w64 is GCC 10;
and the determinism workflow, which vendors ffmpeg on its own Windows
runner, could not build it there at all.

**Build natively under MSYS2 UCRT64 on `windows-latest`.** One job, on the
operating system that ships, with the toolchain `loom-windows` already uses
and already proved can link statically against nothing but Windows' own
DLLs (ADR-021). MSYS2 is a rolling distribution, so GCC's version is not
pinned; the build log prints it.

For zlib, which the PNG encoder and decoder cannot work without:

**The operating system's everywhere.** macOS has `/usr/lib/libz.1.dylib`
and every Linux has `libz.so.1`, both system libraries under the GPL's
definition, with no source to supply. Windows has no zlib of its own.

**A pinned zlib, built statically, everywhere or only on Windows.**
Building it on macOS and Linux too would replace a library the system
already provides with one more archive to ship and nothing to gain; on
Windows it is the only way, and MSYS2's own static zlib would be an
unpinned version whose source the release would have to find.

## Decision

`scripts/vendor-ffmpeg.sh` builds ffmpeg and ffprobe natively on each
target in the vendor workflow's `ffmpeg` jobs, then proves them exactly as
it proved the third-party builds, then puts them in place; the artefacts
keep their names (`ffmpeg-<target>`) and contents. Sources: FFmpeg
**9.0.1** from `ffmpeg-9.0.1.tar.xz` (tag `n9.0.1`, commit `bf1b838f2a`),
x264 at commit **`0480cb05fa`** as `git archive` writes it (the same tar
VideoLAN's GitLab serves), and, on Windows only, zlib **1.3.2** from its
release tarball, each checked against the sha256 in `vendor/pins.json`
before it is opened. x264 is the only external library; zlib is the
system's on macOS and Linux and static on Windows. FFmpeg is configured
`--enable-gpl --enable-version3 --enable-libx264 --enable-zlib
--disable-everything --disable-autodetect --disable-network --disable-doc
--disable-debug --disable-ffplay`, with these components:

| Kind | Enabled | For |
|---|---|---|
| encoders | libx264, aac, gif, png, mjpeg, rawvideo | the MP4, GIF, stills and posters; rawvideo for the determinism test |
| decoders | png, h264, mjpeg, gif, wrapped_avframe, pcm_u8, pcm_s16le, pcm_s32le, pcm_f32le, pcm_f64le | the captured frames, posters, the determinism test's GIF; the last six are what the lavfi device hands ffmpeg for `testsrc` and `anullsrc` |
| parsers | gif | the gif demuxer asks for it; without it no frame after the first decodes |
| filters | scale, format, fade, palettegen, paletteuse, anullsrc, testsrc, null, anull, aformat, aresample, trim, atrim, crop | the export's graphs, the proof's source, and what the ffmpeg program inserts (crop for an H.264 whose height is not a multiple of 16, as a 1080x1920 reel's poster is); the program adds hflip, vflip, transpose and rotate itself |
| muxers, demuxers | mp4, gif, image2, rawvideo; image2, mov, gif | |
| devices, protocols | lavfi; file, pipe | `-f lavfi`, `-progress pipe:1` |

x264 is configured without its command-line tool, OpenCL or input
libraries, 8-bit 4:2:0 only, which is all `format=yuv420p` with `-profile:v
high` asks for. On macOS both are built for macOS **13.0**, the pinned
Electron's `LSMinimumSystemVersion`, and linked with `-dead_strip_dylibs`,
because FFmpeg's configure links CoreFoundation, CoreMedia and CoreVideo
into libavutil whether or not anything uses them. On Windows FFmpeg is
linked `-static`; FFmpeg uses Win32 threads and x264 its own, so no
winpthreads DLL is needed.

The script composes each configure line and refuses to build when it
differs from the one in the pins, and refuses again when FFmpeg's own
record of it does; the proof refuses a binary whose `-version` differs. The
jobs then refuse a binary that links anything but `/usr/lib` and `/System`
on macOS, or that is built for another architecture or for a macOS other
than 13.0; anything but the C library, libm, libpthread, libdl and zlib on
Linux; any imported DLL outside a list of Windows' own on Windows, read
from the PE import table with `objdump -p`, and a zlib that is not the
pinned release; and, on every target, any `--enable-` flag in `-buildconf`
other than the licence switches, zlib, libx264 and the component lists, so
another library or `--enable-nonfree` fails whatever the pins say.

**ffprobe stays.** The engine finds it beside `SCHEMATIC_FFMPEG` by name
and calls it once, for a duration that ffmpeg or the frame count could
give; dropping it is an engine change, and the follow-up.

**The Corresponding Source is uploaded by the same workflow**, as the
artefact `ffmpeg-source`: the three archives as fetched and verified, copies
of the script, the pins and `vendor.yml`, and `BUILD.txt` with every
target's FFmpeg, x264 and zlib configure line and the repository commit.
A6-01 attaches that artefact, by that name, to each GitHub Release.

## Consequences

**Size**, ffmpeg and ffprobe together, unpacked:

| Target | Third-party builds (ADR-012) | This build | Job, on its runner |
|---|---|---|---|
| darwin-arm64 | 132.5 MB | **11.8 MB** (11,849,680 bytes) | 1 min 38 s on `macos-15`; 30 s for the build alone on a ten-core developer Mac, sources cached |
| darwin-x64 | 189.2 MB | **14.2 MB** (14,203,784 bytes) | 3 min 27 s on `macos-15-intel`, with Homebrew's nasm |
| win-x64 | 289.5 MB | **16.5 MB** (16,497,664 bytes) | 7 min 17 s on `windows-latest`, MSYS2's setup included |
| linux-x64 (tests) | 291.5 MB | from the next vendor run | from the next vendor run |

Measured by the vendor workflow's run of 2026-09-13, each job from start to
end, checkout and toolchain included. The Corresponding Source job takes 9 s.

A tenth or less of every pair it replaces, and roughly half of what remains is
ffprobe, which carries the same libraries as ffmpeg for one duration.

**The source obligation is now three archives and a script**, all in this
repository's own record: FFmpeg's release tarball, x264 at a commit, zlib's
release tarball for the Windows binaries, and `scripts/vendor-ffmpeg.sh`
with the configure lines. Nothing is inferred. macOS and Linux link the
operating system's zlib, and the Windows binaries carry, as every MinGW
executable does, GCC's `libgcc` and mingw-w64's CRT startup code, under the
GCC Runtime Library Exception and mingw-w64's permissive terms.
`THIRD_PARTY_NOTICES.md` shrinks from some eighty libraries to FFmpeg,
x264, zlib and that runtime.

**No libdvdcss, no freetype, no network.** `drawtext` and `subtitles` no
longer exist, so the engine's docstring is true of what ships; the export
never used them. Patent licensing for H.264 and AAC encoders is still not
assessed here.

**What ships can now fail to build, not only fail to download.** Each of
four runners needs a toolchain: the macOS images' clang, with Homebrew's
nasm on Intel; Ubuntu's gcc with nasm, pkg-config and zlib's headers from
apt; and MSYS2 UCRT64's packages on Windows, a rolling distribution whose
GCC can change under a pin that has not. A toolchain change that breaks
the build fails the job, which is the point; one that builds and changes
the output is caught by the proof only as far as the proof looks, and by
the determinism gate for the capture (ADR-039).

**Output may differ from the third-party builds'**, since Windows moves from
a snapshot of the release branch to the release, and every target from a
general build to this one. Determinism is judged per machine and per binary
(ADR-023, ADR-039), and the gate runs against this build.

**A component the export starts using must be added here.** An engine
change that calls a filter, codec or format this build lacks fails at its
first export; the proof and the component table name what is there, and
the script's comment says why each is. The determinism workflow vendors
ffmpeg with the same script, so its runners build it too, on a cache miss.

**The Intel macOS deadline no longer applies**, and nothing here depends on
a third-party builder's retention.
