# ADR-035: Installers are built from the same run's vendor artefacts

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** none
- **Superseded by:** none

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
  choice to this issue. The maintainer chose, on 2026-09-13, to compile it
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
`bundled`, only when present and when nothing names another, and starts the
bundled runtime with `PYTHONDONTWRITEBYTECODE=1`. Finally
`scripts/launch-packaged.mjs` launches the unpacked app once with a
temporary `--user-data-dir`, waits for the engine to be ready, asks it
`engine.info` to confirm the native LOOM at the pinned commit and the
bundled ffmpeg, quits, reads the log for the bundled origins and a clean
engine shutdown, and compares every file in the bundle before and after.

The Mac app is signed ad hoc (`identity: '-'`) and nothing is signed with
an identity until A6-05.

## Consequences

Every build waits for the vendor jobs, including the LOOM builds and the
Linux test jobs no installer needs, and a push that changes the pins runs
the vendor jobs twice, once through `vendor.yml`'s own trigger and once
through the build. That is the price of never shipping an artefact from
another run, and it is paid only when the build runs: on request, and on a
push that changes what it packages.

A target fails alone. The packaging jobs run whatever the vendor jobs'
result, a missing artefact is named by the check rather than by the
download, and the other targets upload their installers.

The installers are large: about 110 MB of runtime before bytecode and
about 140 MB after, 4 to 17 MB of LOOM, and 132 to 290 MB of ffmpeg
(ADR-012), before Electron. The darwin-arm64 app measured 577 MB unpacked.
Bytecode adds about 32 MB on darwin-arm64 and makes the sidecar start in
0.15 s on a developer Mac from a copied runtime, with nothing written.

**The installers carry the current third-party ffmpeg builds as test
artefacts.** Issue 95 replaces them with a minimal build of this project's
own, without libdvdcss or freetype, before A6-01 tags a release, and A6-01
attaches the GPL sources the manifest lists. Until both, an installer is
for testing, not for distribution.

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

What the launch check proves runs only on the runners: it launches
Electron, which a developer machine running the end-to-end suite cannot do
at the same time. Its first results are the first time the bundled runtime,
LOOM and ffmpeg run together inside a packaged app.
