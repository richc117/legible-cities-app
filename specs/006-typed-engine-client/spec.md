# Feature Specification: Typed engine client

**Feature Branch**: `A1-02-typed-protocol-client`

**Created**: 2026-09-07

**Status**: Draft

**Input**: Planned issue A1-02, "Typed protocol client generated from the engine's JSON Schema, with contract tests against the real sidecar".

## Overview

The app can already ask the engine anything and get its answer back
unchanged (A1-01). What it cannot do is know, before it runs, whether the
question makes sense. A method name is a string, its parameters are an
object of anything, and its result is `unknown`; a renamed parameter in the
engine becomes a refused request at run time, in front of a person, rather
than a failed build in front of whoever renamed it.

This feature closes that gap. The engine already describes its whole
protocol as a schema and will print it on demand. That description is
brought into the app as data, turned into types, and put behind a client
that names each method, its parameters and its result. From then on the
boundary is checked by the compiler, and a change on the engine's side that
the app has not followed stops the build with a sentence saying what to do.

It also finishes a job left open since Phase 0: the workflow that vendors
the engine's runtime has been carrying a placeholder where the engine's
version should be, waiting for this feature to say where the engine comes
from.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The boundary is checked when the app is built (Priority: P1)

Someone changes a parameter's name, or its type, or removes a method in the
engine. They rebuild the app against that engine. The build stops and tells
them the engine's description of itself no longer matches the copy the app
was built from, and which command brings the two back into step.

**Why this priority**: This is the whole point of the feature and the
constitution's second principle in practice: a change on one side is a
build error on the other, never a runtime surprise. Everything else here
serves it.

**Independent Test**: Change one parameter name in the engine checkout, run
the app's checks, and read the failure. Restore it and the checks pass.

**Acceptance Scenarios**:

1. **Given** an engine checkout whose protocol description differs from the copy in the app, **When** the app's checks run, **Then** they fail naming the difference and the command that regenerates the copy.
2. **Given** no engine checkout on the machine, **When** the app's checks run, **Then** the comparison reports itself skipped, and every other check still runs.
3. **Given** the copy of the description and the types generated from it, **When** anyone regenerates the types on any machine from the same description, **Then** the result is byte for byte the file already committed.

---

### User Story 2 - Asking the engine something, in types (Priority: P1)

Code that needs the engine names a method and passes its parameters. The
editor completes the method names, refuses a parameter the method does not
take, and knows the shape of the result without a cast. An error carries
the engine's own sentence for a person.

**Why this priority**: Every later feature that touches the engine, from
the layout run to export, is written against this client. Handing them an
untyped bridge means each one re-invents the same guesses.

**Independent Test**: Write a call against a stand-in bridge, with the wrong
parameter name, and see the compiler refuse it; with the right one, see the
result's fields known.

**Acceptance Scenarios**:

1. **Given** a call to a method the engine defines, **When** it is written with a parameter the method does not take, **Then** the app does not compile.
2. **Given** a call that succeeds, **When** its result is used, **Then** the result's fields are known without a cast and the compiler refuses a field the engine does not send.
3. **Given** a call the engine refuses, **When** the caller handles the failure, **Then** the engine's kind, its detail and the sentence meant for a person are all available, unchanged.
4. **Given** the map is asked for without a service day, **When** the call is written, **Then** the app does not compile, because the description requires one: the engine never chooses a day (ADR-023).

---

### User Story 3 - Watching and stopping a long request (Priority: P2)

A long request reports its stages as it runs, and can be stopped. The caller
subscribes to that one request's progress rather than filtering everything
the engine says, and cancels it with the same handle.

**Why this priority**: The layout run and the export both need it, and both
are further down the path than the typing itself. The client is usable
without this; the jobs drawer is not.

**Independent Test**: Drive a stand-in bridge that emits progress for two
requests at once and confirm each subscriber hears only its own.

**Acceptance Scenarios**:

1. **Given** two requests in flight, **When** progress arrives for one, **Then** only that request's subscriber is called.
2. **Given** a request in flight, **When** the caller cancels it, **Then** the request ends with the engine's cancelled error and its subscriptions are released.
3. **Given** a request that has ended, **When** a further notification arrives for it, **Then** nothing is delivered and no subscription is left behind.

---

### User Story 4 - The types describe the engine that is actually there (Priority: P2)

The description the app was built from came from a named version of the
engine, and the app can say which. The workflow that vendors the engine's
runtime installs that same version rather than a path someone filled in by
hand.

**Why this priority**: Without it the generated types are a snapshot from
somebody's machine, and the vendoring job cannot run at all. It is what
closes A0-06.

**Independent Test**: Read the pinned version, the description's own
protocol number and the vendoring job's configuration, and confirm all
three name the same engine.

**Acceptance Scenarios**:

1. **Given** the pinned engine block, **When** the description is regenerated, **Then** it is regenerated from an engine at that version and the pin records a fingerprint of the result.
2. **Given** the vendoring workflow, **When** its runtime job runs, **Then** it obtains the engine from the pinned repository at the pinned tag rather than from a path supplied by hand.

---

### Edge Cases

- The engine prints a description the app cannot parse, or prints nothing at all: the comparison fails with what it received, and does not overwrite the committed copy.
- The engine's description gains a method the app has never heard of: the types gain it and nothing breaks; the app is not required to call it.
- The engine's description loses a method the app calls: the app stops compiling, which is the intent.
- A checkout exists but its engine is a different version from the pin: the comparison says which version it found, because a difference then is expected rather than a fault.
- Two callers subscribe to the same request: both hear it, and releasing one does not silence the other.
- A caller cancels a request that has already ended: nothing is sent to the engine and nothing throws.
- The engine describes a string with a pattern, such as a feed key: the type is a string, and the pattern stays a run-time refusal from the engine rather than a compile-time promise the types cannot keep.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The app MUST hold a committed copy of the engine's own description of its protocol, obtained from the engine rather than written by hand.
- **FR-002**: The app MUST derive the types for every method's parameters and result, and for every notification, from that copy, by a command anyone can run, and MUST commit the derived types because the machines that build the app have no engine to derive them from.
- **FR-003**: Deriving the types MUST be reproducible: the same description MUST produce the same file on any machine, with no timestamp, path or machine name in it.
- **FR-004**: The app MUST record a fingerprint of the description beside the engine's pinned version, and MUST fail its checks when the committed description does not match that fingerprint.
- **FR-005**: Where an engine checkout is present, the app's checks MUST ask that engine for its description and MUST fail when it differs from the committed copy, naming the difference and the command that updates the copy. Where no checkout is present, this check MUST report itself skipped, and MUST NOT be reported as passed.
- **FR-006**: The app MUST offer a client that takes a method name and that method's parameters and answers with that method's result, such that a wrong method name, a wrong parameter name, a wrong parameter type or a wrong assumption about the result stops the build.
- **FR-007**: The client MUST be a faithful projection of the description: it MUST NOT relax a constraint the description states, and MUST NOT tighten one either. In particular the map's service day is required because the description already requires it, the engine having been built never to choose a day itself (ADR-023); the app adds nothing there.
- **FR-008**: The client MUST NOT add, rename or reinterpret any method, parameter or result of the engine's, and MUST NOT send a parameter the engine's description does not define.
- **FR-009**: A refused request MUST reach the caller with the engine's code, its message and its `data` unchanged, including the kind, the detail and the sentence written for a person.
- **FR-010**: The client MUST let a caller follow one request's progress and log lines without receiving other requests', and MUST release those subscriptions when the request ends.
- **FR-011**: The client MUST let a caller cancel a request it started, using the same handle the request gave it; cancelling a request that has already ended MUST do nothing and MUST NOT fail.
- **FR-012**: The generated types MUST become the single source for the shapes they describe. Where the app already declares such a shape by hand, the hand-written declaration MUST be replaced by the generated one or MUST be shown to be the same shape by a test, so that the two cannot drift.
- **FR-013**: The client MUST live where the interface can use it without reaching into the app's privileged process, and MUST reach the engine only through the existing bridge.
- **FR-014**: The client's behaviour MUST be tested without the engine, against a stand-in bridge: the routing of results, errors, progress and cancellation, and the release of subscriptions.
- **FR-015**: The app MUST test the client against the real engine where a checkout exists, and MUST skip those tests, saying so, where it does not. The handshake and the shutdown MUST be called for real. The two long-running methods MUST be exercised as far as a machine without the layout tools can reach, which is their refusal of bad parameters: that proves the parameter names, the error's shape and the sentence for a person. Their full runs are not claimed here.
- **FR-016**: The workflow that vendors the engine's runtime MUST obtain the engine from the pinned repository at the pinned tag, replacing the placeholder that waits for this feature.
- **FR-017**: Nothing in this feature MUST make a network connection of its own, beyond the vendoring workflow obtaining the pinned engine when it runs.

### Key Entities

- **Protocol description**: the engine's own account of its methods, their parameters and results, its notifications and its shared definitions, together with the protocol number it belongs to. Data, obtained from the engine, committed.
- **Fingerprint**: a value derived from the description that changes whenever the description does, recorded beside the engine's pinned version.
- **Generated types**: the description expressed as types, derived rather than written, committed, and never edited by hand.
- **Client**: the one way app code asks the engine something. Holds no state of the engine's; owns the mapping from a method to its parameters and its result, and the routing of one request's notifications.
- **Request handle**: what a caller holds while a request is in flight: the answer when it comes, the request's progress and log lines, and the means to cancel it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Renaming one parameter in the engine and running the app's checks fails them, with a message naming the parameter and the command that updates the app's copy; restoring the name makes the checks pass again.
- **SC-002**: Every method and every notification the engine describes is present in the app's types, and a count in a test says so, so that a method added to the engine and not to the app is visible rather than silently absent.
- **SC-003**: All four methods the engine defines are called against the real engine where a checkout exists: two to completion, two to a refusal that proves their parameter names and the error's shape.
- **SC-004**: With no engine on the machine, every check still runs, and the ones that need the engine report themselves skipped rather than passed.
- **SC-005**: The types compile under the project's strictest setting with no suppression and no `any`. The only casts anywhere are the two the untyped bridge forces at its edge, where a method's parameters become the bridge's object and its `unknown` answer becomes the method's result.
- **SC-006**: Regenerating the types twice, and on a second machine, produces a file identical to the one committed.
- **SC-007**: An error's code, kind, detail and the sentence written for a person all reach the caller unchanged. Proven for the kinds a machine without the layout tools can provoke, which is the parameter refusals; the kinds that need a feed or LOOM are reached by A3-01, and are not claimed here.

## Assumptions

- The engine at the pinned version prints its protocol description on demand and does so without side effects; verified against v0.2.0.
- The description names four methods and three notifications today. Nothing here assumes that number: the types follow whatever the description says, and SC-002 counts rather than fixes it.
- Pattern-constrained strings such as a feed key stay strings in the types. Encoding the pattern in the type would promise a check the types cannot perform, and the engine refuses a bad value anyway with a sentence meant for a person.
- The client needs no exception to FR-008 anywhere. This was checked rather than assumed: the map's service day, the one place a divergence looked likely, is already required by the description.
- The client is used by app code, not by a person directly, so its measurable outcomes are about the compiler and the tests rather than about a screen. This feature adds no interface.
- The request handle a caller cancels with is the one the bridge already mints per request, not the engine's own numbering, which the app never sees.
- Whether the contract tests run in continuous integration depends on the engine's tag being published, which is a maintainer's action outside this feature. This feature makes them ready to run and honest about being skipped until then.
- Full runs of the two long methods need the layout tools and a downloaded feed, so they belong to the issue that runs a layout for a project, not here.

## Dependencies

- A1-01, the supervisor and the bridge this client speaks through.
- The engine at the pinned tag, for the description and for the contract tests where a checkout exists.
- A0-06's vendoring job, which this feature completes by naming where the engine comes from.
