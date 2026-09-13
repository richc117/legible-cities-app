# Feature Specification: The licence texts the installers owe, and where a person reads them

**Feature Branch**: `108-python-licence-texts`

**Created**: 2026-09-13

**Status**: Draft

**Input**: Issue #108, "Ship the bundled Python runtime's library licence texts in the installers". The installers carry python-build-standalone's `install_only` runtime (release 20260901, CPython 3.12.14) for darwin-arm64, darwin-x64 and win-x64. CPython's `LICENSE.txt` ships inside it; the licence texts of the libraries python-build-standalone links statically (OpenSSL, libffi, xz, bzip2, zlib, mpdecimal, expat, Tcl/Tk and others) live only in the project's `full` archive's `licenses/` folder, which is not shipped. Their licences require the notices to accompany the binaries. `THIRD_PARTY_NOTICES.md` and ADR-035 also say the installed app shows its notices in a Licences screen, which does not exist.

## Overview

A person who installs Legible Cities can open Settings, find a Licences section naming the app's own licence and every bundled component, and open the notices file and the licence texts from there. Every library statically linked into the bundled Python runtime has its licence text inside the installer, taken from the same python-build-standalone release the runtime comes from, and the build fails if the shipped texts and the pinned runtime disagree.

## Decisions taken before this spec

Answered by the maintainer on 2026-09-13:

- **A Licences section in Settings**, not a new screen and not only a correction of the claim. It lists the app's licence and each bundled component and opens `THIRD_PARTY_NOTICES.md` and the licence folders from the app's resources in the platform's own viewer. Read-only.
- **Vendor the `licenses/` folder.** The python job also fetches the `full` archive of the same python-build-standalone release for each target, pinned by checksum, extracts only its licence texts and the build's own record of what it links, ships them under the runtime, and fails if they disagree.

And from the repository's rules: never write inside the app bundle; child processes and file opens from the main process only; nothing crosses the bridge inward as a path.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The texts are in the installer (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an installer for any of the three targets, **When** its resources are listed, **Then** the Python runtime carries a folder of licence texts from the pinned release's `full` archive, one per statically linked library named in that build's own metadata.
2. **Given** `vendor/pins.json` names a python-build-standalone release, **When** the python job runs, **Then** it fetches the matching `full` archive for the target, verifies it against a checksum recorded in the pins, extracts only the licence texts and the build's link metadata, and fails if a library the build links has no text or a text names a library the build does not link.
3. **Given** the pin moves to a new release, **When** the checksums are not updated, **Then** the job fails naming the archive.
4. **Given** `scripts/check-vendored.mjs` and the afterPack check, **When** a package lacks the licence texts, **Then** the build refuses it, naming them.

### User Story 2 - A person can read them (Priority: P1)

**Acceptance Scenarios**:

1. **Given** Settings, **When** it is read, **Then** a Licences section says the app is free software under GPL-3.0-or-later and lists each bundled component (the engine, LOOM, FFmpeg with x264, Python and its libraries, Electron and Chromium) with its licence, from one list the main process holds.
2. **Given** the Licences section, **When** "Open the notices" is pressed, **Then** `THIRD_PARTY_NOTICES.md` from the app's resources opens in the platform's default viewer; **When** "Show the licence texts" is pressed, **Then** the folder holding the licence texts is shown in the platform's file browser. Neither takes a path from the page.
3. **Given** a development run with nothing vendored, **When** the section is read, **Then** the buttons say the files are not bundled in development and are unavailable, rather than failing.
4. **Given** keyboard and screen reader, **When** the section is walked, **Then** it passes A6-07's sweep (names, Tab order, focus, reduced motion) and has a row in `docs/accessibility.md`.

### User Story 3 - The records tell the truth (Priority: P2)

1. `THIRD_PARTY_NOTICES.md` says where the notices are read (the Licences section, the files in the app's resources, the Release) and no longer promises a screen that does not exist; its python-build-standalone row says the texts ship.
2. A decision record amends ADR-035 (and ADR-020/038 where they describe the runtime's contents).

## Requirements _(mandatory)_

- **FR-001**: The python job MUST fetch the `full` archive for each target at the pinned release, verify a checksum recorded in `vendor/pins.json`, and extract only licence texts and link metadata into the vendored runtime.
- **FR-002**: The job MUST refuse a mismatch between the build's linked libraries and the shipped texts.
- **FR-003**: The packaged app MUST carry the texts; `check-vendored.mjs` MUST refuse a package without them.
- **FR-004**: Settings MUST gain a Licences section as in US2, with the component list held in the main process or `src/shared/`, and two bridge methods that take no argument.
- **FR-005**: Opening files MUST go through `shell.openPath` / `shell.showItemInFolder` on fixed paths under `process.resourcesPath`; nothing is written.
- **FR-006**: The section MUST be in the design system (no literals), the contrast test and `docs/DESIGN.md` 8.2 if it adds a component, and the accessibility sweep.
- **FR-007**: `THIRD_PARTY_NOTICES.md`, a decision record, `docs/ARCHITECTURE.md` and `CLAUDE.md` MUST be updated.

## Success Criteria _(mandatory)_

- **SC-001**: `vendor.yml` green on all three python targets with the texts extracted and the agreement check passing.
- **SC-002**: A packaged app from `build.yml` carries the texts, and `launch-packaged.mjs`' bundle-unchanged check still passes.
- **SC-003**: The end-to-end suite covers the Licences section in development (unavailable state) and the accessibility sweep includes it.
- **SC-004**: A person opens the notices from an installed rc build (A6-04's checklist gains a step).

## Assumptions

- python-build-standalone's `full` archives carry a `licenses/` folder and a `PYTHON.json` whose build metadata names the linked libraries and their licence files; the lane verifies this for release 20260901 on all three targets before building on it, and stops and reports if it is not so.
- The `full` archives are large; only the licence texts and metadata are kept, and the archive is deleted after extraction.
