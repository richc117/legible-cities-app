# Feature Specification: A release on a tag, and the install document

**Feature Branch**: `A6-01-release-on-a-tag`

**Created**: 2026-09-13

**Status**: Draft

**Input**: Planned issue A6-01 (#34), "Installers from CI on a tag, and
unsigned install instructions for both OSes". `build.yml` already builds a
dmg for each Mac and an nsis installer for Windows in one run from that
run's vendor artefacts, launches each packaged app and verifies the Mac
signature (A0-10, ADR-035). Nothing turns a run into a Release, nothing
attaches the Corresponding Source the GPL components require, and nothing
tells a person how to open an unsigned app.

## Overview

The maintainer bumps the version, merges, and pushes `v0.1.0`. The
installer build runs on the tag; when all three installers are built and
checked, a last job drafts a GitHub Release named for the tag carrying the
three installers, a checksum file, and the source archives for every GPL
component the installers carry, with notes from a fixed template. The
maintainer reads the draft and publishes it by hand. A person downloading
it follows `docs/install.md` to install, open past Gatekeeper or
SmartScreen, find what the app writes, and uninstall.

## Decisions taken before this spec

Answered by the maintainer:

- **The first release is `v0.1.0`, and the tag must match.** This change
  sets `package.json`'s version to `0.1.0`; the release job refuses a tag
  whose version is not `package.json`'s, before anything is drafted.
  (2026-09-13)
- **The notes are a fixed template**, written by the workflow: which file
  is for which machine, the link to the install document, the unsigned
  warning, the pinned engine, LOOM and FFmpeg versions, and what each
  source archive is. The maintainer edits the draft before publishing.
  (2026-09-13)
- **The GPL sources attach to the Release in this issue** (2026-09-12), and
  the FFmpeg source is the `ffmpeg-source` artefact issue 95's job uploads.
- **A release-candidate tag drafts a prerelease.** A tag `vX.Y.Z-rc.N`
  whose `X.Y.Z` is `package.json`'s version is accepted, and its draft is
  marked as a prerelease, so the release can be rehearsed end to end and
  the draft and tag deleted after. A final tag `vX.Y.Z` must equal the
  version exactly. (2026-09-13)
- **Unsigned** until A6-05: the Mac app is signed ad hoc, the Windows
  installer not at all.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A tag drafts a Release (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `package.json` at `0.1.0`, **When** `v0.1.0` is pushed,
   **Then** `build.yml` runs on the tag and, after the three packaging jobs
   succeed, a draft Release named `Legible Cities 0.1.0` exists for the tag
   with: the arm64 dmg, the x64 dmg, the Windows installer, `SHA256SUMS.txt`
   over every attached file, and the source archives (US3).
2. **Given** `package.json` at `0.1.0`, **When** `v0.1.0-rc.1` is pushed,
   **Then** the same draft is made, marked as a prerelease and named
   `Legible Cities 0.1.0-rc.1`.
3. **Given** a tag `v0.1.1` while `package.json` says `0.1.0`, **When** it is
   pushed, **Then** the release job fails first, naming both versions, and
   no Release is drafted.
4. **Given** any packaging job fails on the tag, **When** the run ends,
   **Then** no Release is drafted: a Release has all three installers or
   does not exist.
5. **Given** a draft for the tag already exists (a rerun), **When** the job
   runs again, **Then** it replaces the draft's assets rather than failing
   or making a second draft; a published Release for the tag is never
   touched, and the job fails saying so.
6. **Given** a push to a branch or a pull request, **When** `build.yml`
   runs, **Then** nothing is drafted and no job holds `contents: write`.

### User Story 2 - The install document (Priority: P1)

A person on a Mac downloads the dmg for their chip, drags the app to
Applications, is told it cannot be opened, and follows the document to
System Settings › Privacy & Security › Open Anyway. On Windows they pass
SmartScreen through "More info" › "Run anyway".

**Acceptance Scenarios**:

1. **Given** `docs/install.md`, **When** read, **Then** it says: which file
   to download for Apple silicon, Intel and Windows (and how to tell which
   Mac you have); the system requirements; the macOS steps for macOS 15
   and later and the older Control-click › Open route; the Windows
   SmartScreen steps; what the app writes and where on each OS (the
   user-data folder, the engine's home and its size in Settings, the
   logs, the exports on the Desktop by default); how to uninstall
   completely on each OS, including those folders and "Reset engine data";
   and where to report a problem, with "Copy diagnostics".
2. **Given** the README, **When** read, **Then** it links the install
   document near its top.
3. **Given** the first-run check's dialog (A6-02), **When** "How to
   install" is pressed, **Then** the address it opens is this document.
4. **Given** a fresh Mac and the Windows PC, **When** a person follows only
   the document with the Release's assets, **Then** the app installs,
   opens and lays out a feed (the issue's criterion; a person's, after the
   tag, with A6-04).

### User Story 3 - The Corresponding Source travels with the binaries (Priority: P1)

**Acceptance Scenarios**:

1. **Given** the draft Release, **When** its assets are listed, **Then**
   they include: the `ffmpeg-source` archive from this run's vendor job
   (FFmpeg and x264 sources and the configure lines, issue 95); a LOOM
   source archive at the pinned commit with `scripts/loom-windows-patch.py`
   and the Windows port's files at their pinned commit; and the engine's
   source at the pinned tag. The app's own source is GitHub's tag archive.
2. **Given** `THIRD_PARTY_NOTICES.md`'s "Obligations we take on", **When**
   read after this change, **Then** it states what each Release attaches,
   and no longer says A6-01 will.
3. **Given** the source archives, **When** built, **Then** each is fetched
   from the pins, checked against a recorded hash where the pins record
   one, and named with its version or commit.

### Edge Cases

- A tag pushed from a commit that is not on `main`: the job refuses; a
  Release is made only from `main`'s history.
- A tag moved or deleted while its build runs: that run's release job
  refuses, because the tag no longer names the commit it built, and the run
  for the tag's new commit drafts the Release.
- A tag without the `v` prefix does not start the build. A tag with it
  that is not `v<X.Y.Z>` or `v<X.Y.Z>-rc.<N>` (`v1`, `v0.1.0-beta`) builds
  the installers, and the release job refuses it at its first step, naming
  the reason; no Release is drafted (FR-003).
- The release job needs `contents: write`; it is the only job that has it,
  and only on a tag.

## Requirements _(mandatory)_

- **FR-001**: `build.yml` MUST run on a pushed tag matching `v*`, whatever
  the path filter says for branches.
- **FR-002**: A release job MUST run only on a tag, only after every
  packaging job succeeded, with `contents: write` granted to that job
  alone.
- **FR-003**: It MUST refuse a tag that is neither `v<version>` nor
  `v<version>-rc.<N>` for `package.json`'s version, or whose commit is not reachable from `main`.
- **FR-004**: It MUST create or update a **draft** Release for the tag and
  never publish one; an `-rc.N` tag's draft MUST be marked a prerelease.
- **FR-005**: The assets MUST be the three installers, `SHA256SUMS.txt`, and
  the source archives of US3.
- **FR-006**: The notes MUST come from a template committed in the
  repository, filled from `vendor/pins.json` and the tag.
- **FR-007**: `package.json`'s version MUST be `0.1.0`.
- **FR-008**: `docs/install.md` MUST cover US2's list, and the README MUST
  link it.
- **FR-009**: `THIRD_PARTY_NOTICES.md` MUST describe what a Release
  attaches.

## Success Criteria _(mandatory)_

- **SC-001**: A rehearsal tag `v0.1.0-rc.1`, pushed with the maintainer's
  go-ahead after this merges, drafts a prerelease with every asset; the
  draft and the tag are deleted after.
- **SC-002**: The mismatch and failed-package cases are proven by the
  job's own unit-tested script, not by pushing bad tags.
- **SC-003**: The maintainer installs from the draft on a machine that
  never had the checkout, following only `docs/install.md` (A6-04).

## Assumptions

- Issue 95 has merged and its `ffmpeg-source` artefact exists in the same
  run through `vendor.yml`'s `workflow_call`.
