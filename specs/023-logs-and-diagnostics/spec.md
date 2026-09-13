# Feature Specification: Local logs and copy diagnostics

**Feature Branch**: `A6-03-logs-diagnostics`

**Created**: 2026-09-12

**Status**: Draft

**Input**: Planned issue A6-03, "Local logs with rotation and a
copy-diagnostics button; no telemetry". Every line the main process logs
goes through `log` in `src/main/log.ts`, whose sink writes to standard
error and was built to be replaced ("A6-03 redirects them to a file by
replacing the sink, without touching a call site"). The engine's stderr
already arrives there line by line through the supervisor. Settings has
had an "Open logs folder" button since A1-04, under a sentence saying the
app writes its log to standard error "for now". The project's diagnostics
panel already copies its figures and caveats through a one-way clipboard
bridge (specs/017).

## Overview

When something goes wrong on a person's machine today, nothing is left
behind: the log went to a terminal nobody had open. After this feature the
app keeps two log files in the platform's log folder, `main.log` for the
app and `engine.log` for the engine's own output. Each is capped at 5 MB,
with one previous file kept beside it. Nothing ever leaves the machine.

Settings gains **Copy diagnostics**. It puts on the clipboard what a bug
report needs:

- the app's version and the versions of Electron, Chromium and Node;
- the operating system and architecture;
- the engine's `engine.info`;
- the last 200 lines of each log;
- the figures and caveats of every project whose map was drawn in this
  session.

Every path under the person's home folder is written with `~`, and the
text is checked for the home folder before it is copied. A person pastes
it into an issue; nothing is sent by the app.

## Decisions taken before this spec

Answered by the maintainer on 2026-09-12:

- **No `electron-log`.** The issue names it; the rotation is written here,
  behind the existing sink, so the lane adds no dependency and no notice.
  Two files, 5 MB each, one previous file kept.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A log is there after the fact (Priority: P1)

A person's export fails. They open Settings, press "Open logs folder", and
find `main.log` and `engine.log` with the lines from the failure in them.

**Why this priority**: it is the half of the issue that has to exist
before anything can be copied.

**Independent Test**: launch the built app against the stand-in engine
with its user data and logs moved to a test folder, do one engine request,
quit, and read both files.

**Acceptance Scenarios**:

1. **Given** the app has started, **When** the logs folder is read,
   **Then** `main.log` holds the main process's lines, each with an ISO
   timestamp, and `engine.log` holds the engine's stderr and the
   supervisor's lines about the engine.
2. **Given** a log at 5 MB, **When** the next line would take it past the
   cap, **Then** the file becomes `main.old.log` (or `engine.old.log`),
   replacing any earlier one, and a new file is started. Never more than
   two files per log.
3. **Given** the app quits, **When** the files are read, **Then** the last
   line logged before the quit is in them.
4. **Given** a development run, **When** the app logs, **Then** the lines
   still reach standard error as well, as they do today.
5. **Given** Settings, **When** it is read, **Then** the sentence under
   "Open logs folder" no longer says the log goes to standard error.

---

### User Story 2 - Copying what a bug report needs (Priority: P1)

A person presses "Copy diagnostics" in Settings, pastes into a new issue,
and the maintainer can see which versions they ran, what the engine said,
and what the map's build had to fudge.

**Why this priority**: it is the other half of the issue, and the reason
for the first.

**Independent Test**: against the stand-in, press the button and read what
the clipboard bridge was given.

**Acceptance Scenarios**:

1. **Given** Settings, **When** "Copy diagnostics" is pressed, **Then** the
   clipboard holds, in this order: the app's version; Electron, Chromium
   and Node; the operating system, its release and the architecture; the
   engine's `engine.info` (or a line saying the engine is not running);
   the last 200 lines of `main.log`; the last 200 lines of `engine.log`;
   and the diagnostics copy of each project drawn this session, in the
   format the project's own panel copies.
2. **Given** the copied text, **When** it is searched for the home folder,
   **Then** it is not there: every occurrence is `~`, whichever separator
   and, on Windows, whichever case it was written in.
3. **Given** a press, **When** the copy succeeds or fails, **Then** a
   sentence says so where the button is, as the diagnostics panel does.
4. **Given** a log that does not exist yet, **When** diagnostics are
   copied, **Then** that section says so rather than failing.

---

### User Story 3 - No telemetry (Priority: P1)

A person reading the privacy section of the install document, or the code,
can confirm the app sends nothing.

**Acceptance Scenarios**:

1. **Given** this feature, **When** its code is read, **Then** it opens no
   network connection, and the diagnostics text reaches nothing but the
   clipboard.

---

### Edge Cases

- **The logs folder cannot be written** (a read-only profile, a full
  disk). Logging falls back to standard error, and says so once there; a
  logging failure never takes the app down or blocks a request.
- **The end-to-end suite** moves user data with `LEGIBLE_USER_DATA`. On
  macOS `app.getPath('logs')` does not follow it (a note in
  `src/main/index.ts`), so the logs folder is moved beside it explicitly in
  that case, with `app.setAppLogsPath`. The suite never writes a person's
  real log.
- **A line logged before the app is ready**, or before the file is open,
  is kept in memory and written when the file opens, so the first lines of
  a failed launch are not lost.
- **A burst of engine output** (LOOM can print thousands of lines) is
  written through a stream, not a synchronous append per line, and never
  holds up the supervisor.
- **A secret in a log line.** The app's own lines carry no feed URL and no
  header, but the engine's do: at v0.8.2 a failed download raises an error
  naming the whole URL, query string included, and the engine logs it with
  a traceback on the stderr the supervisor writes to `engine.log` (engine
  issue 32 redacts it at source). So every line is passed through one
  redaction before it is written, to either log and to standard error (in
  development, or when the log folder cannot be used), and the copy is
  passed through it again, because a log written before
  this rule still holds whole addresses. What it covers, and nothing more:
  - an `http` or `https` address, with its slashes plain or JSON-escaped
    (`https:\/\/`) and its host a name or an IPv6 literal: the scheme,
    the host, the path and the query's parameter names stay, and the user
    information, every query value (after `?`, `&` or `;`), a query part
    with no name, and the fragment become `<redacted>`;
  - the same address percent-encoded, up to a raw `&`, decoded leniently
    so a stray or truncated escape does not hide it;
  - a path with a query and no scheme, the way urllib3 and `requests`
    word a failed connection (`Max retries exceeded with url:
    /gtfs.zip?api_key=…`): each `name=` stays and its value goes.

  **Not covered**: a token carried as a path segment, because nothing in
  the text says which segment is a secret and the app does not guess from
  how random one looks; a query on a word with no `/` before its `?`; and
  a secret split across words. Beyond that, neither the redaction nor the
  home-folder replacement is a scrubber for anything else. The copied text
  is shown to nobody until the person pastes it.
- **Paths outside the home folder** (an export folder on another volume)
  are left as they are: they are the person's choice, and they can see the
  text before they paste it.
- **The engine's home is inside the logs' own folder**, or the other way
  round. Nothing here deletes anything but the one previous log file, by
  its exact name.
- **"Reset engine data"** does not touch the logs; they live under the
  platform's log folder, not the engine's home.

## Requirements _(mandatory)_

- **FR-001**: The main process MUST write its log lines to `main.log`, and
  the engine's lines to `engine.log`, in `app.getPath('logs')`, each line
  prefixed with an ISO 8601 timestamp.
- **FR-002**: Each log MUST be rotated before a write would take it past
  5 MB (5 * 1024 * 1024 bytes). `<name>.log` is renamed to `<name>.old.log`,
  replacing it. No other file is ever removed.
- **FR-003**: Lines MUST still go to standard error in development.
- **FR-004**: Every existing call site of `log` MUST keep working
  unchanged; the file is a new sink behind `setSink`.
- **FR-005**: Settings MUST offer "Copy diagnostics", which composes the
  text in the main process and writes it through the existing clipboard
  path.
- **FR-006**: The copied text MUST NOT contain the home folder, checked
  after composition with a test that fails on any occurrence.
- **FR-007**: The project reports the renderer holds MUST cross the bridge
  as plain text of bounded length, validated in the main-side handler.
- **FR-008**: Logging MUST NOT throw into a caller, and MUST NOT open a
  network connection.
- **FR-009**: Under `LEGIBLE_USER_DATA` in development, the logs folder
  MUST move beside the moved user data.
- **FR-010**: The button MUST be keyboard-reachable and labelled, and its
  result sentence announced politely.

## Success Criteria _(mandatory)_

- **SC-001**: After a failed export, `engine.log` and `main.log` hold the
  lines that describe the failure.
- **SC-002**: Neither log ever exceeds 5 MB, and never more than two files
  exist per log.
- **SC-003**: Copied diagnostics contain no absolute path under the home
  folder, and a bug can be reproduced from them. For the second half, the
  reviewer reads a sample copied after a failed layout and says whether
  the versions, the engine's error and the caveats are all there.

## Assumptions

- `app.getPath('logs')` is the platform's conventional place
  (`~/Library/Logs/<app>` on macOS, under `%APPDATA%` on Windows) and is
  what "Open logs folder" already opens.
- The supervisor's `log` callback (`engineLog` in `src/main/index.ts`) is
  the single path for the engine's lines, so routing it to `engine.log` is
  one change.
- The diagnostics copy of a project is the existing `copyText` in
  `src/renderer/src/engine/diagnostics.ts`, reused, not reformatted.
