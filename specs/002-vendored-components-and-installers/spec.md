# Feature Specification: Vendored components and installers

**Feature Branch**: `A0-10-vendored-components-and-installers`

**Created**: 2026-09-07

**Status**: Draft, no open questions. Split out of `specs/001-electron-skeleton/` on 2026-09-07 so the skeleton can be built and checked before any vendored component exists.

**Input**: Planned issue A0-10. The application shell (`specs/001`) opens to an empty Library from a development build. This feature makes it installable: every component the engine needs at run time — the Python runtime, the layout binaries, the media encoder, and the engine itself — is obtained from a pinned, checksummed source, laid out where the application can execute it, and packaged into installers that a build run attaches for download. Packages are unsigned; the steps for getting past each operating system's warning are published beside them.

---

## Overview

Nothing here changes what the application does. It changes where it can run: on a machine that has never seen Python, Docker, a compiler or this repository. The value is in three properties that are expensive to add later — that every shipped binary is traceable to a pin and a checksum recorded in the repository, that a build cannot silently produce an installer missing a component, and that the vendored layout is the same shape on every platform and processor family so the code that finds a binary is written once.

The decision records behind it: LOOM is built in this repository's own workflow from a pinned commit with its optional solvers disabled, and needs no bundled libraries (ADR-019); the Python runtime is a pinned python-build-standalone release verified against a checksum this repository computed (ADR-020); Windows is in the first release and its layout binaries are built from a third party's documented compatibility patches (ADR-021); the media encoder is a bundled, pinned FFmpeg (ADR-012, planned issue A0-08).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A person installs the application from a build run's output (Priority: P1)

A person downloads a macOS disk image for their processor family, or the Windows installer, from a completed build run, installs it on a machine that has none of the development tools, and launches the application. It opens to the empty Library exactly as the development build does.

**Why this priority**: It is how the application reaches the two machines it must open on, and it is the only proof that the vendored layout works end to end.

**Independent Test**: Trigger a build run, download the disk image and the installer from the completed run, install each on the corresponding clean machine, launch the application, and confirm one window with an empty Library.

**Acceptance Scenarios**:

1. **Given** a build run completes, **When** its outputs are listed, **Then** macOS disk images for both processor families and a Windows installer are downloadable from the run.
2. **Given** an installer is installed on a machine without Python, Docker or a compiler, **When** the application is launched, **Then** it opens to an empty Library with no error.
3. **Given** an installed application, **When** its bundled resources are inspected, **Then** the engine runtime, the four layout binaries and the media encoder for that platform and processor family are present and executable, and each reports its version when asked.
4. **Given** the application is installed, **When** it runs, **Then** it writes nothing inside its own installed bundle; the engine's home and any writable state live under the user's data folder (Constitution: *Never write inside the app bundle*).
5. **Given** the packages are unsigned, **When** a person installs one, **Then** the documented steps for getting past the operating system's warning are published alongside the download and are sufficient.

---

### User Story 2 - Every vendored component is pinned, verified and traceable (Priority: P1)

A maintainer can name, for every executable inside a shipped package, the exact upstream version it came from, the checksum it was verified against, and the licence it carries — by reading files in this repository, not by asking whoever ran the build.

**Why this priority**: The same priority as installing, because an installer whose contents depend on the machine that built it is not a release. The sidecar spike found a bundler collecting a GPL library from the build host that nothing imported; this story is the rule that prevents it.

**Independent Test**: Change one pin, observe the vendoring workflow rebuild or refetch only that component and fail on a checksum mismatch; then open the installed bundle and match every executable to its row in the pins file and its entry in the third-party notices.

**Acceptance Scenarios**:

1. **Given** the pins file names a component's source, version and checksum, **When** the vendoring workflow runs, **Then** it obtains exactly that version and refuses to continue if the checksum differs.
2. **Given** a pin changes, **When** the change is pushed, **Then** the vendoring workflow runs for the affected component on every target and publishes fresh artefacts keyed by the pins file's hash.
3. **Given** a vendored runtime, **When** it is inspected, **Then** it carries no GNU readline, no GDBM and no library from the build host's package manager; the workflow fails if one appears.
4. **Given** the Windows layout binaries, **When** their directory is inspected, **Then** it contains no Microsoft system library; the workflow fails if one appears.
5. **Given** the shipped package, **When** `THIRD_PARTY_NOTICES.md` is read, **Then** every bundled component has a row with its licence and the obligation it places on distribution, and the runtime's own licence files are inside it.

---

### User Story 3 - The build refuses to ship without a component (Priority: P2)

A build for a target whose vendored components are missing, stale or the wrong processor family fails with a message naming the component and the target, rather than producing an installer that opens to a Library and cannot run the engine.

**Why this priority**: A missing component is discovered in minutes by a maintainer and in weeks by a user; failing the build moves the discovery to the right place.

**Independent Test**: Remove one component's artefact for one target and trigger a build; observe the failure name the component and the target and produce no installer for it, while the other targets complete.

**Acceptance Scenarios**:

1. **Given** the artefact for one component and one target is absent, **When** the build runs, **Then** that target fails naming the component, and no installer is uploaded for it.
2. **Given** an artefact for the wrong processor family is present, **When** the build runs, **Then** it fails rather than packaging a binary that cannot execute on the target.
3. **Given** the pins file changed and the artefacts predate it, **When** the build runs, **Then** it does not package the stale artefacts.

---

### Edge Cases

- A person on macOS runs the Intel disk image on an Apple-silicon machine, or the reverse: the application either runs through translation or refuses with a clear message; it does not open a Library and then fail on the first engine call.
- The vendoring workflow's upstream publishes no checksum (python-build-standalone publishes none): the checksum in the pins file is one this repository computed on first download, and a later mismatch is treated as the asset having changed, which is the point.
- A layout binary links a library from the build host's package manager (Homebrew, MSYS2): it will not run on a clean machine, and the workflow's link check fails the build.
- The third party's Windows patches drift from the pinned commit: the build applies the documented changes to this repository's pinned tree, so drift shows as a failed patch, not a silently different binary.
- The installer is large: the runtime is about 110 MB stripped, the layout binaries a few MB, the encoder tens of MB; the download page states the size.
- The pins file is edited by hand with a typo in a checksum: the workflow fails on the first download and says which pin.

## Requirements *(mandatory)*

### Functional Requirements

**Packaging**

- **FR-001**: The build MUST produce installable packages under the fixed product name and application identifier: "Legible Cities" and `com.richardcaballero.legiblecities`.
- **FR-002**: The build MUST produce macOS disk images for both Apple-silicon and Intel processor families, and a Windows installer for 64-bit Intel-compatible processors. No Linux package is produced; Linux is a verification platform only.
- **FR-003**: The build MUST bundle, per platform and processor family, the engine's runtime, the four layout binaries, the media encoder and the engine package, placed under one directory laid out by platform and processor family where the application can find and execute them at run time.
- **FR-004**: The build MUST fail, naming the component and the target, if any vendored component for a target it is building is missing, stale relative to the pins file, or built for another processor family.
- **FR-005**: Packages are unsigned in this feature; the download page MUST carry the steps for getting past each operating system's warning. Signing and notarisation are decided at the release-readiness gate (planned issue A6-05); until then the build MUST NOT require a signing identity, and MUST accept one without a change to its layout when the gate opens.
- **FR-006**: Every bundled third-party component MUST be listed in `THIRD_PARTY_NOTICES.md` with its licence and the obligations that licence places on distribution, and the runtime's own licence files MUST ship inside the bundle.

**Vendoring**

- **FR-007**: Every vendored component MUST be named in one committed pins file with its source, its exact version (a commit, a release, or a tag), a checksum per target where the component is fetched rather than built, and its licence. The current file is `vendor/pins.json`, with blocks for the layout binaries, the Windows compatibility patches, the Python runtime, the engine and the media encoder.
- **FR-008**: A vendoring workflow MUST obtain each component from its pin on every target — building the layout binaries from the pinned commit with the optional solvers disabled, fetching the runtime and the encoder and verifying their checksums, installing the engine at its pinned tag — and MUST publish the results as artefacts keyed by the hash of the pins file.
- **FR-009**: The vendoring workflow MUST refuse a component that is not self-contained: a layout binary linking a library outside the operating system's own, a runtime carrying GNU readline or GDBM, a Windows directory containing a Microsoft system library.
- **FR-010**: The build MUST consume the vendoring workflow's artefacts for the current pins hash and MUST NOT download any component from the network itself.
- **FR-011**: Changing a pin MUST be a reviewed change with a reason, and MUST re-run the vendoring workflow for the affected component.

**Not in this feature**

- **FR-012**: The application MUST NOT start the engine, speak the sidecar protocol, run the pipeline or export anything. This feature puts the components in place; the sidecar supervisor (planned issue A1-01) is the first to run one.
- **FR-013**: No component is downloaded at first run, ever. Everything the engine needs is inside the package (ADR-011).

### Key Entities

- **Vendored component**: an executable or runtime shipped with the application — the engine's runtime, the layout binaries, the media encoder, the engine package — selected by platform and processor family, obtained from a pin, and carrying its own licence obligations.
- **Pin**: the committed record of one component's source, exact version, checksum and licence. The single place a maintainer looks to answer "what is in the box".
- **Vendor artefact**: the output of the vendoring workflow for one component and one target, keyed by the hash of the pins file so a stale artefact cannot be mistaken for a current one.
- **Target**: a platform and processor family the build produces a package for: macOS Apple-silicon, macOS Intel, Windows x64.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Installing from a build run's output and launching, on both a macOS machine and a Windows machine that have no development tools, produces one window showing an empty Library, with no error, in under 10 seconds on each. (Manual, on the two target machines.)
- **SC-002**: A build run's outputs include a macOS disk image for each processor family and a Windows installer, each downloadable by a person with access to the run, and each carrying every vendored component for its target.
- **SC-003**: The installed application writes nothing inside its own bundle across a full session, verified by comparing the bundle before and after.
- **SC-004**: 100% of executables inside a shipped package can be matched to a row in the pins file and a row in the third-party notices by a reviewer with no other information.
- **SC-005**: A build with one component removed for one target fails that target, names the component, and completes the other targets.
- **SC-006**: A checksum changed by one character in the pins file fails the vendoring workflow on the first download with a message naming the pin.
- **SC-007**: A person following only the published unsigned-install steps gets past the operating system's warning on both target machines. (Manual.)

## Assumptions

- **A-001**: The vendoring workflow and the build workflow are separate: vendoring runs when the pins file changes or on request, and the build consumes its artefacts. *Why*: vendoring takes minutes and changes rarely; building runs on every push.
- **A-002**: The vendored directory is not committed. *Why*: binaries in a git repository are a size and licensing problem; the pins file and the workflow are the reproducible thing.
- **A-003**: The layout binaries are built without their optional solvers and fed an unpacked feed directory, per ADR-019; the engine unpacks before calling them. *Why*: it is what makes them self-contained.
- **A-004**: The Windows layout binaries are built in the workflow from the documented compatibility patches applied to this repository's pinned tree, not taken prebuilt, per ADR-021. *Why*: the prebuilt directory carries Microsoft system libraries that must not be redistributed.
- **A-005**: The engine is installed at a pinned git tag, without its declared dependencies, plus the runtime dependencies it actually imports (pandas and requests), until the engine's dependency list is trimmed. *Why*: the sidecar spike found the declared list three times the size of the real one.
- **A-006**: The first Windows run of the vendoring workflow is an experiment, and the Windows target may lag the others; the build produces packages for every target whose components are present and says which are missing. *Why*: nothing has run the MSYS2 toolchain in this repository yet.

## Dependencies

- **D-001**: `specs/001-electron-skeleton/` — the shell this feature packages, and the workflow it extends.
- **D-002**: Planned spike A0-05 (layout binaries on all targets), planned spike A0-06 (the runtime on all targets), planned issue A0-08 (the pinned media encoder), and the engine tagged at a version (planned issue E11a). Each contributes one block to the pins file.
- **D-003**: The public repository mirror and its runners (planned issue A0-11): the vendoring workflow has never run, and cannot until they exist.

---

## Constraints inherited from the constitution

| Principle or constraint | Where it lands in this spec |
| --- | --- |
| One renderer | Not exercised; nothing here draws |
| The engine is the source of truth | FR-003, FR-007, A-005: the engine is installed at a pinned tag, never copied |
| Determinism is a feature | Not exercised; nothing here captures. FR-007 and FR-009 are what make a shipped layout binary the same on every install |
| No network, no telemetry | FR-010, FR-013 |
| Hygiene enforced by tools | FR-009, SC-006: the workflow refuses what a reviewer would miss |
| Accessible by default | Not exercised beyond `specs/001` |
| Decisions are recorded | ADR-011, ADR-012, ADR-019, ADR-020, ADR-021 cited above |
| Never write inside the app bundle | User Story 1 scenario 4, SC-003 |
| GPL-3.0-or-later, third parties listed | FR-006, SC-004 |
