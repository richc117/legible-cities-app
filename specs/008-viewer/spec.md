# Feature Specification: The viewer

**Feature Branch**: `A3-02-viewer`

**Created**: 2026-09-08

**Status**: Draft

**Input**: Planned issue A3-02, "Viewer: the generated animation page embedded, four views, theme follows the app".

## Overview

A project that has been laid out has a page on disk. This feature puts it on
the screen and lets the app drive it: the four views, the labels, the clock,
the speed and whether it is playing.

The page is the engine's and the app draws nothing of its own (constitution,
principle I). What is new here is not drawing but containment. The page
carries text from a transit feed, which is third-party data, and until this
feature it would have run in the same realm as the app's own bridge: a page
loaded in a plain frame reads `parent.api` and calls it, which was
demonstrated rather than feared. So the frame is sandboxed to an opaque
origin and the app reaches into it from the main process instead
(ADR-028).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - The map is on the screen (Priority: P1)

Someone opens a project that has been laid out. The map is there, animating,
with the page's own controls. It fills the space the app gives it and
follows the app's theme.

**Why this priority**: It is the feature, and it is the last thing the first
reel needs before export.

**Independent Test**: Lay a project out, and look at it.

**Acceptance Scenarios**:

1. **Given** a project with a layout, **When** it is opened, **Then** the page is shown, animating, with its own controls.
2. **Given** a project with no layout, **When** it is opened, **Then** there is no viewer and the screen says the project has not been laid out.
3. **Given** the app's theme, **When** the page loads, **Then** the page is drawn in the same theme, passed on the address rather than restyled from outside.
4. **Given** a laid-out project, **When** the window is resized, **Then** the page refits without the app measuring or positioning anything itself.

---

### User Story 2 - The app can drive the page (Priority: P1)

The app can switch the view, toggle the labels, choose which lines are shown,
move the clock, change the speed, and start or stop the animation. It can
also read what the page is showing.

**Why this priority**: The export path drives the page through this seam, and
so does everything in the style phase. A viewer that can only be looked at
would have to be rebuilt.

**Independent Test**: Call each method and read the state back.

**Acceptance Scenarios**:

1. **Given** the viewer is shown, **When** the app asks for a view by name, **Then** the page shows it and the state reports it.
2. **Given** the viewer is shown, **When** the app asks for something the page does not expose, **Then** the request is refused before it reaches the page.
3. **Given** the viewer has gone, **When** a call is made, **Then** it is refused with a sentence and nothing is injected anywhere.

---

### User Story 3 - The page cannot reach the app (Priority: P1)

A page in the viewer, whatever it contains, cannot read or call the app's
bridge, cannot touch the interface's document, and cannot navigate the
window away.

**Why this priority**: This is the reason the feature is shaped as it is. It
is also the only part a person will never see working, which is exactly why
it is tested rather than asserted.

**Independent Test**: Put a hostile page in a project's output folder and try
every route from inside it.

**Acceptance Scenarios**:

1. **Given** a page in the viewer, **When** it reads the parent, **Then** it is refused by the browser and the app's bridge is unreachable.
2. **Given** a page in the viewer, **When** it tries to navigate the top frame, by assignment, by replacement, by opening a window, or by a link, **Then** the window does not move.
3. **Given** a page in the viewer, **When** it opens a window, **Then** none opens.
4. **Given** the frame, **When** its sandbox is read, **Then** it is exactly the one flag that allows scripts, and never the one that would restore its origin.

---

### Edge Cases

- The page's file is missing or unreadable: the viewer shows nothing and the screen says the project's output is not there, without naming a path.
- The person leaves the project while the page is loading: nothing is injected afterwards, and the frame the app held is released.
- The page never defines its seam, or defines it late: a call made before it is there is refused with a sentence rather than throwing inside the page.
- The page throws: the failure reaches the caller as a sentence, and the page's own message is preserved where the platform allows it.
- Two projects opened in turn: the app drives the second, never the first, and never a frame that has been replaced.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The app MUST show a laid-out project's generated page, and MUST NOT draw any part of the map itself.
- **FR-002**: The page MUST be loaded in a frame with an opaque origin, carrying exactly the sandbox flag that allows scripts and no other. The flag that would restore the page's origin MUST NOT be added.
- **FR-003**: A page in the viewer MUST NOT be able to reach the app's bridge, the interface's document, or any object the interface holds.
- **FR-004**: A page in the viewer MUST NOT be able to navigate the window, and MUST NOT be able to open one.
- **FR-005**: The app MUST drive the page from its privileged process rather than from the interface, and MUST refuse any method the page does not expose before anything is injected.
- **FR-006**: The app MUST be able to read what the page is showing, and MUST treat what comes back as data rather than as something to trust.
- **FR-007**: The app MUST address the frame it holds, never a frame found by its address at the time of use, and MUST refuse to inject into the interface's own frame under any circumstance.
- **FR-008**: The app MUST serve generated pages with a policy of their own, which MUST allow the page to be framed by the interface and MUST NOT be the interface's own policy.
- **FR-009**: The theme MUST reach the page as part of the address it is loaded with, and the app MUST NOT restyle the page from outside.
- **FR-010**: A failure MUST reach the caller as a sentence, and MUST NOT put a path or a fragment of code on the screen.
- **FR-011**: The viewer MUST be reachable by keyboard and MUST NOT trap focus; the page's own controls carry their own labels.
- **FR-012**: The containment MUST be proven by a test that drives a hostile page from inside the viewer, and the sandbox's exact value MUST be asserted rather than assumed.

### Key Entities

- **The page**: what the engine wrote for a project. Not the app's, not trusted, and not modified.
- **The frame**: where the page runs. Held by identity, at an opaque origin, addressed only through the privileged process.
- **The seam**: the methods the page exposes. A fixed list; anything else is refused.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A laid-out project shows its map within 2 seconds of being opened, on a developer machine.
- **SC-002**: Every method the app offers reaches the page and takes effect, proven by reading the page's own state back after each.
- **SC-003**: A hostile page in the viewer fails to reach the bridge, the interface's document, and the window's address by every route the tests try, and the tests name the routes.
- **SC-004**: The frame's sandbox is exactly the one flag, asserted by a test that fails if a second is ever added.
- **SC-005**: No path, no code and no engine internal reaches the screen through any failure this feature can produce.
- **SC-006**: The app draws no part of the map: no geometry, no canvas, and nothing that reads the project's graphs.

## Assumptions

- The engine's page is unchanged. This feature is the app's half of the containment; the engine's own escaping defect is its issue, and the sandbox holds whether or not that is fixed.
- Reading the page's state is asynchronous, because it crosses into the privileged process and back. Anything wanting a live clock will poll; nothing here wants one.
- The page's own controls stay the controls (the design document, section 8.2). The app adds no chrome over the page.
- The page cannot hand back a function, so its draw callback is not available to the app. Nothing in this feature needs it.

## Dependencies

- A3-01, for a project that has a layout and a page on disk.
- ADR-028, which decided the containment and corrected the premise it rested on.
