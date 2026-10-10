# Feature Specification: Looks, marker shapes, trains and the label typeface

**Feature Branch**: `034-looks-markers-trains-faces`

**Created**: 2026-10-10

**Status**: Draft

**Input**: Issue 391, "Cell 04: looks, marker shapes, trains and the label typeface (the app half of engine 73 to 76)"; engine issues 73, 74, 75 and 76, at the v0.15.0 pin (issue 389). The issue's block "Decided on 10 Oct 2026" and the lane brief's settled list are the coordinator's decisions; each is recorded below as an "*As of 10 Oct 2026:*" line under the requirement it settles. Where this spec had to read a decision one way, it says so and why, and where the reading could reasonably go the other way it carries a `[NEEDS CLARIFICATION]` marker beside what was built.

## What the engine takes

At v0.15.0 (`CHANGELOG.md` 0.15.0, `serve._style`, `serve.style_presets`, `serve.map_build`, `render.PRESETS`, `render.STYLE_SHAPES`, `render.LABEL_FONTS`, `animate.DOT_RADIUS_RANGE` and `TRAIL_RANGE`; in the app's types `MapStyle`, `StylePreset`, `StylePresets` and `MapBuildParams`):

- **`style.presets`**, a method with no parameters, answers three looks in order, `beck`, `blueprint` and `paper`, each a name and the fields of `style` it stands for: all eight numbers, and for `beck` also `station_shape: "tick"`. A look carries no colour and no face. `map.build`'s `style` also takes `{ "preset": name }`, alone or with `label_font`, and refuses a name beside any other field; the app never sends it (FR-001).
- **`MapStyle.station_shape`**: `circle`, `tick` or `square`, `circle` when omitted. **`MapStyle.interchange_shape`**: `circle` or `square` (never a tick), `circle` when omitted. Either outside its list is refused with the `params` kind: "style.station_shape must be circle, tick or square", "style.interchange_shape must be circle or square".
- **`MapStyle.label_font`**: `system`, `inter` or `atkinson-hyperlegible-next`, `system` when omitted; the two faces ship with the engine and are embedded in the SVG, so nothing is fetched. Refused otherwise: "style.label_font must be system, inter or atkinson-hyperlegible-next".
- **`MapBuildParams.dot_radius`** (2 to 12, in SVG user units at the map's width, 5 when omitted) and **`MapBuildParams.trail`** (0 to 3 seconds of playback, 0 when omitted) sit beside `style`, not inside it: they are the animation's, reach the page's data only, and never the SVG. Refused out of range: "dot_radius must be from 2 to 12, in SVG user units at the map's width", "trail must be from 0 to 3, in seconds of playback". A trail is drawn under the dots; a train standing at a station has none, nor has the Time view, nor a page under reduced motion that no exporter is capturing.
- Every new field and parameter at its default draws exactly what was drawn before.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A look in one choice (Priority: P1)

As someone who wants a map that looks like a transit map and not like a default, I want to choose one of the engine's named looks, so that the map's sizes and markers change together into something designed, in one redraw.

**Why this priority**: it is the most value per press: eight numbers and a marker that belong together, chosen at once.

**Independent Test**: on a laid-out project, open cell 04, choose **Beck** in **Look**, and read the `map.build` the stand-in engine recorded and the record's `style`.

**Acceptance Scenarios**:

1. **Given** a laid-out project with the engine running, **When** cell 04 is open, **Then** the first control of the **Sizes** group is a native select **Look** offering **The engine’s sizes** first and then the engine's looks in the engine's order, each by its name with a capital (**Beck**, **Blueprint**, **Paper**), with **The engine’s sizes** chosen for a project nobody has styled.
2. **Given** **Beck** chosen, **Then** after the redraw delay the map is drawn once from the stored layout with exactly Beck's fields that are not the engine's own numbers, in the engine's names (`line_width` 6, `line_gap` 1.33, `station_radius` 3.6, `interchange_radius` 7.5, `station_stroke` 3, `label_offset` 10, `station_shape` "tick"), never `preset`; the record's `style` then holds the same fields in the app's names and no name of a look; the eight fields show Beck's numbers and **Station marker** shows **Tick**.
3. **Given** a look chosen, **When** one of its sizes is typed over and committed, **Then** **Look** shows **Custom**, an option it offers only while no look and not the engine's own sizes match.
4. **Given** **Custom** or a look, **When** **The engine’s sizes** is chosen, **Then** the eight sizes and the two markers go back to the engine's own and the record holds none of them.
5. **Given** a label typeface or a train setting chosen, **When** a look is chosen, **Then** the typeface and the trains stay as they were.
6. **Given** the engine not running, or not answering `style.presets`, **Then** **Look** offers only **The engine’s sizes** and, while the record's sizes are not the engine's own, **Custom**, and a sentence under it says the looks come from the engine; nothing else in the cell is disabled.

---

### User Story 2 - The markers and the typeface (Priority: P2)

As someone matching a map to a printed diagram, I want to choose the station's marker, the interchange's marker and the face the station names are set in.

**Why this priority**: they are the three choices a look does not make on its own, and the tick is what makes a map read as a London-style diagram.

**Independent Test**: choose **Square** in **Interchange marker** and **Inter** in **Label typeface**, and read the stand-in's `map.build`.

**Acceptance Scenarios**:

1. **Given** cell 04 open, **Then** after the eight sizes there are two native selects, **Station marker** (Circle, Tick, Square) and **Interchange marker** (Ring, Square), the first described by "A tick stands on the side of the station’s name, as on the London diagram.", and then a native select **Label typeface** (System, Inter, Atkinson Hyperlegible Next), each showing the engine's own (Circle, Ring, System) for a project that never chose.
2. **Given** a choice made, **Then** the map is drawn again once from the stored layout with the choice as the engine's field (`station_shape`, `interchange_shape`, `label_font`) inside `style`, and the record holds it once the map carries it.
3. **Given** a choice set back to the engine's own, **Then** the record holds nothing for it and nothing for it is sent.

---

### User Story 3 - The trains (Priority: P3)

As someone making a video of the network running, I want the trains drawn larger and with a trail, so that they read on a phone's screen.

**Why this priority**: it matters for the export, and only there; the map is unchanged by it.

**Independent Test**: type **13** into **Dot size** and **4** into **Trail** and read the sentences beside them; then **8** and **1.5**, and read the stand-in's `map.build`.

**Acceptance Scenarios**:

1. **Given** cell 04 open, **Then** after **Label typeface** there is a group **Trains** of two numeric fields in the sizes' pattern: **Dot size**, described "2 to 12. The engine’s own is 5.", and **Trail**, described "0 to 3 seconds. The engine’s own is 0." and by the note "There is no trail while a train stands at a station, in the Time view, or for a person who has asked for reduced motion."
2. **Given** a number outside the range, or text that is not a number, **When** committed, **Then** the engine's own sentence for the field is shown beside it in a `role="alert"` line, the field carries `aria-invalid` and keeps what was typed, and nothing is sent or written.
3. **Given** a number in range committed, **Then** the map is drawn again once from the stored layout with `dot_radius` or `trail` as a parameter of `map.build` itself, never inside `style`, and the record holds it in `style` once the map carries it.

---

### User Story 4 - Reset, and a project made before (Priority: P4)

As someone who has gone too far, I want one press to put the whole group back, and as anyone else I want a project I never styled to stay exactly as it was.

**Independent Test**: choose a look, a typeface and a dot size, choose **Sepia**, press **Reset to the engine’s sizes**, and read the record and the next `map.build`; open a project made before this feature and redraw it.

**Acceptance Scenarios**:

1. **Given** any field of the group away from the engine's own, or a refused figure waiting in a field, **Then** **Reset to the engine’s sizes** can be pressed; otherwise it cannot.
2. **Given** a press on it, **Then** the eight sizes, both markers, the typeface and both train settings go back to the engine's own, the next `map.build` carries no `style`, no `dot_radius` and no `trail`, the record's `style` is `{}`, the theme is the one chosen, and focus is on the cell's heading before the button stops being pressable.
3. **Given** a project made before this feature, **Then** its file gains no key, its `map.build` is the one it always sent, and every new control shows the engine's own.
4. **Given** a styled project closed and opened again, **Then** every control shows what was chosen and opening draws nothing.

### Edge Cases

- **A look that matches by numbers alone**: the record holds Beck's eight numbers with a circle station marker. That is not Beck, whose marker is a tick, so **Look** shows **Custom**.
- **A look's field at the engine's own number** (Beck's label size 11 and margin 24): stored as absent and not sent, as any size at the engine's own number is; the look still matches, since an absent field is the engine's own.
- **A choice made while a run or an export holds the page**: shown at once and drawn once the way is clear, as a size is; nothing is disabled.
- **A record edited by hand**: a marker or typeface the engine does not offer is read as not held; a train number outside its range is kept and shown refused, as a size's is, and nothing is sent until it is fixed. A choice made meanwhile is shown and drawn with the fix.
- **A look the app cannot read** (a field outside its range or not on the list, a marker the engine does not offer): it is not offered.
- **A read-only project**: the cell's one sentence stands and no control is drawn.
- **An export**: reads the map the last draw wrote, so the markers, the face and the trains reach it through the page and the SVG the engine drew; the export's own parameters do not change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Cell 04 MUST offer the engine's named looks in a native select, **Look**, at the head of the sizes group, and choosing one MUST write its fields, never its name.
  - *As of 10 Oct 2026:* a look is a convenience over fields, never stored by name. Choosing a look writes its fields (read from `style.presets` at that moment; the app copies no numbers) into the record's `style`, and the record never holds the look's name, so the engine's rule that a `preset` is sent alone is never in play: the app sends fields, as it does today. The select shows the look whose fields equal the record's resolved style, else **Custom** (an option shown only then); its first option is **The engine’s sizes**. A look carries no typeface and no train settings, so choosing one leaves those as they are.
  - *As of 10 Oct 2026:* the **Look** select reads `style.presets` once per engine session (cached in the renderer; the engine's answer is the truth) and compares the record's resolved style to each look's fields to decide what to show; when the engine is away it shows only **The engine’s sizes** and **Custom** and says the looks need the engine, without disabling anything else.
  - **What a look's fields are.** A look stands for everything `{ "preset": name }` draws: its eight numbers and both markers, a marker the look does not name being the engine's circle (the engine resolves a preset to `Style(**fields)`, so Blueprint draws circles). So choosing Blueprint after Beck puts the station marker back to the circle, and "the record's resolved style" is compared on those ten fields, each absent field read as the engine's own. The typeface and the trains are not among them.
  - **The engine's sizes.** Read by this spec as the engine's own look: choosing it puts the ten fields a look sets back to the engine's own and, as for every look, leaves the typeface and the trains as they are. The issue says it "clears the group as Reset does"; "the group" is read as the sizes group the sentence opens with, which Reset cleared when the sentence was written, rather than the whole group Reset now clears. [NEEDS CLARIFICATION: if the whole group is meant, the option also clears the typeface and the trains, which is one line in `looks.ts`'s `withLook`.]
  - The options read "The engine’s sizes", the engine's names with a first capital ("Beck", "Blueprint", "Paper"), and "Custom". One sentence under the select says what a look does: "A look sets the sizes and the markers; the typeface and the trains stay as they are." While the engine is not running it says "The looks come from the engine, and are offered once it is running."; when the engine answered `style.presets` with a refusal, "The engine did not list its looks, so only its own sizes are offered." The sentence is in the select's description.
  - The answer is asked through the engine client, kept for the session in `looks.ts`, forgotten when the engine is not ready (a restarted engine may be another version), and not kept when refused, as the export's tables are (`exportTablesFor`). A look whose fields do not read - a field not on the list, a number outside its range, a marker not offered, the two radii in the wrong order - is not offered.
  - A choice of a look is a commit: debounced, one redraw from the stored layout, written once the map carries it (FR-006). The eight fields' text follows the look; a refused figure waiting in a train field stays.
- **FR-002**: The marker shapes MUST be two native selects, **Station marker** and **Interchange marker**.
  - *As of 10 Oct 2026:* two native selects, **Station marker** (Circle, Tick, Square) and **Interchange marker** (Ring, Square), with a one-line gloss for the tick ("Stands on the side of the station’s name, as on the London diagram"), stored as `style.stationShape` and `style.interchangeShape` and sent as the engine's fields; absent means the engine's circle.
  - The gloss is a sentence under **Station marker**, in its description, always shown: "A tick stands on the side of the station’s name, as on the London diagram." It is shown whichever marker is chosen because it is what a person needs to know before choosing the tick. The interchange's circle is called **Ring**, because it is the ring the map has always drawn round an interchange.
  - Both sit after the eight sizes. They are the kit's select (`kit/Select.tsx`), as the grid in cell 02 is; its name is the select's own label, and the name beside it is drawn as the sizes' labels are and hidden from the accessibility tree, where the select already says it.
- **FR-003**: The typeface MUST be a native select **Label typeface**.
  - *As of 10 Oct 2026:* a native select **Label typeface** (System, Inter, Atkinson Hyperlegible Next), stored as `style.labelFont`, absent meaning System. The faces ship with the engine, so nothing is fetched.
  - It follows the two markers. Nothing in the app loads, embeds or names a face: the engine draws the names and embeds the face in the SVG it writes (constitution I and IV).
- **FR-004**: The trains MUST be two numeric fields in the sizes' pattern, **Dot size** and **Trail**, sent as `map.build`'s own parameters.
  - *As of 10 Oct 2026:* two numeric fields in the sizes' pattern, **Dot size** (2 to 12, the engine's 5) and **Trail** (0 to 3 seconds, the engine's 0), stored beside the style (`dotRadius`, `trail`) and sent as `map.build`'s top-level params, not inside `style`. The trail's note says what the engine says: none while a train stands at a station, none in the Time view, none for a person who has asked for reduced motion.
  - *As of 10 Oct 2026:* the two train numbers live in the record's `style` (the smallest change), so one writer, one validator and one reader carry the whole group; `styleSent` decides what is sent, in the app's names, and `styleParams` (`styleRules.ts`) is the one place it is put on the wire, `dot_radius` and `trail` at `map.build`'s top level and everything else inside `style`.
  - They are a group, a `fieldset` whose legend is **Trains**, with one sentence saying what they are: "How a train is drawn as the map plays; the map itself does not change." Each field is described by its range and the engine's own number ("2 to 12. The engine’s own is 5.", "0 to 3 seconds. The engine’s own is 0."), and **Trail** also by the note "There is no trail while a train stands at a station, in the Time view, or for a person who has asked for reduced motion." A refusal is the engine's sentence word for word ("dot_radius must be from 2 to 12, in SVG user units at the map's width", "trail must be from 0 to 3, in seconds of playback").
- **FR-005**: Where the controls sit.
  - *As of 10 Oct 2026:* the **Look** select at the head of the sizes group; then the eight sizes as today; then the two marker selects; then **Label typeface**; then the **Trains** pair. One group, one Reset, one status line.
  - The group is the region **Sizes** it was, so every control in it is one draw away from the map by the one path (`LayoutRun.restyle`): one Reset after the Trains, and one status, the cell's row while the redraw runs and cell 02's sentence after it ("Drawn in the sizes you chose, from the stored layout. The stations have not moved."). The unit sentence stays under **Look**, at the head of the eight sizes it is about.
- **FR-006**: Every control of the group MUST be a cheap edit.
  - *As of 10 Oct 2026:* all of these are cheap edits, the same machinery as the sizes: debounced, a redraw from the stored layout, written to the record only once the map carries them, and part of what the map on screen was drawn from (`drawn.style`). Nothing re-lays out; no cell goes stale.
  - A select's choice is shown at once and drawn after the redraw delay, so a look and a marker chosen in quick succession are one draw. A choice made while a run or an export holds the page waits and is drawn once the way is clear, as a size does. `drawn.style` is the style as it was sent, the train numbers included, in the app's names; the run graph raises no source for any of it.
- **FR-007**: **Reset** MUST clear the whole group and leave the theme.
  - *As of 10 Oct 2026:* Reset ("Reset to the engine’s sizes") clears the whole group: the eight sizes, the shapes, the typeface and the trains. The theme stays.
  - Its name is unchanged, so the gate documents' sentences about it keep their words. It can be pressed while any field of the group is away from the engine's own or a refused figure waits in a field, and hands focus to the cell's heading before it stops being pressable (A6-07).
- **FR-008**: The record MUST keep the new choices in `style`, each absent at the engine's own, and the main process MUST validate them.
  - *As of 10 Oct 2026:* `style` gains `stationShape`, `interchangeShape`, `labelFont` (strings, the engine's names), and the two train numbers `dotRadius` and `trail` live with it. A field equal to the engine's default is stored as absent, as the sizes are.
  - *As of 10 Oct 2026:* validation sits in the main process as `style` is validated today: the two enums and the two ranges, refused naming the field; a record from before reads as before (`RECORD_VERSION` unmoved).
  - *As of 10 Oct 2026:* the rule that `interchange_radius` may not be below `station_radius` stays judged as today; choosing a look whose numbers satisfy it cannot break it.
  - The handler (`ipc.ts`) and the store both refuse a style with a field not on the list, a number outside its range, a marker or face the engine does not offer, or the radii in the wrong order, in the engine's own sentence, the label face's included; the colours the page's theme owns and `preset` stay refused, as before. One table in `src/shared/project.ts` carries each field's name on the wire, its range or its options, and the engine's own value (`STYLE_RANGES`, `TRAIN_RANGES`, `STYLE_CHOICES`, `DEFAULT_STYLE`), held to the committed protocol schema by a unit test.
  - On read, a marker or face that is not one the engine offers is read as not held, field by field, since a select cannot show it; a train number that is not a finite number is read as not held and one outside its range is kept and shown refused, the sizes' rule. `RECORD_VERSION` stays at 2 under the run graph's three criteria: every new field is optional on read; its absence is the engine's own, which is what every map before was drawn with; and the one released build, v0.1.0, holds records at version 1 and reads a version-2 record as read-only, so it never writes one and cannot drop a field (a build between issue 350 and this one would drop them on a write; none was released). `specs/003-project/contracts/record.md` gains the fields.
- **FR-009**: `map.build` MUST carry exactly what the record chose, and nothing for what it did not.
  - A project that chose nothing sends no `style`, no `dot_radius` and no `trail`, so its request is the one it always sent. A field at the engine's own value is not sent. The two radii go together whenever either does. A style holding a number the engine would refuse sends nothing of the group, as a size does today.
  - *As of 10 Oct 2026:* the determinism fixture holds no new field, so its request is unchanged; the `style` the export reads from the record carries the new fields into an export through the drawn map (the page's data and SVG), which is the engine's.
- **FR-010**: The stand-in engine MUST answer `style.presets` and take the new fields as the engine does.
  - *As of 10 Oct 2026:* the stand-in engine answers `style.presets` with the three looks' fields as the engine has them at the tag and takes the new params and fields in `map.build`.
  - It refuses what `serve._style` and `map.build` refuse of them, with the `params` kind and the engine's sentences: a marker or face not on the list, a train number outside its range, a style field the engine does not take (so a `dot_radius` sent inside `style` is refused, as the engine refuses it), a `preset` beside a field, and parameters to `style.presets`. It records every request in `fake-engine.received`, as it does. `tests/unit/stand-in-shapes.test.ts` holds its answers to the description and its sentences to the engine's.
- **FR-011**: Nothing MUST be drawn by the app.
  - The group is selects, fields and sentences. The markers, the face and the trains are the engine's; the app shows the page the engine wrote (constitution I).
- **FR-012**: The documents that quote cell 04 MUST gain the group's sentences in the same change.
  - `docs/acceptance.md` step 8 gains the look, the markers, the typeface and the trains, and Reset's wider reach; `docs/accessibility.md` gains the rows and the walkthrough paragraphs, its VoiceOver and Narrator columns a person's and not yet run; `docs/DESIGN.md` 8.2's Style row gains the controls; `CLAUDE.md`'s cell table names them; `tests/acceptance/acceptance.spec.ts` reads the new controls where step 8 does. The stranger's timed run (`docs/acceptance-stranger.md`) never reaches cell 04's sizes and gains nothing.
  - The collapsed row is unchanged: it names the theme and adds ", sizes of your own" only when one of the eight sizes is set, as `docs/DESIGN.md` 8.2 says. The issue does not ask for a word about the markers, the face or the trains there, and the gate documents quote the row as it is.

### Key Entities

- **Look**: a name the engine answers and the fields it stands for: eight sizes and a station and an interchange marker. Never stored.
- **Style** (the record's): the eight sizes, the two markers, the label face and the two train numbers, each optional, absent meaning the engine's own.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The end-to-end test records one `map.build` for a look chosen, whose `style` is exactly the look's fields that are not the engine's own, with no `preset`, and a record whose `style` holds the same fields and no name.
- **SC-002**: A project that never touched the group sends `map.build` exactly the keys it sent before this feature, and its file gains no key.
- **SC-003**: The ranges, options and defaults of the new fields are held to the committed protocol schema by a unit test, so a pin that moves one fails there first.
- **SC-004**: The determinism suite's request and captures do not move (its fixture holds no new field).
- **SC-005**: Every decision above has a unit test that was watched failing under a named mutation, or an end-to-end test whose mutation is named for the coordinator to run.

## Assumptions

- The engine pin is v0.15.0, which has `style.presets`, the marker shapes, the label face and the two train parameters (issue 389, merged).
- The pictures are the engine's: a tick, a square, a face and a trail are drawn by its SVG and its page, and the app shows the page (constitution I). No end-to-end test here can see them; the stand-in draws nothing, so what the suite proves is what was sent.
- Lane 392 (cell 06's opening and the capture driver) owns `ExportTab.tsx`, `exportChoice.ts`, `src/main/export.ts`, `src/main/capture.ts` and the record's `export`; this feature's hunks in `src/shared/project.ts`, `src/main/projects.ts` and the stand-in are the style's and `map.build`'s, and nothing else.
