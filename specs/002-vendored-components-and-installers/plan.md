# Implementation Plan: Vendored components and installers

**Branch**: `A0-10-installers` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

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

Answered by the maintainer on 2026-09-13:

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

**One run, no cross-workflow fetch.**
- `vendor.yml` gains `workflow_call:` so a build workflow can run its jobs as
  a reusable workflow. Its existing triggers stay.
- `build.yml` runs on `workflow_dispatch` and on a push to `main` that
  changes `vendor/pins.json`, `electron-builder.yml`, the vendor scripts or
  `build.yml` itself.
- It calls `vendor.yml`, then runs one packaging job per target that
  downloads that target's `python-<t>`, `loom-<t>` and `ffmpeg-<t>`
  artefacts from the same run.
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
1. `npm ci`, `npx install-electron --no`, `npm run build`.
2. Downloads the three artefacts into `vendor/{python,loom,ffmpeg}/<target>/`.
3. Restores executable bits (the artefact zip drops them, A0-06):
   `chmod +x` on `python/bin/*`, the four LOOM binaries, `ffmpeg` and `ffprobe`.
4. Runs `node scripts/check-vendored.mjs <target>`, which fails naming the
   component and target if any is missing, or built for another
   architecture (Mach-O `lipo -archs` or `file`; PE machine type read from
   the header on Windows). Then it writes
   `vendor/manifest-<target>.json`: pins hash, the target, and each
   component's source, version or commit, and checksums from
   `vendor/pins.json`.
5. Compiles bytecode: `vendor/python/<t>/python/bin/python3 -m compileall -q
   -j 0` (or `python.exe` on Windows) over the runtime's `lib`, invalidation
   mode `unchecked-hash` so a moved or re-signed bundle keeps them valid.
6. Runs `electron-builder --<platform> --<arch>` with `extraResources`
   mapping, per target:
   - `vendor/python/<t>` → `python`;
   - `vendor/loom/<t>` → `loom`;
   - `vendor/ffmpeg/<t>` → `ffmpeg`;
   - `vendor/manifest-<t>.json` → `vendor-manifest.json`;
   - `THIRD_PARTY_NOTICES.md` → `THIRD_PARTY_NOTICES.md`.

   The python-build-standalone licence files already live inside the runtime.
7. Uploads the installer as `installer-<target>`, 30-day retention.

`electron-builder.yml` takes the mapping with `${arch}`/`${os}` macros, or
per-platform `extraResources` blocks fed by an environment variable naming
the target. Whichever is chosen, a missing source path must fail the build
rather than be skipped.

**The app finds the components.**
- `src/main/interpreter.ts` already looks for `resources/python`.
- `src/main/config.ts` gains packaged defaults: when `app.isPackaged` and
  neither `SCHEMATIC_LOOM_BIN` nor `SCHEMATIC_FFMPEG` is set, `loomBin` is
  `resources/loom` and `ffmpeg` is `resources/ffmpeg/ffmpeg[.exe]`, each
  only if present. Their sources report "bundled", as the interpreter's
  origin does.
- In development nothing changes.
- The LOOM pin passed as `SCHEMATIC_LOOM_COMMIT` already comes from `vendor/pins.json` (A1-06).

**A local `npm run dist`** keeps working without vendored components for an
unpacked build. `npm run dist:check <target>` runs the check script alone,
so a developer can see what is missing.

**Launch check in CI.** The Windows and Mac packaging jobs launch the
unpacked app from `release/` once with `LEGIBLE_USER_DATA` in a temporary
folder, wait for the engine status to read ready, and quit. They then:
- list the bundle's files before and after, to prove nothing was written
  inside it (SC-003);
- read the log for the three components' origins being "bundled".

This is the only place the bundled runtime, LOOM and ffmpeg are exercised
together before a person installs.

## Source code

```text
.github/workflows/vendor.yml        # + workflow_call only
.github/workflows/build.yml         # new: vendor via workflow_call, then package per target
electron-builder.yml                # extraResources per target; mac/win arch targets
scripts/check-vendored.mjs          # new: presence, architecture, manifest
scripts/launch-packaged.mjs         # new: launch the unpacked build once, bundle unchanged, origins bundled
package.json                        # dist:check script (no dependency changes)
src/main/config.ts                  # packaged defaults for loomBin and ffmpeg
src/main/index.ts                   # pass resourcesPath/isPackaged to config if not already
tests/unit/{config,check-vendored}.test.ts
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
  beyond adding `workflow_call`.
- `scripts/vendor-*.sh`.
