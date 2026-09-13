# Implementation Plan: The first-run check of the bundled tools

**Branch**: `A6-02-first-run-check` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

## Summary

A main-process module runs the bundled `gtfs2graph` over a committed tiny
GTFS folder and the bundled `ffmpeg`/`ffprobe -version`, once per start
after the engine's first start settles, and publishes a typed result over
the bridge. The page shows a modal dialog on failure (the mismatch
dialog's pattern) and Settings shows the result; the diagnostics copy and
the log carry it; the installer build's launch check asserts it passed.

## Technical Context

Electron main process (TypeScript, Node's `child_process.spawn`), React
renderer, Vitest units with an injected spawner, Playwright end-to-end
against the built app. No new dependency. No engine change.

## Constitution Check

- **Principle: never write inside the bundle** - the spawns' working
  directory is a temporary folder; `launch-packaged.mjs` already proves the
  bundle is unchanged after a launch, and now covers the check too.
- **Child processes** - argument arrays, `windowsHide`, a timeout (15 s per
  spawn: a first launch on macOS can wait on Gatekeeper's scan), stderr to
  the log, ended at quit.
- **The page is contained** - the install link's address never crosses the
  bridge inward; the method takes no argument.
- **Design system** - the dialog is the kit's `Button` in a `<dialog>`, as
  `MismatchDialog.tsx`; no literal in a component file.
- **Accessibility (principle VI)** - the dialog labelled and described, the
  first button focused, Settings' result in text; the result announced
  politely in Settings when it changes.

## Design

### Where the tools are judged (FR-002, FR-004)

`resolveConfig` already resolves `config.loomBin` and `config.ffmpeg`, and
records `sources.SCHEMATIC_LOOM_BIN` / `SCHEMATIC_FFMPEG` as `bundled`,
`environment`, `.env.local` or `default`. A packaged app with no `loom/`
folder resolves `loomBin` to null (the development default). So the check
takes its targets from an explicit function, unit-tested beside
`bundledComponents`:

- packaged: LOOM is the named folder when the environment names one, else
  `<resources>/loom` whether or not it exists; ffmpeg likewise with
  `<resources>/ffmpeg/ffmpeg[.exe]`.
- development: LOOM only when `SCHEMATIC_LOOM_BIN` came from the
  environment or `.env.local`; ffmpeg likewise; otherwise `skipped`.

### The spawns (FR-003, FR-005)

A new `src/main/first-run.ts`, with the spawner and clock injected:

- LOOM: resolve `gtfs2graph` or `gtfs2graph.exe` in the folder (missing
  file: `failed`, "missing"); spawn `[exe, '-m', 'subway', fixtureDir]`,
  cwd a fresh `mkdtemp` under `os.tmpdir()`, removed after; collect stdout
  up to a cap (a few MB); pass when exit 0 and `JSON.parse(stdout)` is a
  FeatureCollection with at least one `LineString` feature.
- ffmpeg: spawn `[ffmpeg, '-version']` and `[ffprobe, '-version']`; pass
  when exit 0 and the first line starts with the tool's name and
  ` version`.
- Each has a 15 s timeout; a timeout, a spawn error (`ENOENT`, `EACCES`)
  or a signal is `failed` with the reason in `detail`. stderr goes to the
  log under a `first-run` tag. The running children are held so `before-quit`
  can end them (see how `index.ts` stops the sidecar).

### The fixture (FR-006)

`resources/first-run-gtfs/` in the repository (a new top-level
`resources/` folder): `agency.txt`, `stops.txt` (three stops), `routes.txt`
(one route, `route_type` 1), `trips.txt` (one trip), `stop_times.txt`,
`calendar.txt`. Carried by `electron-builder.yml`'s `extraResources` to
`first-run-gtfs`. Development finds it at `app.getAppPath()/resources/...`;
packaged at `process.resourcesPath/first-run-gtfs`. **Prove it against
the real `gtfs2graph` before writing the parser**: download a LOOM artefact
from the latest successful installer build and run it by hand
(`gh run list --workflow build.yml --status success --limit 1`, then
`gh run download <id> -n loom-darwin-arm64 -D <scratch dir>`), and put the
exact command and the size of its output in `research.md`.

### Bridge and page (FR-007 to FR-011)

- `src/shared/first-run.ts`: the `ToolCheck` and `FirstRunResult` types and
  the sentences (shared, so the log and the page agree, as
  `describeState` is shared).
- `src/main/first-run-ipc.ts`: `firstRun.get` (invoke) and
  `firstRun.changed` (send), `firstRun.openInstallGuide` (invoke, no
  argument), each behind the top-frame guard every handler uses. Channel
  names in the shared channel table.
- Preload: `api.firstRun.{get, onChanged, openInstallGuide}`.
- `index.ts`: start the check when the sidecar's state first leaves
  `starting` (subscribe to its state change the way the window's
  `engineStateChanged` send is fed), register the handlers, end children
  at quit.
- `src/renderer/src/FirstRunDialog.tsx`: modal, shown when the result has
  finished with any `failed`, once per page load, and only while the
  mismatch dialog is not open (`App.tsx` owns both flags). "Copy
  diagnostics" calls the existing settings diagnostics copy through the
  bridge it already has.
- `Settings.tsx`: a "Bundled tools" row, result per tool in text, in a
  polite live region.
- `diagnostics-text.ts`: one section for the check; the unit test that
  asserts the whole copy grows by it.

### The installer build (US2-4)

`scripts/launch-packaged.mjs` already reads the packaged app's log; add
that the first-run check's passed line is present for both tools, and its
unit test (`tests/unit/launch-packaged.test.ts`) grows by it.

## Tests

- Units: target selection (packaged/development, named/unnamed, missing
  folder); each outcome of each spawn with a fake spawner (exit 0 with a
  line graph, exit 0 with an empty collection, non-zero, signal, timeout,
  ENOENT, oversized stdout); the sentences; the diagnostics section; the
  launch check's new assertion.
- End-to-end (`tests/e2e/first-run.spec.ts`), written and not run by the
  agent: `SCHEMATIC_LOOM_BIN` an empty temp folder → dialog naming LOOM,
  Library visible behind, Escape closes, it does not return on navigating;
  `SCHEMATIC_FFMPEG` a missing file → dialog naming ffmpeg; neither named →
  no dialog and Settings says skipped. Each sets `LEGIBLE_USER_DATA`.
  Existing suites must not start seeing the dialog: check which launches
  set `SCHEMATIC_FFMPEG` or `SCHEMATIC_LOOM_BIN` today
  (`tests/e2e/export.spec.ts`, `reel.spec.ts`, `determinism.spec.ts`) and
  make those still pass.
