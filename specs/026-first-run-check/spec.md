# Feature Specification: The first-run check of the bundled tools

**Feature Branch**: `A6-02-first-run-check`

**Created**: 2026-09-13

**Status**: Draft

**Input**: Planned issue A6-02, "First-run check: bundled LOOM and ffmpeg
run, or a clear message". A packaged app carries its own Python, LOOM and
ffmpeg (A0-10, ADR-035). The engine's handshake proves the Python runtime
and the engine start. Nothing proves LOOM or ffmpeg will run on a person's
machine until a layout or an export fails half way through, with the
engine's sentence about a tool the person has never heard of. The LOOM
binaries answer `--version` with `-128-NOTFOUND`, so asking them their
version proves nothing: a check has to make one of them do real work.

## Overview

A person installs the app, and macOS quarantines one of the bundled LOOM
binaries, or an antivirus on Windows removes `ffmpeg.exe`. Today the app
opens, the engine says it is ready, and the first layout fails minutes
later. After this feature, a few seconds after every start of a packaged
app, the main process runs `gtfs2graph` from the bundled LOOM over a tiny
GTFS folder the app ships, and `ffmpeg -version` and `ffprobe -version`
from the bundled ffmpeg. If any of them fails, the page shows one dialog
naming what failed, in a sentence a person can act on, with "Copy
diagnostics" and a link to the install document. The Library still opens
and everything that does not need the failed tool still works. Settings
shows the result of the check, passed or failed, from then on.

## Decisions taken before this spec

Answered by the maintainer on 2026-09-13:

- **The failure is said in the page's own modal dialog, and in Settings.**
  The dialog is the engine-mismatch dialog's pattern (`MismatchDialog.tsx`):
  the browser owns the focus trap, Escape and the return of focus, and a
  native message box would block the main process on macOS and hold a quit
  on Linux. It is shown once per start. Settings shows the check's result
  for as long as the app runs.
- **The check runs on every start of a packaged app**, not only the first:
  a component quarantined or removed later is caught too, and the work is
  well under a second. **In development it runs only when
  `SCHEMATIC_LOOM_BIN` or `SCHEMATIC_FFMPEG` is named**, for whichever of
  the two is named; that is also how the end-to-end suite reaches the
  dialog. Docker is never probed, and nothing on `PATH` is.

And from the plan:

- **The app spawns the tools itself.** No engine method: an `engine.check`
  would be an engine release for a spawn the app can make with the paths it
  already resolved (`config.loomBin`, `config.ffmpeg`).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A tool that will not run is named at start (Priority: P1)

A packaged app starts with its `loom` folder renamed. A dialog says the
bundled LOOM tools are missing, so maps cannot be laid out, and points at
the install document. The Library opens behind it.

**Why this priority**: it is the issue and its acceptance criterion.

**Independent Test**: in the end-to-end suite, launch the built app with
`SCHEMATIC_LOOM_BIN` naming an empty folder and read the dialog; launch it
with `SCHEMATIC_FFMPEG` naming a file that does not exist and read the
dialog. On a packaged app, rename `resources/loom` by hand (a person's
check, SC-004).

**Acceptance Scenarios**:

1. **Given** a packaged app whose `resources/loom` folder is missing,
   **When** it starts, **Then** the dialog names LOOM as missing, even
   though the configuration then falls back to its development default
   (see FR-004), and the Library opens.
2. **Given** a LOOM folder whose `gtfs2graph` exits non-zero, is killed,
   times out or prints no line graph, **When** the check runs, **Then** the
   dialog names LOOM as not running, with the reason in the detail.
3. **Given** an ffmpeg or ffprobe that is missing or does not answer
   `-version` with a zero exit and a first line beginning `ffmpeg version`
   or `ffprobe version`, **When** the check runs, **Then** the dialog names
   ffmpeg, and says exports cannot be made.
4. **Given** both LOOM and ffmpeg fail, **When** the check runs, **Then**
   one dialog names both.
5. **Given** the dialog, **When** "Copy diagnostics" is pressed, **Then** the
   clipboard holds what Settings' "Copy diagnostics" copies today, with the
   check's result included, and a sentence says it was copied.
6. **Given** the dialog, **When** "How to install" is pressed, **Then** the
   install document opens in the platform's browser at a fixed address the
   main process holds; nothing from the page names the address.
7. **Given** the dialog is dismissed, **When** the person carries on,
   **Then** it does not return this session.

---

### User Story 2 - A passing check is quiet and visible on request (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a packaged app with its tools intact, **When** it starts,
   **Then** no dialog is shown, one log line says the check passed with
   each tool's time, and Settings says "The bundled LOOM and ffmpeg ran".
2. **Given** a development run naming neither variable, **When** it starts,
   **Then** no tool is spawned, and Settings says the check did not run and
   why ("development: no bundled tools named").
3. **Given** the check has not finished, **When** Settings is open, **Then**
   it says the check is running, and changes when it ends without a
   reload.
4. **Given** the installer build (`build.yml`), **When** the packaged app is
   launched by `scripts/launch-packaged.mjs`, **Then** the log shows the
   check passed from inside the bundle, and the bundle is unchanged after
   it.

---

### User Story 3 - The check never harms the start (Priority: P2)

**Acceptance Scenarios**:

1. **Given** the check running, **When** the person quits, **Then** every
   child it started is ended and the quit is not held.
2. **Given** the engine unavailable or mismatched, **When** the app starts,
   **Then** the check still runs once the engine's first start has
   settled, and its dialog never opens over the mismatch dialog: it waits
   until that one is closed.
3. **Given** the check, **When** it runs, **Then** nothing is written
   inside the app bundle or into the engine's home; any scratch it needs is
   in the platform's temporary folder and is removed after.

### Edge Cases

- A tool that hangs (a Gatekeeper prompt nobody answers): the timeout ends
  it and the dialog says it did not answer in time.
- A Windows `gtfs2graph.exe` whose DLL is missing exits with a loader code;
  the detail carries the exit code, not a guess at the cause.
- The GTFS fixture itself is missing from a broken install: that is a
  failed check naming the install, not LOOM.
- The engine restarting later does not run the check again; it is once per
  app start.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Once per app start, after the engine's first start has
  settled (ready, unavailable, mismatched or stopped), the main process
  MUST run the check for each tool that applies (FR-002).
- **FR-002**: A packaged app MUST check LOOM and ffmpeg always. A
  development run MUST check LOOM only when `SCHEMATIC_LOOM_BIN` is named
  and ffmpeg only when `SCHEMATIC_FFMPEG` is named, and otherwise report
  the check as skipped with its reason.
- **FR-003**: LOOM passes only when `gtfs2graph -m subway <fixture>` exits 0
  within its timeout and its standard output parses as GeoJSON with at
  least one line feature. ffmpeg passes only when `ffmpeg -version` and
  `ffprobe -version` (ffprobe beside ffmpeg, as the engine finds it) each
  exit 0 within the timeout with a first line starting `ffmpeg version` or
  `ffprobe version`.
- **FR-004**: A packaged app MUST judge the tools where it expects them,
  under its resources (`loom/`, `ffmpeg/`), unless the environment names
  others; a missing folder is a failure named "missing", even though
  `resolveConfig` falls back to its development defaults for a package
  with no folder.
- **FR-005**: Every spawn MUST follow the child-process rules: an argument
  array, `windowsHide: true`, a timeout, stderr captured to the log, and
  the child ended at quit. The working directory is a temporary folder,
  never the bundle.
- **FR-006**: The GTFS fixture MUST be committed in the repository, small
  (a handful of stops, one route, one trip), carried in the package through
  `extraResources`, and found from the repository in development.
- **FR-007**: The result MUST cross the bridge as one read and one change
  notification, typed in `src/shared/`, carrying per tool: passed, failed
  (with a sentence and a detail without absolute paths shown on screen),
  or skipped (with a reason).
- **FR-008**: A failure MUST open one modal dialog in the page, once per
  start, never over the mismatch dialog, naming each failed tool and what
  it stops (layouts for LOOM, exports for ffmpeg), with "Copy diagnostics",
  "How to install" and "OK".
- **FR-009**: "How to install" MUST open one fixed URL held in the main
  process (the install document on the repository's default branch)
  through the platform's browser; the bridge method takes no argument.
- **FR-010**: Settings MUST show the check's current result.
- **FR-011**: "Copy diagnostics" MUST include the check's result per tool.
- **FR-012**: The log MUST carry one line per tool with its outcome and
  time, and the detail of any failure.

### Key Entities

- **Tool check**: a tool (`loom`, `ffmpeg`), its outcome (`running`,
  `passed`, `failed`, `skipped`), a person's sentence, a detail, and the
  milliseconds it took.
- **First-run result**: the two tool checks and whether the whole check has
  finished.

## Success Criteria _(mandatory)_

- **SC-001**: With `SCHEMATIC_LOOM_BIN` naming an empty folder, the built
  app shows the dialog naming LOOM within ten seconds of start, in the
  end-to-end suite on three platforms.
- **SC-002**: The installer build's launch check shows the check passed
  from inside each packaged app (darwin-arm64, darwin-x64, win-x64).
- **SC-003**: The check adds no more than one second to the time to the
  Library on this Mac, measured once and recorded in the plan.
- **SC-004**: A person renames `resources/loom` in a packaged app, starts
  it, reads the dialog naming LOOM, and the Library opens (the issue's
  acceptance criterion, after merge).
- **SC-005**: The dialog is reachable and read by the keyboard and
  VoiceOver (A6-07's person half).

## Assumptions

- `docs/install.md` arrives with A6-01, after this; the link's address is
  fixed now and resolves once A6-01 merges.
- `gtfs2graph` reads a directory of GTFS tables and writes the line graph
  to standard output, as the engine's native backend runs it
  (`schematic/loom.py`, `NativeBackend.feed_command`).
