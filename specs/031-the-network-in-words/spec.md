# Feature Specification: The network in words

**Feature Branch**: `031-the-network-in-words`

**Created**: 2026-10-02

**Status**: Implemented

**As of 7 Oct 2026:** built against engine v0.12.0, which answers `render.stage`'s `description` (the engine's issue 54) and takes its optional `date`. Where this spec is silent the build chose, and kept to the least: the service day sent is the day the map on screen was drawn for (`drawnDate`), because the extent sentence says "On the day drawn" and a day chosen and not yet drawn is not that day (A5.5-15); a count in the pane's name or a sentence is read in the singular for one ("1 line", "one station", "1 minute"); a line's station count is the run's stations and every branch's together, each once, as the engine's field comment says they are the line's stations; a loop's extent keeps the line's name and reads "the `<line>`, a round trip from `<from>`", the parenthesis of FR-004 replacing only the "from `<from>` to `<to>`" part; inside one interchange the lines read "B, C and D" (no serial comma) while the interchanges read "X at P, Y at Q, and Z at R" (with one); a line's station list holds the run and then, under a heading, each branch and separate section; a name of only spaces reads as an unnamed station; the pane's name follows the drawing on screen, so the counts in it are those of the stage it names while the next stage arrives.

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
    extent: { minutes: number, line: string, from: string, to: string } | null,
    lines: [ { label: string,
               termini: [string],            // two names; one for a loop
               stations: [string],           // names in order, termini first and last
               meets: [ { station: string, lines: [string] } ],
               branches: [ { at: string | null, stations: [string] } ],
               trip: { minutes: number, from: string, to: string } | null } ]
  }
  ```
  Lines are in the engine's `labels` order; `meets` lists every station where the line shares a node with at least one other label, in station order along the line.

  **As of 6 Oct 2026:** `render.stage` takes an optional `date`, the project's service day, and `StageDescription` replaces `extent: {ew_km, ns_km}` with `extent: {minutes, line, from, to} | null` and gains `lines[].trip: {minutes, from, to} | null`, `from` and `to` in the order the line's `stations` list them; additive at protocol 1. Without `date` both are null and the app infers nothing. The words stay those of the stage asked for: reading the day's timetable costs about 1.1 s on New York and 3 s on Chicago (6.0 million `stop_times` rows, 2.5 GB in memory), so the engine caches the computed minutes per layout and date, never the tables, and `map.build`, which already holds the day's trips, fills the same cache.
- **FR-002**: The pane's accessible name MUST be the short alternative: the stage, its gloss, and the line and station counts from `counts`.
- **FR-003**: The long alternative MUST be a visible disclosure named "The network in words", after the keys hint, inside the section headed "Where the routes run".

  **As of 6 Oct 2026, the name stands:** "The network in words", a noun phrase in sentence case saying what the disclosure holds, as the notebook's other section names do ("In the feed", "Where the routes run", "What the build had to fudge", "Engine log"), and the name of no control inside it. It is the kit's `Disclosure` with no heading of its own, as the engine log's is, because the section's `h3` "Where the routes run" already heads it; its disclosed group is named "The network's extent and its lines", so one name is not heard twice.
- **FR-004**: **As of 6 Oct 2026: minutes, from the timetable of the day drawn.** Each line is timed by its commonest trip that day (trips grouped by their first and last calls on mapped stations), the median in whole minutes. The sentence reads "On the day drawn, the longest trip on one line takes `<m>` minutes: the `<line>` from `<from>` to `<to>`." (a loop: "a round trip from `<from>`"), and is left out when `extent` is null. Timing between the spine's ends was measured and rejected: of the registry's 184 lines it times 100 from half their trips or more and 32 from none (Chicago's Loop lines, New York's 2 to 5); the commonest trip times 178, covering a median 89% of each line's trips. Criterion: on BART on a weekday, Blue's trip is 64 minutes, Daly City to Dublin / Pleasanton, as `stop_times.txt` reads by hand, and `extent` is the Yellow, 104.

  **As of 7 Oct 2026, which trip, and the rounding:** the engine times a line by its commonest trip that day, grouping trips by their first and last mapped calls, and breaks ties by the group with more trips, then the shorter median in seconds, then the pair of names that sorts first; the median is rounded half up to whole minutes. On BART on Friday 11 September 2026 the Blue's two directions have 58 trips each with medians of 64.0 and 65.0 minutes, so the Blue is 64 from Daly City to Dublin / Pleasanton, and `extent` is the Yellow at 104 from San Francisco International Airport to Antioch.
- **FR-005**: The top level MUST hold exactly one item per line and MUST NOT list stations; station lists live only behind per-line disclosures.
- **FR-006**: **As of 6 Oct 2026: termini are the drawn ends,** the two ends of the line's spine (`linear.spine`) in station order, never headsigns, which are per trip and empty in three of the 22 feeds. A line whose stations form one cycle is a loop, with one terminus. A branch is `{at, stations}`: `at` the spine station it leaves (beside a junction that is no station, the spine station next to it on the longer side), `stations` in travel order, split where it forks again; the item adds "with a branch from `<at>` to `<last>`". A label in pieces (New York's S) gives each further piece `at` null, read "and a separate section from `<first>` to `<last>`". Criterion: on BART, Blue runs Daly City to Dublin / Pleasanton, Red and Yellow each have one branch, San Bruno to Millbrae (Caltrain Transfer Platform), and BridgeA and BridgeB are loops.
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
