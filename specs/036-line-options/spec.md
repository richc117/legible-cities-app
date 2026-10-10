# Feature Specification: Line options

**Feature Branch**: `line-options`

**Created**: 2026-10-10

**Status**: Draft

**Input**: Issue 394, "Cell 05: a line's name, visibility, width, casing and dash (the app half of engine 42 and 55)"; engine issues 42 (a line's name and hidden, v0.12.0) and 55 (a line's width, casing and dash, v0.16.0), at the v0.16.0 pin (issue 393); app ADR-053, which decides what a hidden line is. The issue's block "Decided on 10 Oct 2026" and the lane brief's settled list are the coordinator's decisions; each is recorded below as an "*As of 10 Oct 2026:*" line under the requirement it settles. Where the lane had to read a decision one way, the requirement says so and why, and where the reading could reasonably go the other way it carries a `[NEEDS CLARIFICATION]` marker beside what was built.

## What the engine takes

At v0.16.0 (`CHANGELOG.md` 0.12.0 and 0.16.0, `serve._lines`, `serve.map_build`, `render.LINE_WIDTH_RANGE`, `CASING_WIDTH_RANGE`, `LINE_DASHES` and `line_strokes`, `pipeline.run`; in the app's types `MapBuildParams.lines`, `LineOptions` and `LineCasing`):

- **`map.build`'s `lines`** is an object keyed by line label. Each value is an object of optional fields and nothing else: **`name`**, 1 to 40 characters (Python's `len`, so code points) with no line break of any kind (`\r`, `\n`, U+2028, U+2029), written wherever the page writes the line's label - its chip, its row, the time chart's band, the trains' titles - while the label stays the line's key everywhere else; **`hidden`**, true or false; **`width`**, 0.75 to 1.5 times the map's `line_width`, 1 when omitted; **`casing`**, an object of exactly `width` (0 to 1 times `line_width` on each side, 0 drawing none) and `color` (`#rrggbb`), both required; and **`dash`**, `solid`, `dashed` or `dotted`, solid when omitted. An omitted field leaves the line as it is drawn without it, and a map whose lines choose none of the stroke's three, or only their defaults, is drawn byte for byte as without them.
- A label the layout does not carry is ignored, as `colors` ignores one, so a project's choices survive a narrower mode.
- Every refusal has the `params` kind and names the field by its path, the label in Python's `repr`: "lines['A'].name must be from 1 to 40 characters with no line break", "lines['A'].hidden must be true or false", "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width", "lines['A'].casing must be an object of width and color", "lines['A'].casing must have both width and color", "lines['A'].casing.width must be from 0 to 1, as a multiple of line_width on each side", "lines['A'].casing.color must be a colour written #rrggbb", "lines['A'].dash must be solid, dashed or dotted", "lines['A'] does not take colour", "lines['A'] must be an object of name, hidden, width, casing and dash", and "lines must be an object of line label to the line's name, hidden, width, casing and dash".
- **A hidden line** is taken off the line graph before anything reads it (ADR-053): no track, no trips, no chip, row or band, no colour in either thumbnail; a station only it served is not drawn, and `map.build`'s `stations` leaves it out; the lines it shared track with close up over its place. The service day is still counted over every line, nothing stored changes, and `render.stage` still draws every line. **Hiding every line the layout carries is refused**, with the `feed` kind and the sentence "`<key>`: every line on this map is hidden; show at least one line to draw it".
- **`lines` carries no colour of a line.** Its one colour is the casing's. A line's own colour stays `colors` and `default_color`, and its place in the stack stays `line_order`, as the app sends them today; nothing in `lines` competes with either, so no key wins over another.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A line left off the map, and back (Priority: P1)

As someone making a map of the lines that matter for a story - the rail without the streetcar, the network without a line that is closed this year - I want to leave a line off the map and the page, and put it back later, without laying anything out again.

**Why this priority**: it is the option a person asks for first, and the one the engine took first (v0.12.0); nothing else in the app can take a line off the map itself.

**Independent Test**: on a laid-out project, open cell 05, open **Line options** on line B's row, turn **Shown** off, and read the `map.build` the stand-in engine recorded, the record, and the row.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** cell 05 is open, **Then** each row of the **Line colours** list carries, under its chip and its words, a closed disclosure **Line options** whose summary reads "Default", and the list is one row per line as before.
2. **Given** **Line options** opened on line B, **Then** it holds **Name**, **Shown** (on), **Width**, **Casing**, **Dash** and **Reset line**, each named and described as FR-002 to FR-008 say.
3. **Given** **Shown** turned off, **Then** after the redraw delay the map is drawn once from the stored layout for the day it already showed, `map.build` carrying `lines: { "B": { "hidden": true } }` with the colours, the order and the sizes as the record holds them, and no `graph.build`; the record's `lines` holds the same once the map carries it, and `drawn.lines` with it.
4. **Given** line B hidden, **Then** its row stays in the list where it was, its words drawn faint, its summary reading "Hidden", its chip and every option still working; the **Line order** list keeps it in its place; no cell reads **not drawn yet**.
5. **Given** **Shown** turned on again, **Then** the map is drawn once more and the record holds no `lines` at all.
6. **Given** every other line the cell lists already hidden, **When** the last one's **Shown** is turned off, **Then** the switch stays on, nothing is sent or written, and the engine's sentence "every line on this map is hidden; show at least one line to draw it" is said beside it.

---

### User Story 2 - A line called by another name (Priority: P2)

As someone whose feed calls a line "801" or "Metro A Line", I want to give it the name a rider knows, so that the page's chips, rows and trains say it.

**Independent Test**: type "Airport Express" into **Name** on line A and press Enter; type 41 characters and press Enter.

**Acceptance Scenarios**:

1. **Given** **Line options** open on line A, **Then** **Name** is empty with the label "A" as its placeholder, and is described by a sentence saying where the name is shown and that empty uses the label.
2. **Given** a name typed, **Then** nothing is read until Enter or until focus leaves the field.
3. **Given** "Airport Express" committed, **Then** the map is drawn once with `lines: { "A": { "name": "Airport Express" } }`, the record holds it once drawn, and the summary reads "Renamed".
4. **Given** 41 characters committed, **Then** the engine's sentence "lines['A'].name must be from 1 to 40 characters with no line break" is said beside the field in a `role="alert"` line, the field carries `aria-invalid` and keeps what was typed, and nothing is sent or written.
5. **Given** the field emptied, or set to the line's own label, and committed, **Then** the name is cleared: the map is drawn without it and the record holds none.

---

### User Story 3 - A line drawn bolder, cased or dashed (Priority: P3)

As someone drawing attention to one line - the one a story is about, a line under construction, a limited service - I want it thicker, outlined in a colour that sets it off, or dashed.

**Independent Test**: choose **Bold** in **Width**, **Regular** in **Casing** with a colour typed into its chip's panel, and **Dashed** in **Dash** on line A; read the stand-in's `map.build`.

**Acceptance Scenarios**:

1. **Given** **Line options** open, **Then** **Width** offers Thin, Regular, Bold and Heavy (Regular chosen), **Casing** None, Thin, Regular and Wide (None chosen), and **Dash** Solid, Dashed and Dotted (Solid chosen), each a native select described by what its words stand for.
2. **Given** **Casing** on None, **Then** there is no colour chip beside it; **Given** a casing chosen, **Then** a colour chip appears beside the select in white (`#ffffff`), with the sentence that the casing keeps its colour in both of the map's themes and should read on the map's ground.
3. **Given** **Bold**, **Regular** casing, a casing colour of `#112233` and **Dashed** chosen, **Then** the map is drawn with `lines: { "A": { "width": 1.25, "casing": { "width": 0.5, "color": "#112233" }, "dash": "dashed" } }`, the record holds the same once drawn, and the summary reads "Bold, cased, dashed".
4. **Given** choices made in quick succession, **Then** they are drawn together after the redraw delay, not one build a choice behind.
5. **Given** a choice set back to the engine's own (Regular, None, Solid), **Then** nothing is kept or sent for it.

---

### User Story 4 - Reset line, and a project made before (Priority: P4)

As someone who has gone too far with one line, I want one press to put that line back, and nothing else; and as anyone else, I want a project I never touched to be exactly what it was.

**Independent Test**: set options on lines A and B, press **Reset line** on A; open a project made before this feature and redraw it.

**Acceptance Scenarios**:

1. **Given** a line with options, **Then** **Reset line** can be pressed; **Given** a line without, **Then** it cannot.
2. **Given** a press on **Reset line** on A, **Then** the map is drawn once with B's options and none of A's, the record holds B's only, A's fields show the engine's own, A's colour is untouched, and focus is on cell 05's heading before the button stops being pressable.
3. **Given** **Reset every line** pressed, **Then** the colours go back as they always did and the line options stay.
4. **Given** a project made before this feature, **Then** its file gains no key, its `map.build` is the one it always sent, and every row's summary reads "Default".
5. **Given** a project with options closed and opened again, **Then** each row's summary and fields show what was chosen, and opening draws nothing.

### Edge Cases

- **A line the record holds options for that the cell does not list** (a narrower mode since): the options are kept and sent, as an override's colour is; the engine ignores a label its layout does not carry.
- **A record edited by hand**: each field the store would refuse on write - a name past 40 or with a line break, a width or casing outside its range, a casing missing its colour, a dash not offered, `hidden` that is not true or false, a key not on the list - is read as not held, field by field, and an entry left with nothing is dropped; so nothing the engine would refuse ever reaches `map.build`. A width or casing in range that is none of the four steps is kept, shown as one more option at the end of its select ("1.1 times the line width"), and sent.
- **A choice made while a run, an export or the reading-back of a finished run holds the page**: shown at once and drawn once the way is clear, as a colour is; nothing is disabled.
- **A redraw that stops** (cancelled, or refused by the engine): nothing is written, and the line options and the colours both go back to what the record holds, at the moment the run stops (`usePutBack`, issue 360); cell 02 says why.
- **Every line the layout carries hidden, though the cell lists one shown**: the cell lists the feed's lines under the mode, which may be more than the layout carries, so the app's own refusal cannot catch every case. The engine then refuses the draw with its sentence, the run fails in cell 02 with that sentence, and the cell goes back to the record.
- **A read-only project**: cell 05's one sentence stands and no control is drawn, as now.
- **An export**: reads the map the last draw wrote, so a hidden line, a name and a stroke reach it through the page and the SVG the engine drew; the export's own parameters do not change. Cell 06's "lines to keep" is cell 06's and lists every line as before (outside this lane).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each row of cell 05's **Line colours** list MUST carry a closed disclosure, **Line options**, whose summary says what the line holds.
  - *As of 10 Oct 2026:* a closed disclosure per line row, "Line options", in cell 05's colours list, so a line that has none shows nothing new and the list stays one row per line. Its summary says "Default" or names what is set ("Bold, dashed, renamed"), so a collapsed row still tells.
  - It is the kit's `Disclosure` with no heading (the kit's "a disclosure inside a row"): a native button with `aria-expanded` over a group, under the row's chip and words, inside the row's list item. The button shows the cell's chevron, "Line options" and, in `--text-muted`, the summary; between them a visually hidden " for line `<label>`," so the button's name names its line ("Line options for line A, Default"), as every control in the list does (DESIGN.md 8.2, the colour control). The group is named "Line options for line `<label>`". Every row's disclosure starts closed when the cell is drawn; which are open is the screen's, never stored.
  - The summary, in this order and joined by commas with the first word capitalised: "hidden"; the width's word ("thin", "bold", "heavy", or "thinner" or "wider" for a width that is none of the four); "cased"; "dashed" or "dotted"; "renamed". "Default" when the line holds nothing. Derived from what the cell shows, so it follows a choice at once.
- **FR-002**: **Name** MUST be a text field with the line's label as its placeholder, committed on Enter or on leaving it.
  - *As of 10 Oct 2026:* a text field **Name** (the label shown as its placeholder; empty clears it; refused beyond 40 characters beside the field).
  - *As of 10 Oct 2026 (lane brief):* a rename is refused beside the field past 40 characters, in the engine's own sentence where the engine has one: "lines['A'].name must be from 1 to 40 characters with no line break", the label written as the engine writes it (Python's `repr`).
  - It is the kit's text field (`kit/TextInput.tsx`) in cell 04's field pattern: never read per keystroke; the text is trimmed; empty, or the line's own label, clears the name; more than 40 characters (counted as the engine counts them, in code points) or a line break of any kind is refused in a `.message.error` line with `role="alert"` under the field, in its description, with `aria-invalid` on the field and the text left as typed, and nothing is sent or written. Its description: "Shown in place of `<label>` in the page's chips, rows and time chart, and on its trains. Up to 40 characters; left empty, the line is called `<label>`."
  - **A name equal to the line's own label is no name** (the lane's reading of "a field equal to the engine's default is stored as absent"): it would draw exactly what is drawn without it, so it is not kept and not sent.
- **FR-003**: **Shown** MUST be a switch-style checkbox, on while the line is drawn; off writes `hidden`.
  - *As of 10 Oct 2026:* a switch-style checkbox **Shown** (off writes `hidden`).
  - It is the platform's checkbox with `role="switch"`, so it is read as a switch, on or off, drawn as the kit draws a checkbox (its resting edge and checked fill are pairs the contrast test already holds). The kit's own switch (`input.switch`) was not used: its track and knob are literal greys and white that no theme reaches, and drawing one in the app's palette is a choice of colours this lane does not make. [NEEDS CLARIFICATION: is a checkbox read as a switch what "switch-style" asks for, or is a drawn pill switch wanted?]
  - Its description: "Off takes the line off the map and the page: its track, its trains, its chip and its row. The lines beside it close up over its place, and nothing is laid out again."
  - **The last shown line is not hidden.** Hiding every line is refused by the engine (ADR-053, "as of 7 Oct 2026"), and ADR-053 asks cell 05 to treat it as a choice to undo rather than a feed fault. So turning off the only line the cell lists as shown leaves the switch on, sends and writes nothing, and says the engine's sentence beside it in a `role="alert"` line, less the feed key it opens with: "every line on this map is hidden; show at least one line to draw it" (the lane's).
- **FR-004**: **Width** MUST be a native select of four steps.
  - *As of 10 Oct 2026:* native select **Width** (Thin 0.75, Regular 1, Bold 1.25, Heavy 1.5).
  - The kit's select, in cell 04's select row: the name drawn in the terms' column and hidden from the tree, where the select's own label names it. Its description: "A multiple of the map's line width: thin 0.75, regular 1, bold 1.25, heavy 1.5. A wider line moves the lines beside it out to make room." Regular is the engine's own and is never kept.
- **FR-005**: **Casing** MUST be a native select of four steps, with the casing's colour on a chip beside it while a casing is chosen.
  - *As of 10 Oct 2026:* native select **Casing** (None, Thin 0.25, Regular 0.5, Wide 1 a side). The casing's colour is the app's own colour picker on a chip beside the casing select, shown only when a casing is chosen, defaulting to `#ffffff`, with a note that it should read on the map's ground; the engine takes a literal colour and the app does not follow the theme with it.
  - *As of 10 Oct 2026 (lane brief):* the casing's colour defaults to `#ffffff`, is shown only when a casing is chosen, is a literal colour (the app does not follow the theme with it), and the note beside it says it should read on the map's ground.
  - The chip is cell 05's own colour chip and floating panel (DESIGN.md 8.2, the colour control and the floating panel), named "Choose the casing colour of line `<label>`", its panel "Casing colour for line `<label>`" holding the picker, the hex field and **Use this colour**; as for a line's colour, the map follows the end of a gesture and not its every colour. The note, in the casing row's `.message`: "The casing keeps this colour in both of the map's themes, so choose one that reads on the map's ground." The select's description: "A stroke either side of the line, a multiple of the line width on each side: thin 0.25, regular 0.5, wide 1."
  - None is the engine's own and keeps nothing: choosing None removes the casing, its colour with it, and a casing chosen again starts white. The default colour is `DEFAULT_CASING_COLOR` in `src/shared/project.ts`, a literal outside the renderer's component files.
- **FR-006**: **Dash** MUST be a native select: Solid, Dashed, Dotted.
  - *As of 10 Oct 2026:* native select **Dash** (Solid, Dashed, Dotted).
  - Its description: "Paint only: a dashed or dotted line takes the room a solid one does, and its trains run the whole track." Solid is the engine's own and is never kept.
- **FR-007**: **Reset line** MUST clear one line's options and nothing else.
  - *As of 10 Oct 2026:* a **Reset line** button clears one line's options; the existing colour resets are separate.
  - A kit button reading "Reset line", named "Reset line `<label>`’s options" (the visible words first in the name, WCAG 2.5.3), pressable only while the line holds something, drawing the map once without the line's options. It hands focus to cell 05's heading before it stops being pressable (A6-07), as the colours' **Reset every line** does. **Reset every line** and the chip panel's **Reset** stay the colours' and do not touch the options.
- **FR-008**: The record MUST keep the options as `lines`, keyed by label, each entry holding only what differs from the engine's own, and the main process MUST validate them.
  - *As of 10 Oct 2026:* `lines` on the record, optional, keyed by label, each entry holding only the keys that differ from the engine's default, an entry with none removed; validated in the main process as `style` and `tuning` are (the ranges and enums above, no other key, labels bounded); `RECORD_VERSION` unmoved.
  - *As of 10 Oct 2026 (lane brief):* a field equal to the engine's default is stored as absent, and an entry with no keys is removed, as the sizes are.
  - The entry's names are the engine's (`name`, `hidden`, `width`, `casing: { width, color }`, `dash`), so the record's entry and the wire's are one shape. Kept: a `name` other than the label; `hidden` only as `true`; a `width` other than 1; a `casing` whose width is above 0, with its colour; a `dash` other than `solid`. A record with no entry left holds no `lines` key at all.
  - `src/shared/project.ts` carries what the engine takes - the ranges, the dashes, the name's length and line breaks and the engine's own values (`LINE_WIDTH_RANGE`, `CASING_WIDTH_RANGE`, `LINE_DASHES`, `LINE_NAME_MAX`, `DEFAULT_LINE`) - held to the committed protocol schema by a unit test, so a pin that moves one fails there first, and the casing's white (`DEFAULT_CASING_COLOR`); the four steps each select offers are the cell's and live with its rules (`WIDTH_STEPS`, `CASING_STEPS` in `lineOptions.ts`).
  - The bridge's handler and the store both refuse, in the engine's sentences, a `lines` that is not an object, an entry that is not one, a key not on the list, a name, width, casing or dash the engine would refuse, `hidden` that is not a boolean, a label the record could not hold (`validateLineLabel`: empty, over 64 characters, a control character, `__proto__`), and more than 512 entries.
  - On read each field is taken on its own, and one that would be refused on write is read as not held (the colours' and the order's rule, and the tuning's), so a hand-edited value never reaches `map.build` and what the cell shows is what the store would keep.
  - `RECORD_VERSION` stays at 2 under the run-graph contract's three criteria: the field is optional on read; its absence is the engine's own drawing of every line, which is what every map before was drawn with; and the one released build, v0.1.0, holds records at version 1 and reads a version-2 record as read-only, so it never writes one and cannot drop the field (a build between issue 350 and this one would drop it on a write; none was released). A name is something a person typed, which criterion 3 does not admit a loss of; it is admitted because no released build can lose it. `specs/003-project/contracts/record.md` gains the field.
  - It is written by a new bridge method, `projects.completeLines(id, lines, stations?)`, once the map carries it, as `completeColors` is (FR-010); `specs/003-project/contracts/bridge.md` gains it.
- **FR-009**: `map.build` MUST carry exactly the options the record keeps, and nothing for a project that keeps none.
  - *As of 10 Oct 2026 (lane brief):* `map.build`'s `lines` is keyed by the line's label, and the engine reads colour and order elsewhere in the request as it does today; they do not move. `lines` carries no line colour (its one colour is the casing's), so no key competes with `colors` and none wins.
  - The entries are sent as kept, in the engine's names; `hidden` is never sent `false`. A project that keeps none sends no `lines` key, so its request is the one it always sent. Every draw sends the record's options - a layout run, a chosen day, a colour, an order and a size - so none of them loses a hidden line or a name; a redraw for the options sends the ones being drawn.
  - *As of 10 Oct 2026:* the determinism fixture holds no line option, so its request is unchanged.
- **FR-010**: Every option MUST be a cheap edit.
  - *As of 10 Oct 2026:* all cheap edits: the colours' machinery, debounced, a redraw from the stored layout, written only once the map carries them, and part of what the map on screen was drawn from. Nothing re-lays out.
  - A choice is shown at once and drawn after the redraw delay (`REDRAW_DELAY`), so choices in quick succession are one build. While anything holds the page it waits before it is compared with the record, so a choice undone while a build of it runs is drawn once that build has written, rather than dropped as equal to a record about to move. It waits too while a casing's colour is under a hand, and while the run has moved on since the screen last drew (its record not yet read). A choice waiting when the screen goes is dropped, never drawn later from the record the gone screen last saw. The colours section's own builds wait for the read-back as well, since every draw now carries the options. [NEEDS CLARIFICATION, outside this lane: the colours, the order and the sizes still compare a change with the record before they wait (`colours.ts` `nextStep`, `order.ts`, `styleRules.ts`), the same loss of a choice undone mid-build, and the order and the sizes do not wait for the read-back.] What the rows show and when it is drawn is `useLineOptions`, a hook beside the colours section rather than in it, since the section's own file is held to building a colour on its gesture's end and never on a quiet interval; each row's disclosure is `LineOptionsDisclosure.tsx` (not `LineOptions.tsx`, which beside `lineOptions.ts` resolves to the wrong module on a filesystem that ignores case). It waits, and is drawn once the way is clear, while a run or an export holds the page or the record a finished run wrote is being read back (`settling`), since a build begun in that beat would draw the map from the record as it was before the run. The redraw is the map call alone (`LayoutRun.redrawLines`), from the stored layout, for the day the map already showed (`drawnDate`), with the record's colours, order and sizes; it is the colours' kind of run (`recoloured`), so cell 05 reads **running** while it goes and **ready** after, `cellOfRun` needs nothing new, and a stop puts both the colours and the options back. Its job in the inspector is "Redraw with new line options". `drawn.lines` is the options as they were sent, absent for none, and the run graph raises no source for them: the cells below never read **not drawn yet** for an option.
  - [NEEDS CLARIFICATION: because the redraw is the colours' kind, cell 02's run region says "Drawn in the colours you chose, from the stored layout. The stations have not moved." after it, and "The map was not drawn in those colours. …" when it stops. A sentence of its own ("Drawn with the line options you chose, …") needs `LayoutRun.tsx` and a flag of its own on the snapshot, both outside this lane's files.]
- **FR-011**: A hidden line MUST stay in cell 05, dimmed, with every control working.
  - *As of 10 Oct 2026:* a hidden line stays in the list, dimmed, with its row's controls working, so it can be shown again; it leaves cell 05's order list's drawn effect only (the order list keeps it), and cell 03's trip pickers are the page's: they follow what the page says.
  - *As of 10 Oct 2026 (lane brief):* a hidden line keeps its place in the order list and its colour row, dimmed, with every control working; the page's chips and the trip pickers follow what the page draws, never the record.
  - Dimmed is its name and its words in `--text-faint` (a pair the contrast test holds at 4.5), with "Hidden" in its summary so the dimming is never the only sign; its chip keeps the line's colour. The **Line order** list draws its row as before, undimmed (the lane's reading of the brief's sentence, whose "dimmed" is the colour row's; `LineOrder.tsx` is not this lane's). Cell 03's Trip offers the stations `map.build` answered, which leave out a station only a hidden line served, and the app derives nothing from the record for it.
- **FR-012**: The stand-in engine MUST take the new keys as the engine does and show what it did with `hidden` and `name`.
  - *As of 10 Oct 2026:* the stand-in engine takes the new `lines` keys with the engine's bounds and refusals and reflects `hidden` and `name` in what it reports, so the suite can see them cross.
  - It refuses what `serve._lines` refuses, with the `params` kind and the engine's sentences, before anything is drawn, and a map whose every layout line is hidden with the `feed` kind and the engine's sentence. A draw sent `lines` writes, into the page it writes (`<key>.html`, `{}` for a draw sent none, as before), the lines the page would list after hiding and the names it would show: `{"lines": ["A"], "names": {"A": "Alpha line"}}`. `tests/unit/stand-in-shapes.test.ts` holds its requests to the description and its sentences to the engine's.
- **FR-013**: Nothing MUST be drawn by the app.
  - The options are fields, selects, a switch, a chip and sentences. A hidden line, a name, a width, a casing and a dash are drawn by the engine; the app shows the page the engine wrote (constitution I).
- **FR-014**: The documents that quote cell 05 MUST gain the options' sentences in the same change.
  - `docs/acceptance.md` step 9 gains the options; `docs/accessibility.md` gains a cell 05 row and a walkthrough paragraph, its VoiceOver and Narrator columns a person's and not yet run; `docs/DESIGN.md` 8.2 gains a Line options row; `CLAUDE.md`'s cell table names them; `tests/acceptance/acceptance.spec.ts` step 9 says the options are not automated. The stranger's timed run (`docs/acceptance-stranger.md`) never reaches cell 05 and gains nothing.
  - Cell 05's collapsed row is unchanged: it counts recoloured lines, a default of one's own and an order, as `docs/DESIGN.md` 8.2 says. The issue asks for no word about the options there, and the gate documents quote the row as it is.

### Key Entities

- **Line options** (the record's `lines`): a line label to what a person chose for that line - a name, hidden, a width, a casing with its colour, a dash - each optional and absent at the engine's own; written once the map carries it.
- **Drawn line options** (`drawn.lines`): the options the map on screen was drawn with, as sent; absent for none.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The end-to-end suite records one `map.build` for each option chosen, carrying exactly that line's kept options in the engine's names, from the stored layout and with no `graph.build`, and a record whose `lines` and `drawn.lines` hold the same.
- **SC-002**: A project that never touched the options sends `map.build` exactly the keys it sent before this feature, and its file gains no key.
- **SC-003**: The ranges, steps, dashes and the name's rule are held to the committed protocol schema by a unit test.
- **SC-004**: The determinism suite's request and captures do not move (its fixture holds no line option).
- **SC-005**: Every decision above has a unit test that was watched failing under a named mutation, or an end-to-end test whose mutation is named for the coordinator to run.

## Assumptions

- The engine pin is v0.16.0, which has `lines` with all five fields (issue 393, merged).
- Cell 05 lists the feed's lines under the mode and agency the layout was made with (`linesOf`), a superset of the lines the layout carries; the options are offered for every listed line, as a colour is.
- The pictures are the engine's: a hidden line's absence, a name on a chip, a bold or cased or dashed stroke are drawn by its SVG and its page, and the app shows the page. No end-to-end test here can see them; the stand-in draws nothing, so what the suite proves is what was sent, and what the stand-in's page says it would show.
- The record's `export` part, the capture and cell 06 are another lane's, merged; this feature's hunks in `src/shared/project.ts`, `src/main/projects.ts` and the stand-in are the lines' and `map.build`'s, and nothing else.
