# Feature Specification: The Library adds and removes feeds

**Feature Branch**: `A2-01-feeds`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A2-01 (#19). Engine v0.7.0 puts the registry on
the protocol: `feeds.list` answers every feed, preset or added, with
whether its zip is cached; `feeds.add` takes a URL or an absolute path and
reports its download, then its check, and refuses a zip that is not GTFS
with a sentence naming the missing table; `feeds.remove` forgets a feed a
person added and refuses a preset. Until now the create dialog took a
typed feed key because no list existed.

## Overview

The Library lists the feeds the engine knows beside the projects, so a
person sees what a project can be made from. A feed is added from a zip
on disk or from a URL; the add runs as a job with its download on a
progress line and can be cancelled; a refusal is the engine's own
sentence. A feed a person added can be removed, behind a confirmation,
unless a project still names it. The create dialog offers the list
instead of a typed key. The empty Library says what to do first and
offers it.

The rules this leans on: a file path is chosen in a native dialog opened
by the main process, the one thing only the OS can do, and the main
process is the gate for what may be added and removed (constitution's
constraints; `.claude/rules/main.md`). The page never draws a map.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See the feeds, and make a project from one (Priority: P1)

The Library shows every feed the engine knows: the presets with their
city and network, the feeds a person added, and whether each is
downloaded. "New project" on a feed opens the create dialog with that
feed chosen; the dialog's feed control is a select over the same list.

**Acceptance Scenarios**:

1. **Given** the engine ready, **When** the Library opens, **Then** the
   feeds are listed with name, city and network, whether preset or added,
   and whether downloaded; a screen reader names each row.
2. **Given** a feed's "New project", **When** pressed, **Then** the create
   dialog opens with that feed chosen and the name focused; Create makes
   a project on it.
3. **Given** the engine not ready, **When** the dialog opens, **Then** the
   feed is typed as before, with the sentence saying why, so a project
   can still be made.
4. **Given** an empty Library, **When** it opens, **Then** the empty state
   says to pick a feed and offers "New project" as its one action; a
   project exists two steps later.

### User Story 2 - Add a feed from a file or a URL (Priority: P1)

"Add feed" opens a dialog with two ways in: choose a zip, which opens the
platform's file chooser, or paste a URL. The add runs with its download's
bytes on a progress line, then the check; it can be cancelled; when it
finishes the feed is in the list and the dialog closes.

**Acceptance Scenarios**:

1. **Given** a GTFS zip chosen from disk, **When** added, **Then** the
   engine is asked with the chosen path, the check reports, the feed
   appears as added, and only the file's name was ever on screen.
2. **Given** a URL, **When** added, **Then** the download's bytes report
   on the line, then the check, and the feed appears with that URL.
3. **Given** a zip with no stop_times, **When** added, **Then** the
   dialog shows the engine's sentence under the source, nothing is
   listed, and the dialog stays open.
4. **Given** an add in progress, **When** cancelled, **Then** the engine
   is told, the list is unchanged, and the dialog says so.
5. **Given** a path that no dialog of the app's handed out, **When** a
   page asks `feeds.add` with it, **Then** the main process refuses it
   before the engine sees it.

### User Story 3 - Remove a feed a person added (Priority: P2)

"Remove" on an added feed asks first, names what goes (the feed, its
downloaded zip, its stored layouts), and then forgets it. A preset has no
Remove. A feed a project still names is refused, naming how many.

**Acceptance Scenarios**:

1. **Given** an added feed no project names, **When** removed and
   confirmed, **Then** it is gone from the list and from the engine.
2. **Given** an added feed two projects name, **When** removed, **Then**
   the main process refuses with a sentence naming the two, and the feed
   stays.
3. **Given** a preset, **Then** no Remove is offered; asked directly, the
   engine refuses with its own sentence.

### Edge Cases

- The list is read when the Library opens and again after an add or a
  remove; nothing polls. The engine restarting empties it until ready.
- A feed added without an agency name is named after its file, as the
  engine does; the app renames nothing.
- The engine caches a URL's zip under the feed's key; "downloaded" is the
  engine's `cached`, never the app's guess.
- Reduced motion: the progress line already honours it; nothing new moves.

## Requirements _(mandatory)_

- **FR-001**: The pin MUST move to engine v0.7.0 and the types MUST be
  regenerated; the five feed methods MUST be reachable through the typed
  client.
- **FR-002**: The Library MUST list `feeds.list`'s answer with name, city
  and network, source and cached, and offer "New project" per feed and
  "Remove" per added feed.
- **FR-003**: The create dialog MUST offer the feeds as a native select
  when they are listed, and a typed key otherwise.
- **FR-004**: A zip MUST be chosen through a native file dialog opened by
  the main process, which hands the page the path and remembers it; the
  page MUST show the file's name only.
- **FR-005**: The main process MUST refuse a `feeds.add` whose source is
  neither an http(s) URL nor a path it handed out, and a `feeds.remove`
  of a feed any project names, before the engine sees either.
- **FR-006**: The add MUST run as a job through the typed client with its
  progress on a progress line and a Cancel; a refusal MUST show the
  engine's hint verbatim.
- **FR-007**: Remove MUST confirm first in the page's own dialog with
  Cancel focused.
- **FR-008**: The empty state MUST carry one sentence and one primary
  action, per the design document.
- **FR-009**: The stand-in engine MUST answer the three registry methods
  with a fixed preset list, a persisted user list, a download reported in
  steps for a URL, and the engine's refusal sentences for a zip that is
  not GTFS.

## Success Criteria _(mandatory)_

- **SC-001**: End to end against the stand-in: the list, a project from a
  feed, an add from a file, an add from a URL, a refused zip, a cancelled
  add, a remove, a refused remove, the empty state's two steps.
- **SC-002**: Against the real engine: `feeds.list` answers 22 presets and
  a zip added from disk appears and is removed.
- **SC-003**: Lint, typecheck, unit, build, end to end on three platforms.

## Assumptions

- **A-001**: Feeds are listed on the Library screen, below the projects,
  not on a screen of their own: the design's left rail (section 9) is not
  built yet, and a second screen would be a router.
- **A-002**: The list shows no service window: that is `feeds.inspect`'s,
  a long request per feed, and A2-02's screen.
- **A-003**: Grouping is by source (presets, then added), not by country:
  the registry carries a city, not a country, and 22 rows read fine.
- **A-004**: A2-02 chooses mode and agency; this feature adds a feed with
  the engine's defaults.

## Dependencies

- E07, E09c (engine v0.7.0); A1-05.
