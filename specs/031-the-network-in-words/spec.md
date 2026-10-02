# Feature Specification: The network in words

**Feature Branch**: `031-the-network-in-words`

**Created**: 2026-10-02

**Status**: Draft

**Input**: Issue 105, "The geographic view says only its counts to a screen reader"; `docs/accessibility.md` finding F2; the engine issue for a `description` field on `render.stage`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hear what the network is (Priority: P1)

As someone using a screen reader, I want the pane "Where the routes run" to tell me where they run: how far the network reaches and what each line does, so that the drawing I cannot see has an equivalent I can read.

**Why this priority**: the pane today says five counts and nothing else; the finding is a WCAG 1.1.1 gap.

**Independent Test**: lay out a project, Tab to the pane, listen; then open the disclosure after it and read.

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** the pane takes focus, **Then** its name is "The `<stage>` stage, `<gloss>`: `<L>` lines, `<S>` stations" and it is described by the keys hint as before.
2. **Given** the pane, **Then** immediately after the keys hint there is a disclosure named "The network in words", closed by default, and on opening it reads one sentence of extent and then a list with one item per line.
3. **Given** a line item, **Then** it reads "`<label>`: from `<A>` to `<B>`, `<n>` stations; meets `<X>` at `<P>`, and `<Y>` and `<Z>` at `<Q>`." or, with no interchange, "...; meets no other line."
4. **Given** a loop line, **Then** it reads "`<label>`: a loop of `<n>` stations through `<A>`; ...".

---

### User Story 2 - Read one line's stations in order (Priority: P2)

As someone who knows the city, I want a line's stations in order, so that I can place a station on a line I cannot see.

**Acceptance Scenarios**:

1. **Given** a line item, **Then** it holds a disclosure named "Stations on `<label>`, in order", closed by default, whose content is an `<ol>` of names.
2. **Given** a network of forty lines, **Then** no station list is open until a person opens one.

---

### User Story 3 - See it, not only hear it (Priority: P2)

As someone with low vision or new to the city, I want the same words visible beside the drawing.

**Acceptance Scenarios**:

1. **Given** the disclosure open, **Then** its text is on screen in the prose track and is the same text a screen reader hears.

### Edge Cases

- A station with no name in the feed reads "an unnamed station"; a name is rendered as a text node, never markup.
- The stage switch changes the counts and the description together; the description asked for is the stage shown.
- A line with one station is listed as "`<label>`: one station, `<A>`; ...".
- The engine answers no `description` (older pin): the disclosure is not drawn and the pane keeps today's name; nothing is inferred.
- The project has no layout: the pane's existing sentence stands and there is no disclosure.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `render.stage`'s result MUST carry `description`, validating against this schema, additive at protocol 1:

  ```
  StageDescription: {
    extent: { ew_km: number, ns_km: number },
    lines: [ { label: string,
               termini: [string],            // two names; one for a loop
               stations: [string],           // names in order, termini first and last
               meets: [ { station: string, lines: [string] } ] } ]
  }
  ```
  Lines are in the engine's `labels` order; `meets` lists every station where the line shares a node with at least one other label, in station order along the line.
- **FR-002**: The pane's accessible name MUST be the short alternative: the stage, its gloss, and the line and station counts from `counts`.
- **FR-003**: The long alternative MUST be a visible disclosure named "The network in words", after the keys hint, inside the section headed "Where the routes run".
- **FR-004**: Its first sentence MUST be "The network spans `<ew>` km east to west and `<ns>` km north to south." [NEEDS CLARIFICATION: kilometres, or minutes end to end from the timetable]
- **FR-005**: The top level MUST hold exactly one item per line and MUST NOT list stations; station lists live only behind per-line disclosures.
- **FR-006**: Termini MUST be the first and last of `stations` as the engine orders them. [NEEDS CLARIFICATION: or the feed's headsigns, where the engine has them]
- **FR-007**: The renderer MUST compute nothing: no ordering, no junction, no distance; a unit test feeds a fixture `description` and asserts the sentences.
- **FR-008**: Names MUST be rendered as text, never as markup.
- **FR-009**: The disclosure MUST NOT change the pane's keyboard handling, its sandbox or its `aria-hidden` frame.

### Key Entities

- **StageDescription**: the engine's account of one stage graph in words-ready fields.
- **Line item**: a label, its termini, station count, interchanges.

## Success Criteria *(mandatory)*

- **SC-001**: A screen reader user can state, from the pane and the disclosure alone, a line's two ends and where it meets another line, for every line on the fixture.
- **SC-002**: The top level for a forty-line network is under forty-two sentences.
- **SC-003**: The accessibility sweep passes over cell 01 with the disclosure open and closed, both themes.
- **SC-004**: The fixture test fails when any `meets` entry is dropped (watched failing once).

## Assumptions

- The engine pin carries the field; the app draws nothing until it does.
- Evidence read raw: the W3C complex-images tutorial lists "maps showing locations" among complex images and says "a two-part text alternative is required. The first part is the short description ... The second part is the long description – a textual representation of the essential information conveyed by the image."; WCAG 1.1.1's Situation B pairs a short alternative with a long one; Highcharts says a hidden description "is not generally recommended, since making the description visible will also improve cognitive accessibility".
- `docs/DESIGN.md` 8.2's geographic pane row gains the disclosure; `docs/accessibility.md` F2 closes against this spec.
