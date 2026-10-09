# Feature Specification: The layout as it solves

**Feature Branch**: `032-the-layout-as-it-solves`

**Created**: 2026-10-09

**Status**: Draft

**Input**: Issue 382, "Draw the layout as it solves: cell 02 shows each stage as the run reaches it (the app half of engine 43)"; engine issue 43 (E27), released in engine v0.14.0, which the app pins since 1d90b66. The issue's title says cell 02; the coordinator settled cell 01, where the stages are drawn (FR-001).

What engine v0.14.0 gives, in its own words (`vendor/protocol.schema.json`): `job/progress` names the layout in `layout` on every report of one of a layout's four stages - as `graph.build` finishes each, the four it replays for a stored layout, and the four `map.build` replays before its own steps - and on no other report, a download's included. `render.stage` draws a stage a running build has finished from the build's scratch; one the build has not reached is refused with kind `layout` and `data: {layout, stage, building: true}`, where `stage` is the stage the answer waits on (octi when a `date` asks for minutes). A stored layout being laid out again (`force`) is drawn from its new build once the build has finished what the answer needs, and **from the store until then, never refused**. A cancel or a failure leaves nothing of the build's own to draw.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch a first layout solve (Priority: P1)

As someone laying out a city for the first time, I want to see each stage of the layout as the engine finishes it, so that the minutes a large feed takes show the network taking shape instead of a progress line and nothing else.

**Why this priority**: it is the feature; the engine has done its half and the app shows nothing until the run ends.

**Independent Test**: on a project never laid out, press Lay out with the stand-in reporting slowly, and watch cell 01's "Where the routes run" draw gtfs2graph, then topo, loom and octi, each before the next is reported.

**Acceptance Scenarios**:

1. **Given** a project with no layout, **When** a layout run reports its first stage, **Then** cell 01 shows "Where the routes run", and the pane draws gtfs2graph from the build before topo has been reported.
2. **Given** the run going, **When** each later stage is reported, **Then** the pane draws it, in the engine's order, and the sentence beside the pane names the stage drawn and the stage running ("topo drawn; loom running.").
3. **Given** a stage drawn, **Then** a polite live region says it once ("topo drawn.").
4. **Given** the run going, **Then** the two stage buttons are still "gtfs2graph" and "loom", a stage not yet reached is neither pressed nor disabled, and a press on one says it is not drawn yet.
5. **Given** the run ends, **When** the record it wrote has been read back, **Then** the view is what it is today for a stored layout: the store read under the new `made`, for the day drawn, with nothing left over from the run.

---

### User Story 2 - A stage the engine cannot draw yet is drawn when it can (Priority: P2)

As someone watching the run, I want a stage the engine refused as not yet to appear as soon as the engine can draw it, without the app asking on a timer.

**Why this priority**: the engine's contract says a not-yet refusal is worth asking again at a later report; without the retry a refused stage would never be drawn during the run.

**Independent Test**: with the stand-in told that a stage's answer waits on a later stage, watch that stage refused at its own report and drawn at the report of the stage it waited on.

**Acceptance Scenarios**:

1. **Given** a stage asked for at its report, **When** the engine refuses it with `building: true` and `stage: <S>`, **Then** nothing is shown as a failure and the stage is asked for again at the next report that names `<S>`, which need not be the stage asked for.
2. **Given** any other refusal, **Then** it is shown as the view shows a refusal today: the engine's sentence in a `role="alert"`.
3. **Given** the run, **Then** no request is made on a timer: the reports are the clock.

---

### User Story 3 - A cancel or a failure leaves nothing of what it drew (Priority: P3)

As someone who stopped a run, I want the stages it drew to go, because the engine has removed the build they were drawn from.

**Independent Test**: cancel a run after its first stage is drawn; the pane holds nothing from the run and one sentence says so; a project with a stored layout shows its stored drawing again.

**Acceptance Scenarios**:

1. **Given** a first layout with gtfs2graph drawn, **When** the run is cancelled, **Then** the pane draws nothing and says "The layout run was cancelled, so its stages are no longer drawn."
2. **Given** a run that fails, **Then** the same with "failed".
3. **Given** a project with a stored layout, **When** its run is cancelled or fails, **Then** the stored layout's drawings are drawn again, untouched, and the sentence adds "The stored layout is shown as it was."

---

### User Story 4 - A re-layout draws the new build and never the stored set (Priority: P4)

As someone re-laying out a project, I want the stages drawn during the run to be the new build's, and the stored set's drawings to stay as they were until the run ends.

**Independent Test**: on a laid-out project, press Re-layout with the stand-in marking each build's drawing; during the run the pane shows the new build's marks, and a cancel brings back the stored set's.

**Acceptance Scenarios**:

1. **Given** a forced re-layout under the same layout id, **When** a stage is reported, **Then** the pane draws that stage of the new build, never the stored set's.
2. **Given** the stored set's drawings already held, **Then** no drawing taken during the run is answered for the stored set, and none of the stored set's for the run.
3. **Given** the re-layout finishes, **Then** the view reads the store under the new `made`; **given** it is cancelled, **Then** the stored set's drawings are shown as they were.

### Edge Cases

- **A refusal that arrives after the stage it waits on has been reported**: the engine marks a stage readable before it reports it, but the refusal and the report travel separately, so the report can come first. The stage is asked again at once, because the report it waited for came after it was asked.
- **A refusal that waits on a stage already reported when it was asked**: not asked again, so a wrong answer cannot become a loop of requests; the stage stays not drawn until the run ends.
- **Drawings that land out of order, or together** (a retry): the pane shows the latest stage drawn in the engine's order; the live region says each as it lands, and two that land at once together ("loom drawn. octi drawn.").
- **The view mounted part way through a run** (a person comes back to the project): every stage reported so far is asked for at once.
- **A layout already stored and not forced**: the engine replays the four reports from the store and `render.stage` answers from the store; the reveal draws them as they come.
- **A redraw** (a chosen day, colours, an order, sizes): `map.build` replays the four stages with the layout too, but a redraw lays nothing out and the view draws nothing from it.
- **A forced re-layout stopped after `graph.build` answered** (`replaced`, A3-05): the engine's store holds the new set and the record names the old `made`, so the view, reading the record, shows the drawings it holds of the old set. This is the open edge `specs/028-the-notebook/contracts/run-graph.md` records for `replaced`, not one this issue opens.
- **A first layout whose map call fails after the layout answered**: the engine stored the set and the record does not name it; the view says the run failed and draws nothing.
- **The engine not ready**: nothing is asked.
- **Cell 01 collapsed** (a laid-out project opens with it collapsed): the view is in the document and says nothing aloud, because a collapsed cell's group is hidden.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reveal MUST be cell 01's stage view, "Where the routes run", and MUST draw nothing of its own.
  - *As of 9 Oct 2026:* the reveal is cell 01's stage view, where the stages are drawn. During a layout run the pane draws each stage as the run reaches it, in the engine's order (gtfs2graph, topo, loom, octi), from the engine's own `render.stage` over the build's scratch; nothing is drawn by the app.
  - The view is in cell 01 whenever the project has a layout, as before, and also from the first report of a layout run that names its layout until the next run starts, so a first layout shows it.
- **FR-002**: The run's snapshot MUST carry the layout id from the first report that names it, and the view MUST ask for each stage at its report.
  - *As of 9 Oct 2026:* `job/progress` for the run carries `layout` on every stage report (gtfs2graph, topo, loom, octi; never on `download`). The run's snapshot gains the layout id as soon as a report carries it. On each stage report the stage view asks `render.stage` for that stage with that id. No polling on a timer: the reports are the clock.
  - The id is cleared at the start of every run, so a run that starts and is refused carries none of the last run's.
  - The main process carries `layout` on a progress report to the page, and keeps `layout`, `stage` and `building` on an error's data of kind `layout`, the refusal's, each only when it has the engine's shape; until this issue it passed neither.
- **FR-003**: A not-yet refusal MUST be asked again on the report that names the stage it waits on.
  - *As of 9 Oct 2026:* a "not yet" refusal (`error.data.building` true) is asked again on the next report that names `data.stage`, which is the stage the answer waits on and not always the one asked for; any other refusal is shown as the view shows refusals today.
  - "The next report" is one that came after the ask (Edge Cases): a refusal whose stage was reported after the ask and before the refusal arrived is asked again at once; one whose stage was reported before the ask is not asked again.
- **FR-004**: During a run the view MUST ask for a stage without a service day.
  - This is not one of the decisions below; it follows from FR-007 and the engine's contract. A `date` makes the answer wait on octi, and for a stored layout being laid out again the engine answers from the store until the build has finished what the answer needs - so a stage asked for with a day during a re-layout would be the stored set's. Without a day each stage is drawn from the build as soon as it is reported, and its words carry no minutes (the extent sentence is left out, as for any untimed description). The day drawn returns with the store's drawings once the run ends (FR-006).
- **FR-005**: The stage cache MUST never answer a drawing from a build for the stored set, nor the reverse.
  - *As of 9 Oct 2026:* `stages.ts`'s slot is keyed by `made`, which during a forced re-layout is still the stored set's value. While a run is in flight the slot carries the run's own identity instead (the run id or the job id), so a drawing taken from the scratch is never answered for the stored set and never the reverse; when the run ends, the view reads the store under the new `made` as today.
  - The identity is the run's job id, one per attempt, so two re-layouts of one project never share a drawing. A run's drawings are forgotten when its reveal ends.
- **FR-006**: The end of a run MUST leave the view as a stored layout's, or cleared.
  - *As of 9 Oct 2026:* when the run finishes, the view is what it is today for a stored layout, with nothing left over from the reveal. A cancel or a failure clears what the reveal drew (the scratch is gone) and the pane says so in one sentence; the stored layout's drawings, where there was one, are untouched.
  - Between the run's end and the moment the record it wrote has been read back, the pane holds nothing and says "Drawing the stage…": a first layout is not left for that moment with no layout to draw, a re-layout is not drawn for it from the stored set it replaced, and the build's last stage is not left on screen as if it were the stored layout's.
  - The sentences: "The layout run was cancelled, so its stages are no longer drawn." and "The layout run failed, so its stages are no longer drawn.", each followed by "The stored layout is shown as it was." where the project has one. The sentence stays until the next run starts.
- **FR-007**: The view MUST say what is drawn and what is running, and keep its controls.
  - *As of 9 Oct 2026:* while the run goes, the pane's status sentence names the stage drawn and the stage running ("topo drawn; loom running"), in the voice of `docs/DESIGN.md` section 11, and the live region says each stage once as it is drawn. The two stage buttons keep their names; a stage not yet reached is neither pressed nor disabled, and the pane says it is not drawn yet.
  - The sentences: "Nothing drawn yet; `<running>` running." before the first drawing; "`<drawn>` drawn; `<running>` running." after it, the drawn stage the latest in the engine's order; "`<drawn>` drawn; the layout’s four stages are done." (with the typographic apostrophe the app writes) once no layout stage is running (the map is being drawn). The live region, visually hidden and polite, says "`<stage>` drawn." as each lands. A press on a stage not drawn yet says "`<stage>` is not drawn yet." beside the pane and in the live region. A button is pressed while its stage is the one in the pane.
  - *As of 9 Oct 2026:* a press on a stage already drawn during the run shows that stage, and the pane keeps it until the next stage is drawn, when it follows the run again; the press is also the stage the view shows once the run has ended. A second press on a stage not drawn yet says "`<stage>` is not drawn yet." again: the live region is emptied and filled a frame later, as the jobs' announcement is.
  - *As of 9 Oct 2026:* topo and octi, which have no button and so had no gloss, are "with platforms merged" and "straightened into the schematic" in the pane's name, from `docs/DESIGN.md` 8.2's own account of the two.
  - A stage not reached is not asked for early, even on a press: during a re-layout the engine would answer it from the stored set (FR-004's reason).
- **FR-008**: The reveal MUST change nothing of the export, the map or the record.
  - *As of 9 Oct 2026:* the map's frame is not touched by the reveal; no field is written to the record; the determinism suite's captures cannot move.
  - The view reaches the engine only through the stage reader it is given, which asks `render.stage` and nothing else.
- **FR-009**: The stand-in engine MUST do enough of v0.14.0 to drive the suite.
  - *As of 9 Oct 2026:* the stand-in engine learns enough to drive the suite: its `graph.build` reports carry `layout`, and its `render.stage` answers a stage once the stand-in's build has reported it and refuses an unreported one with the engine's exact refusal shape (`kind: layout`, `data: {layout, stage, building: true}`), so the end-to-end tests see the reveal, the not-yet retry and the clear on cancel.
  - As the engine does, it also names the layout on `map.build`'s four replays, makes a date wait on octi, answers a stored layout being laid out again from the store until the build has reported what is asked, and leaves nothing to draw after a cancel or a failure. Each drawing names the build it is of (`data-build`), so a test can tell the new build's from the stored set's. A control, `stage_waits_on`, makes one stage's answer wait on a later one, as a date makes the engine's wait on octi, because without it nothing the app asks is ever refused as not yet.

### Key Entities

- **The reveal**: a layout run that has named its layout, seen from the stage view - the run's identity, the layout, the run's state, the stages it has reported and the one it is at.
- **The run's identity**: the run's job id, which the drawings asked for during the run are cached under in place of `made`.
- **A not-yet refusal**: an error whose data carries `building: true` and the stage the answer waits on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the stand-in reporting a stage every 1.5 seconds, the pane draws gtfs2graph while the sentence still says topo is running.
- **SC-002**: No `render.stage` request made during a run carries a `date`, and the reveal sends nothing but `render.stage`.
- **SC-003**: A stage refused as not yet is asked for exactly twice: at its report and at the report of the stage it waited on.
- **SC-004**: After a cancel the pane holds no drawing from the run; after a re-layout's cancel it holds the stored set's.

## Assumptions

- The engine pin is v0.14.0 or later, with `JobProgress.layout` and the three `ErrorData` fields.
- A layout run's four stages are drawn whole by `render.stage` from the build; the app adds no picture of its own (constitution I).
- Two of the three gate documents quote the stage view: the acceptance checklist (step 4, the run, and step 5) and the accessibility pass (cell 01's row and the walkthrough). The stranger's timed run never reaches cell 01's stage view and gains nothing. `docs/DESIGN.md` 8.2's row for the geographic pane gains the reveal.
