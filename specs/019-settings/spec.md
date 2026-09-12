# Feature Specification: Settings

**Feature Branch**: `A1-04-settings`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A1-04 (#17). Two folders have been decided by the
environment and nothing else since A1-05: the engine's home
(`SCHEMATIC_HOME`, else `<userData>/engine`) and the export folder
(`LEGIBLE_EXPORT_FOLDER`, else a `Legible Cities` folder on the desktop -
"until Settings exist", which is this issue, `.claude/rules/main.md` and
ADR-016). The interface's theme has followed the operating system since
A2-00 with no way to say otherwise. The engine reports its own versions
over `engine.info` and nothing shows them.

## Overview

A screen where a person sees and changes what the app decides for itself:
where the engine keeps its data and how much of it there is, where exports
go, which theme the interface wears, what versions are actually running,
where the logs are, and - behind a confirmation that says what goes - how
to throw the engine's data away and start again.

Settings are one small file under the user-data folder, written the way a
project record is (a temporary file renamed over the old one) and read
defensively: a half-written or hand-edited file falls back to the defaults
rather than stopping the app. The environment still wins over both, because
the end-to-end suite and the development loop steer the app with it; a
folder the environment names is shown with its source and cannot be changed
here.

The rules this leans on: a folder is chosen in a native dialog the main
process opens, one of the two things only the operating system can do, and
the page never hands the main process a path (`.claude/rules/main.md`, and
the discipline A2-01 established for feeds). Everything the app has to say
is said in the page's own `<dialog>`. Nothing is written inside the app
bundle.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See where everything is, and how much of it there is (Priority: P1)

A person opens Settings from the header and reads, in one column: the
engine's data folder and its size, the export folder, where each came from,
and the versions the engine reports.

**Acceptance Scenarios**:

1. **Given** a fresh profile, **When** Settings opens, **Then** the engine
   data folder reads as the default under the user-data folder and the
   export folder as `Legible Cities` on the desktop, each saying it is the
   default.
2. **Given** an engine home with files in it, **When** Settings opens,
   **Then** its size is measured and shown as a size and a count of files;
   a folder that is not there yet reads as empty rather than as an error.
3. **Given** the engine ready, **When** Settings opens, **Then** the engine
   version, the protocol, the Python version, the LOOM backend and commit
   and the ffmpeg the engine would run are listed as `engine.info` answered
   them; a field the engine reports as null says so in words rather than
   showing an empty row.
4. **Given** the engine not ready, **When** Settings opens, **Then** the
   versions block says the engine is not running and the rest of the screen
   still works.
5. **Given** `SCHEMATIC_HOME` or `LEGIBLE_EXPORT_FOLDER` in the
   environment, **When** Settings opens, **Then** that folder says it comes
   from the environment and offers no way to change it here.

### User Story 2 - Choose where things are kept (Priority: P1)

A person changes the export folder, and the next export goes there. They
change the engine's data folder and are told plainly that the app has to
start again before it takes effect.

**Acceptance Scenarios**:

1. **Given** the export folder at its default, **When** "Choose folder" is
   pressed and a folder chosen in the platform's dialog, **Then** the screen
   shows the new folder as chosen, the file survives a restart, and the next
   export is written there.
2. **Given** a chosen export folder, **When** "Use the default" is pressed,
   **Then** the folder returns to `Legible Cities` on the desktop and the
   stored setting is cleared.
3. **Given** the engine data folder at its default, **When** another folder
   is chosen, **Then** the screen shows the folder in use, names the chosen
   one as waiting, and says the app must start again; after a restart the
   chosen folder is the one in use and the one the engine was given.
4. **Given** a page that asks the main process to set a folder it made up,
   **When** it asks, **Then** the main process refuses: only a path its own
   dialog answered, and not yet spent, is accepted.
5. **Given** the chooser cancelled, **When** it closes, **Then** nothing
   changes and the screen says nothing.

### User Story 3 - Choose the interface's theme (Priority: P2)

A person picks the interface's theme: whatever the system says, or one of
the engine's two by name.

**Acceptance Scenarios**:

1. **Given** the theme control, **When** "Sepia" is chosen, **Then** the
   interface changes at once and is still sepia after a restart.
2. **Given** the theme at "System", **When** the operating system's
   preference changes, **Then** the interface follows it.
3. **Given** the theme control, **When** reached by keyboard, **Then** it is
   labelled, focusable and operable without a mouse.

### User Story 4 - Start the engine's data again (Priority: P2)

A person whose engine data has gone wrong - a half-downloaded feed, a
layout that will not read - throws it away, having been told exactly what
goes with it.

**Acceptance Scenarios**:

1. **Given** an engine home with projects, feeds and layouts, **When**
   "Reset engine data" is pressed, **Then** a confirmation names what goes -
   every project, every downloaded feed, every stored layout and every
   export still being made - with Cancel focused; Cancel changes nothing.
2. **Given** the confirmation, **When** confirmed, **Then** the four
   folders are removed, the folder itself and everything else in it stay,
   the Library shows no projects, and the screen says what went and that
   the app should be restarted so the engine reads its folder afresh.
3. **Given** a layout run or an export going, **When** Settings is opened,
   **Then** the reset is offered but disabled, and says which. A reset
   confirmed while the main process can see work in flight is refused with a
   sentence saying what, the folders are untouched, and the dialog stays
   open.
4. **Given** an engine home that is the user's home folder, a filesystem
   root, or a folder containing the user-data folder, **When** a reset is
   asked for, **Then** the main process refuses it.
5. **Given** an engine data folder a person pointed at a folder of their
   own, **When** it is reset, **Then** their files are still there: only
   the four folders the app and the engine wrote are removed.

### User Story 5 - Find the logs (Priority: P3)

A person asked for a diagnosis opens the folder the app's log belongs in,
in the platform's own file browser.

**Acceptance Scenarios**:

1. **Given** "Open logs folder", **When** pressed, **Then** the platform's
   log folder for this app is made if it is missing and opened in the file
   browser; the screen says the app writes to standard error until A6-03
   puts a file there.

### Edge Cases

- A settings file that is not JSON, is an array, is half-written, or names a
  relative folder, a folder with a control character in it, or a theme that
  does not exist: every field falls back to its default, the app starts, and
  one line goes to the log. The file is rewritten in the current form at the
  next change.
- Two windows are impossible (one window, one instance), so there is no
  concurrent writer; the write is still atomic, because a crash mid-write
  must not leave a file that cannot be read.
- A folder chosen inside the app bundle, or a relative path arriving from
  anywhere, is refused: only an absolute path is stored.
- The engine home's size is walked with a cap and symbolic links are never
  followed; a folder too large to walk reports what it counted and says the
  count is partial.
- A reset while the engine is running leaves the engine with an empty home.
  It is told nothing (the supervisor has no restart), so the screen says to
  start the app again. On Windows a file the engine still holds open can
  make one folder's removal fail; each folder is attempted whatever
  happened to the last, and the screen says which stayed and why.
  Unmeasured on Windows.
- A reset that fails part way must not leave the size line showing the
  figure from before it: the folder is measured again whichever way the
  reset went.
- Reduced motion: nothing on this screen animates.

## Requirements _(mandatory)_

- **FR-001**: Settings MUST be stored in one file under the user-data
  folder, written atomically and read defensively: any unreadable or
  invalid field takes its default and the app starts.
- **FR-002**: The app MUST resolve each folder as environment, then
  `.env.local`, then the stored setting, then the default, and MUST say
  where a folder came from. The screen names three, not four: `.env.local`
  _is_ the environment in development, and what matters to a person is
  whether the folder is the app's to change.
- **FR-003**: `LEGIBLE_EXPORT_FOLDER` and `SCHEMATIC_HOME` MUST keep
  overriding the stored setting, and a folder they name MUST NOT be
  changeable from the screen.
- **FR-004**: A folder MUST be chosen in a native dialog the main process
  opens; the renderer MUST NOT pass a path to the main process, and the main
  process MUST refuse any path its own dialog did not answer, spending each
  answered path on one change.
- **FR-005**: A changed export folder MUST take effect for the next export
  without a restart; a changed engine data folder MUST take effect at the
  next start and the screen MUST say so.
- **FR-006**: Settings MUST show the engine data folder's size, measured on
  demand, as a size and a count of files.
- **FR-007**: Settings MUST show `engine.info`'s engine version, protocol,
  Python version, LOOM backend and commit, and ffmpeg; a null commit or
  ffmpeg MUST read as a sentence saying the host reported none.
- **FR-008**: The theme MUST be one of system, warm-dark and sepia, stored,
  applied at once, and applied again at the next start as soon as the
  settings are read. The page opens on the system's preference and adopts
  the stored choice when the bridge answers, so a choice that differs from
  the system's shows for a frame before it is applied; removing that would
  mean the served document carrying the attribute, which is out of scope
  here.
- **FR-009**: "Reset engine data" MUST remove only the folders the app and
  the engine keep under the home - `projects`, `out`, `data` and `frames` -
  and MUST NOT remove the home itself or anything else in it, because the
  home is a folder a person can point anywhere in one click. A folder that
  is a symbolic link MUST be left alone and reported. It MUST be behind a
  confirmation naming exactly what goes. The main process MUST refuse it
  while an export, an engine request or a record write is in flight, MUST
  refuse a home that is a root, the user's home folder or an ancestor of
  the user-data folder, and MUST refuse an export folder inside one of the
  four; the home it works on comes from its own configuration and never
  from the page. While the removal runs, no export, no engine request and no
  write to a project record may start.
- **FR-013**: A layout run is four steps with nothing in flight between
  them, so the main process MUST NOT claim to know one is open. The screen,
  where the runs live, MUST refuse the reset while any run or export is
  going.
- **FR-010**: "Open logs folder" MUST open the platform's log folder for
  this app, making it if it is missing.
- **FR-012**: A folder inside the app's own bundle MUST be refused even
  when the platform's dialog answered it: nothing is ever kept there
  (ADR-016).
- **FR-011**: Every control MUST be keyboard reachable and labelled, with
  visible focus and contrast holding in both themes.

## Success Criteria _(mandatory)_

- **SC-001**: Unit: the settings shape and its defensive reader; the store
  against a temporary user-data folder, including a corrupt file and an
  atomic rewrite; the folder walk; the reset removing its four folders and
  leaving a person's own files, its symbolic-link refusal, its own guard,
  its export-folder rule and the gate it raises while it runs over the
  engine's requests, the exporter and the project store; the project
  store's count of writes in flight; the main-side refusal of a path no
  dialog answered and of a folder inside the bundle; the logs folder; the
  handlers' top-frame rule.
- **SC-002**: End to end: the screen's three blocks against the stand-in
  engine, a theme that survives a relaunch, a chosen export folder that
  survives a relaunch, an environment-named folder that offers no change,
  and a reset that empties the home and leaves the Library empty.
- **SC-003**: Lint, typecheck, unit, build, end to end on three platforms.
- **SC-004**: _(checked by hand)_ A VoiceOver pass over the screen: the
  three headings, the theme control, the folder rows and the confirmation.

## Assumptions

- **A-001**: Settings is a screen beside the Library and the project, not a
  dialog: it is long enough to scroll and the design's left rail (section 9)
  is not built.
- **A-002**: The engine data folder is applied at the next start rather than
  live. Changing it live means restarting the sidecar and rebuilding the
  project store, the served roots, the capture's session and the export's
  frames root; that is an architecture change, not a settings screen, and
  the supervisor has no public restart.
- **A-003**: Nothing is moved. Changing a folder points the app at a new one
  and leaves the old one where it is; copying a person's data between disks
  belongs to whoever asks for it.
- **A-004**: The app's log still goes to standard error (A6-03 writes the
  file); this issue only opens the folder it belongs in.
- **A-005**: The theme here is the application's own. The project record's
  `theme` field is what the exported page wears and belongs to A4-03.
- **A-006**: `LEGIBLE_USER_DATA` overrides Electron's user-data folder so
  the end-to-end suite can run without writing into a person's own profile.
  It is a test switch, not a setting.

## Dependencies

- A1-01 (the supervisor and `engine.info`), A1-02 (the typed client),
  A1-05 (the project store's atomic write), A2-00 (the tokens and the kit),
  A2-01 (the picked-path discipline), A5-02b (the export folder).
