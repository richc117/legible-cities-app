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

**Independent Test**: choose a trip, leave route mode, compare the page to before.

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
- **FR-002** (as of 6 Oct 2026): There MUST be no mode switch. A trip exists while Start and End both hold a station; until then nothing is sent and the map is whole, and emptying either picker while a trip is shown sends `setTrip(null)`. While a trip is shown, and only then, a text button "Show the whole network" follows the steps; a press sends `setTrip(null)`, clears both pickers (FR-008), and hands focus to Start, where the next trip begins. The section is named by its `h3`, "Trip", alone. A pressed "One trip" with empty pickers would show the whole network too: a mode that does nothing, which section 8.2 calls decoration.
- **FR-003**: Start and End MUST be editable comboboxes with list autocomplete and manual selection (APG), as a new kit wrapper, with `aria-expanded`, `aria-controls`, `aria-activedescendant`, a listbox popup, and a polite match count.
- **FR-004**: The options MUST come from `map.build`'s `stations` (id, name) and nothing the app derives.
- **FR-005**: `setTrip` MUST be on `VIEWER_METHODS` and in `specs/008-viewer/contracts/viewer.md`, called only from the main process, and `state().trip` MUST be read as untrusted data.
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
- **FR-008**: Leaving route mode MUST send `setTrip(null)` and clear both pickers.
- **FR-009**: The viewer's restore after a reload MUST include the trip, between labels and playing.
- **FR-010**: Choosing a trip MUST never start a layout, a rebuild, `graph.build` or an export.
- **FR-011**: Every refusal MUST be a sentence beside the control that caused it; nothing is disabled.

### Key Entities

- **Station**: id and name, as the engine lists them for this layout.
- **Trip**: from, to, legs, changes, and a reason when there is no trip.
- **Leg**: line, towards (terminus), board, alight, stops.

## Success Criteria *(mandatory)*

- **SC-001**: A trip is chosen by keyboard alone, from Tab into the section to the first leg read, in under twelve key presses on the fixture.
- **SC-002**: The end-to-end test records exactly one `setTrip` per completed choice and no engine call.
- **SC-003**: Leaving route mode restores the page within tolerance 8 in RGB.
- **SC-004**: The accessibility sweep passes over cell 03 with the popup open and closed, in both themes.

## Assumptions

- The engine pin carries E38: `setTrip`, `state().trip`, `stations` on `map.build`.
- The fade and the penalty constant are the engine's.
- The three documents quote the section's heading, both pickers' names and the leg sentence.
- `docs/DESIGN.md` 8.2 gains a "Trip" row under cell 03.
