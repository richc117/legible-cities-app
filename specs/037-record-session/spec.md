# Feature Specification: The record session

**Feature Branch**: `426-record-session`

**Created**: 2026-10-24

**Status**: Draft

**Input**: Issue 426, "Spec: the record session (revision, drawn from what the run sent, one writer path)", from the codebase review of 15 Oct 2026 (findings R3-02, R3-03, R1-02, R1-04, R4-01). The review read 667b48c. Every claim below about the code as it stands was re-checked at a3c775d on 24 Oct 2026, and the line numbers are from there. Where the review was wrong or has been overtaken, this spec says so.

## Why

A project is one record on disk (`projects/<id>/project.json`), written by the main process's `ProjectStore` (`src/main/projects.ts`), and edited from the notebook's six cells. Three facts make the record harder to keep true than it should be.

- **`drawn` says what the record held when it was written, not what the map was drawn from.** Each `complete*` writer builds `drawn` from the record about to be written: `drew` and `redrew` (`projects.ts:87-89, 118-126`) over `drawnFrom` (`shared/project.ts:1523-1553`). Only the payload's own field comes from the run. `completeLayout` sends none of the colours, order, style or lines its `map.build` carried (`layoutRun.ts:871-879` against `881-902`). It also writes `date: record.date ?? done.date` (`projects.ts:675`), so a day changed while a layout runs is recorded as drawn when the map does not carry it. `drawnFrom`'s own comment (1515-1519) says it relies on no other write landing between the draw and the write.
- **The rule that keeps it true lives in five places in the renderer, and is written in none.**
  - The run's `writing`/`writingFrom`/`#taken` with `#afterWrites` (`engine/layoutRun.ts`).
  - The panels' `mustWait` and `settling` (`panelRelease.ts:83-93`, `useProjectState.ts:234-255`).
  - `usePutBack`/`refusedAtStart` (`usePutBack.ts`, `panelRelease.ts:116-127`).
  - Four wait loops.
  - Two serialisers that know nothing of the first: the theme's `writeThrough` (`themeWrites.ts:44-56`) and the export choice's (`ExportTab.tsx:385-418`). A third, smaller one sits in `LayoutTuning.tsx:75-105`.

  Each mechanism was added for one fault: 388, then 399, then 407. Issue 380, which the review counted with them, was a test-only flake (dd025b4) and is not part of this. A new control has to find all five to be correct.
- **The four cheap-edit panels each hand-build the same machinery, and have drifted.**
  - The panels are Colours, Order, Sizes (with looks and markers) and Line options.
  - The machinery is about ninety lines each of debounce, hold, put-back and adoption.
  - **Rule 1, a pending change when the panel unmounts:** Sizes, Options and the day flush; Order cancels; Colours drops a held release.
  - **Rule 2, adopting the record during the panel's own redraw:** Sizes and Options skip it; Order and Colours adopt. R4-01 put Colours with the skippers; the code (`colours.ts:294-296, 267-270`) puts it with Order.

Two smaller facts belong here too.
- **The store has no read that waits behind its writes.** `get` (`projects.ts:519-522`) is outside `#serial` (R1-02).
- **Three cross-run rules are held only by disabled buttons in the renderer**, which is not a security boundary (R3-03):
  - an export must not start while an engine request is writing into the project's `out` folder;
  - a project must not be deleted while it exports;
  - a project must not be deleted while an engine request addresses it.

  Main checks none of them. `Exporter.start` checks the reset, its token and `#busy` (`export.ts:327-333`); `delete` is serialised with record writes only (`projects.ts:1069-1093`).

The fix the issue names: a `revision`, `drawn` built from what each run sent, one record session in main through which every write goes, one hook for the cheap edits, the three invariants held in main, and `shared/project.ts` split by what it is.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What the map says it was drawn from is true (Priority: P1)

As someone who changes the day, a colour or a size while a layout or a redraw is running, I want the project to remember what the map on screen actually carries. When I come back to it, or when the cells judge what is out of date, they should judge it against the real map, not against what I chose a moment too late.

**Why this priority**: every other part of this rests on `drawn` being true, and today it is true only when nothing else is written during a run's window.

**Independent Test**:
- Hold the stand-in's `map.build` for a layout. While it is held, choose another day, and separately change a line's colour.
- Release it, and read the record.
- `drawn.date` is the day the run drew, and `drawn.colors` the palette the run sent. The record's own `date` and `colors` hold the new choices.

**Acceptance Scenarios**:

1. **Given** a layout whose `map.build` is held, **When** a different day is chosen and the build is released, **Then** `drawn.date` is the run's day, the record's `date` is the chosen day, and cell 03 says the map is not drawn for the chosen day yet (today's *stale* wording for the day edge), until the rebuild the choice starts has drawn it.
2. **Given** a layout whose `map.build` is held, **When** a line's colour is changed and the build is released, **Then** `drawn.colors` is the palette the run sent. The colour change is then drawn by its own redraw, after which `drawn.colors` holds it.
3. **Given** any run kind (layout, rebuild for a day, recolour, reorder, restyle, the line options' redraw, Run all), **When** any other field is written during its window, **Then** `drawn` holds exactly what that run's `map.build` was sent, field by field, and nothing the run did not send.
4. **Given** a run cancelled after its `map.build` answered (a map on disk since engine v0.18.0), **Then** its record is written with `drawn` from what it sent, as today.

---

### User Story 2 - A choice made at the press, or during a run, is never lost (Priority: P1)

As someone who picks a mode and presses **Lay out** in the same breath, or changes the operator, tuning or day just before **Run all**, I want the run to use what I chose. I want nothing I chose to be silently undone when the run's record comes back.

**Why this priority**: issues 388, 399 and 407 were each a version of this. Each was fixed by its own mechanism, and none of the fixes is visible to the next control.

**Independent Test**: the existing end-to-end tests for 388, 399 and 407 pass unchanged against the new design: `tuning.spec.ts`, `inspect.spec.ts`, `layout.spec.ts`, and `colours.spec.ts`, `order.spec.ts` and `style.spec.ts` for the 399 cases. So do one new unit test per run kind: a write sent before the press is in the run's inputs, and a write sent after it is not in `drawn`.

**Acceptance Scenarios**:

1. **Given** a mode, operator or tuning committed by the same click that presses **Lay out** (blur then click), **Then** the layout reads the committed value (388).
2. **Given** **Run all** pressed with a day choice still in its debounce, **Then** the plan and the run use that day (407).
3. **Given** a choice made and undone during its own build, **Then** the map ends at the undone choice and the record agrees (399).
4. **Given** the operator chosen just after the mode, **Then** neither undoes the other (407).

---

### User Story 3 - Every cheap edit behaves the same way (Priority: P2)

As someone using the colour chips, the order list, the sizes and looks, and the line options, I want each to wait, hold, give back a refused change and follow the record the same way, so that what I learn on one is true of the others.

**Why this priority**: the drift between the four copies is how 399 happened twice. A fifth cheap edit should cost a few lines, not ninety.

**Independent Test**: one table of behaviours (debounce, hold while busy, put back on a refused start, adoption, unmount) run against each of the four panels through a rendered test. Each row goes red under a mutation of the shared hook.

**Acceptance Scenarios**:

1. **Given** a change on any of the four panels, **Then** it is drawn after that panel's redraw delay, as today. Colours keeps its gesture rule: it follows while the chip moves and releases at the end, with no debounce.
2. **Given** a run going, or the record being read back after one, **When** a change is made, **Then** it is held and drawn once the way is clear, on every panel.
3. **Given** a redraw refused at its start, **Then** the control goes back to what the record holds and says the engine's sentence, on every panel.
4. **Given** the panel's own redraw running, **When** the record changes, **Then** the panel does not take the record's value for the fields its own redraw is drawing until that redraw has ended. It takes every other field at once. *Decided here, not open:* this is Sizes' and Options' behaviour today. It is the one that cannot put a value on screen and then take it away mid-redraw, which is what Order's and Colours' adoption can do.
5. **Given** a change still waiting when its panel unmounts (the cell closed, or the project left), **Then** it is flushed: drawn and kept as if its delay had run out. If the redraw is refused, the engine's sentence is said on the project's status line, since the control is gone. *As of 24 Oct 2026:* the maintainer chose flush (Q1, A).

---

### User Story 4 - Main refuses what would break a running export or request (Priority: P2)

As someone who presses **Delete project** while an export of it is still writing, or starts an export while a redraw is writing the map, I want the app to refuse with a sentence. It must never leave a half-written export or a deleted folder that a running job is still writing into. This must hold even if a disabled button were somehow pressed.

**Why this priority**: today only the renderer's disabled buttons hold these rules, and `remove.confirm` (`useProjectState.ts:572-581`) does not re-read the run state at the moment of confirming.

**Independent Test**: from a unit test of main, with the renderer's guards removed:
- start an export while a `map.build` for the project is in flight;
- delete a project while its export runs;
- delete a project while a `map.build` naming it is in flight.

Each is refused with its sentence, and nothing on disk changes.

**Acceptance Scenarios**:

1. **Given** an engine request in flight that writes the project's `out` folder, **When** an export of that project starts, **Then** main refuses it with "This project's map is being drawn. Wait for it to finish, then export." Nothing is planned or written.
2. **Given** an export of the project running, **When** its deletion is confirmed, **Then** main refuses with "This project is exporting. Wait for the export to finish or cancel it, then delete the project." The record and `out/<id>` are untouched.
3. **Given** an engine request naming the project in flight, **When** its deletion is confirmed, **Then** main refuses with "This project is being drawn. Wait for it to finish or cancel it, then delete the project."
4. **Given** none of these, **Then** export and delete behave exactly as today.

---

### User Story 5 - The record's code is split by what it is (Priority: P3)

As a contributor reading or changing the record, I want its types, its parsing, its validators, its sentences and its helpers each in a module of their own, imported only by the process that uses them, so that a change to one is not a change to a 2,154-line file every process imports (2,321 lines and 136 exports when it was split, issue 492).

**Why this priority**: it is enabling work for the rest of this spec and for any future record field. It changes no behaviour.

**Independent Test**: an import-graph unit test that fails if the renderer imports a main-only module, if main imports a renderer-only one, if shared code imports either, if a value cycle with `shared/export.ts` returns, or if `shared/project.ts` comes back (`tests/unit/import-graph.test.ts`).

**Acceptance Scenarios**:

1. **Given** the split, **Then** `shared/project.ts`'s exports (130 when this was written, 136 at the split) live in modules grouped as research-426.md section 6 lists them: types; parse and persistence (main only); field and whole-object validators; sentences; and derived helpers, one module per process where only one imports them. No export is lost, and none is duplicated. `shared/project.ts` itself is deleted, with no re-export left behind (research R7).
2. **Given** the exports nothing else under `src/` imports (24 when this was written, 25 at the split), **Then** each is either deleted, made private to its module, or kept with a comment saying who uses it (a test, or the generator).
3. **Given** the build and the unit suite, **Then** both pass with no behaviour change.

### Edge Cases

- **A record written before `revision` existed** reads as revision 0, and its first write makes it 1. A record from a newer build keeps its unknown keys (ADR-056), and `revision` is one of the record's own facts in `RECORD_FACTS`.
- **A write that arrives for a deleted project** is refused with today's sentence for a missing project, and creates nothing.
- **The reset** (Settings' "Reset engine data") still refuses every write while its flag is up. The session's queue is drained or refused before the reset walks the folders, never written into them after.
- **The engine restarts mid-run:** the run fails as today, and nothing it did not draw is recorded as drawn.
- **Two runs of one project at once** cannot happen today. A layout and an export are exclusive in the renderer, and from User Story 4 also in main. The session still serialises their writes if they ever overlap.
- **`markOpened`**, today the one in-place patch, becomes a patch like any other. It changes only `opened` and never raises `revision` for staleness purposes. It does raise it as a write.
- **The app quits with writes queued:** the queue is flushed before the store closes, within the shutdown's existing deadline, or abandoned with a log line. A half-written record is never possible, because `writeAtomic` already guarantees that.
- **The theme** is never sent to `map.build`; the page restyles in place through `setTheme` (issue 349). So `drawn.theme` is the theme the page was last told, written by the theme's own patch. That is today's behaviour under a truthful name.

## Requirements *(mandatory)*

### Functional Requirements

**The record and `drawn`**

- **FR-001**: The record MUST carry an optional `revision`: a whole number that the store raises by one on every write. It is an additive field under ADR-056's rule: no version bump, and absent reads as 0.
- **FR-002**: Every run's completion MUST carry exactly what its `map.build` was sent: the layout and its `made`, the day, the palette and default colour, the line order, the style as sent, the lines as sent, and the stations it answered.
- **FR-003**: `drawn` MUST be built from what the run sent (FR-002), never from the record at the moment of the write. `drawnFrom`'s reliance on the record goes, and so does its comment saying so.
- **FR-004**: The layout's completion MUST record the run's own day as `drawn.date`. The fallback `record.date ?? done.date` goes.

**The record session (main)**

- **FR-005**: Main MUST hold one record session per project. Every write to a record goes through it:
  - the fifteen `ProjectStore` writers, `markOpened`, and `setDestination` by way of `Destinations`;
  - each as a patch of the fields it names, applied in arrival order to the record as it then stands;
  - no writer replaces a field it was not asked to change.
- **FR-006**: A read of a record MUST wait behind the writes already queued for it, so `get` answers with every write sent before it.
- **FR-007**: Every run's start MUST read its inputs from the session after every write sent before the press has landed. This covers the layout, the rebuild for a day, Run all, and the four redraws. The renderer's `writing`, `writingFrom`, `#taken`, `#current`, `beforeStart`'s ordering role and `#afterWrites` are then removed, not kept beside it.
- **FR-008**: Before FR-007 is built, one Electron test MUST establish whether two `ipcRenderer.invoke` calls from one renderer are handled by main in the order they were sent, under load. If they are, FR-007 rests on that order. If they are not, every write and every start carries a sequence number from the renderer, and the session orders by it. The test stays in the suite either way.
- **FR-009**: The theme's keep-latest serialiser, the export choice's serialiser and the tuning cell's in-flight counter MUST be replaced by the session's ordering. Each control then writes and takes the answer, with no ordering of its own.

**The cheap edits (renderer)**

- **FR-010**: One hook MUST carry the cheap edits' shared behaviour for Colours, Order, Sizes (with looks and markers) and Line options:
  - each panel's redraw delay, and Colours' gesture rule (follow, then release at the end);
  - the hold while a run is going or the record is being read back;
  - putting a control back on a refused start, with the engine's sentence;
  - adoption as User Story 3's scenario 4 decides it;
  - the unmount rule: flush, with a refusal said on the project's status line (User Story 3, scenario 5).

  The four hand-built copies are removed.
- **FR-011**: The rule a new control must follow MUST be written once, in `docs/ARCHITECTURE.md` under a section "The record session", and referenced from the hook's and the session's headers. The stale comment at `ServiceDay.tsx:96-98` is corrected. Specs 012, 015, 033 and 036 keep their history and point at the section.

**Invariants (main)**

- **FR-012**: Main MUST refuse:
  - an export of a project while an engine request that writes the project's `out` folder is in flight;
  - a project's deletion while its export runs;
  - a project's deletion while an engine request addressing the project is in flight.

  A fourth refusal the spec did not foresee: a `map.build` for a project is refused with "This project is being deleted." while its deletion runs, so it cannot write into the folder being removed (issue 491).

  Two more, which close what issue 491 left to the screen (issue 505): a `map.build` for a project whose export is running is refused with "This project is exporting. Wait for the export to finish or cancel it, then try again."; and a `map.build` whose `out` names no project record - a layout's closing `map.build` after its project was deleted while `graph.build` ran - is refused with "This project has been deleted.", or with "This project could not be found in time. Try again." when the store does not answer within `FOLDERS_TIMEOUT_MS`. A record that is there but cannot be read is let through. The bridge marks the request before it asks, so an export or a deletion begun while it asks is refused. Only a layout's earlier steps, which name a feed and not a project, are still the screen's alone, and they write nothing of the project's.

  Each refusal uses User Story 4's sentence, and nothing changes on disk. The renderer's disabled states stay as the first line, and `remove.confirm` re-reads the run state at the moment of confirming.

**The split**

- **FR-013**: `shared/project.ts` MUST be split by what it holds, as User Story 5 says. An import-graph unit test holds the boundaries. The value cycle with `shared/export.ts` is removed.

**Tests and behaviour**

- **FR-014**: Every end-to-end test that pins 388, 399 and 407 MUST pass unchanged. A unit test of a removed mechanism is re-aimed at the session or the hook. Each removed test is named in the pull request beside the test that now covers its case, so none goes silently. Those are the `layout-run`, `panel-release`, `project-state-writes`, `inspect-writes`, `service-day-writes`, `theme-writes` and `run-all` suites (research-426.md section 9).
- **FR-015**: New tests MUST include:
  - R3-02's probe: a day written mid-run is not `drawn.date`;
  - User Story 1's matrix, each run kind against each field;
  - User Story 3's table, per panel;
  - User Story 4's three refusals, from main with the renderer guard removed;
  - the invoke-order test (FR-008).

  Each is shown failing under its named mutation.
- **FR-016**: No behaviour a person can see changes, except for these:
  - `drawn` is truthful, so a cell can say a day or a choice is not drawn yet where today it says nothing;
  - the three refusals in main;
  - the panels agree on Rule 1 and Rule 2.

**Delivery**

- **FR-017**: The work MUST be delivered as four issues, each its own branch and pull request, built in this order:
  1. `revision`, the sent set, `drawn` from it, the record session in main and FR-008's invoke-order test (FR-001 to FR-009);
  2. the cheap-edit hook (FR-010, FR-011);
  3. the three invariants in main (FR-012);
  4. the split of `shared/project.ts` (FR-013).

  (3) and (4) depend only on (1) and may be built beside (2). FR-014 to FR-016 apply to each in its part. Issue 426 is the umbrella and closes with the last. *As of 24 Oct 2026:* the maintainer chose four issues (Q2, A).

### Key Entities

- **Record**: a project's versioned JSON file. It gains `revision` (FR-001); everything else is as ADR-056 and the record schema hold it.
- **`drawn`**: what the map now on disk was drawn from. It is built from a run's **sent set** (FR-002/003), never from the record at the write.
- **Sent set**: the fields a run's `map.build` was sent, carried by its completion.
- **Record session**: main's per-project queue of patches and reads. It is the only path to a record file, and the only place a run's inputs are read from.
- **Cheap edit**: a choice that is drawn by a `map.build` from the stored layout, never by a re-layout: colours, order, sizes and looks, line options. Theme, day, tuning and inputs are writes, not cheap edits, and use the session directly.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In User Story 1's matrix (seven run kinds against every field a run sends, each written mid-run), `drawn` equals what the run sent in 100% of cases. Today it does not, for the day and for every cheap-edit field during a layout.
- **SC-002**: The five renderer mechanisms are gone. A search of `src/` finds no `writing`, `writingFrom`, `#taken`, `mustWait` or `#afterWrites`, and no serialiser of record writes outside the session. *As of 24 Oct 2026 (issue 490):* `mustWait`, with `stoppedNow` and `refusedAtStart` in `panelRelease.ts` and the `usePutBack` hook, remains as the cheap edits' hook's internals (`useCheapEdit.ts`, its only caller); what is gone is every panel's own use of them (research R5, "Part 2 design").
- **SC-003**: The four panels' copies, about 340 lines of debounce, hold, put-back and adoption code (research-426.md section 4), are replaced by one hook. No panel carries more than a few lines of its own for these behaviours.
- **SC-004**: The end-to-end suites for 388, 399 and 407 pass 10 loaded loops on each of the three platforms (the `e2e-loop` workflow), as the flakes of the 23 Oct wave were closed.
- **SC-005**: Each of the three invariants has a main-side test that fails when main's check is removed, and passes with the renderer's guard removed.
- **SC-006**: No renderer file imports a main-only part of the record's code, and no main file a renderer-only part, by the import-graph test.

## Clarifications

### Session 2026-10-24

- Q: A cheap edit still waiting when its panel unmounts: flush, cancel, or flush within the project only? → A: Flush (A). User Story 3, scenario 5, and FR-010.
- Q: Is this delivered as one pull request or several? → A: Four issues in order (A). FR-017.

The questions as they were put, kept for the reasoning:

### Q1: A cheap edit still waiting when its panel goes away

User Story 3, scenario 5. Today Sizes, Options and the day flush it, Order cancels it, and Colours drops a held release. The cell can close mid-debounce, or the person can leave the project. The question is which one rule all of them follow.

| Option | Answer | Implications |
|---|---|---|
| A | **Flush** (recommended): the change is drawn and kept as if the delay had run out | Nothing a person chose is lost by closing a cell. A refusal then has no control to show it on, so it is said on the project's status line. |
| B | **Cancel**: the change is dropped, and the record keeps what it had | The simplest rule. A person who closes a cell quickly loses the last change silently. |
| C | **Flush within the project, cancel on leaving it** | A change survives a closed cell, but not leaving the project. Two cases to explain. |

### Q2: How this is delivered

The issue estimates about a week of work plus some 5,000 lines of tests re-aimed. The repository's rule is one issue, one branch, one pull request.

| Option | Answer | Implications |
|---|---|---|
| A | **Split into four issues** (recommended), built in this order: (1) `revision`, the sent set, `drawn`, the session and FR-008's test; (2) the cheap-edit hook; (3) the three invariants; (4) the split | Each pull request is reviewable and its own lane. (3) and (4) are independent of (2) and can run beside it. Issue 426 becomes the umbrella and closes with the last. |
| B | **One pull request** | One review of the whole design, but a very large diff, one lane, and nothing lands until all of it does. |
| C | **Two**: (1)+(2) as one, then (3)+(4) | Fewer reviews, but the first is still most of the risk. |

## Assumptions

- The layout run's **orchestration** stays in the renderer: `graph.build`, `feeds.service` and `map.build` are still sent from `layoutRun.ts`. Its **write model** and its **input reads** move to the session (FR-005-FR-007). Moving the orchestration itself into main is not asked for, and would be another spec.
- The redraw delays, the progress lines and every sentence a person sees stay as they are, apart from FR-012's three new sentences and FR-016's truthful *not drawn yet*.
- The issue's dependency, issue 429 (the method allowlist and the run-kind union), has landed (9497a51). The union is used where it helps. Folding the four redraw methods into one is not required here.
- The engine needs no change. Everything here is in the app.
- `docs/ARCHITECTURE.md`, `.claude/rules/main.md` and `.claude/rules/renderer.md` change with the code, as the constitution's workflow asks.
