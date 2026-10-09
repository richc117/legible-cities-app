# Feature Specification: Route mode

**Feature Branch**: `030-route-mode`

**Created**: 2026-10-02

**Status**: Draft

**Input**: Issue 272, "Route mode: a trip between two stations, everything else faded"; engine issue 49 (E38); ADR-048, which this spec carries out.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose a trip by keyboard and see it (Priority: P1)

As someone reading a city's map who has somewhere to go, I want to name a start and an end station from the keyboard and see only that trip bright, so that the map answers "how do I get from here to there" and not only "how does this fit together".

**Why this priority**: it is the feature; the essay's argument is that a map supports two kinds of understanding and the app offers one.

**Independent Test**: on a laid-out project, Tab to cell 03's Trip section, type part of a station's name in Start, choose with the arrows and Enter, do the same in End, and watch the map fade around the trip.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** cell 03 is opened, **Then** after the transport there is a section headed "Trip" (an `h3`) holding a combobox named "Start", a combobox named "End", and the steps, and no pressed or disabled control.
2. **Given** Start has focus, **When** three letters are typed, **Then** a popup lists the stations whose names contain them, a polite line says "N stations match", DOM focus stays in the field, Down Arrow highlights the next option, Enter accepts it and Escape closes the popup.
3. **Given** both are chosen, **Then** the main process sends the page `setTrip(from, to)` and nothing else: no `map.build`, no `graph.build`, no export call.
4. **Given** the page answers a trip, **Then** the map shows it faded around and the steps list it.
5. **Given** the page answers a reason instead, **Then** the reason is shown in `--error` under the pickers and the map is whole.

---

### User Story 2 - Hear the trip as steps (Priority: P1)

As someone using a screen reader, I want the trip as a numbered list of what to do, so that a picture I cannot read is a sequence I can follow.

**Why this priority**: the list is the trip's text alternative; without it the feature is a picture.

**Independent Test**: choose a trip with two changes and read the list with a screen reader.

**Acceptance Scenarios**:

1. **Given** a trip, **Then** the steps are an `<ol>` with one item per leg, each naming the line, its direction as "towards `<terminus>`", the boarding station, the number of stops, and the station to change at or to alight at.
2. **Given** a trip changes, **Then** one `role="status"` line says "N stops, M changes." and nothing else is announced.
3. **Given** lines are hidden, **Then** the list's last line names them: "Avoids the lines you hid: A, C."

---

### User Story 3 - Return to the whole network (Priority: P2)

As someone who has looked at a trip, I want one press to bring the whole map back, exactly as it was.

**Independent Test**: choose a trip, clear it by pressing "Show the whole network" or emptying a picker, compare the page to before.

**Acceptance Scenarios**:

1. **Given** a trip, **When** "Show the whole network" is pressed, **Then** the main process sends `setTrip(null)`, the map is pixel-equal to before the trip (RGB, tolerance 8), both pickers are empty, focus is on Start, and the button is gone.
2. **Given** the whole network, **When** Start is chosen and End is empty, **Then** nothing is sent and the map is whole.

---

### User Story 4 - A trip survives a redraw (Priority: P3)

As someone recolouring a line while looking at a trip, I want the trip still there when the map reloads.

**Acceptance Scenarios**:

1. **Given** a trip, **When** a colour change rebuilds the page, **Then** after the reload `setTrip(from, to)` is sent again, after the view and labels and before playing resumes, and the steps are unchanged.
2. **Given** a trip, **When** a layout run replaces the layout, **Then** a chosen station no longer in the new `stations` list clears its field with a sentence saying so, and no trip is sent.

### Edge Cases

- Start and end the same: refused on End in a `role="alert"`, "Start and end are the same station."; nothing is sent.
- No connecting trip, or none without the hidden lines: the page's reason is shown; the map stays whole.
- A run or an export holds the page: the choice is refused with one sentence in `--error`, as the transport's are; nothing disables.
- No layout yet: the section says "Lay the project out to plan a trip." and draws no control.
- A read-only project gets the trip: viewing is not editing.
- Four hundred stations: the popup lists every match, scrolled, never a capped list; a name is matched case-folded by substring.
- The page's `prefers-reduced-motion` makes the fade instant; the app sends no duration.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Trip section MUST be the third section of cell 03, headed by an `h3` "Trip", and MUST write nothing to the project record.
  - *As of 8 Oct 2026:* the section is drawn for every project with a record, after the transport. Before a layout it is the edge case's one sentence, "Lay the project out to plan a trip.", and no control; after one it begins with one sentence, "Choose a start and an end station: the map fades everything off the trip between them, and the steps say how to ride it. A trip changes nothing the project keeps." The record gains no trip; what it gains is the map's stations (FR-004's note).
- **FR-002** (as of 6 Oct 2026): There MUST be no mode switch. A trip exists while Start and End both hold a station; until then nothing is sent and the map is whole, and emptying either picker while a trip is shown sends `setTrip(null)`. While a trip is shown, and only then, a text button "Show the whole network" follows the steps; a press sends `setTrip(null)`, clears both pickers (FR-008), and hands focus to Start, where the next trip begins. The section is named by its `h3`, "Trip", alone. A pressed "One trip" with empty pickers would show the whole network too: a mode that does nothing, which section 8.2 calls decoration.
- **FR-003**: Start and End MUST be editable comboboxes with list autocomplete and manual selection (APG), as a new kit wrapper, with `aria-expanded`, `aria-controls`, `aria-activedescendant`, a listbox popup, and a polite match count.
  - *As of 8 Oct 2026:* the wrapper is `kit/Combobox.tsx` over a pure model, `kit/comboboxModel.ts`, and it is the platform's own `<input>` drawn in the tokens as the date control is, not FigUI3's field, which mirrors five aria attributes onto its inner input and none of the pattern's. Nothing is chosen by typing alone: while a person types the field shows what they typed and the choice stays what it was; once they stop (a choice, Tab, a press elsewhere) it shows the chosen station's name again, so a refused choice puts the previous one back. Emptying the field is the one edit that clears the choice. Down opens the popup on the first match, Up on the last, Alt+Down with nothing highlighted and Alt+Up shuts it; the arrows stop at the ends rather than wrapping; Escape with the popup shut does nothing; a key that is composing in an input method is left to it; the popup is never a Tab stop and a press on it keeps focus in the field. Matching is the name lower-cased (`toLowerCase`, the same on every machine) holding the typed text lower-cased, untrimmed. The match count is a visually hidden polite line, worded as quoted here without a full stop ("3 stations match", "1 station matches", "No station matches"), and empty while the popup is shut. The popup is a manual popover anchored to its field by a per-instance `anchor-name`, as wide as the field and `--listbox-max-height` tall before it scrolls; the highlighted option carries an inset edge in `--focus` (`--focus` on `--surface-selected` joins the contrast test).
- **FR-004**: The options MUST come from `map.build`'s `stations` (id, name) and nothing the app derives.
  - *As of 8 Oct 2026:* the list is kept in the record as `drawn.stations` (optional, `RECORD_VERSION` unmoved): every draw writes the list its build answered - a layout run and a rebuild on `LayoutDone` and `RebuildDone`, a recolour, a reorder and a resize as an optional last argument of their bridge methods, because a redraw draws the stored set as it is now and another project may have laid it out again (A3-06); a draw whose build answered none keeps the list while the layout and its `made` are unchanged, and nothing from another layout. A list that does not read whole is no list, and the bridge drops it rather than failing the run. The front door's summaries leave it out. A record with no list draws both pickers empty with "Draw the map again to pick a trip." Two stations of one name are offered as two options, each named apart by its place among the stations of that name - "Times Sq (1 of 2)" - so no two options share a name; a station whose name is the empty string is "Unnamed station `<id>`". The steps say the plain name.
- **FR-005**: `setTrip` MUST be on `VIEWER_METHODS` and in `specs/008-viewer/contracts/viewer.md`, called only from the main process, and `state().trip` MUST be read as untrusted data.
  - *As of 8 Oct 2026:* the validator is `readTrip` in `src/shared/trip.ts`. No trip is `legs === null`, with the page's reason; a trip is accepted only when every leg is whole, its stops a whole number of at least one, every station it names among `drawn.stations`, its legs join from `from` to `to`, and `changes` is one fewer than its legs. An answer naming a station the list lacks is refused with "The map named a station this project does not list, so no trip is shown. Draw the map again to pick a trip."; any other answer it cannot read with "The map’s answer about the trip could not be read, so no trip is shown."; an answer about another pair than the one asked for is refused the same way; and on any of these the page is told `setTrip(null)`, so the map and the section agree. A call the page refuses is said as "This map was drawn before it could show a trip. Draw the map again to pick a trip." when the page has no `setTrip`, and "The map is not ready to show a trip. Choose the station again in a moment." otherwise. After either, or after a refused answer, choosing a station already in its picker again asks the page again, once; while the page was told the pair it asks for, it asks nothing.
- **FR-006** (as of 6 Oct 2026): The steps MUST be an `<ol>`, one item per leg, each two sentences: "At `<board>`, board the `<line>` towards `<towards>`." ("change to" from the second leg on), then "Ride `<n>` stops to `<alight>`.", the last ending "and get off.". The station comes first, so no name is heard as "at" another. `<n>` counts stops after boarding, the alighting one included ("1 stop"); `<line>` is the label verbatim; `<towards>` is the drawn end (FR-006 of spec 031) reached by riding on past `<alight>`, never a headsign; on a loop, the station after `<board>`. The fixture's three trips read:
  - "At Alder, board the Blue Line towards Elm. Ride 3 stops to Damson and get off."
  - "At Alder, board the Blue Line towards Elm. Ride 2 stops to Cedar." / "At Cedar, change to the Red Line towards Oak. Ride 1 stop to Gorse and get off."
  - "At Alder, board the Blue Line towards Elm. Ride 2 stops to Cedar." / "At Cedar, change to the Red Line towards Oak. Ride 2 stops to Hazel." / "At Hazel, change to the Green Line towards Maple. Ride 2 stops to Larch and get off."

  The examples need a fixture for engine 49's test, which does not exist yet:
  - Blue Line: Alder, Birch, Cedar, Damson, Elm.
  - Red Line: Fir, Cedar, Gorse, Hazel, Oak.
  - Green Line: Ivy, Hazel, Juniper, Larch, Maple.

  Each of the three trips has only one path under the cost rule.
- **FR-007**: A trip change MUST be announced once, politely, as "N stops, M changes."
  - *As of 8 Oct 2026:* the line is visible, above the steps, a `role="status"` that is emptied and filled two frames later for each trip shown, so a trip whose counts repeat the last one's is still said; it is empty while no trip is shown.
- **FR-008**: Clearing the trip, by pressing "Show the whole network" or emptying a picker, MUST send `setTrip(null)`; the press also clears both pickers.
- **FR-009**: The viewer's restore after a reload MUST include the trip, between labels and playing.
  - *As of 8 Oct 2026:* the restore gives back the page's own ask - the `from` and `to` of `state().trip` - and only for a trip it found: an answer with `legs: null` left the map whole, which a new page already is. It is sent straight after the labels, before the speed and the clock. The section keeps the answer to its own ask and does not read the reloaded page's: a redraw from the same layout draws the same trip, and a layout run that drops a chosen station clears it (US4 scenario 2). Two gaps are left for a change to the viewer (`Viewer.tsx`, `viewerGiveBack.ts`), which this issue did not own: after a layout run that keeps both stations the steps are not read again from the new page; and the restore's `setTrip` is composed from the page being left, read before the frame navigates, so a picker changed or emptied between that read and the restore's call - a second or so after a run ends - is overtaken by it, leaving steps for one trip over a map showing another, and a read that missed its deadline can bring back an older trip. The fix is the transport's: the section writes its ask into a memory the restore reads at the moment it sends, as `asDispatched` does for the speed and the pause.
- **FR-010**: Choosing a trip MUST never start a layout, a rebuild, `graph.build` or an export.
- **FR-011**: Every refusal MUST be a sentence beside the control that caused it; nothing is disabled.
  - *As of 8 Oct 2026:* a refused choice is not taken: the same station in both pickers is refused beside the picker it was chosen in, which is End when End was chosen last, and the field shows the station it held before. A run or an export holding the page refuses a choice, an emptying and the button with "The map is being drawn. A trip can be chosen again when the run ends." or "The export is reading the map. A trip can be chosen again afterwards.", beside the control, gone when the hold is. The page's reason for no trip is said word for word with its first letter capitalised and a full stop, under the pickers, in `--error` (US1 scenario 5); when lines were hidden it is followed by "The lines you hid: A, C.". A trip found with a reason (the `not_serving` fallback) shows its steps and the reason as a sentence in `--text-muted` under them. A chosen station a new layout does not draw leaves its picker with "`<name>` is not on the map drawn now, so Start is empty." (or End).

### Key Entities

- **Station**: id and name, as the engine lists them for this layout.
- **Trip**: from, to, legs, changes, and a reason when there is no trip.
- **Leg**: line, towards (terminus), board, alight, stops.

## Success Criteria *(mandatory)*

- **SC-001**: A trip is chosen by keyboard alone, from Tab into the section to the first leg read, in under twelve key presses on the fixture.
- **SC-002**: The end-to-end test records exactly one `setTrip` per completed choice and no engine call.
- **SC-003**: Clearing the trip ("Show the whole network" pressed, or a picker emptied) restores the page within tolerance 8 in RGB.
  - *As of 8 Oct 2026:* no test in this repository can assert it yet. The end-to-end suite drives the stand-in page, which draws nothing for a trip, so it proves the one `setTrip(null)` and not the pixels; the fade and its clearing are the engine's, and its own browser tests hold them. Until a real-engine spec is gated in here, SC-003 is a person's check, made at acceptance step 7.
- **SC-004**: The accessibility sweep passes over cell 03 with the popup open and closed, in both themes.

## Assumptions

- The engine pin carries E38: `setTrip`, `state().trip`, `stations` on `map.build`.
- The fade and the penalty constant are the engine's.
- The three documents quote the section's heading, both pickers' names and the leg sentence.
  - *As of 8 Oct 2026:* two of them do - the acceptance checklist (step 7) and the accessibility pass (cell 03's row and walkthrough). The stranger's timed run (`docs/acceptance-stranger.md`) never reaches cell 03, so it gains no sentence; ADR-048's consequence "Three documents gain sentences" needs the same correction.
- `docs/DESIGN.md` 8.2 gains a "Trip" row under cell 03.
