# ADR-035: Installers are built from the same run's vendor artefacts

- **Status:** Accepted
- **Date:** 2026-09-12
- **Supersedes:** none
- **Superseded by:** none
- **Amended by:** [ADR-040](040-ffmpeg-is-built-from-pinned-sources.md): the
  ffmpeg the installers carry is built in this repository, 12 to 17 MB a
  target rather than the 132 to 290 MB of third-party builds given below

## Context

By 2026-09-12 every component the engine needs was vendored and proven on
the runners, each by its own job in `.github/workflows/vendor.yml`: LOOM on
four targets (A0-05, ADR-019, ADR-021), the Python runtime with the engine
installed on three (A0-06, ADR-038), and ffmpeg with ffprobe on four (A0-08,
ADR-012). Each job uploads an artefact that lives for 30 days. Nothing
turned them into something a person installs, and the app, once packaged,
found only the runtime: `src/main/interpreter.ts` looked under the app's
resources, and `src/main/config.ts` knew no bundled LOOM or ffmpeg.

Four facts shaped how the installers are made:

- **An artefact carries no pin.** Its name says the component and the
  target, not which `vendor/pins.json` built it, and a packaging job that
  took artefacts from an earlier run could ship components the pins no
  longer describe.
- **The artefact zip drops the executable bit** (ADR-038), so every binary
  arrives unable to run on macOS.
- **electron-builder skips an `extraResources` source that does not exist**,
  logging a warning (`file source doesn't exist`) and producing an app
  without it. An installer missing its runtime opens to a Library and fails
  at the first engine call.
- **The runtime ships without bytecode.** ADR-038 measured a start of 1.5 to
  3.5 s on the runners without it and 0.3 to 0.84 s with it, and left the
  choice to this issue. The maintainer chose, on 2026-09-12, to compile it
  at build time.

And one the first local package found. The first attempt compiled with
`compileall --invalidation-mode unchecked-hash` and nothing more, and 74 of
the standard library's 1593 bytecode files came out timestamped anyway:
the modules the compiler itself imports were written as it started, with
timestamps, and `compileall` then skipped them as up to date. The packager
copies the runtime into the bundle and gives every source a new time, so
those 74 no longer matched; running the packaged interpreter rewrote them
inside the bundle, and `codesign --verify --deep --strict` then reported a
sealed resource missing or invalid.

## Options

**Package from the latest successful vendor run.** Fast: the packaging jobs
would need minutes, not the vendor jobs' tens. It needs a cross-run fetch
with a token that can read another run's artefacts, and it loses the
guarantee that what ships was built from the pins being packaged, which is
the property this project has spent four spikes making true.

**Commit the vendored tree, or cache it by the pins' hash.** A cache is the
same run-to-run question in another form. Committing binaries is what A-002
of `specs/002` rules out: size, and a GPL conveyance in the git history.

**Run the vendor jobs in the build's own run** by making `vendor.yml` a
reusable workflow, then package each target from that run's artefacts.
Slow, and the vendor jobs run on every build. Nothing is fetched from
another run and nothing can be stale.

For the bytecode: **ship none** and let the first start compile it, which
writes into the bundle, is refused by the constitution, and on macOS breaks
the signature; **compile to a cache outside the bundle** at first start
(`PYTHONPYCACHEPREFIX`), which works and makes every person's first start
the slow one; or **compile at build** with hash-based, unchecked
invalidation, so a copy or a move leaves every file valid.

## Decision

Installers are built in `.github/workflows/build.yml` from the vendor
artefacts of the same run. `vendor.yml` gains `workflow_call` and nothing
else; the build calls it, then runs one packaging job per target (a dmg on
`macos-15` and on `macos-15-intel`, an nsis installer on `windows-latest`)
that downloads its target's three artefacts, restores the executable bits,
and runs `scripts/check-vendored.mjs`. That script refuses, naming the
component and the target, a component that is missing, stale against the
pins (the runtime's `PY_VERSION`, the engine's installed version, the
pinned version string and configure line inside ffmpeg and ffprobe) or
built for another architecture, read from each executable's Mach-O or PE
header; and on success writes `vendor/manifest-<target>.json` with the
pins' sha256 and every bundled component's exact version, including the
Python packages the runtime actually carries. The job then compiles the
runtime's bytecode with `compileall -f --invalidation-mode unchecked-hash`
under `PYTHONDONTWRITEBYTECODE=1`, and packages.

Every component lands in the app's resources at a path of the same shape on
every target: `python/`, `loom/`, `ffmpeg/` and `vendor-manifest.json`,
beside `LICENSE` and `THIRD_PARTY_NOTICES.md`. The same script is
electron-builder's `afterPack` hook, and checks the components again where
they landed, with the manifest's pins hash against the pins being built and
every `.py` in the runtime required to have unchecked-hash bytecode; with
`LEGIBLE_VENDOR_TARGET` set, as the build sets it, a missing component fails
the package rather than being skipped. The packaged app defaults
`SCHEMATIC_LOOM_BIN` and `SCHEMATIC_FFMPEG` to the bundled ones, reported as
`bundled`, whenever their folders exist and nothing names another - even
when a file inside is missing, so the engine's own error names it instead of
the app falling back to Docker, which can pull an image, or to an ffmpeg on
`PATH` (FR-013) - and starts the bundled runtime with
`PYTHONDONTWRITEBYTECODE=1`.

Then `scripts/launch-packaged.mjs` launches the unpacked app once, with a
temporary `--user-data-dir` and the bundle as its working directory, as an
installer's shortcut starts it. What it checks is exactly this:

- the engine reaches ready from the bundled runtime, which is the one
  bundled executable the session itself runs;
- `engine.info` reports the pinned engine and Python, the native LOOM
  backend at the pinned commit, and the bundled ffmpeg's path. At the
  pinned engine those are read from the environment and from
  `shutil.which`, so they prove the configuration, not that anything runs;
- the log shows the three components taken from the bundle and the engine
  ending on request at quit;
- after quit, each of the four LOOM tools runs with `--help`, and ffmpeg
  and ffprobe with `-version`, from inside the bundle with the bundle as
  their working directory, and must exit 0 and print their own name (and
  for ffmpeg the pinned version) first. This is what proves each executes
  from the packaged app, signed on macOS;
- every file and folder in the bundle is the same after all of that as
  before the launch.

It runs no layout and no export, so LOOM and ffmpeg do no real work inside
the app here. On macOS the job then runs `codesign --verify --deep
--strict` on the app.

The Mac app is signed ad hoc (`identity: '-'`), and nothing is signed with
an identity until A6-05. `forceCodeSigning` is set but does nothing with
the ad-hoc identity, which electron-builder 26.15.3 builds before the only
branch that reads the flag; it matters once a real identity replaces `-`.
The `codesign --verify` step is what checks the ad-hoc signature.

## Consequences

Every build waits for the vendor jobs, including the LOOM builds and the
Linux test jobs no installer needs, and a push that changes the pins runs
the vendor jobs twice, once through `vendor.yml`'s own trigger and once
through the build. That is the price of never shipping an artefact from
another run. The build runs on request and on a push to any branch that
changes the pins, the packaging configuration, the vendor and check
scripts, `src/main/`, `package.json` or `package-lock.json`. The last three
are there so a change to how the app finds its components, or an
electron-builder bump, is packaged and launched before it merges; they also
mean every Dependabot npm branch runs the full build, about 720 MB of
installers each time. Installers built on `main` are kept 30 days and those
built on any other branch 7.

A target fails alone. The packaging jobs run whatever the vendor jobs'
result, a missing artefact is named by the check rather than by the
download, and the other targets upload their installers.

The installers are large: about 110 MB of runtime before bytecode and
about 140 MB after, 4 to 17 MB of LOOM, and 132 to 290 MB of ffmpeg
(ADR-012), before Electron. The darwin-arm64 app measured 577 MB unpacked;
the first build run's installer artefacts were 238 MB (darwin-arm64), 256 MB
(darwin-x64) and 224 MB (win-x64).
Bytecode adds about 32 MB on darwin-arm64 and makes the sidecar start in
0.15 s on a developer Mac from a copied runtime, with nothing written.

**The installers carry the current third-party ffmpeg builds, and they are
conveyed.** They are test builds, but an artefact of this public repository
is downloadable by anyone for 30 days, which the vendor job already treats
as conveying GPL binaries, and an installer is no different. The maintainer
accepted that for test builds on 2026-09-12. Issue 95 replaces the ffmpeg
builds with a minimal one of this project's own, without libdvdcss or
freetype, before A6-01 tags a release, and A6-01 attaches the Corresponding
Source at the Release from the pins the manifest records. Until then the
test installers' Corresponding Source is what the pins and each builder's
published scripts point at, which is the gap ADR-012 describes.

**Ad-hoc signing is not distribution signing.** It keeps an Apple-silicon
Mac running an app whose original signature the packager invalidated, and
it signs every Mach-O in the resources with the hardened runtime and
electron-builder's default entitlements, which disable library validation.
A downloaded copy still meets Gatekeeper; the steps past it are A6-01's
download page, and a Developer ID replaces one line in
`electron-builder.yml` without changing the layout (FR-005).

**python-build-standalone's `install_only` asset carries only CPython's
`LICENSE.txt`.** The licences of the libraries it links statically are in
the full archive's `licenses/` folder, which is not shipped; the Licences
screen and A6-01 have to supply them.

The launch check runs only on the runners: it launches Electron, which a
developer machine running the end-to-end suite cannot do at the same time.
On macOS it cannot keep the app's logs out of the real `~/Library/Logs`,
because a packaged app has no switch that moves them; it removes the log
files it created there.

**SC-003 is checked for a session that starts, answers `engine.info` and
quits, and for each bundled tool run alone; not for a session that does
work.** A real one is within reach and is not built here. It would take a
GTFS fixture small enough to lay out in seconds (a handful of stops, two
routes, a calendar) committed under `tests/fixtures/`; adding it to the
temporary profile's engine home before launch through the bundled
interpreter itself (`python -c` calling the engine's `feeds.add`, so no
private file format is written by the script); then from the window
`graph.build` for that key, `feeds.service` and `map.build`, which runs all
four LOOM tools natively, and an export of the shortest preset through
`api.export`, which runs the capture and ffmpeg and ffprobe. About a
hundred lines and a minute or two on each runner, and the bundle
comparison would then cover the engine's real writes.
