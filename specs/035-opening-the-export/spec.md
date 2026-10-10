# Feature Specification: Opening the export

**Feature Branch**: `035-opening-the-export`

**Created**: 2026-10-10

**Status**: Draft

**Input**: Issue 392, "Cell 06: open the export on a title card and the network drawing in, and the capture that drives them (the app half of engine 44)"; engine issue 44, at the v0.15.0 pin (issue 389). The issue's block "Decided on 10 Oct 2026" and the lane brief's settled list are the coordinator's decisions; each is recorded below as an "*As of 10 Oct 2026:*" line under the requirement it settles. Where the lane had to decide something the two are silent on, the line says so ("the lane's").

## What the engine gives

`StoryboardBeat` (what `export.storyboards` answers and what `export.plan` takes as a list) and `BeatPayload` (what a plan's beats are) take two flags, `card` and `draw_in`, written only where true and false when left out; neither is inherited from the beat before. A `card` beat puts the title card up for the whole beat: the city, the network, the service day and the caption on a scrim of the page's ground, the overlay's name and clock hidden under it, cutting in at the beat's first frame and out after its last. A `draw_in` beat draws the network in over the beat, line after line in stacking order, the trains and the clock held until it is whole. The engine's `authored_beats` refuses, with `params` and a sentence naming the beat from 0 (`storyboard[2].secs ...`): a card shorter than 1 second; a draw-in shorter than 2 seconds; a second draw-in; a draw-in that sweeps; a draw-in on, or carried onto, the linear or the time view; any beat before the draw-in that names the linear or the time view; and, as before, a list past 90 seconds or 16 beats, a beat outside 0.5 to 30 seconds, a first beat without a view, a first beat whose `tween` is not 0 or null, and a first beat without `at` (unless it sweeps a span). A first beat's null `tween` is read as 0; a later beat's null `tween` is kept null and given `min(secs, 1.2)` in the plan's payload. A plan with a card carries the city, the network and the day on its address whether or not the title is drawn, and a card whose words need longer to read than it lasts, at 0.3 seconds a word, comes with a note ("the title card at storyboard[0] says 14 words, about 4.2 seconds of reading at 0.3 seconds a word, and lasts 2. Lengthen the beat, or shorten the caption."). The page's seam gains `setCard(on)` and `setDrawn(fraction)`, `state()` reports `card` and `drawn`, and `settle()` returns a promise that resolves once the map's face has loaded (the snap itself happens before it returns, as it always did). The engine's own recorder (`bin/_record.js`) drives them: `setCard(!!b.card)` at every beat's start when any beat has a card, `setDrawn(0)` after its settle when any beat has a draw-in, and on frame `i` of `n` of a draw-in beat `advance(1/fps)` and then `setDrawn(n > 1 ? i / (n - 1) : 1)`. The eight named storyboards plan byte for byte as they did.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An export that opens on its title card (Priority: P1)

As someone posting a city's transit as a video, I want the video to open on a card that names the city, the network and the day, so that a person scrolling past knows what they are looking at before the map moves.

**Why this priority**: it is the feature's first half and the simpler one; the engine has had it since v0.15.0 and nothing in the app can ask for it.

**Independent Test**: in cell 06, with a video preset, choose **Opening** "Title card", export, and read the `export.plan` the stand-in engine recorded and what the stand-in page was asked during the capture.

**Acceptance Scenarios**:

1. **Given** cell 06 open on a video or GIF preset, **Then** after **Storyboard** there is a native select **Opening** offering "None", "Title card", "The network drawing in" and "Title card, then the network drawing in", on "None" for a project that never chose one.
2. **Given** a still preset, **Then** there is no **Opening**.
3. **Given** "Title card" chosen, **Then** the record's `export` holds `opening: "card"` at once, a numeric field **Card** appears under the select, showing 2, and the preview is planned again.
4. **Given** that choice, **When** the preview or the export is planned, **Then** `export.plan` is sent a list of beats: the card beat first, then the storyboard's own beats as `export.storyboards` writes them, and not the storyboard's name.
5. **Given** that export, **When** it is captured, **Then** the page is asked `setCard(true)` at the card beat's start and `setCard(false)` at every later beat's start, and never `setDrawn`.
6. **Given** a card too short for its words, **Then** the engine's note says so where the plan's other notes are, and the export is not refused.

---

### User Story 2 - An export in which the network draws itself in (Priority: P1)

As the same person, I want the network to draw itself in before the trains run, so that the shape of the system is the first thing seen.

**Why this priority**: the other half; the capture has to drive it frame by frame, and it is the destructive path.

**Independent Test**: choose "The network drawing in" (or the card then the draw-in), export, and read what the stand-in page was asked.

**Acceptance Scenarios**:

1. **Given** "The network drawing in" chosen, **Then** a numeric field **Draw-in** appears, showing 6, and the record holds `opening: "draw-in"`.
2. **Given** "Title card, then the network drawing in", **Then** both fields appear, and the list sent starts with the card beat and then the draw-in beat.
3. **Given** an export with a draw-in, **When** it is captured, **Then** the page is asked `setDrawn(0)` after its settle and before the first beat, and on each frame of the draw-in beat `advance(1/fps)` and then `setDrawn(i / (n - 1))`, the last frame's fraction 1.
4. **Given** a storyboard that opens on the linear or the time view, **Then** every opening is offered and can be chosen, and the list is planned and exported as before any other storyboard, its first beat keeping its view and sent a tween of 0.

---

### User Story 3 - Nothing else moves (Priority: P1)

As anyone who exports today, I want an export without an opening to be exactly what it was.

**Why this priority**: the capture is the destructive path, and the determinism suite holds its frames to the last byte of the request and the tolerance of the pixels.

**Independent Test**: export with **Opening** on "None"; read the plan the stand-in recorded and every call the capture made.

**Acceptance Scenarios**:

1. **Given** "None", **Then** `export.plan` is sent what it was sent before this feature: the storyboard's name where one was chosen, nothing where the preset's own plays, and no list; `export.storyboards` is not asked by the export.
2. **Given** a capture job whose beats carry neither flag, **Then** the capture makes exactly the calls it made before, in the same order, with the same scripts, byte for byte.
3. **Given** a project that never chose an opening, **Then** its record gains no key.

### Edge Cases

- **A storyboard that opens on the rows or the chart** (none of the engine's eight does): the opening is offered, kept and sent as for any other storyboard, since the engine takes it (FR-004).
- **A still**: the opening and its durations stay in the record, as every option does across presets, and are neither shown nor sent.
- **A number out of range, or not a number, typed in Card or Draw-in**: refused beside the field, `aria-invalid`, nothing written, nothing planned; emptied, the field goes back to its default and the record holds nothing for it.
- **A page drawn before v0.15.0** (a map drawn by the previous pin and not drawn since): the capture refuses before its first frame, in a sentence that says to draw the map again or choose no opening, and nothing is written.
- **The 90-second ceiling**: an opening on the longest storyboard and the longest durations adds at most 30 seconds; none of the eight storyboards reaches 90 with it, and a list that would is refused by the engine, its sentence shown as any refused plan's is.
- **An export already running**: the opening's controls are disabled with the rest of the choices.
- **A read-only project**: no choices are drawn, as now.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cell 06 MUST offer an **Opening** for a video or GIF preset.
  - *As of 10 Oct 2026:* an Opening choice, not a beat editor: cell 06's video and GIF options (not a still) gain a native select **Opening**: None (default), Title card, The network drawing in, Title card, then the network drawing in.
  - *As of 10 Oct 2026:* it sits in cell 06's options after **Storyboard** and before **Start time**, shown only for a video or GIF preset and only when a storyboard is chosen (a still has the start time and no storyboard, so on screen the two never meet).
  - *As of 10 Oct 2026 (the lane's):* the select is the kit's (`kit/Select.tsx`), as the preset and the storyboard are, with the issue's four words as its options and nothing marked. Under it, one `.message` sentence says what it does: "What plays before the storyboard: a title card naming the city, the network and the service day, with the caption under them, or the network drawing itself in, line by line." (It said "drawing itself in on the map" until the opening came to stand on the geographic view too, below.) The refusals and the plan's notes stay where they are, now under the three selects.
- **FR-002**: A card or a draw-in MUST have a duration a person can set.
  - *As of 10 Oct 2026:* with a card or a draw-in chosen, a numeric field for each appears: **Card** in seconds (1 to 10, default 2) and **Draw-in** in seconds (2 to 20, default 6).
  - *As of 10 Oct 2026 (the lane's):* each is cell 06's typed-field pattern (the start time's and the tag's): a label, the kit's text field, and a `.message` under it saying the range and the default ("How long the title card stays up: 1 to 10 seconds, 2 unless you change it.", "How long the network takes to draw itself in: 2 to 20 seconds, 6 unless you change it."), read when committed (Enter, or leaving the field) and never on a keystroke. A number outside the range, or text that is not a number, puts the refusal in that line's place in `--error` ("A title card lasts from 1 to 10 seconds.", "A draw-in lasts from 2 to 20 seconds."), marks the field `aria-invalid`, keeps what was typed and writes nothing. An emptied field goes back to its default. Any number in the range is taken, a decimal included, as the engine takes one.
- **FR-003**: The choice MUST be the export's, in the record.
  - *As of 10 Oct 2026:* the choice is the export's, written to the record's `export` the moment it is made (`opening`, `cardSecs`, `drawInSecs`, all optional, absent meaning None).
  - *As of 10 Oct 2026 (the lane's):* `opening` is `card`, `draw-in` or `card-then-draw-in`; None is never stored, and neither is a duration at its default, so a project that never chose an opening has no key and choosing None or 2 removes one. The durations are kept when the opening changes, as every option is kept across presets. `RECORD_VERSION` is unmoved, under the run-graph contract's three criteria, as `tuning` was: the fields are optional on read; their absence is what every export before them was; and the one released build holds records at version 1 and reads a version-2 record as read-only.
  - *As of 10 Oct 2026 (the lane's):* the store and the bridge refuse what `validateExportChoice` refuses (an opening not one of the three, a duration not a number or outside its range, a field not on the list); on read the three are taken field by field and one that would be refused is read as not held, the rest of the choice kept, because an opening read as None sends exactly what an export sent before this feature. The rest of the choice is still whole or the reel.
- **FR-004**: The app MUST compose the beat list it sends.
  - *As of 10 Oct 2026:* with Opening not None the plan call sends an authored list: the opening beats, then the chosen storyboard's own beats from `export.storyboards`, every field explicit. The opening beats name the map view and the storyboard's first clock; the card (if any) comes first and the draw-in (if any) follows it, so a card followed by a draw-in puts the card on bare ground and the network draws in under it, as the engine decided.
  - *As of 10 Oct 2026:* the list is built in one pure function; with Opening None it returns nothing and the plan is requested by the storyboard's name as today, so every existing request is unchanged.
  - *As of 10 Oct 2026 (the lane's):* the function is `openingBeats` in `src/shared/opening.ts`, not beside `exportChoice.ts`: the main process builds every plan (`src/main/export.ts`, for the preview and the export alike) and cannot import the renderer's modules, which are another TypeScript project. The renderer's `src/renderer/src/opening.ts` holds the tab's own pure parts. The main process asks `export.storyboards` for the storyboard's beats only when an opening is to be sent, so a plan without one asks the engine exactly what it asked before.
  - *As of 10 Oct 2026 (the coordinator's, superseding the decision's "the opening beats name the map view"):* the opening plays on the storyboard's own first view when that is the map or the geographic view, and otherwise on the map. Three of the engine's eight (`transform`, `transform-loop`, `essay-loop`) open on the geographic view, which the engine says they do with a tween of 0 so as not to open on the schematic map, "the whole argument told in reverse"; their card and draw-in are on the geographic view, which the engine allows a draw-in on (its `DRAW_IN_VIEWS`), so the network draws in on the view the storyboard starts from and no cut to the ground follows, and the preview shows that view. Before a storyboard that opens on the rows or the time chart (none of the eight today) the opening is on the map, as first decided. A card alone sits over whatever that first view shows. (`openingView` in `src/shared/opening.ts`; held against the engine at the tag by `opening-real.test.ts` for a map storyboard, a geographic one and one on the rows.)
  - *As of 10 Oct 2026 (the coordinator's, superseding "the storyboard's first clock" in the decision above):* the opening's beats stand at the page's own start clock, 07:00, and not at the storyboard's first clock. With a list the engine puts the first beat's `at` on the page's address, so the capture's first look at the page ("no trains at …", `src/main/capture.ts`) ran at the storyboard's first clock (05:30 for `tour` and `reveal`, 05:00 for `day`) instead of at the page's own start, where it has always run for a storyboard asked for by name: on a feed with no train at 05:30 the export without an opening succeeds and the same export with one was refused, in a sentence the person can do nothing about. The clock is the page's when its address names none: `let now = 7 * 3600` in the engine's `src/schematic/page/page.html` at v0.15.0, line 1163, which `export.PAGE_START = "07:00"` (`src/schematic/export.py`, line 72) restates; the app's `PAGE_START` in `src/shared/opening.ts` cites both. It is explicit on the opening's beats, since the engine requires a first beat to name its clock. The storyboard's first beat keeps its own `at` and `tween: 0` and jumps to its clock after the opening, by which time the network is whole and the card gone, the clock overlay having been hidden under the card and held during the draw-in. A storyboard whose first beat names no clock of its own still has no opening (`OPENING_UNMADE`): it would play from 07:00 and not from its own clock. An end-to-end test exports `tour` with a card and with a draw-in on the stand-in, whose page draws trains only from 06:00 to 22:00, and asserts the capture's first look read 07:00.
  - *As of 10 Oct 2026 (the lane's):* every beat carries the nine fields `export.storyboards` writes (`secs`, `view`, `labels`, `at`, `speed`, `sweep`, `hours`, `span`, `tween`), nulls included, and a flag only where it is true, as the engine writes them. An opening beat is `view` as the line above says, `at` the page's own start (the line below; it was the storyboard's first clock until then), `labels: null`, `sweep: false`, `hours` and `span` null, `tween: 0`, and `speed: 0` - the clock holds under the opening, which the card covers and the draw-in holds anyway - unless the storyboard's first beat names no speed, where it is null, so the storyboard's own beats play at the speed they always did.
  - *As of 10 Oct 2026:* the storyboard's first beat, now second or third, keeps its own view and gets a tween the engine accepts; the lane states the engine's rule. **The rule (engine v0.15.0, `authored_beats` and `beat_payload`):** a first beat's `tween` must be 0 or null, and null there is read as 0; a later beat's `tween` may be any number of seconds from 0, and a null there is kept null and played as `min(secs, 1.2)`. So the storyboard's first beat, which was read with a tween of 0 when it was first, is sent with `tween: 0`, explicitly: it cuts into its own first view and plays exactly as it did. Its `at` is its own, which is the opening's, so the clock does not jump. Checked against the engine at the tag: `authored_beats` takes the card, the draw-in and both before "tour", and the plan's payload carries the 0.
  - *As of 10 Oct 2026:* a storyboard that opens on the linear or the time view is refused by the engine for a draw-in; the app says so in a sentence beside the control and sends nothing it knows the engine will refuse. A draw-in choice is disabled with a sentence beside it when the storyboard opens on the linear or time view ("The network can draw itself in on the map or the geographic view; this storyboard opens on the rows") rather than sent to be refused.
  - *As of 10 Oct 2026 (the coordinator's, superseding the line above):* the premise was false at v0.15.0, so the app does not refuse what the engine accepts. The engine's refusals concern the draw-in's own view and the views of the beats *before* it; the opening's beats come first and are on a view a draw-in may be on, so `authored_beats` accepts a card, a draw-in or both before a storyboard that opens on the rows (probed against the engine at the tag on 10 Oct 2026, and held by `opening-real.test.ts`, which plans all three before one). Every opening is offered for every storyboard, none disabled and no sentence beside them, a stored draw-in is never taken out on a change of storyboard or preset, and the list is sent whatever view the storyboard opens on. What the engine does refuse - a list past 90 seconds, or, for a storyboard that drew the network in itself, a second draw-in (none of the engine's eight does) - is its refusal, shown as any plan's is.
  - *As of 10 Oct 2026:* the 90 s ceiling is the engine's refusal, shown as it is for any plan.
  - *As of 10 Oct 2026 (the coordinator's):* an opening is never dropped silently. Where one is chosen (`needsStoryboards`) and its list cannot be made - the storyboard is not among those `export.storyboards` lists, or its first beat names no clock to open at - the preview and the export refuse it, in the bad-call kind with the `params` kind, "The opening cannot be made from this storyboard; choose None or another storyboard.", rather than plan by the storyboard's name and make an export without the opening cell 06 says plays (`openingStoryboards` in `src/main/export.ts`). Neither cause arises with the engine's eight storyboards at v0.15.0: every opening before each of them, at the defaults and at a card of 10 and a draw-in of 20 seconds, is planned by the engine at the tag (`opening-real.test.ts`).
- **FR-005**: The preview MUST NOT play the opening.
  - *As of 10 Oct 2026:* the preview frame shows the page at the plan's pose and does not play the opening; its note says that the opening plays in the export.
  - *As of 10 Oct 2026 (the lane's):* the preview's plan is the export's (without `safe`'s difference), so it carries the list, is refused or noted as the export would be, and its address is the list's first beat: the view the opening stands on, at the page's own start. The note is one `.prose` sentence after the cell's first, drawn while an opening is chosen: "The opening plays in the export and not in the preview, which shows the map it plays over."
- **FR-006**: The plan's notes MUST be shown.
  - *As of 10 Oct 2026:* the plan's notes (the engine's reading note when a card is too short for its words) are shown where the plan's other notes are.
  - That is the existing `role="status"` line under the selects, as the engine writes it, and the export's own "Planned ..." sentence, which already carries every note; nothing new is drawn for it.
- **FR-007**: The capture MUST drive the card and the draw-in.
  - *As of 10 Oct 2026:* the capture (`src/main/capture.ts`, the destructive path: the reviewer reads it twice) awaits the page's `settle()`; calls `setCard` at each beat when the list has a card; calls `setDrawn(0)` after the settle when the list has a draw-in; and on each draw-in frame advances first and then calls `setDrawn(i / (n - 1))`.
  - *As of 10 Oct 2026:* with `bin/_record.js` as the model for the order: after `setCapture(true)` and the navigation, `await settle()` (a promise now; resolved before the first frame); at each beat's start `setCard(b.card === true)` when any beat in the job has `card`; after the settle `setDrawn(0)` when any beat has `draw_in`; on each frame of a draw-in beat `advance(dt)` first and then `setDrawn(i / (n - 1))`. Calls are made through the same evaluate mechanism the capture already uses to drive the seam, with the same timeouts.
  - *As of 10 Oct 2026 (the lane's):* each call is one evaluation of its own, in the order above, through the capture's own `evaluate` and its frame timeout; only numbers are interpolated into a script. `setCard` is its own evaluation immediately before the beat's (`applyBeat`), which is the recorder's order within its one evaluation. A draw-in beat of one frame gets the fraction 1, as the recorder's does.
  - *As of 10 Oct 2026 (the lane's, superseded below):* the settle is awaited only for a job with an opening; a job with neither flag makes the call it always made, unawaited (FR-008). The awaited form resolves to true whether the page's `settle()` answers a promise or nothing, so it works on any page that has the seam.
  - *As of 10 Oct 2026 (the coordinator's):* every capture awaits the page's `settle()`, through the same evaluate with its frame timeout. At v0.15.0 it answers a promise that resolves once the map's face has loaded, and cell 04 is about to let a project choose an embedded face (lane 391): an export without an opening that did not wait could take its first frame before the face is in. A page whose `settle()` answers nothing (an older engine's page, the stand-in's older pages) resolves at once; a promise that never resolves ends in the frame's timeout with the existing sentence ("settling the page took longer than 30 s"), the frames removed and the window destroyed, never a hang.
  - *As of 10 Oct 2026 (the lane's):* before the settle, a job with a flag asks the page once whether it has the call it needs (`setCard`, `setDrawn` or both) and refuses, before any frame, with "this map was drawn before it could open on a title card or draw itself in; draw the map again, or choose no opening": a page drawn by the previous pin and not drawn since lacks them, and a call it lacks would otherwise fail mid-capture as a script error.
  - *As of 10 Oct 2026 (the lane's):* `validateCaptureJob` takes `card` and `draw_in` where they are true or false and refuses anything else, and refuses a draw-in that sweeps (the engine refuses it at the plan; the capture is the guard on what reaches the page). Since the second review of 10 Oct 2026 it also refuses a draw-in of no frame (`Math.round(secs * fps) < 1`) and a second draw-in, either of which would leave the network undrawn; the engine plans neither. `Beat` in `src/shared/capture.ts` gains the two optional flags, the engine's `BeatPayload`'s.
- **FR-008**: A capture job without the flags MUST be captured exactly as before.
  - *As of 10 Oct 2026:* a list without the flags captures as before, byte for byte (the determinism suite is unchanged and must stay green); a job with neither flag takes exactly the old code path (asserted in a unit test by recording the calls).
  - The unit test records every script the capture evaluates and every protocol command it sends for a job without flags, and holds them to a transcript taken from the capture before this change (`tests/fixtures/capture-transcript.json`). `tests/e2e/determinism.spec.ts` is not touched; it exports with no opening.
  - *As of 10 Oct 2026 (the coordinator's):* the old path changes by exactly one thing, the settle awaited (FR-007's last line). The transcript was taken again for that change alone: in each of its three jobs the settle's script is the awaited one and the recording page notes its promise resolving before the next call, and nothing else differs. Any other change to the path still fails the test.
- **FR-009**: Nothing about where an export goes MUST change.
  - *As of 10 Oct 2026:* nothing about the export folder, the sidecar, the destination guards or the reset changes.
  - *As of 10 Oct 2026 (the coordinator's):* one field of the sidecar does change, because the plan does: the sidecar of an export with an opening says `"storyboard": "custom"`, the engine's name for a storyboard written as a list, instead of the storyboard that played (its `view` and its alt text are still made from the beats); the app writes nothing of the sidecar, and the acceptance checklist's step 12 says so.
- **FR-010**: The stand-in engine and page MUST take the opening as the engine does.
  - *As of 10 Oct 2026:* the stand-in page learns `setCard`, `setDrawn` and their `state()` fields, so the suite can drive the capture with the stand-in engine.
  - *As of 10 Oct 2026 (the lane's):* the stand-in engine's `export.plan` takes `card` and `draw_in` with the engine's bounds and its sentences, writes them into the plan's beats only where true, and adds the engine's reading note for a card too short for its words; `export.encode` takes them back, refusing a flag that is not true or false as the engine's handler does. A control key, `storyboard_first_view`, makes a named storyboard of its table open on another view, so the suite has one that opens on the rows. The stand-in page records what the capture asked it in `window.__seen` and, while it is being captured, says each call once on its console (`seam [name, value]`), which an end-to-end test reads in the main process; its `settle()` answers a promise. `tests/unit/stand-in-shapes.test.ts` holds the new answers to the description and the refusals to the engine's sentences.
- **FR-011**: The documents that quote cell 06 MUST gain the control's sentences in the same change.
  - `docs/DESIGN.md` 8.2's cell 06 row gains the opening; `docs/acceptance.md` step 11 notes **Opening** on "None", step 12's GIF is exported with "Title card, then the network drawing in", its look a person's check and recorded by the automated run as not automated, never passed, and step 17 finds the opening kept after a restart; `docs/accessibility.md` gains a cell 06 row and a walkthrough paragraph, its VoiceOver and Narrator columns a person's and not yet run. The stranger's timed run (`docs/acceptance-stranger.md`) exports the reel as it comes and gains nothing. (The lane brief named acceptance steps 17 to 19; in the checklist at this commit cell 06 is steps 11 and 12, and 17 to 19 are the rename, diagnostics and licences.)

### Key Entities

- **Opening**: what plays before a storyboard in a video or GIF export: none, a title card, the network drawing in, or the card and then the draw-in; with a duration for each, the app's defaults 2 and 6 seconds.
- **Authored list**: the beats `export.plan` is sent in place of a storyboard's name when there is an opening: the opening's beats, then the storyboard's own.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An end-to-end test records an `export.plan` whose `storyboard` is a list beginning with the card beat and then the draw-in beat, and a capture whose page was asked `setDrawn(0)` before the first beat, `setCard(true)` and then `setCard(false)`, and on every draw-in frame `advance` and then `setDrawn`, ending at 1.
- **SC-002**: With "None", the export's `export.plan` is the request it was before, and the capture's transcript for a job without flags equals the transcript taken before the change.
- **SC-003**: The determinism suite is unchanged and green on the three runners.
- **SC-004**: Every decision above has a unit test that was watched failing under a named mutation, or an end-to-end test whose mutation is named for the coordinator to run.

## Assumptions

- The engine pin is v0.15.0 (issue 389, merged), whose page has `setCard` and `setDrawn` and whose `export.plan` takes the two flags.
- A card's words, its look and the draw-in's look are the engine's page's; the app drives the seam and draws nothing (constitution I). Whether a card or a draw-in looks right is a person's check, in the gate's step 12.
- Lane 391 (cell 04's looks, markers, trains and typeface) owns the record's `style`, `StyleFields.tsx`, `StyleCell.tsx` and `layoutRun.ts`'s `map.build` parameters; this feature's hunks in the files both touch are the export's.
