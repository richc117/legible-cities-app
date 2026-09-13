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

Taken on 2026-09-13 while building, by the coordinator, after the research in `research.md` found the metadata incomplete:

- **Reviewed lists beside the metadata.** The build metadata is held to three lists per target in `vendor/pins.json` (`unlisted`, `named_absent`, `not_linked`), and the check fails whenever the metadata, the folder and the lists disagree; a new python-build-standalone release failing until the lists are reread is the intended cost. The three Windows libraries the metadata does not name are proved present by strings in their DLLs on every run.
- **CPython's incorporated software.** CPython's `Doc/license.rst` at the pinned version's tag ships beside the texts, fetched by commit and pinned by sha256.
- **zstd on the runners** is checked for, with an error naming the runner.
- **Electron's and Chromium's licences.** electron-builder deletes `LICENSES.chromium.html` and Electron's `LICENSE` from a Mac app; the Mac app carries them in its resources, the packaging check refuses an app on either system without them, and the Licences section opens Chromium's. Nothing about Electron's own FFmpeg library, which is issue 109.

And from the repository's rules: never write inside the app bundle; child processes and file opens from the main process only; nothing crosses the bridge inward as a path.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The texts are in the installer (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an installer for any of the three targets, **When** its resources are listed, **Then** the Python runtime carries a folder of licence texts from the pinned release's `full` archive, one per statically linked library named in that build's own metadata.
2. **Given** `vendor/pins.json` names a python-build-standalone release, **When** the python job runs, **Then** it fetches the matching `full` archive for the target, verifies it against a checksum recorded in the pins, extracts only `licenses/` and `PYTHON.json`, adds CPython's `Doc/license.rst` checked against its pinned sha256, and fails, naming the text, if: the metadata is not for the pinned version and target; a text the metadata names is neither carried nor listed as `named_absent`; a text carried is not named by the metadata, `unlisted` or `not_linked`, or is on more than one of them; a `named_absent` entry is carried or no longer named; an `unlisted` or `not_linked` entry is named now or not carried; or an `unlisted` entry's file no longer contains the strings that proved the library is compiled into it.
3. **Given** the pin moves to a new release, **When** the checksums are not updated, **Then** the job fails naming the archive.
4. **Given** `scripts/check-vendored.mjs` and the afterPack check, **When** a package lacks the licence texts, **Then** the build refuses it, naming them.

### User Story 2 - A person can read them (Priority: P1)

**Acceptance Scenarios**:

1. **Given** Settings, **When** it is read, **Then** a Licences section says the app is free software under GPL-3.0-or-later and lists each bundled component (the engine, LOOM, FFmpeg with x264, Python and its libraries, Electron and Chromium) with its licence, from one list the main process holds.
2. **Given** the Licences section, **When** "Open the notices" is pressed, **Then** `THIRD_PARTY_NOTICES.md` from the app's resources opens in the platform's default viewer (or, where none takes a Markdown file, is shown in the file browser); **When** "Show the licence texts" is pressed, **Then** the folder holding the licence texts is shown in the platform's file browser; **When** "Open Chromium's licences" is pressed, **Then** `LICENSES.chromium.html` opens in the platform's browser. None takes a path from the page.
3. **Given** a development run with nothing vendored, **When** the section is read, **Then** the buttons say the files are not bundled in development and are unavailable, rather than failing.
4. **Given** keyboard and screen reader, **When** the section is walked, **Then** it passes A6-07's sweep (names, Tab order, focus, reduced motion) and has a row in `docs/accessibility.md`.

### User Story 3 - The records tell the truth (Priority: P2)

1. `THIRD_PARTY_NOTICES.md` says where the notices are read (the Licences section, the files in the app's resources, the Release) and no longer promises a screen that does not exist; its python-build-standalone row says the texts ship.
2. A decision record amends ADR-035 (and ADR-020/038 where they describe the runtime's contents).

## Requirements _(mandatory)_

- **FR-001**: The python job MUST fetch the `full` archive for each target at the pinned release, verify a checksum recorded in `vendor/pins.json`, and extract only licence texts and link metadata into the vendored runtime.
- **FR-002**: The job MUST refuse any disagreement between the build metadata's licence paths, the shipped folder and the three reviewed lists per target in `vendor/pins.json`, as US1 scenario 2 enumerates, and MUST look for each `unlisted` entry's strings in its file on every run; a new release MUST fail until the lists are reread.
- **FR-003**: The packaged app MUST carry the texts; `check-vendored.mjs` MUST refuse a package without them.
- **FR-004**: Settings MUST gain a Licences section as in US2, with the component list held in the main process or `src/shared/`, and bridge methods that take no argument: one to read what can be opened and one per opening (three, since Chromium's licences were added).
- **FR-005**: Opening files MUST go through `shell.openPath` / `shell.showItemInFolder` on fixed paths under `process.resourcesPath`; nothing is written.
- **FR-006**: The section MUST be in the design system (no literals), the contrast test and `docs/DESIGN.md` 8.2 if it adds a component, and the accessibility sweep.
- **FR-007**: `THIRD_PARTY_NOTICES.md`, a decision record, `docs/ARCHITECTURE.md` and `CLAUDE.md` MUST be updated.
- **FR-008**: A packaged app MUST carry Electron's `LICENSE` and `LICENSES.chromium.html` (beside the executable on Windows, in the resources on a Mac), and the afterPack check MUST refuse one without them.

## Success Criteria _(mandatory)_

- **SC-001**: `vendor.yml` green on all three python targets with the texts extracted and the agreement check passing.
- **SC-002**: A packaged app from `build.yml` carries the texts, and `launch-packaged.mjs`' bundle-unchanged check still passes.
- **SC-003**: The end-to-end suite covers the Licences section in development (unavailable state) and the accessibility sweep includes it.
- **SC-004**: A person opens the notices from an installed rc build (A6-04's checklist gains a step).

## Assumptions

- python-build-standalone's `full` archives carry a `licenses/` folder and a `PYTHON.json` whose build metadata names the linked libraries and their licence files; the lane verifies this for release 20260901 on all three targets before building on it, and stops and reports if it is not so.
- The `full` archives are large; only the licence texts and metadata are kept, and the archive is deleted after extraction.
