# Feature Specification: Layout tuning

**Feature Branch**: `033-layout-tuning`

**Created**: 2026-10-09

**Status**: Implemented 2026-10-09 (#386)

**Input**: Issue 385, "Layout tuning in cell 02: LOOM's grid, merge distance, grid size and bend penalties, a tuned layout being a layout of its own (the app half of engine 37)"; engine issue 37 (E26), at the v0.14.0 pin (issue 383). The issue's paragraph "Decided on 9 Oct 2026" and the lane brief's settled list are the coordinator's decisions; each is recorded below as an "*As of 9 Oct 2026:*" line under the requirement it settles.

## What the engine takes

`graph.build` takes an optional `tuning` (`LayoutTuning` in `src/shared/protocol.ts`, the engine's `serve._tuning` and `pipeline`'s table): `merge_distance`, topo's `-d`, 5 to 500 metres, LOOM's default 50; `grid`, octi's `-b`, one of `octilinear`, `ortholinear`, `orthoradial`, `hexalinear`, LOOM's default `octilinear`; `grid_size`, octi's `-g`, 25 to 400 percent of the distance between adjacent stations, LOOM's default 100; and `penalties` (`LayoutPenalties`), octi's bend costs `deg45`, `deg90`, `deg135`, `deg180` and `diagonal`, each 0 to 10, LOOM's defaults 2, 1.5, 1, 0 and 0.5. The flags are part of the layout's id, so a tuned layout is a layout of its own and the same tuning finds it again without running a tool. A field equal to LOOM's default writes no flag, so leaving `tuning` out, sending `{}` and sending only defaults all name the layout stored today. A value out of range, an unknown grid, a field not on the list and a null are refused with the `params` kind, before any tool starts, in sentences of the form "tuning.merge_distance must be from 5 to 500, in metres". `LayoutMeta.stages` shows the flags a stored layout was made with.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A tuned layout (Priority: P1)

As someone whose network octi draws badly on its own grid - a city of rings and spokes, a network of right angles - I want to choose LOOM's grid for this project and lay it out again, so that the map is the tuned one.

**Why this priority**: it is the feature. The engine has taken the tuning since v0.14.0 and nothing in the app can send it.

**Independent Test**: on a laid-out project, open **Layout tuning** in cell 02, choose `orthoradial` in **Grid**, press **Lay out again**, and read the `graph.build` the stand-in engine recorded and the layout the project now names.

**Acceptance Scenarios**:

1. **Given** a project this version can write, **When** cell 02 is open, **Then** under the layout's own controls (**Lay out** or **Lay out again**, and **Re-layout**) there is a disclosure **Layout tuning**, closed, whose row reads "Layout tuning" and "LOOM’s defaults".
2. **Given** the disclosure opened, **Then** it holds one sentence saying what the tuning is, a native select **Grid** offering the engine's four grids, each with a gloss, `octilinear` chosen, two numeric fields **Merge distance** and **Grid size**, a group **Bend penalties** of five numeric fields **45°**, **90°**, **135°**, **180°** and **Diagonal**, and a button **Reset to LOOM’s defaults**.
3. **Given** a grid chosen, **Then** the record's `tuning` holds it at once, the row reads "tuned", and nothing runs: no `graph.build`, no `map.build`, the map's frame where it was.
4. **Given** a record that holds a tuning, **When** a layout run starts (**Lay out**, **Lay out again**, **Re-layout** or **Run all**), **Then** `graph.build` is sent `tuning` in the engine's names, carrying exactly the fields the record holds and nothing else, and the record keeps the tuning that run was asked with once the run has written.
5. **Given** that run finished, **Then** the project names the layout the engine answered for the tuning, and cell 02 says so in the sentence a run that lands on another layout already says ("Laid out. The layout differs from the one the project had recorded, so the project now names this one.").
6. **Given** the tuning set back to what an earlier layout was asked with, **When** the project is laid out again, **Then** the engine answers that earlier layout, by the same id, without running a tool (the engine's own behaviour; the stand-in answers the same id for the same tuning).

---

### User Story 2 - The fields' ranges, defaults and refusals (Priority: P2)

As someone tuning a layout, I want each number to say what it takes and what LOOM uses without it, and a number LOOM would refuse to be refused where I typed it, so that no layout run fails over a typing slip.

**Why this priority**: the engine refuses a value out of range only once a run is asked for; a field that let one through would fail the run minutes later, in another place.

**Independent Test**: type 600 in **Merge distance** and press Enter; read the sentence beside it and the record.

**Acceptance Scenarios**:

1. **Given** the disclosure open, **Then** each numeric field shows the record's number, or LOOM's own while it holds none, and is described by its range and LOOM's own: "5 to 500 metres. LOOM’s own is 50.", "25 to 400 percent of the distance between adjacent stations. LOOM’s own is 100.", and for each penalty "0 to 10. LOOM’s own is `<n>`." (2, 1.5, 1, 0, 0.5).
2. **Given** a field typed over, **Then** nothing is read until Enter or until focus leaves the field; never on a keystroke.
3. **Given** a number outside the field's range, or text that is not a number, **When** committed, **Then** the engine's own sentence for that field is shown beside it in a `role="alert"` line ("tuning.merge_distance must be from 5 to 500, in metres"), the field carries `aria-invalid` and keeps what was typed, and nothing is written.
4. **Given** a field emptied, **When** committed, **Then** it goes back to LOOM's own and the record holds nothing for it.
5. **Given** a field set to LOOM's own number, **Then** the record holds nothing for it, as though it had never been set.

---

### User Story 3 - A changed tuning reports the layout stale (Priority: P3)

As someone who has changed the tuning, I want the notebook to say the map on screen was laid out without it, and to bring it up to date only when I ask, so that a change that costs a layout run is never made behind my back.

**Why this priority**: a changed tuning is an expensive edge; without it the record would claim a layout the map does not show.

**Independent Test**: on a laid-out project, choose a grid; read cells 02 to 06, the header and the map; press **Run all**.

**Acceptance Scenarios**:

1. **Given** a laid-out project whose record's tuning differs from the tuning its layout was asked with, **Then** cells 03 to 06 read **not drawn yet**, the header says "03 Day to 06 Export are not drawn yet." and offers **Run all**, cell 02 says "Lay out again to use this tuning: the map on screen was laid out with LOOM’s defaults." (or "… with another tuning.", or "Lay out again to use LOOM’s defaults: …" after a reset), and the map stays exactly where it was.
2. **Given** that state, **Then** nothing lays out by itself.
3. **Given** that state, **When** **Lay out again** or **Run all** runs and finishes, **Then** the run was sent the record's tuning, the cells read **ready**, and cell 02's sentence is gone.
4. **Given** that state, **When** a colour, the order, a size, the theme or the service day is changed, or an export is made, **Then** each does what it did before, from the stored layout, and the staleness stays until the layout is run again.
5. **Given** **Re-layout**, **Then** its warning (ADR-033) is the one it was, word for word.

*As of 29 Oct 2026 (issue 565):* cell 03 is called "Day", and scenario 1 above quotes the header with that name. When this was written the header said "03 Frame and service day to 06 Export are not drawn yet."; the rail cut that name short.

---

### User Story 4 - Reset, and a project that never tuned (Priority: P4)

As someone who has tuned too far, I want one press to put LOOM's defaults back; and as anyone else, I want a project I never tuned to be exactly what it was.

**Why this priority**: the way back has to exist, and the projects people already have must not move.

**Independent Test**: tune two fields, press **Reset to LOOM’s defaults**, read the record and the row; open a project made before this feature and lay it out.

**Acceptance Scenarios**:

1. **Given** any field or the grid away from LOOM's own, or a refused number waiting in a field, **Then** **Reset to LOOM’s defaults** can be pressed; otherwise it cannot.
2. **Given** a press on it, **Then** every field and the grid show LOOM's own, the refusals are gone, the record holds no `tuning`, the row reads "LOOM’s defaults", and focus is on the disclosure's heading before the button stops being pressable.
3. **Given** a project that never touched the tuning, **Then** its file holds neither `tuning` nor the tuning its layout was asked with, its `graph.build` is sent exactly the parameters it was sent before this feature (`key`, `mode`, `agency`, and `force` for a re-layout), and its layout id does not move.
4. **Given** a tuned project closed and opened again, **Then** the disclosure shows its tuning and its row reads "tuned".

### Edge Cases

- **A project made by a newer version of the app**: cell 02 offers no run, as now, and so no tuning either; its one sentence stands.
- **Before the first layout**: the tuning can be chosen, and the first **Lay out** sends it. Nothing is stale before there is a layout.
- **A tuning committed while a layout run goes**: it is written at once. The run sends what it was started with, the record keeps that as what the layout was asked with, and the layout reads stale when the run ends. Nothing is disabled for the run, as no cheap edit is.
- **The tuning put back to what the layout was asked with**: nothing is stale, whether it went back field by field or by Reset; the comparison is of what the engine would be sent, so a field at LOOM's own number and a field not held are the same.
- **A record edited by hand**: a number out of range, a grid the engine does not offer, a field not on the list or a value of the wrong kind is read as not held, field by field, so the run sends only what the store would have kept.
- **A write refused** (the engine data being reset, a record that cannot be written): one sentence in the section says the tuning was not saved, and why, and the fields go back to the record.
- **An export while the layout is stale**: allowed, as stale never blocks an export (run-graph contract); it exports the map on screen.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cell 02 MUST hold a disclosure, **Layout tuning**, under the layout's own controls, closed when the project opens, whose row says whether the record holds a tuning.
  - *As of 9 Oct 2026:* the controls sit in cell 02, because the tuning is an input to the layout run and to nothing else. The disclosure is closed and sits under the layout's own controls; its summary says "LOOM’s defaults" while every field is at its default and "tuned" otherwise, so a collapsed disclosure still tells.
  - The disclosure's toggle sits in an `h3` (the kit's `Disclosure` with a heading), a level below the cell's own row, because the tuning is a section of the cell, and the heading is where Reset hands focus (FR-005). Its disclosed part is a group named "Layout tuning". The row reads "Layout tuning" and, in `--text-muted`, the word. Cell 02's own collapsed row is unchanged.
  - It is drawn for a project this version can write, with a layout or without one, and not for a read-only project, whose cell offers no run.
- **FR-002**: The grid MUST be chosen in a native select, **Grid**, offering the engine's four grids in the engine's words, each with a gloss.
  - *As of 9 Oct 2026:* a native select **Grid** with the engine's four words, `octilinear` (the default), `ortholinear`, `orthoradial`, `hexalinear`, each with a one-line gloss in the voice of section 11 of `docs/DESIGN.md`, saying what the lattice looks like: eight directions; four; rings and spokes; six. All four are offered, since the engine refuses the research variants itself.
  - The options read "octilinear (eight directions; LOOM’s own)", "ortholinear (four directions)", "orthoradial (rings and spokes)" and "hexalinear (six directions)". It is the kit's select (`kit/Select.tsx`), as the mode and the preset are. A choice is written the moment it is made.
  - *As of 30 Oct 2026 (issue 560):* the plain words come first and the engine's word in a bracket, the default marked: "Eight directions (octilinear; the default)", "Four directions (ortholinear)", "Rings and spokes (orthoradial)", "Six directions (hexalinear)". The row's word is "the defaults", each field's description ends "The default is `<n>`.", the section's lead is "The settings LOOM, the layout engine, lays this project out with. …", the cells' one naming of LOOM, and the penalties' sentence begins "What the layout pays".
- **FR-003**: Merge distance, grid size and the five bend penalties MUST be numeric fields in cell 04's pattern (issue 350): labelled, described by their range and LOOM's own number, committed on Enter or on leaving.
  - *As of 9 Oct 2026:* **Merge distance** in metres (5 to 500, default 50), **Grid size** in percent of the distance between adjacent stations (25 to 400, default 100), and the five bend penalties **45°**, **90°**, **135°**, **180°** and **Diagonal** (0 to 10; defaults 2, 1.5, 1, 0, 0.5), each labelled, described by its range and its default, committed on Enter or on leaving. No slider is mapped over anything.
  - The five penalties are a group, a `fieldset` whose legend is **Bend penalties**, with one sentence saying what a penalty is, because a field named "45°" says nothing on its own. The pattern is copied, not shared: `StyleFields.tsx` is not touched, and the figure reader both use (`parseFigure`, `styleRules.ts`) is imported from where it is.
- **FR-004**: A number the engine would refuse MUST be refused beside its field before anything is written.
  - *As of 9 Oct 2026:* a value out of range is refused beside the field with the range in the sentence, and nothing is written.
  - The sentence is the engine's own for the field, word for word (`serve._tuned` at v0.14.0), as cell 04 says the engine's sentence for a size: "tuning.merge_distance must be from 5 to 500, in metres", "tuning.grid_size must be from 25 to 400, as a percentage of the distance between adjacent stations", "tuning.penalties.deg45 must be from 0 to 10, as a cost without a unit" (and so on for each penalty). Text that is not a number gets the same sentence. It is a `.message.error` line with `role="alert"` under the field, in the field's description, with `aria-invalid` on the field and the text left as typed.
- **FR-005**: "Reset to LOOM’s defaults" MUST clear every field and the grid.
  - *As of 9 Oct 2026:* **"Reset to LOOM's defaults"** clears every field and the grid, is disabled while everything is at its default, and hands focus to the disclosure's summary as cell 04's Reset hands it to the heading.
  - Focus goes to the `h3` the summary's toggle sits in, which takes focus and does nothing with it (`tabIndex={-1}`), not to the toggle itself, where a reflexive Space would close the section a person is working in (cell 04's reason). It is pressable while a refused number waits in a field, as cell 04's is, since clearing that is part of what it does.
  - *As of 30 Oct 2026 (issue 560):* the button is **Reset to the defaults**, and Put back's line says "The tuning is back to the defaults. …".
  - *As of 29 Oct 2026:* on a layout made with a tuning, Reset hands focus to **Put back the tuning this layout was made with**, which comes beside it and writes `laidOutWith` back, and Put back hands focus back to Reset as it goes (issue 561, ADR-061). On a layout made with LOOM's defaults it hands focus to the `h3` as above.
- **FR-006**: The record MUST keep the tuning as `tuning`, optional, absent meaning LOOM's defaults.
  - *As of 9 Oct 2026:* `tuning` on the record, optional: absent means LOOM's defaults, and a field equal to its default is not stored, so a project that never touched the tuning has no `tuning` and a reset removes it. `RECORD_VERSION` is unmoved, as `drawn.stations` was added. The main process validates it as it validates `style`: the ranges above, the four grids, no other field, and refuses the rest. The choice is written the moment it is committed, as the export's options are.
  - The record's names are the engine's in camel case, the five penalties flat beside the others, as the style's are (`mergeDistance`, `grid`, `gridSize`, `deg45`, `deg90`, `deg135`, `deg180`, `diagonal`): one list then drives the fields, the validator and the reader, and one table in `src/shared/project.ts` (`TUNING_RANGES`, `DEFAULT_TUNING`, `GRIDS`) carries each field's name on the wire, its range, its unit and LOOM's own number, held to the committed protocol schema by a unit test.
  - It is written through a new bridge method, `projects.setTuning(id, tuning)`, which writes the whole tuning the section shows, as `completeStyle` writes the whole style; the handler and the store both refuse what `validateTuning` refuses.
  - The version stays at 2 under the run-graph contract's three criteria: the field is optional on read; its absence is LOOM's defaults, which is what every project before it was laid out with; and the one released build, v0.1.0, holds records at version 1 and reads a version-2 record as read-only, so it never writes one and cannot drop the field. A build between issue 350 and this one would drop it on a write, and the next layout would then be untuned; none was released.
  - On read the tuning is taken field by field, and a field that would be refused on write is read as not held (the colours' and the order's rule, not the style's), so a hand-edited value never reaches `graph.build`.
- **FR-007**: The next layout run MUST pass the record's tuning to `graph.build` as the engine takes it.
  - *As of 9 Oct 2026:* the next layout run passes the record's `tuning` to `graph.build` as the engine takes it (`LayoutTuning`, only the fields the record holds). The engine's `LayoutMeta.stages` is the truth of what a stored layout was tuned with; the app does not compute flags.
  - "The record" is the one the run was started with, as for the mode and the agency. No `tuning` key at all is sent for a record that holds none, so an untuned request is the one the app has always sent. The penalties go as the engine's `penalties` object, present only when one of them is held.
  - *As of 24 Oct 2026 (spec 037):* the waits, `run.writing`, `#current` and `writingFrom` described below are superseded by docs/ARCHITECTURE.md, "The record session": every run reads its record from the store at its start, queued behind the writes sent before it.
  - *As of 12 Oct 2026 (issue 388):* a field committed by leaving it for **Lay out again** or **Lay out** is the one that run sends. (Run all makes the same promise for the layout it makes, but it chooses *which* run to make, a layout or a rebuild for the day, from the record at the press; with a tuning or a mode committed by that press and only the day behind it makes a rebuild, which waits for the write, reads it, draws the day and sends no `graph.build`, so one more press lays out. That, a window of about one task between the store's answer and the screen rendering it, and two ordering faults beside the start are issue 407.) The commit is a write through the bridge, still on its way as the press starts the run, so the run's start waits for the writes to the record on their way and reads the record they leave. The screen hands the run each write of a field a layout run reads as it sends it (`run.writing` around `projects.setTuning`, `setInputs` and `setDate` in `useProjectState.ts`); the run is going from the press, with Cancel and "Starting the layout." on the screen, and reads the store's answer to the last of those writes the store took, which is the record as it then stood, or, where it took none, the record it was handed, which is then the record as it stands; a refusal is shown where it always was. With nothing on its way the run reads the record it was handed at once, in the same turn, as before. Waiting was chosen over a reference the writers update the moment they accept a value: a value accepted is not yet a value kept, and a run started from one the store then refused would lay out a tuning the record never held. The wait lives in the run's own start, `start` and `rebuild` in `engine/layoutRun.ts`, which every press reaches, so **Lay out**, **Lay out again**, **Re-layout**, **Run all** and the rebuild for a chosen day all read the record the same way, and none of the screens that start them changed. It has no deadline, since a write the store has not answered has not landed; a cancel ends it. A write sent after the press is not waited for: the run sends what it was started with.
  - *As of 12 Oct 2026 (issue 407):* **Run all** chooses its run, a layout or a rebuild for the day, from the record the writes on their way leave, and no longer from the record the screen held at the press. The header calls `LayoutRun.runAll(record, engine, runAllPlan)`, and the run makes the plan from the record a start reads and the run as the press found it (a failure, a re-layout stopped half way). With nothing on its way that is the record handed, and the layout or the rebuild is started, or refused, in the press's own turn, with the job, the flags and the refusals it always had. With a write on its way the run is going from the press as the press's plan would go (its job, its flags, the cell that reads running), waits as a start does, and makes the plan again from the record the writes leave: a tuning or a mode committed by the press on Run all, with only the day behind, is laid out at once, rather than the day drawn and one more press asked for; and a day still on its way is the day the rebuild draws and writes, rather than the day the screen showed written back over it. Where the plan changes after the wait the job is the same one (its id, its start, its log), renamed for the run it became. A press whose plan at the press is nothing, with a write on its way, goes as a layout for the wait (cell 02 reads running and the inspector lists a layout run until the plan is made again); the header offers Run all only for a plan of its own, so this is a record the run reads newer than the screen's, and was left as it is rather than given a kind of its own. An engine that is not ready refuses at the press, as the run the press would have started does, since nothing waits to be refused. Where the writes leave nothing to run (a mode or a day put back, its write on its way at the press) nothing runs: the run goes back to the very snapshot and job it had before the press, no job ends, and the screen, which reads the record back and loads the map again after a run that finished, does not take one put back for one (`useProjectState.ts`). A redraw for colours, line options, the order or the sizes that had stopped is the exception, and goes back to idle, with no kind, sentence or figures of that redraw: its panel puts its control back to the record on the change into its own stop (`stoppedNow`, `usePutBack`), so a stop put back after the press would read as a second one and drop a change the panel held while Run all waited. Put back rather than ended as cancelled, since nobody stopped anything, and rather than the press's plan run anyway, which for a day put back would draw and write the day the person had just left. `runAllPlan` is unchanged and pure, and is handed in so the run needs nothing of the run graph's.
  - *As of 12 Oct 2026 (issue 407):* a press made in the beat between a write's answer and the screen rendering it reads the store's answer. A write leaves those on their way the moment the store answers it, and React draws the answer a task or so later, so a press in that beat was handed the record from before the write and, with nothing then on its way, used it at once. The run keeps the store's answer to the latest write it was sent and took (by the order the writes were sent, not the order the answers arrived), and `start`, `rebuild` and `runAll` read it in place of the record handed where the store's own stamp on it (`modified`, which every write moves) is later than the handed record's; otherwise, the same stamp included, the record handed, which is then the newer or the same: a later edit the screen has drawn, a run's own write read back. The answer is the whole record as the store then held it, every earlier write in it, so it is read whole, as a start that waited reads it. The answer is forgotten when a run finishes: the run's own write and the record read back after it supersede it, which keeps the reliance on the store's clock to the one beat it is for, rather than until the next write, across a clock that steps back. The redraws for colours, the order, the sizes and the line options are left as issue 388 left them.
  - *As of 12 Oct 2026 (issue 407):* "A write sent after the press is not waited for" holds with one qualification. An operator chosen in cell 01 while a mode was on its way is sent only once every write sent before it has landed, and is made from the store's answer to those (spec 015 FR-003); if it is still waiting at the press, the run waits for it, and a field committed after the press but sent before the operator, a tuning say, is in the answer the run reads, so the run sends it. The record stays whole, since `laidOutWith` records what the layout was asked with; this was not restructured for, as it takes an operator, a mode and a later commit inside one round trip to the store.
- **FR-008**: The record MUST keep, beside the layout's id, the tuning that layout was asked with.
  - *As of 9 Oct 2026:* the record keeps, beside the layout id, the tuning that layout was asked with (`laidOutWith`, or the same field inside `drawn`: the smaller change, said why here).
  - It is `laidOutWith`, a field of the record beside `layout`, `made` and `built`, in `tuning`'s shape and under its rules: optional, absent meaning LOOM's defaults, a field at LOOM's own number not kept. It is the smaller change because only one writer moves it, `completeLayout`, in the same write as the layout's id, and nothing else has to know it exists; inside `drawn` every draw would copy it (a recolour, a reorder, a resize and a rebuild all go through `drawnFrom`), so each of those writers would have to be taught to keep the old value rather than copy the record's, and a record whose `drawn` is null, from before A5.5-04, would lose it altogether. It is `built`'s counterpart: `built` is what the engine says the layout was made with, `laidOutWith` what the app asked it with, because reading the tuning back from `LayoutMeta.stages` would mean computing flags.
  - The run hands it to the store: `LayoutDone` gains an optional `tuning`, the tuning the run sent, in the record's names, and `completeLayout` writes it (or removes `laidOutWith` for a run sent none). Copying the record's own `tuning` at the end of the run instead would record a tuning committed while the run went as one the layout was made with.
  - An absent `laidOutWith` beside a layout is LOOM's defaults, which is what every layout before this feature was asked with, so an existing project reads current.
- **FR-009**: A changed tuning MUST be an expensive edge.
  - *As of 9 Oct 2026:* a changed tuning is an expensive edge: cell 02 and Run all report the layout stale when the record's `tuning` differs from it, in the run graph's own words; nothing re-lays out by itself, and the next **Lay out again** or **Run all** re-lays with the tuning and clears the staleness. An export, a redraw, the colours, the order, the theme and the service day are unaffected until then. The warning behind a re-layout (ADR-033) stays as it is.
  - In the run graph (`specs/028-the-notebook/contracts/run-graph.md`) it is a source of cell 02's, reason `tuning`, raised when the record has a layout and `tuning` and `laidOutWith` would not send the same thing; it does not need `drawn`, as the inputs source does not. As every source does, it marks the cells below its own: 03 to 06 read **not drawn yet**, the header names them, and `runAllPlan` answers a layout, unforced. Cell 02 itself reads ready, because the cell holding a change is showing it, and says so in a sentence under its run, beside the inputs' sentence and on the same terms (`role="status"`, while no run is going or after one finished): "Lay out again to use this tuning: the map on screen was laid out with LOOM’s defaults.", "… with another tuning.", or "Lay out again to use LOOM’s defaults: the map on screen was laid out with another tuning."
- **FR-010**: Nothing MUST be drawn by the app.
  - *As of 9 Oct 2026:* nothing is drawn by the app, the map's frame is untouched, and the determinism suite's captures cannot move.
  - The section is fields and sentences. The determinism suite's fixture holds no tuning, so its `graph.build` is the one it always sent.
- **FR-011**: The stand-in engine MUST take a tuning as the engine does.
  - *As of 9 Oct 2026:* the stand-in engine records the `tuning` it was given on `graph.build` and answers a different layout id for a different tuning, so the suite can see the parameter cross and the staleness clear.
  - It records it in `fake-engine.received` with every message, as it does every parameter. The id hashes the fields not at LOOM's own number, so `{}`, defaults and no `tuning` name the untuned layout's id, which does not move. It refuses what `serve._tuning` refuses, with the `params` kind and the engine's sentences, and writes the flags into `meta.stages` as the engine does. `tests/unit/stand-in-shapes.test.ts` holds it to the description and to those sentences.
- **FR-012**: The documents that quote cell 02 MUST gain the section's sentences in the same change.
  - `docs/acceptance.md` step 6 (cell 02) gains the section's row, its fields and a refusal, with nothing written; `docs/accessibility.md` gains a cell 02 row and a walkthrough paragraph, its VoiceOver and Narrator columns a person's and not yet run; `docs/DESIGN.md` 8.2 gains a Layout tuning row; `specs/003-project/contracts/record.md` gains the two fields and its bridge contract the method; the run-graph contract gains the source. The stranger's timed run (`docs/acceptance-stranger.md`) never reaches cell 02's controls and gains nothing.

### Key Entities

- **Tuning**: what a person chose of LOOM's settings for a project's layout: a grid and seven numbers, each optional, absent meaning LOOM's own.
- **Laid out with**: the tuning the stored layout was asked with, kept beside the layout's id and written only when a layout run writes the layout.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The end-to-end test records a `graph.build` whose `tuning` is exactly the fields committed, in the engine's names, and a record whose `tuning` and `laidOutWith` agree once that run has written.
- **SC-002**: A project that never touched the tuning sends `graph.build` exactly the keys it sent before this feature, and its file gains no key.
- **SC-003**: The table of ranges, defaults and grids is held to the committed protocol schema by a unit test, so a pin that moves one fails there first.
- **SC-004**: The determinism suite's captures do not move (its fixture holds no tuning).
- **SC-005**: Every decision above has a unit test that was watched failing under a named mutation, or an end-to-end test whose mutation is named for the coordinator to run.

## Assumptions

- The engine pin is v0.14.0, which takes `tuning` on `graph.build` (issue 383, merged).
- The tuned geometry is the engine's; the app shows the page the engine writes and nothing else (constitution I).
- Lane 382 (the layout as it solves) owns `StageView.tsx`, `engine/stages.ts`, `DataCell.tsx` and the progress and snapshot handling in `engine/layoutRun.ts`; this feature's hunks in `layoutRun.ts` are the tuning the run sends `graph.build` and hands to `completeLayout`, and nothing else.
- No person's run of the gate covers a tuned layout at acceptance: step 6 reads the section and refuses a number, and writes nothing, so the steps after it see the layout they always did.
