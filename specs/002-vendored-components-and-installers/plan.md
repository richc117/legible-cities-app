# Implementation Plan: Vendored components and installers

**Branch**: `A0-10-installers` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

Every component is now vendored and proven on its runners: LOOM on four
targets (A0-05), the Python runtime with the engine on three (A0-06), and
ffmpeg with ffprobe on four (A0-08), all from `vendor.yml`. This feature
turns those artefacts into installers. A build workflow runs the vendor
jobs in the same run, lays their outputs out under `vendor/`, refuses a
target whose components are missing or built for the wrong architecture,
compiles the runtime's bytecode, and has `electron-builder` copy the lot
into `resources/` for a dmg per Mac and an nsis installer for Windows. The
app, when packaged, finds LOOM and ffmpeg there as it already finds the
runtime.

## Decisions taken before this plan

Answered by the maintainer on 2026-09-12:

- **Bytecode is compiled at build time** (`compileall` over the vendored
  runtime), so a packaged sidecar starts in about 0.3-0.8 s rather than
  1.5-3.5 s (A0-06's measurements), and nothing is ever written inside the
  bundle at run time.
- **The installers carry the current third-party ffmpeg builds as test
  artefacts.** Issue #95 replaces them with a minimal build of our own
  (no libdvdcss, no freetype) before A6-01 tags a release.
- **GPL source archives are attached with the Release in A6-01.** This
  feature records the exact version of every bundled component in a
  manifest inside the bundle so A6-01 can gather them.

## Spec corrections made in this change

`spec.md` predates the supervisor and the vendoring jobs; these lines are
corrected in the same commit as this plan:

- **FR-012** said the application must not start the engine. It has since
  A1-01. The line becomes "this feature changes nothing about how the
  engine is started; it puts the components where the supervisor already
  looks".
- **A-005** said the engine is installed without its dependencies. Since
  A0-06 it is installed with them, from wheels.
- **A-006** said the Windows target may lag. It no longer does: every
  vendor job is green on win-x64.
- **The size edge case** said the encoder is tens of MB. It is 132-290 MB
  unpacked (ADR-012).

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | Untouched. |
| II. The engine is the source of truth | The engine is installed at its pinned tag by `vendor-python.sh`; nothing is copied. |
| III. Determinism is a feature | The bundled LOOM is the pinned commit (ADR-019); bytecode compilation does not change behaviour. |
| IV. No network without a reason | FR-013: nothing is downloaded at first run. The build downloads only from its own run's artefacts. |
| V. Hygiene by tools | The build refuses missing, stale or wrong-architecture components, naming them; the manifest is checked against `vendor/pins.json`. |
| VI. Accessible by default | No interface change. |
| VII. Records | ADR-035: installers are built from the same run's vendor artefacts, laid out under `resources/<component>/`, with a manifest; bytecode compiled at build. |

## Design

*Rewritten on 2026-09-12 to describe what was built; where it departs from
the first version of this plan, the departure is said.*

**One run, no cross-workflow fetch.**
- `vendor.yml` gains `workflow_call:` so a build workflow can run its jobs as
  a reusable workflow. Its existing triggers stay; its jobs also gained
  job-level timeouts and uncredentialed checkouts, and no step changed.
- `build.yml` runs on `workflow_dispatch` and on a push **to any branch**
  (not only `main`: a workflow file is dispatchable only once it is on the
  default branch, so a push is the only way to run it before merge) that
  changes `vendor/pins.json`, `electron-builder.yml`, `src/main/**`,
  `package.json`, `package-lock.json`, the vendor and check scripts,
  `vendor.yml` or `build.yml`. A push that changes the pins runs the vendor
  jobs twice, once through each workflow.
- It calls `vendor.yml`, then runs one packaging job per target that
  downloads that target's `python-<t>`, `loom-<t>` and `ffmpeg-<t>`
  artefacts from the same run. The packaging jobs run whatever the vendor
  jobs' result (`!cancelled()`), with each download allowed to fail, so a
  missing artefact is named by the check and the other targets still upload.
- The artefact names are the pins hash's proxy: they cannot be stale,
  because they were built from the checked-out pins in this run. The
  manifest records the pins hash anyway.

**Packaging jobs.**

| Target | Runner | Output |
|---|---|---|
| darwin-arm64 | `macos-15` | dmg, `--arm64` |
| darwin-x64 | `macos-15-intel` | dmg, `--x64` |
| win-x64 | `windows-latest` | nsis, `--x64` |

Each job:
1. `npm ci`, `npm run build`. The Electron binary is not fetched: the
   packager downloads its own.
2. Downloads the three artefacts into `vendor/{python,loom,ffmpeg}/<target>/`.
   The python artefact holds a `python/` folder, so the runtime is at
   `vendor/python/<t>/python/`.
3. Restores executable bits on macOS (the artefact zip drops them, A0-06):
   `chmod +x` on `python/bin/*`, the four LOOM binaries, `ffmpeg` and `ffprobe`.
4. Runs `node scripts/check-vendored.mjs <target>`, which fails naming the
   component and target if any is missing, stale or built for another
   architecture. The architecture is read from each executable's own
   header, Mach-O or PE, rather than from `lipo` or `file`, so the check
   runs the same on every build machine with no child process and is unit
   tested with fixture headers. Stale means the runtime's `PY_VERSION`, the
   engine's installed version, or the pinned version string and configure
   line inside ffmpeg and ffprobe differ from `vendor/pins.json`. Then it
   writes `vendor/manifest-<target>.json`: pins hash, the target, each
   component's source, version or commit and checksums from
   `vendor/pins.json`, and the Python packages the runtime carries.
5. Compiles bytecode: `PYTHONDONTWRITEBYTECODE=1 <python> -m compileall -f
   -q -j 0 --invalidation-mode unchecked-hash` over the runtime's `lib`
   (`Lib` on Windows). `-f` and the variable were added after the first
   local package: without them the modules the compiler itself imports
   are written timestamped first and then skipped (ADR-035).
6. Runs `electron-builder --mac dmg --arm64` (and so on) with
   `LEGIBLE_VENDOR_TARGET` set. `electron-builder.yml` maps, per platform
   with the `${arch}` macro:
   - `vendor/python/<t>/python` → `python` (the inner folder);
   - `vendor/loom/<t>` → `loom`;
   - `vendor/ffmpeg/<t>` → `ffmpeg`;
   - `vendor/manifest-<t>.json` → `vendor-manifest.json`;
   - `LICENSE` and `THIRD_PARTY_NOTICES.md` beside them.

   electron-builder only warns on a missing source, so the same check
   script is the `afterPack` hook, over the packaged resources: components,
   architecture, every module's bytecode unchecked-hash, and the manifest's
   hash against the pins. The Mac app is signed ad hoc with
   `forceCodeSigning`.

   The runtime carries only CPython's own `LICENSE.txt`: the `install_only`
   asset has no `licenses/` folder for the libraries python-build-standalone
   links statically (corrected 2026-09-12; that folder is in the full
   archive). Their texts are owed by A6-01's Licences screen.
7. Runs `scripts/launch-packaged.mjs`, then on macOS `codesign --verify
   --deep --strict`.
8. Uploads the installer and the manifest as `installer-<target>`, 30-day
   retention.

**The app finds the components.**
- `src/main/interpreter.ts` already looks for `resources/python`; a bundled
  runtime is started with `PYTHONDONTWRITEBYTECODE=1`.
- `src/main/config.ts` gains packaged defaults: when `app.isPackaged` and
  neither `SCHEMATIC_LOOM_BIN` nor `SCHEMATIC_FFMPEG` is set, `loomBin` is
  `resources/loom` and `ffmpeg` is `resources/ffmpeg/ffmpeg[.exe]`, each
  whenever its folder exists, even if a file inside is missing, so the
  engine's own error names it rather than the app falling back to Docker or
  to an ffmpeg on `PATH` (FR-013). Their sources report "bundled", as the
  interpreter's origin does.
- In development nothing changes.
- The LOOM pin passed as `SCHEMATIC_LOOM_COMMIT` already comes from `vendor/pins.json` (A1-06).

**A local `npm run dist`** keeps working without vendored components for an
unpacked build. `npm run dist:check <target>` runs the check script alone,
so a developer can see what is missing.

**Launch check in CI.** Each packaging job launches the unpacked app from
`release/` once, with Chromium's `--user-data-dir` set to a temporary
folder (not `LEGIBLE_USER_DATA`, which is development-only and which a
packaged app ignores) and the bundle as its working directory. It waits for
the engine status to read ready, asks `engine.info`, and quits. Then it:
- reads the log, from wherever `app.getPath('logs')` answers inside the
  running app, for the three components' origins being "bundled" and the
  engine ending on request; on macOS that is the real `~/Library/Logs`,
  and the files the run created there are removed;
- runs each bundled LOOM tool with `--help` and ffmpeg and ffprobe with
  `-version` from inside the bundle, requiring a zero exit and the line
  each prints first;
- lists every file and folder in the bundle before the launch and after
  all of the above, to prove nothing was written inside it (SC-003, for
  that session).

This is the only place the bundled runtime, LOOM and ffmpeg are exercised
together before a person installs. It does not run a layout or an export.

## Source code

```text
.github/workflows/vendor.yml        # + workflow_call only
.github/workflows/build.yml         # new: vendor via workflow_call, then package per target
electron-builder.yml                # extraResources per target; mac/win arch targets
scripts/check-vendored.mjs          # new: presence, architecture, staleness, manifest; also the afterPack hook
scripts/launch-packaged.mjs         # new: launch the unpacked build once, run the bundled tools, bundle unchanged
package.json                        # dist:check script (no dependency changes)
src/main/config.ts                  # packaged defaults for loomBin and ffmpeg
src/main/index.ts                   # pass the resources to config; say when the interpreter is bundled
src/main/interpreter.ts             # PYTHONDONTWRITEBYTECODE for a bundled runtime
tests/unit/{config,interpreter,check-vendored,launch-packaged}.test.ts
docs/install.md                     # NOT in this feature: A6-01 writes it
docs/adr/035-installers-are-built-from-the-same-runs-vendor-artefacts.md, docs/adr/README.md
specs/002-vendored-components-and-installers/spec.md   # the corrections above
THIRD_PARTY_NOTICES.md              # bundled components' rows updated from "planned" where now true
docs/ARCHITECTURE.md, CLAUDE.md
```

## Must not touch

- `src/renderer/`, `tests/e2e/` and `src/main/projects.ts`:
  A1-03 and issue 93's lanes.
- `tests/e2e/reel.spec.ts` and anything named determinism: A5-04's lane.
- The `loom`, `loom-windows`, `python` and `ffmpeg` jobs' steps in `vendor.yml`,
  beyond adding `workflow_call` and job-level keys.
- `scripts/vendor-*.sh`.
