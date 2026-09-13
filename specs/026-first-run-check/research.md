# Research: The first-run check of the bundled tools

## 1. The fixture against a real `gtfs2graph` (T001)

Done before the parser was written, on 2026-09-13, on an Apple-silicon Mac.

**The binaries.** The `loom-darwin-arm64` and `ffmpeg-darwin-arm64`
artefacts of the latest successful `build.yml` run at the time (run
34743411701, which carries the vendor jobs' artefacts):

```
gh run list --workflow build.yml --status success --limit 1
gh run download 34743411701 -n loom-darwin-arm64 -D <scratch>/loom
gh run download 34743411701 -n ffmpeg-darwin-arm64 -D <scratch>/ffmpeg
```

`gtfs2graph` is a 64-bit arm64 Mach-O of about 500 KB.

**The fixture.** `resources/first-run-gtfs/`: six tables, 588 bytes in
all. One agency, three stops, one route of `route_type` 1 (subway), one
trip calling at the three stops, and a calendar running every day from
2026 to 2036. The stops sit near 0°, 0°: nowhere anyone lives, so the
fixture names no place.

**The run.** From an empty temporary folder as the working directory, as
the check runs it:

```
gtfs2graph -m subway resources/first-run-gtfs > out.json
```

| | |
|---|---|
| Exit code | 0 |
| Standard output | 2,012 bytes of GeoJSON |
| Standard error | empty |
| Features | a `FeatureCollection` of 3 `Point` (the stations, each with `station_id` and `station_label`) and 2 `LineString` (the edges, each with a `lines` array naming route `1` and its colour) |
| Time | under 10 ms (`time -p` reports 0.00 s real) |
| Written | nothing: the working directory and the fixture folder hold the same entries afterwards |

The output is not byte-stable from run to run: the `id` fields are
pointer addresses (`0x105120100`). The check therefore parses the JSON and
counts features; it never compares bytes.

**What else was learned, and why the parser has to parse:**

- `gtfs2graph -m bus` over the same folder also **exits 0**, with
  `{"type": "FeatureCollection", "properties": {}, "features": []}`. A
  zero exit alone proves nothing: an empty collection is a failure, and the
  check requires at least one `LineString` feature.
- A folder that is not there exits 1 with
  `ERROR: Could not parse input GTFS feed, reason was: <path>: Cannot read from path`
  on standard error; an empty folder exits 1 naming `agency.txt` as not
  found. Both carry absolute paths, which is why a failure's detail has its
  paths replaced before it crosses the bridge.
- `gtfs2graph --version` prints `gtfs2graph - (LOOM -128-NOTFOUND)` and
  exits 0, and `--help` begins `gtfs2graph (part of LOOM) -128-NOTFOUND`:
  as the spec says, asking a LOOM tool its version proves only that the
  loader started it.

## 2. ffmpeg and ffprobe

From the same artefact, with any working directory:

```
ffmpeg -version     # exit 0, first line "ffmpeg version 9.0.1-… Copyright (c) 2000-2026 the FFmpeg developers"
ffprobe -version    # exit 0, first line "ffprobe version 9.0.1-… Copyright (c) 2007-2026 the FFmpeg developers"
```

About 1.1 KB each, about 10 ms each. The check matches the first line's
start only (`ffmpeg version `, `ffprobe version `), not the version: issue
95 replaces this build with the project's own, and the launch check in
`scripts/launch-packaged.mjs` is what holds the version to the pin.

`ffprobe` is found as the engine finds it (`export.ffprobe_path` at
v0.8.3): the ffmpeg path with the first `ffmpeg` in its **file name**
replaced by `ffprobe`, so `ffmpeg.exe` becomes `ffprobe.exe` beside it.

## 3. Where a packaged app keeps the fixture

`electron-builder.yml`'s top-level `extraResources` carries
`resources/first-run-gtfs` to `<resources>/first-run-gtfs`, beside
`LICENSE`, on every target; the per-platform lists add to the top-level one
rather than replacing it, which is how `LICENSE` already reaches both. In
development the check reads it from the repository, at
`<app path>/resources/first-run-gtfs`. It is only ever read: the spawn's
working directory is a fresh folder under the platform's temporary folder,
removed after.

## 4. The check against the real binaries

Once `src/main/first-run.ts` was written, it was bundled with esbuild into a
throwaway script outside the repository and run against the same
downloaded binaries, each case naming its tools as the environment would:

| Case | Result |
|---|---|
| The downloaded `loom/` and `ffmpeg/` | LOOM passed in 5 ms, ffmpeg (both tools) in 13 ms |
| An empty folder as LOOM, a missing file as ffmpeg | both `missing`; details `…/<folder> has no gtfs2graph.` and `There is no ffmpeg at …/ffmpeg.` |
| A `gtfs2graph` that is a text file with the executable bit | `not-running`: `gtfs2graph could not be started (ENOEXEC).` |
| The fixture without `stops.txt` | `install`, and `gtfs2graph` never spawned |
| The fixture with its route as a bus (`route_type` 3) | `not-running`: `gtfs2graph exited 0, but it printed a feature collection with no line in it.` |

The temporary folder was gone after every case. The time the check adds to
a start (SC-003) is these few tens of milliseconds, spent after the engine
has settled rather than before the window opens; it is for the maintainer
to measure on a packaged app and record in the plan.
