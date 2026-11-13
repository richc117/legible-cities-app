# Feature Specification: Ask before quitting or closing during a run

**Feature Branch**: `552-quit-guard`

**Created**: 2026-11-12

**Status**: Draft

**Input**: Issue 552, "Quitting or closing during an export throws it away without asking", and its decided approach (option (a), with "Keep working" as the safe button). One change from that approach, decided by the maintainer when issue 556 moved out of 1.0: the window's close asks on **every** platform, macOS included. The decided approach let macOS close the window silently during an export because issue 556 would let a reopened window see it; without 556, a window reopened from the Dock cannot see or stop an export that went on without one, so closing asks there too, and "Close anyway" stops the runs as quitting does. Each such decision is recorded below as an "*As of 12 Nov 2026:*" line under the requirement it settles.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quitting during an export asks first (Priority: P1)

As someone whose reel has been exporting for four minutes, I want a stray Cmd+Q or Quit from the Dock to ask me before it throws the export away.

**Why this priority**: an export is the longest thing the app does, and today one keystroke loses it with nothing said.

**Independent Test**: start an export held by the stand-in engine, quit the app, and read the dialog; press **Keep working**, then quit again and press **Quit anyway**.

**Acceptance Scenarios**:

1. **Given** an export running, **When** the person quits the app (the menu, the shortcut, the Dock or the taskbar), **Then** the app does not quit; the interface's own modal dialog opens with the title "Quit while an export is running?", a sentence naming the project ("The export of Paris has not finished. Quitting stops it, and nothing of it is kept."), and two buttons, **Keep working** and **Quit anyway**, with focus on **Keep working**.
2. **Given** the dialog open, **When** the person presses **Keep working**, presses Escape, or closes the dialog any other way, **Then** the dialog closes, focus returns where it was, and the export goes on as if nothing happened.
3. **Given** the dialog open, **When** the person presses **Quit anyway**, **Then** the app quits as it does today: the export is stopped, its frames folder is removed, the engine is stopped, and nothing of the export is kept.
4. **Given** the dialog open, **When** the person quits again (a second Cmd+Q or Quit from the Dock), **Then** the app quits as if **Quit anyway** had been pressed. A second quit is an answer.

---

### User Story 2 - Quitting during a layout asks first (Priority: P1)

As someone whose large city has been laying out for two minutes, I want the same question before a quit throws that away.

**Independent Test**: start a layout held by the stand-in engine, quit, and read the dialog.

**Acceptance Scenarios**:

1. **Given** a layout running (the layout run in cell 02, **Run all**'s layout, or a sample city's card), **When** the person quits, **Then** the dialog opens with the title "Quit while a layout is running?" and a sentence naming the project ("The layout of Paris has not finished. Quitting stops it, and nothing of it is kept.").
2. **Given** an export and a layout both running, or two of either, **Then** the title is "Quit while 2 runs are going?" and the sentence names each project once.
3. **Given** nothing running, **When** the person quits, **Then** the app quits at once, as today, with no dialog.

---

### User Story 3 - Closing the window during a run asks first (Priority: P1)

As someone who closes windows by habit, I want closing the app's window during a run to ask as quitting does, on every system.

**Acceptance Scenarios**:

1. **Given** a run going, **When** the person closes the app's window (its close button, Cmd+W, Alt+F4), **Then** the same dialog opens with "Close" in place of "Quit": "Close while an export is running?", "... Closing stops it, and nothing of it is kept.", **Keep working** and **Close anyway**.
2. **Given** **Close anyway** pressed, **Then** every run the window started is stopped by the same path its own **Cancel** takes (an export's frames folder removed, a layout's request cancelled), and then the window closes. On Windows and Linux the app then quits as it does today when its window closes; on macOS the app stays running with no window, as today, and nothing of the stopped runs goes on.
   *As of 12 Nov 2026:* the macOS close asks and stops, rather than letting an export go on unseen; issue 556 (a reopened window that can see an export) is what would let that change.
3. **Given** nothing running, **Then** closing the window behaves exactly as today.

---

### Edge Cases

- **The renderer is gone or not answering.** If the window's renderer has crashed, or Electron has reported it unresponsive, a quit or close goes ahead without asking: the question cannot be shown, and a person must always be able to quit.
- **The app's own quits do not ask**: the crash box's **Quit**, a lost single-instance lock, and any other quit the app makes itself rather than the person. They bypass the question.
- **A system shutdown or log-out** is not asked about on Windows (Electron cannot hold a session end) and the rule leaves it alone; on macOS a log-out that sends quit takes the same path as any quit, so the dialog may hold it, as other apps' unsaved-work questions do.
- **The run ends while the dialog is open.** The dialog stays until answered; answering **Quit anyway** then quits with nothing to stop, and **Keep working** keeps working. The dialog does not close by itself, because a dialog that disappears under the pointer invites a mis-click on what is behind it.
- **The export's capture window** is never the app's window: closing it is not a close of the app's window, and it is never counted as one (issue 537).
- **Several projects' runs**: there is one window; the sentence names each running project once, in the order the runs started.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Main holds one pure rule, `quitQuestion` in `src/main/window-lifecycle.ts`, with no Electron import, that takes what is running (exports from main's own state; layouts as the renderer last reported them), whether the renderer can be asked, whether the quit is the app's own, and whether a question is already open, and returns whether to ask, and if so the question (quit or close, the counts, the project names). `before-quit` and the app window's `close` handler consult it.
- **FR-002**: The question is asked in the interface's own `<dialog>`, never a native message box (`.claude/rules/main.md`, "Native dialogs": an unparented native box blocks the quit itself). It reuses `ConfirmDialog` (`src/renderer/src/ConfirmDialog.tsx`), which gains an optional label for its safe button, through one `QuitDialog` mounted once at the root.
- **FR-003**: The renderer reports to main which layouts are running, keyed by project, whenever that changes, through a narrow typed bridge call; main never asks the page what is running at quit time. The question and its answer cross the bridge as one typed request and one typed reply.
- **FR-004**: **Keep working** is the default and has focus when the dialog opens; Escape answers **Keep working**.
- **FR-005**: The texts are exactly those in the scenarios above. The project's name is the one the Library shows.
- **FR-006**: `before-quit`'s existing gate (`quitGate`, the engine stop) is unchanged once the person has answered **Quit anyway**: the question comes before it and does not replace it.
- **FR-007**: `docs/DESIGN.md` section 8.2 describes the dialog; `docs/acceptance.md` and `docs/accessibility.md` quote it; `tests/acceptance/acceptance.spec.ts` (the step that records "Quit showed no dialog", around line 3630) changes to match: quitting idle still shows none.

### Accessibility

- The dialog is a modal `<dialog>` with its title as its accessible name and the sentence as its description; focus moves into it on **Keep working** and returns on close (ARIA APG, dialog modal). The two buttons are labelled by their words. Its text and button pairs are in the contrast test through `ConfirmDialog`'s existing styles; no new colour, size or duration literal.

## Success Criteria *(mandatory)*

- **SC-001**: A unit table of `quitQuestion` covers: nothing running; an export; a layout; both; two of one; the renderer gone; the renderer unresponsive; the app's own quit; a question already open (a second quit quits); quit versus close. Mutations that drop the layout term, the close-on-macOS term, the app's-own-quit bypass, the renderer-gone bypass and the second-quit rule each turn it red.
- **SC-002**: End-to-end tests (written by the lane, run by the coordinator): quit during a held export, **Keep working**, the export still running; quit again, **Quit anyway**, the app gone and no frames folder left; the same for a held layout; a window close during a held export on the platform the test runs on, **Close anyway**, the export stopped and its frames folder gone; quitting idle shows no dialog.
- **SC-003**: The acceptance spec's quit step and the gate documents agree with the dialog.

## Out of scope

- Seeing or reattaching to an export from a window reopened from the Dock (issue 556, ADR-060).
- Elapsed time on long runs (issue 568).
- Asking before stopping a feed's download: a download is not a run in this sense, and stopping it keeps nothing, as a sample city's cancel already does (issue 178).
