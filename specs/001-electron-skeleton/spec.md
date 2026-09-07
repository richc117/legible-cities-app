# Feature Specification: Electron skeleton

**Feature Branch**: `main` (committed directly until this feature's CI workflow lands; branches and pull requests after)

**Created**: 2026-09-07

**Status**: Clarified 2026-09-07. The seven open questions are answered below under [Clarifications](#clarifications-2026-09-07); the installers and the vendored components moved to `specs/002-vendored-components-and-installers/` (planned issue A0-10).

**Input**: Planned issue A0-09. The desktop application has no code yet; this feature is the empty shell everything later is built inside — a window that opens, a single origin the engine's animation page can eventually be embedded from, a development loop against a local engine checkout, and an automated check on all three platforms.

---

## Overview

This feature delivers a running but nearly empty application: it starts, shows one window with a Library that has nothing in it, and quits. It draws no map, talks to no engine, and runs no pipeline. Its value is entirely in the shape it fixes — the process boundary, the origin, the vendored-binary layout, the verification that runs on every change — because each of those is expensive to change once features are built on top of it.

Two things are load-bearing beyond this feature and are therefore specified here even though nothing uses them yet: the single `app://local` origin (Constitution: *`app://local` is one origin on purpose*), and the renderer's isolation from Node (Constitution: *The renderer holds no Node APIs*). Getting either wrong is discovered much later, when the viewer refuses to be driven.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The application opens to an empty Library (Priority: P1)

A person installs or launches the application on macOS or Windows and sees a single window containing a Library area that reports, in words, that there are no projects yet. Nothing is broken, nothing is loading forever, and nothing offers an action that does not work.

**Why this priority**: It is the whole observable deliverable. Every other story exists to produce, verify or ship this one. If only this story shipped, the project would have a shell to build inside.

**Independent Test**: Launch the built application on a machine that has never run it. Observe one window, a titled Library, and an empty state. Quit from the application's own quit affordance and confirm the process ends.

**Acceptance Scenarios**:

1. **Given** a machine where the application has never been run, **When** the person launches it, **Then** exactly one window appears within a few seconds showing an empty Library and no error.
2. **Given** the application is open, **When** the person quits it, **Then** the window closes, no dialog blocks the exit, and no process belonging to the application is left running.
3. **Given** the application is open, **When** the person navigates the interface with the keyboard only, **Then** every interactive element can be reached and its focus is visible (Constitution: *Accessible by default*).
4. **Given** the application is open, **When** an assistive technology reads the window, **Then** the Library region and its empty-state message are announced with meaningful labels.
5. **Given** the operating system requests reduced motion, **When** the application shows any transition, **Then** the motion is suppressed or reduced.

---

### User Story 2 - The interface and generated project pages share one origin (Priority: P1)

The interface is served from a custom application origin rather than from files on disk, and generated project output is served from that same origin under a different path. Nothing in this feature displays a project page yet; the routing exists so that when the engine's animation page arrives, it is same-origin with the interface and can be driven through its published interface.

**Why this priority**: Same priority as the window itself because it cannot be retrofitted cheaply. A shell that serves its interface from a file path or a second origin has to be rebuilt, not adjusted, when the viewer lands. This is a named constraint in the constitution.

**Independent Test**: With the application running, request an interface asset and a project asset from the application origin and confirm both are served, that the interface origin and the project origin are identical, and that a request for a path outside a project's own output directory is refused.

**Acceptance Scenarios**:

1. **Given** the application is running from a build, **When** the interface loads, **Then** its document origin is the custom application origin, not a file path.
2. **Given** a project output directory exists on disk with an identifier, **When** an asset under that project's path on the application origin is requested, **Then** the file is returned with a content type the browser engine honours.
3. **Given** a request for a project asset whose path attempts to escape the project's output directory (for example by traversal segments or an absolute path), **When** it is served, **Then** it is refused and nothing outside the engine's home directory is disclosed.
4. **Given** a request for a project identifier that does not exist, **When** it is served, **Then** the request fails cleanly rather than crashing the application or leaking the location of the engine's home.
5. **Given** the application is running, **When** the interface's privileges are inspected, **Then** the renderer has no direct access to the file system, the process, or module loading; every capability it has arrives through a narrow declared bridge.

---

### User Story 3 - A developer runs the application against a local engine checkout (Priority: P2)

A developer with the engine checked out beside this repository starts the application in development mode with one command. It reads its pointers — where the engine's home lives, where the layout binary is, where the media encoder is — from a local, uncommitted configuration file. Interface changes appear without a restart.

**Why this priority**: It is the daily loop for every subsequent feature, and it is the thing that makes the vendored-binary layout real before there are installers. It is below P1 only because a build can be produced without it.

**Independent Test**: On a machine with an engine checkout and a local configuration file, run the development command and confirm the application opens, that it reports the three configured locations, and that editing an interface file updates the running window without a restart.

**Acceptance Scenarios**:

1. **Given** a local configuration file naming the engine home, the layout binary and the media encoder, **When** the developer starts development mode, **Then** the application launches and those three values are visible in its log.
2. **Given** development mode is running, **When** an interface source file is saved, **Then** the running window reflects the change without being restarted by hand.
3. **Given** no local configuration file exists, **When** the developer starts development mode, **Then** the application either starts with documented defaults or fails with a message naming the file to create and the values it needs — never with an unexplained crash.
4. **Given** a checkout of this repository, **When** its tracked files are inspected, **Then** the local configuration file is absent and ignored, and no machine path, personal address or private hostname appears anywhere (Constitution: *Hygiene is enforced by tools, not attention*).

---

### User Story 4 - Every change is checked automatically on all three platforms (Priority: P2)

A change pushed to the repository is checked without anyone remembering to run anything: style, types, unit tests, and one end-to-end test that launches the real application, confirms its window, and quits it — on Linux, macOS and Windows.

**Why this priority**: The constitution's fifth principle applied to correctness rather than secrets. It is also the gate that ends direct commits to the main branch, so it unblocks the project's stated workflow.

**Independent Test**: Push a change and observe the check run to completion on all three operating systems. Then push a change that breaks types, or the window title, and observe the corresponding check fail.

**Acceptance Scenarios**:

1. **Given** a change is pushed, **When** the checks run, **Then** style, type and unit checks and the end-to-end smoke test all complete on Linux, macOS and Windows.
2. **Given** the smoke test runs, **When** it executes, **Then** it launches the packaged or built application, asserts the window's title, quits the application, and reports a failure if the process does not exit.
3. **Given** a change that introduces a type error, **When** the checks run, **Then** they fail and name the file and line.
4. **Given** the checks pass, **When** a reviewer reads the run, **Then** the result distinguishes which platform each result came from.
5. **Given** the checks exist, **When** the repository's protection settings are applied, **Then** they can be required before merge (recorded in the repository settings checklist, applied when the public mirror exists).

---

### User Story 5 - moved

Installers and the vendored components they carry are specified in `specs/002-vendored-components-and-installers/spec.md` (planned issue A0-10), so that this feature can be built and checked before any vendored component exists. The "no outbound request" scenario stays here as FR-034 and SC-006, because a development build must satisfy it too.

---

### Edge Cases

- A second launch while the application is already running: the application holds a single-instance lock and the second launch focuses the existing window (FR-035), which is the platform convention on both targets.
- The engine home directory does not exist, or exists and is not writable: the application must still open to an empty Library and report the problem, not fail to start.
- The engine home contains an output directory with no recognisable project inside it: the Library stays empty rather than showing a broken entry.
- A project identifier containing characters that are meaningful to a file system (separators, traversal segments, a leading dot, a drive letter, a URL-encoded separator): served as a path component it must be rejected, not resolved.
- Windows and macOS disagree about path separators and case sensitivity: a project path that resolves on one must not resolve differently on the other.
- The end-to-end smoke test on the Linux runner has no display server: the check must provide one rather than being skipped, or the platform's coverage is a fiction.
- The window is resized very small, or the display's scale factor is unusual: the Library's empty state stays legible and its controls stay reachable.

## Requirements *(mandatory)*

### Functional Requirements

**The window and the Library**

- **FR-001**: The application MUST open exactly one window on launch, containing a Library area.
- **FR-002**: The Library MUST show an explicit empty state when no projects exist — a message a person can read, not a blank area.
- **FR-003**: The window MUST have a stable, asserted title so an automated test can identify it. The title is `Legible Cities`, constant in this feature; if a later feature appends the open project's name, the test is updated in the same change.
- **FR-004**: The application MUST quit cleanly: window closed, no orphaned child process, no blocking dialog.
- **FR-005**: The interface MUST be operable by keyboard alone, with visible focus, labelled controls, and contrast that holds in every theme it offers.
- **FR-006**: The interface MUST respect the operating system's reduced-motion preference in anything that animates.
- **FR-007**: The interface MUST take its colours, type and spacing from declared design tokens rather than values written at each use site. The colours are a committed stylesheet copied from the engine's animation page at the pinned engine version — both of its theme blocks, warm-dark and sepia; type and spacing, which the engine's blocks do not define, are a small token set the interface declares once. A unit test MUST fail when the colour copy differs from the engine's page. Until the engine is vendored at a pinned tag (A0-06, E11a), the test compares against the checkout named by configuration and skips, saying so, where none is configured; the pinned form activates with the pin.

**The single origin**

- **FR-008**: The application MUST register one custom origin, treated by the browser engine as a secure, privileged origin, and serve both the interface and generated project output from it.
- **FR-009**: The interface MUST be served from the interface path of that origin — from the built assets in a packaged application, and from the development server in development mode — with no difference in origin between the two.
- **FR-010**: Generated project output MUST be served from the projects path of that origin, mapping a project identifier to that project's own output directory beneath the engine's home.
- **FR-011**: The application MUST refuse any request whose resolved target lies outside the addressed project's output directory, including traversal segments, absolute paths, encoded separators and symbolic links that point outward.
- **FR-012**: The application MUST serve project assets with content types the browser engine honours, and MUST fail cleanly — no crash, no disclosure of absolute paths — for a missing project or a missing file.
- **FR-013**: The application MUST NOT expose any second origin or file-path origin for the interface.

**Process boundary**

- **FR-014**: The interface process MUST run with context isolation on, Node integration off and the sandbox on, and MUST reach every privileged capability through a narrow, explicitly declared bridge.
- **FR-015**: The bridge MUST expose only what this feature needs; each later addition to it is a reviewed change, not an open surface.
- **FR-016**: The application MUST write nothing inside its own installed bundle. The engine's home defaults to a location under the user's data folder, overridable by configuration.

**Configuration and the development loop**

- **FR-017**: The application MUST read three locations — the engine's home, the layout binary, the media encoder — from configuration, with the local development file uncommitted and ignored by version control.
- **FR-018**: The application MUST record the three resolved locations in its log at startup, so a misconfigured run is diagnosable without a debugger.
- **FR-019**: The application MUST start with documented defaults when configuration is absent — the engine home under the user's data folder, the layout binary and the media encoder unset — and MUST log prominently which values are unset and the name of the file that would set them. It never refuses to start over configuration in this feature, because nothing in it uses the two binaries.
- **FR-020**: One documented command MUST start the application in development mode with interface changes applied to the running window without a manual restart.

**Packaging**

- **FR-021** to **FR-026**: moved to `specs/002-vendored-components-and-installers/spec.md`. The numbers are left unassigned here so references in either document stay stable. The product name and application identifier they fix — "Legible Cities" and `com.richardcaballero.legiblecities` — are also the values FR-003 and the development build use.

**Verification**

- **FR-027**: An automated check MUST run style, type and unit checks and one end-to-end smoke test on Linux, macOS and Windows for every change.
- **FR-028**: The smoke test MUST launch the real application, assert the window title, quit it, and fail if the process does not exit.
- **FR-029**: moved to `specs/002-vendored-components-and-installers/spec.md`.
- **FR-030**: The checks MUST be nameable as required status checks so direct pushes to the main branch can be refused once they exist. When the check exists, the repository's branch protection is applied from `docs/repository-settings.md` and `CONTRIBUTING.md` flips from direct commits to pull requests in the same change.
- **FR-031**: The existing hygiene checks MUST keep passing over the new files: no machine paths, no personal addresses, no private hostnames, no keys, no links to tool sessions.

**Not in this feature**

- **FR-032**: The application MUST NOT draw a map, a line, a station or any transit geometry — now or ever (Constitution: *One renderer*). This feature draws no visualisation of any kind.
- **FR-033**: The application MUST NOT start the engine, speak the sidecar protocol, run the pipeline or export anything. Those are later features; this one only makes the place they will live.
- **FR-034**: The application MUST make no outbound network request during normal operation.
- **FR-035**: The application MUST hold a single-instance lock; a second launch while it is running focuses the existing window and opens nothing.

### Key Entities

- **Project**: a piece of generated engine output identified by an opaque identifier, living in its own directory beneath the engine's home output folder. This feature never creates one; it only defines how one is addressed and served. The identifier's permitted character set is fixed by the feature that creates projects (planned issue A1-05); FR-011 treats it as untrusted input regardless.
- **Library**: the list of projects the application knows about. In this feature it is always empty; its only behaviour is its empty state.
- **Engine home**: the writable directory the engine owns, holding the output folder among other things. Configured, defaulting under the user's data folder, never inside the application bundle.
- **Application origin**: the single custom origin from which both the interface and project output are served, with one path prefix for each.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Launching a development build on both a macOS machine and a Windows machine produces one window showing an empty Library, with no error, in under 10 seconds on each. (Manual, on the two target machines; the same outcome from an installed package is `specs/002`'s SC-001.)
- **SC-002**: The automated checks complete green on Linux, macOS and Windows for a change, and the run's log distinguishes which platform each result came from.
- **SC-003**: The end-to-end smoke test launches the application, finds the window title and quits it within 60 seconds on every platform, and fails — rather than hanging or passing — when the title is changed or the process does not exit.
- **SC-004**: 100% of interactive elements in the window are reachable and operable by keyboard with visible focus, and the empty state is announced by a screen reader on both target platforms. (Manual check with the platform's own screen reader, recorded in the pull request.)
- **SC-005**: A request from the interface for a project asset outside its project's directory is refused in 100% of the traversal, absolute-path, encoded-separator and outward-symlink cases the test suite covers, on every platform.
- **SC-006**: A full launch-and-quit session produces zero outbound network requests, observed on a machine with network monitoring.
- **SC-007**: A developer with the engine checked out beside this repository, following only the committed documentation, reaches a running window in under 10 minutes on a machine that has never built this project.
- **SC-008**: The hygiene checks pass over every file this feature adds, and a reviewer reading the tracked files finds no machine path, personal address, private hostname, key or tool-session link.
- **SC-009**: A development build writes nothing beside its own source or build output across a full session; everything it writes lands under the user's data folder or the configured engine home. (The installed-bundle form of this outcome is `specs/002`'s SC-003.)

## Assumptions

Decisions taken here because the issue is silent and a reasonable default exists. Each says why.

- **A-001**: The window's Library is the only surface in this feature. No menu structure beyond the platform's default, no preferences window, no about box. *Why*: the issue's acceptance criterion is "opens to an empty Library"; anything more is a later feature and a later spec.
- **A-002**: The engine's home defaults to a directory under the operating system's per-user application data folder for this application, and the configured value overrides it. *Why*: the constitution names the user-data folder and forbids writing in the bundle; ADR-016 records it.
- **A-003**: "The site's design tokens" means one committed stylesheet of custom properties, consumed by every component. This feature ships the file and the mechanism; the values are the engine page's, copied and tested against the pin (FR-007). *Why*: the mechanism is what the skeleton must fix; the values can change with the engine pin without changing the shape.
- **A-004**: Project identifiers are treated as untrusted input from an external process even though the engine produces them. *Why*: a path served from a privileged origin is a path-traversal surface, and the cost of validating is near zero.
- **A-005**: The Linux runner in the automated checks is a verification platform, not a shipping target. *Why*: the issue lists Linux under checks and omits it from installer targets, and the project's vision names Linux as unsupported; the answer is recorded under Clarifications.
- **A-006**: The end-to-end smoke test drives a build of the application rather than an installed package. *Why*: installing a package inside a check run is slow and platform-specific; the installers are exercised by a person on the two target machines instead (SC-001).
- **A-007**: A theme is offered — at least following the operating system's light and dark preference — because the constitution requires contrast that holds "in every theme". *Why*: it is cheaper to define tokens for both at the start than to add a second theme to values already written.
- **A-008**: Unit checks exist in this feature only to prove the test runner works and to cover the path-resolution rules in FR-011. *Why*: there is almost no logic yet; a test suite with nothing in it rots, and path resolution is the one piece with real edge cases.
- **A-009**: Documentation added by this feature lists any new commands in the README and the contributing guide. *Why*: they are the two places a person looks.

## Dependencies

- **D-001**: An engine checkout beside this repository, for the development loop (User Story 3). Its location is a personal setting and is never committed.
- **D-002**: None of the vendored components. This feature needs no engine runtime, layout binary or media encoder; they arrive with `specs/002`, which depends on this feature rather than the reverse.
- **D-003**: A public repository mirror with its protection settings applied, for FR-030 to have anything to protect. Until it exists, FR-030 is satisfied by the checks being nameable, and the setting itself stays in the repository settings checklist.
- **D-004**: The decision records the constitution cites for the origin and the engine home must exist publicly before or with this feature, so a reader of this repository can follow the reasoning.

## Clarifications (2026-09-07)

The seven questions the first draft left open, answered during the re-plan of 7 September 2026 and written into the requirements above. Recorded here so the reasoning is not lost.

- **Q1, the window title**: `Legible Cities`, constant in this feature (FR-003). A later feature may append the open project's name and updates the smoke test in the same change.
- **Q2, the design tokens**: copied from the engine's animation page at the pinned engine version — both theme blocks, warm-dark and sepia — into one committed stylesheet, with a unit test that fails when the copy differs from the pinned page (FR-007). Copying keeps the engine the source of truth without a new engine capability on the critical path; a single token file published by the engine is on the backlog.
- **Q3, absent configuration**: documented defaults and a prominent log line naming what is unset and the file that would set it (FR-019). Nothing in this feature uses the two binaries, so refusing to start would stop a person who only wants to see the window.
- **Q4, Linux**: a verification platform only; no Linux package is published (A-005, and `specs/002`).
- **Q5, where vendored components come from**: answered in `specs/002` — a vendoring workflow builds or fetches each component from `vendor/pins.json`, verifies the recorded checksum, and publishes artefacts keyed by the hash of the pins file; the build consumes those artefacts and fails if one is missing.
- **Q6, a second launch**: a single-instance lock; the second launch focuses the existing window (FR-035).
- **Q7, signing**: unsigned, with documented steps for each operating system's warning, until the release-readiness decision gate (planned issue A6-05) records otherwise (`specs/002`).

---

## Constraints inherited from the constitution

Not requirements this feature invents — requirements it is measured against, listed so a reviewer can check them without leaving the document.

| Principle or constraint | Where it lands in this spec |
| --- | --- |
| One renderer | FR-032 |
| The engine is the source of truth | FR-033 — this feature adds no engine logic at all |
| Determinism is a feature | Not exercised; nothing is captured or exported yet |
| No network, no telemetry | FR-034, SC-006 |
| Hygiene enforced by tools | FR-031, SC-008 |
| Accessible by default | FR-005, FR-006, SC-004 |
| Decisions are recorded | D-004; the answers under Clarifications cite their records where one exists |
| Never write inside the app bundle | FR-016, SC-009; the installed form in `specs/002` |
| `app://local` is one origin on purpose | FR-008 to FR-013, SC-005 |
| The renderer holds no Node APIs | FR-014, FR-015 |
| Child processes get argument arrays, hidden windows, timeouts | Not exercised; this feature starts no child process |
| GPL-3.0-or-later, third parties listed | Nothing bundled here; `specs/002` FR-006 |
