# Feature Specification: Sidecar supervisor

**Feature Branch**: `A1-01-sidecar-supervisor`

**Created**: 2026-09-07

**Status**: Draft; no open questions (the four things the issue was silent on are decided under [Assumptions](#assumptions))

**Input**: Planned issue A1-01 (GitHub #14). The engine now runs as a server (`schematic.serve`, engine 0.2.0, protocol 1): the app must start it, prove it is the engine it was built for, pass requests and answers between the interface and it, bring it back when it dies, and end it when the app quits, leaving nothing behind. This is the first time the app talks to the engine at all; the typed client over this connection is A1-02, the screen that shows long jobs is A1-03.

---

## Overview

The app is a shell around an engine that runs as a separate program. This feature is the part of the app that owns that program: it finds an interpreter that can run the engine, starts it when the app is ready, checks that it is the version the app was built against, keeps one connection to it open, forwards requests from the interface and answers back, tells the interface what the engine is doing, restarts it when it stops unexpectedly, and shuts it down when the app quits.

What the engine can do at this version is fixed and small. Engine 0.2.0 answers exactly four requests: `engine.info` (who it is), `graph.build` (lay out a feed's network through the four layout stages), `map.build` (draw the map and the animation page for a feed on one service day, which the caller must name), and `engine.shutdown`. While a long request runs it sends two kinds of notification, `job/progress` (one per stage, with a fraction and a sentence) and `job/log` (a line from the layout tool as it is written), both carrying the request's id, and it accepts `$/cancelRequest`, which ends the layout tool it is waiting on and answers the request with the cancelled error. Its errors are of two kinds: something a person can act on (code -32000, with `data` holding `kind`, `detail` and `hint`, where `hint` is the sentence to show) and bad parameters (code -32602, same shape, kind `params`). The supervisor adds no request of its own, changes no answer, and drops no notification; what the engine says is what the interface receives.

Two facts about where this runs shape the feature. Continuous integration has no engine and no Python to run one with, so the supervisor's behaviour is tested against a stand-in that speaks the engine's framing, and the tests that need the real engine run only where a checkout of it exists. And in development the engine is the sibling checkout's own virtual environment, which the configuration already knows how to find; in a packaged app it is the bundled runtime, which arrives with A0-10.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The engine is there when the app opens (Priority: P1)

A person launches the app and, from the first screen, can see that the engine is ready. If it is not, the screen says why in a sentence they can act on, and the parts of the app that need the engine are unavailable rather than broken.

**Why this priority**: Everything the app is for runs through the engine. An app that cannot say whether its engine is running cannot say anything useful about a failure, and the first-run experience the vision measures starts here.

**Independent Test**: Launch with a working engine and read the state; launch with no interpreter and read the reason; launch against an engine of the wrong version and read the dialog.

**Acceptance Scenarios**:

1. **Given** an interpreter that can run the engine at the pinned version, **When** the app opens, **Then** the engine is started, its identity is checked, and the first screen shows the engine as ready without the person doing anything.
2. **Given** no interpreter can be found (no explicit one configured, no engine checkout with an environment in development, no bundled runtime in a packaged build), **When** the app opens, **Then** the first screen says the engine is unavailable and why, in a sentence that names what to do (set the configuration key, or reinstall), and the app is otherwise usable: the Library and projects work as before.
3. **Given** an interpreter that starts but reports a different engine version or a different protocol version, **When** the handshake completes, **Then** a dialog says which version the app expected and which it found, the engine is not used, and the first screen shows the mismatch after the dialog is dismissed.
4. **Given** an interpreter that exists but cannot run the engine (the package is not installed there, or it exits at once), **When** the app opens, **Then** the first screen says the engine could not start and repeats the last lines the engine wrote, leaving out any line that carries a path (every line is in the log), so the reason is on the screen and the detail is in the log.
5. **Given** the engine has started, **When** the person looks at the log, **Then** it names the interpreter used, the version expected and found, and the engine's home.

---

### User Story 2 - Ask the engine something and get its answer (Priority: P1)

The interface sends a request to the engine and receives what the engine answers: the result, or the engine's error with its sentence for a person, while progress and log lines for a long request arrive as they happen, and a request can be cancelled.

**Why this priority**: This is the connection every later feature is built on: layout (A3-01), the map, export. If a result or an error changes shape on the way, every later feature inherits the distortion.

**Independent Test**: With the engine ready, request `engine.info` from the interface and compare with what the engine says on its own; request `graph.build` and count the progress notifications; cancel one and see the cancelled error; send bad parameters and see the engine's hint unchanged.

**Acceptance Scenarios**:

1. **Given** the engine is ready, **When** the interface requests `engine.info`, **Then** it receives exactly what the engine answered.
2. **Given** the engine is ready, **When** the interface requests `graph.build` for a feed, **Then** progress notifications for that request reach the interface as the engine sends them, in order, each with the request's id, and the result arrives when the engine answers.
3. **Given** a request is running, **When** the interface cancels it, **Then** the engine is told to cancel, the request ends with the cancelled error, and nothing the engine was running for it is left running.
4. **Given** the engine answers with an error, **When** it reaches the interface, **Then** the code, the message and the `data` (`kind`, `detail`, `hint`) are the engine's, unchanged.
5. **Given** the engine is not ready (starting, restarting, unavailable, mismatched or stopped), **When** the interface sends a request, **Then** it is refused at once with a sentence that says the engine's state and reason, and nothing is sent to the engine.
6. **Given** a long request sends no progress and no log line for the inactivity bound, **When** the bound passes, **Then** the app cancels the request and it ends with an error that says how long it waited.
7. **Given** the handshake does not complete within its bound, **When** the bound passes, **Then** the engine is treated as failed to start, with that reason.

---

### User Story 3 - The engine comes back when it dies (Priority: P2)

If the engine process ends when nobody asked it to, the app restarts it, tells the person, and carries on; if it keeps dying, the app stops trying and says so rather than looping forever.

**Why this priority**: The engine runs other programs on real transit data and will sometimes crash. The person must not have to know how to restart it, and must not be left with an app that looks alive and does nothing.

**Independent Test**: With the engine ready, end its process from outside the app; read the notice; see the engine ready again. Make the engine fail every time it starts; see the app give up after the third attempt with a reason.

**Acceptance Scenarios**:

1. **Given** the engine is ready, **When** its process ends unexpectedly, **Then** the interface says the engine stopped and is restarting, the engine is started again after a short wait, the handshake is repeated, and the interface says it is ready again.
2. **Given** a request is in flight, **When** the engine's process ends, **Then** that request ends with an error saying the engine stopped, and the request is not repeated on the person's behalf.
3. **Given** the engine has died and been restarted three times in a row without answering a request in between, **When** it dies again, **Then** the app stops restarting it, the interface says the engine has stopped and why, and a request is refused with that reason.
4. **Given** the app is quitting, **When** the engine's process ends, **Then** nothing restarts it.

---

### User Story 4 - Nothing outlives the app (Priority: P2)

When the app quits, the engine is asked to stop, is ended if it does not, and no program the app started, including the ones the engine started, is left running.

**Why this priority**: A layout tool left running after the app closes is invisible to the person and consumes their machine until they find it in a process list. On the vendored runtime the leftover would be a program nobody can name.

**Independent Test**: With the engine ready and a long request running, quit the app; wait; look for any process of the engine, the layout tools or the encoder.

**Acceptance Scenarios**:

1. **Given** the engine is ready and idle, **When** the app quits, **Then** the engine is asked to shut down, ends, and the app exits after it.
2. **Given** a long request is running, **When** the app quits, **Then** the request is cancelled, the engine is asked to shut down, and the layout tool it was running is gone within the shutdown bound.
3. **Given** the engine does not answer the shutdown request within its bound, **When** the bound passes, **Then** the app ends the process itself, waits a further bound, and forces it if it is still there; the app exits either way.

---

### Edge Cases

- The engine writes something on its output that is not a message (a stray print): the connection treats it as a failure of the engine, the app logs what it read, and the restart path applies.
- The engine writes a great deal to its error stream: every line goes to the log as it arrives, prefixed so it can be told from the app's own lines, and none of it reaches the interface except through the engine's own `job/log` notifications.
- The engine process ends during the handshake: it counts as a failure to start, with the engine's last lines as the reason; restarts apply.
- A request's id from a previous engine process arrives at the interface after a restart: it does not, because every request in flight is ended when the process ends and notifications for unknown ids are logged and dropped.
- Cancel is requested for a request that has already finished: nothing is sent and nothing changes.
- The person quits while the engine is restarting: the restart is abandoned and the quit proceeds.
- The app is killed outright by the system: it cannot help what it leaves; the engine's own shutdown on end-of-input covers the case where the pipe closes.
- The interpreter path or the engine's home contains spaces or non-ASCII characters: nothing is passed through a shell, so they are ordinary characters.
- Two windows: there is one window and one engine; a second launch focuses the first (A0-09).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST start the engine once it is ready to show its window, without any action by the person, and MUST show the engine's state on the first screen from the moment the screen appears.
- **FR-002**: The app MUST resolve the interpreter that runs the engine in this order: an explicitly configured interpreter; in development, the engine checkout's own virtual environment; in a packaged app, the bundled runtime. When none exists, the engine's state is *unavailable* with a reason that says which of these was looked for and where, and which configuration key would fix it.
- **FR-003**: The app MUST start the engine with an argument list (never a command line for a shell), with no console window on Windows, and with an environment that carries the engine's home, the layout-tool directory, the encoder path and the log level from the app's configuration.
- **FR-004**: The app MUST log every line the engine writes to its error stream, as it arrives, under a tag that distinguishes it from the app's own lines.
- **FR-005**: The app MUST complete a handshake before any other request: it asks the engine who it is and compares the protocol version and the engine version with the pin the app was built with. The pin lives with the other vendored versions and names the engine's repository, tag, version and protocol.
- **FR-006**: If the protocol or the engine version differs from the pin, the app MUST show a dialog naming the expected and the found versions, MUST NOT send the engine any further request, and MUST show the state as *mismatched* afterwards.
- **FR-007**: The interface MUST be able to send any request the engine defines and receive the engine's result or error unchanged, including an error's code, message and `data`; the app MUST add no request of its own to the protocol and MUST reject a request that is not a method name and an object of parameters before it reaches the engine.
- **FR-008**: The interface MUST receive the engine's `job/progress` and `job/log` notifications, each with the request id the engine gave it, in the order the engine sent them.
- **FR-009**: The interface MUST be able to cancel a request by its id; the app MUST forward the cancellation to the engine and end the request with the engine's cancelled error.
- **FR-010**: Every request MUST have a bound: the handshake a short fixed one, and any other request an inactivity bound measured from the last progress or log notification for it, after which the app cancels it and ends it with an error that states the bound.
- **FR-011**: A request sent while the engine is not ready MUST be refused at once with a sentence naming the state and its reason, and MUST NOT be queued.
- **FR-012**: When the engine's process ends without the app having asked, the app MUST end every request in flight with an error saying so, MUST restart the engine after a wait that grows with each consecutive failure, and MUST stop after three consecutive failures with the state *stopped* and the reason.
- **FR-013**: The count of consecutive failures MUST start afresh once the engine has answered a request after the handshake or has been ready for a bound (30 s); a handshake alone MUST NOT reset it, or an engine that dies right after its handshake would be restarted without end.
- **FR-014**: On quit, the app MUST cancel requests in flight, ask the engine to shut down, wait a bound, end the process if it is still running, wait a further bound, force it if it is still there, and only then exit; nothing MUST restart the engine while the app is quitting.
- **FR-015**: The engine's state MUST be one of *starting*, *ready*, *restarting*, *unavailable*, *mismatched* and *stopped*, with a reason for the last three; the interface MUST show it in a labelled status region that assistive technology announces politely when it changes, with no animation.
- **FR-016**: The mismatch dialog MUST be reachable by keyboard, read by a screen reader, and dismissable with the keyboard alone.
- **FR-017**: The app MUST run at most one engine process at a time.
- **FR-018**: Only the interface's own top frame MUST be able to reach the engine through the bridge, as with the projects bridge; a page shown in a frame shares the origin but must not have it.
- **FR-019**: Every state change, the interpreter chosen, the versions expected and found and the engine's home MUST be logged; no log line and no sentence shown to the person MUST be the only record of a failure.
- **FR-020**: The app MUST make no network connection for any of this, and the supervisor MUST write nothing to disk; what the engine writes is under its home, as before.
- **FR-021**: The supervisor's behaviour (start, handshake, pass-through, cancellation, bounds, restart, shutdown) MUST be tested without the real engine, against a stand-in that speaks the same framing and can be told to misbehave; tests against the real engine MUST run where a checkout exists and skip, saying so, where it does not.

### Key Entities

- **Engine state**: one of starting, ready, restarting, unavailable, mismatched, stopped; with a reason for the last three, and for mismatched the versions expected and found.
- **Engine pin**: the engine's repository, tag, version and protocol the app was built against; committed with the other vendored versions.
- **Request**: a method name, an object of parameters, the id the app assigns, and its bound; ends with the engine's result, the engine's error, or an app error that says why the engine could not answer.
- **Notification**: `job/progress` (id, stage, fraction, sentence) or `job/log` (id, level, line), from the engine, for one request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With a working engine, the first screen shows the engine as ready within 5 seconds of appearing, on the developer's machine.
- **SC-002**: Ending the engine's process from outside the app: the screen says the engine is restarting within 2 seconds and shows it ready again within 10 seconds, with no action by the person.
- **SC-003**: Three seconds after the app quits, no process of the engine, the four layout tools or the encoder remains, checked by the automated test on all three platforms and by a person in Activity Monitor and Task Manager.
- **SC-004**: Against an engine of the wrong version, a dialog names both versions, and every request afterwards is refused with a sentence; the Library still works.
- **SC-005**: An error from the engine reaches the interface with its `hint` byte for byte as the engine wrote it, for every kind of error the engine defines.
- **SC-006**: No test in continuous integration needs the engine; where the engine is absent, the tests that need it are reported as skipped, not passed.
- **SC-007**: A screen-reader user hears each state change once, in a sentence, without it interrupting what they were doing (checked by a person with VoiceOver and Narrator).

## Assumptions

- **The engine this feature talks to is 0.2.0, protocol 1**, exposing `engine.info`, `graph.build`, `map.build`, `engine.shutdown`, the two notifications and cancellation as described; that tag exists in the engine's repository but has not yet been pushed to its public remote, which A0-06's vendoring job needs and this feature does not.
- **The pin is an `engine` block in the vendored-versions file** (`vendor/pins.json`), added by this feature: repository, tag `v0.2.0`, version `0.2.0`, protocol `1`. The handshake compares version and protocol; the tag is for the vendoring job.
- **The interpreter in development** is the engine checkout's own virtual environment: `.venv/bin/python` under `LEGIBLE_ENGINE_CHECKOUT` (`.venv/Scripts/python.exe` on Windows). A new optional configuration key, `LEGIBLE_ENGINE_PYTHON`, names an interpreter explicitly and wins when set. In a packaged app the interpreter is the bundled runtime under the app's resources, at the layout `specs/002` defines; if that folder is missing the state is unavailable with that reason. Nothing else is searched: never the system Python, never the PATH.
- **The engine starts at app ready**, after the configuration is read, and before the window shows; the window does not wait for the handshake.
- **Bounds**: the handshake 10 seconds; the inactivity bound for any other request 10 minutes; the shutdown request 3 seconds, then terminate, then 3 seconds, then force. The restart waits are 1, 2 and 4 seconds.
- **"Engine features disabled"** means the bridge refuses requests with the state's sentence, and the interface shows the state; no screen in this feature has a control that needs the engine (A3-01 brings the first), so nothing else is greyed.
- **The status region is one line** in the interface's header, present on every screen; the fuller account of jobs, progress and logs is A1-03.
- **Health is exit monitoring plus the handshake**; there is no periodic ping, because an idle engine does nothing and a wedged request is caught by its inactivity bound.
- **Environment passed to the engine** is a minimal one built by the app (the engine's four keys plus what an interpreter needs to run: the path, the home directory, the temporary directory, and on Windows the system root), not the app's whole environment.
- **Notifications go to the interface only while it is open**; the app logs progress and log lines too, so nothing is lost if a screen is not showing them.
- **A1-02** generates types for the methods and parameters from the engine's schema and wraps this bridge; this feature's bridge is deliberately untyped beyond "a method name and an object".
- **The stand-in engine** is a small script committed with the tests; it answers the handshake with whatever version it is told, runs a fake long request with progress, honours cancellation, and can be told to exit at once, exit after the handshake, print garbage, or ignore shutdown.

## Dependencies

- A0-09 (the skeleton: configuration, logging, the bridge pattern) and A1-05 (the Library that carries the status region): done.
- E09a and E11 on the engine: done locally at tag `v0.2.0`.
- A1-02 (typed client), A1-03 (jobs drawer), A1-04 (settings) build on this; A0-10 supplies the bundled runtime the packaged path expects.
