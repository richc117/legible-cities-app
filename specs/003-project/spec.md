# Feature Specification: Project

**Feature Branch**: `A1-05-project`

**Created**: 2026-09-07

**Status**: Clarified 2026-09-07; the two questions the engine's absence forced are answered under [Clarifications](#clarifications-2026-09-07)

**Input**: Planned issue A1-05. Later features assume an object nobody had defined: the viewer loads a project's page, the style screen persists into a project, the export passes a project, and the MVP's fourth capability says style persists *per project*. Since the re-plan of 7 September, the project is also the unit of determinism (ADR-023): it carries its stored layout and its service date. This feature defines that object, the Library that lists it, and the four things a person can do to it before any engine is connected: create, open, rename, delete.

---

## Overview

A project is a named piece of work on one feed: which feed, which mode, which agency, which service day, how it is styled, and, once it has been laid out, which stored layout it shows. Everything later hangs off it. This feature gives it a home on disk under the engine's home, a record that later features extend without renaming anything, and a Library that shows the projects a person has.

The engine is not connected yet (the sidecar arrives with A1-01 and E09a), so this feature cannot ask it for anything: not the list of preset feeds, not a feed's service window, not the busiest weekday. The spec says plainly where that limit lands and leaves the two choices it forces as open questions rather than deciding them quietly.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a project and find it again (Priority: P1)

A person opens the Library, chooses to create a project, names it and says which feed it is for, and sees it appear in the Library. They quit and relaunch; the project is still there with the same name, feed and details.

**Why this priority**: It is the object every later feature needs. Without persistence there is no project to lay out, style or export.

**Independent Test**: Create a project, restart the application, read the Library.

**Acceptance Scenarios**:

1. **Given** an empty Library, **When** the person creates a project with a name and a feed, **Then** the Library shows it with that name, its feed and its service day (or "not yet chosen" where the day is not known), and the empty state is gone.
2. **Given** a project exists, **When** the application is quit and relaunched, **Then** the Library shows the same project with the same fields.
3. **Given** the person leaves the name blank or gives a feed that does not fit the expected form, **When** they confirm, **Then** the form says what is wrong in a sentence and creates nothing.
4. **Given** two projects are created with the same name, **When** the second is confirmed, **Then** both exist as distinct projects (names are labels; identity is the identifier).

---

### User Story 2 - Open, rename and delete (Priority: P1)

A person opens a project from the Library and sees its details; renames it and sees the new name everywhere; deletes it after a confirmation and sees it gone, together with its generated output, while the feed it was made from is untouched.

**Why this priority**: The lifecycle is what makes the object real rather than a record that only grows.

**Independent Test**: With one project, rename it, relaunch, confirm the name; delete it, confirm the Library is empty and the feed data still exists.

**Acceptance Scenarios**:

1. **Given** a project in the Library, **When** the person opens it, **Then** a project view shows its name, feed, mode, agency, service day, style summary and whether it has a layout yet.
2. **Given** an open project, **When** the person renames it, **Then** only the name and the modified time change; every other field is as before, and the Library shows the new name.
3. **Given** an open project, **When** the person chooses delete, **Then** a confirmation names the project and says what will be removed; confirming removes the project and its generated output, and cancelling removes nothing.
4. **Given** a project is deleted, **When** the engine's home is inspected, **Then** the project's folder and its output folder are gone and the feeds folder is untouched.

---

### User Story 3 - The project's output is served only from its own folder (Priority: P1)

The project's generated pages, when they exist, are reachable on the application origin under the project's identifier, and nothing else is: an identifier that is not a project, or a path that tries to leave the project's output folder, is refused without saying where anything lives.

**Why this priority**: The skeleton already fixed the origin and the routing; this feature makes identifiers real, so the refusals have to be tested against real projects.

**Independent Test**: Create a project, place a file in its output folder, request it; then request a traversal and an unknown identifier.

**Acceptance Scenarios**:

1. **Given** a project with a file in its output folder, **When** the file is requested on the origin under the project's identifier, **Then** it is served.
2. **Given** any request that resolves outside the project's output folder, or names an identifier that is not a project, **When** it is served, **Then** it is refused and the response contains no path.

---

### User Story 4 - The Library is usable without a mouse or with a screen reader (Priority: P2)

Every control the Library and the project view offer can be reached and operated with the keyboard alone, with a visible focus; the controls and the dialogs are labelled so a screen reader announces them; reduced motion suppresses any transition.

**Why this priority**: The constitution's sixth principle, applied to the first screens that have controls.

**Independent Test**: Tab through the Library and the project view; create, rename and delete with the keyboard only; run a screen reader over the same flow.

**Acceptance Scenarios**:

1. **Given** the Library, **When** the person navigates with the keyboard, **Then** every button, field and list entry is reachable in a sensible order with visible focus.
2. **Given** the create or delete dialog is open, **When** a screen reader reads it, **Then** its purpose, its fields and its buttons are announced, and closing it returns focus to where it came from.
3. **Given** the operating system requests reduced motion, **When** a dialog opens or a list changes, **Then** nothing animates.

---

### Edge Cases

- The engine's home does not exist yet: creating the first project creates the projects folder; the Library shows the empty state until then.
- A project folder exists but its record is missing or unreadable: the Library skips it rather than showing a broken entry, and the log says which folder.
- A project record from a later version of the application (a higher record version): the Library shows the project as read-only with a message, rather than rewriting it.
- A project record from an earlier version: read with the missing fields at their defaults, written back in the current form only when something else changes.
- The name contains characters meaningful to a file system: the name is a label only; the identifier is generated and never derived from the name.
- Two application instances: the single-instance lock makes a second one focus the first, so no two writers exist.
- Deleting a project whose output folder is missing, or whose folder is not writable: the record's removal succeeds where it can, and the person is told what could not be removed.
- A very long name, or a name of only whitespace: refused with a sentence; whitespace is trimmed before checking.

## Requirements *(mandatory)*

### Functional Requirements

**The record**

- **FR-001**: A project MUST be stored as one record in its own folder under the engine home's projects folder, named by its identifier, and MUST carry: a record version, the identifier, the name, the feed key, the mode, the agency (optional), the service day (optional until known), the style, per-line colour overrides, the default colour, the line order, the theme, the stored layout's identifier (empty until a layout exists), and the created and modified times.
- **FR-002**: The identifier MUST be generated by the application, opaque, and valid under the origin's identifier rule (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, no device names); it MUST never be derived from the name.
- **FR-003**: The record MUST be versioned so a later feature can extend it; reading an older version fills defaults, reading a newer version leaves the project read-only with a message.
- **FR-004**: Writing a record MUST be atomic from the reader's point of view: a crash mid-write leaves the previous record, not a truncated one.
- **FR-005**: Every field a later feature owns (style, colours, default colour, line order, theme, layout) MUST exist in the record from this feature on, at its default, so that feature changes a value rather than the shape.

**The Library**

- **FR-006**: The Library MUST list every readable project under the projects folder with its name, feed key and service day (or that the day is not yet chosen), sorted by modified time, newest first.
- **FR-007**: The Library MUST offer creation, with a name and a feed key. Until the engine's registry is reachable (A2-01), the key is typed and validated for form only (`^[a-z0-9][a-z0-9-]{0,63}$`), defaulting to `la-metro-rail`; the form says that the list of feeds arrives later. Nothing from the engine's registry is copied into the application.
- **FR-008**: The Library MUST open a project into a view showing its fields, and offer rename and delete from that view.
- **FR-009**: Rename MUST change only the name and the modified time.
- **FR-010**: Delete MUST ask for confirmation naming the project and what will be removed, then remove the project folder and the project's output folder, and MUST never touch the feeds folder or any other project.
- **FR-011**: The empty state from the skeleton MUST remain when no project exists, and MUST carry the create control so the first project is one step away.

**The service day**

- **FR-012**: The service day is resolved once, at the project's first layout (A3-01), when the engine is first asked about the feed; it is stored then and never re-resolved silently, because the engine's busiest-weekday rule reads today's date (ADR-023). Until then the record holds no day and the Library and the project view say "not yet chosen".

**The origin**

- **FR-013**: The project's output folder MUST be served under the origin's projects path by identifier, exactly as the skeleton specified; an unknown identifier or an escape MUST be refused without a path in the response.

**Boundary and hygiene**

- **FR-014**: The bridge MUST grow by exactly the methods this feature needs (list, get, create, rename, delete) and no more; every argument is validated on the main side.
- **FR-015**: The renderer MUST NOT know where the engine home is; it addresses projects by identifier only.
- **FR-016**: Nothing in this feature MUST start the engine, read a feed, or draw anything.
- **FR-017**: The existing checks (style, types, unit tests, the smoke test on three platforms, the hygiene scanners) MUST keep passing, and the new behaviour MUST be covered: the record store by unit tests, the lifecycle by the smoke test.

### Key Entities

- **Project**: the record above; identity is the identifier, the name is a label.
- **Library**: the list of projects the application finds under the projects folder; it has no record of its own.
- **Stored layout**: named by the project's `layout` field; produced by A3-01, never by this feature.
- **Engine home**: as defined by the skeleton; this feature adds the projects folder beneath it and, on delete, removes an output folder beneath it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person creates a project, quits and relaunches, and finds it with identical fields, in under 30 seconds end to end.
- **SC-002**: Renaming changes exactly two fields of the record and nothing else, verified by comparing the record before and after.
- **SC-003**: Deleting removes exactly the project folder and its output folder, and leaves every other folder under the engine home byte-identical.
- **SC-004**: 100% of the Library's and the project view's controls are reachable and operable by keyboard with visible focus, and the create and delete dialogs are announced by a screen reader on both target platforms (manual, recorded in the pull request).
- **SC-005**: The five checks are green on Linux, macOS and Windows, and the smoke test exercises create, list, rename, delete and the served output on every platform.
- **SC-006**: A record from a made-up future version is shown read-only, and a record with a missing optional field is read with the default, in the unit tests.

## Assumptions

- **A-001**: Identifiers are short random tokens (letters and digits), because a name-derived identifier would have to be sanitised, deduplicated and kept stable across renames, and a random one needs none of that.
- **A-002**: Mode and agency are free values validated only for form in this feature (the engine's registry, which says which are valid for a feed, arrives with E07/E08 and A2-02); the defaults are the mode `all` and no agency, which is what the engine's presets use most.
- **A-003**: Style, colours, default colour, line order and theme are stored at defaults that mirror the engine's own (`Style` in `render.py`, `#888888` as the default line colour, no overrides, no explicit order, the warm-dark theme); the values are not shown or edited here (A4-01 to A4-03).
- **A-004**: The project view is the place rename and delete live, and the Library lists; a context menu on the list is not needed for the MVP.
- **A-005**: Confirmation for delete is a dialog in the interface, not a native dialog, so it is labelled and keyboard-operable the same way on both platforms.
- **A-006**: The projects folder and each project folder are created on demand; nothing else under the engine home is created by this feature.

## Dependencies

- **D-001**: The skeleton (A0-09): the origin, the bridge, the configuration, the checks.
- **D-002**: None on the engine. The two places the engine would normally answer are the open questions below.

## Clarifications (2026-09-07)

The two questions the first draft left open, answered by the maintainer the
same day and written into FR-007 and FR-012 above.

- **Q1, naming a feed before the engine's registry is reachable**: a typed
  feed key, validated for form only, defaulting to `la-metro-rail`; the
  chooser over the real registry arrives with A2-01 (`feeds.list`). Copying
  the preset list into the application was rejected as the second
  implementation the constitution forbids; deferring creation would have
  left the feature untestable by a person.
- **Q2, when the service day is resolved**: at the project's first layout,
  when the engine is first asked about the feed; stored then, never
  re-resolved. Until then the record holds no day. Asking the person for a
  date before any calendar is known was rejected; computing the busiest
  weekday in the application was rejected as a second implementation.

---

## Constraints inherited from the constitution

| Principle or constraint | Where it lands in this spec |
| --- | --- |
| One renderer | FR-016 |
| The engine is the source of truth | Q1 and Q2 exist because of it; A-002, A-003 mirror engine defaults rather than redefining them |
| Determinism is a feature | FR-012 and the `layout` field: the project is the unit ADR-023 names |
| No network, no telemetry | Nothing here reaches the network |
| Hygiene enforced by tools | FR-017 |
| Accessible by default | User Story 4, SC-004 |
| Decisions are recorded | ADR-016 (the home), ADR-023 (the stored layout and the date) |
| Never write inside the app bundle | Everything written lives under the engine home (FR-001, FR-010) |
| `app://local` is one origin on purpose | FR-013 |
| The renderer holds no Node APIs | FR-014, FR-015 |
| Child processes | None started (FR-016) |
