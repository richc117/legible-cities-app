# ADR-048: Route mode is a trip the page finds

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

The map shows a whole network at once. The maintainer asked for the other way of reading it: choose a start and an end station, let everything off the trip fade, and keep the trip bright with the line to board, its direction, the changes and where to alight (app issue 272, engine issue 49). The essay on the public site would gain the same switch.

Four facts constrain the design. The app draws nothing (principle I): a trip is drawn by the engine's page and asked for through `window.__present`, whose methods the app allow-lists by name in `src/shared/viewer.ts`. The engine is the source of truth (principle II), and the page is the engine's artefact: it is the viewer on the site as well as in the app, and on the site nothing but the page runs. The allow-list already holds `setRoutes`, which takes the lines to keep (routes in the feed's sense), and the page has an internal `setRoute(r, on)` for its line chips. And the engine holds the network as a graph (`LineGraph.adjacency()`), while the page holds only the drawn lines and their stations in order.

Open: where the trip is computed; how fewer changes weigh against more stops; what a trip does when a line it needs is hidden; what the seam is called; where its pickers live; whether a trip is part of the project.

## Options

**Where it is computed.** (a) In Python, answered by an RPC the app relays to the page as legs to draw: one router in the language that has the graph, but the site has no RPC and would need a second one, and the page would draw a trip handed to it rather than one it found. (b) In Python, every pair precomputed and emitted with the page: four hundred stations is eighty thousand pairs, too much to ship. (c) In the page's own script, over a graph the engine emits with it: one router that runs wherever the page runs, so the app, the site and the essay give one answer; its cost is that Python cannot assert a route without running the page.

**The cost rule.** Fewest changes first, then fewest stops, gives the trip that avoids one change by riding thirty stops. A single cost, stops plus a fixed penalty per change, is what journey planners do: OpenTripPlanner's `transferPenalty` is "An additional penalty added to boardings after the first."

**A hidden line.** Route over it and un-hide its legs; route around it; or refuse. A person who hid a line has said "not that one", which is a question worth answering.

**The name.** `setRoute(from, to)` beside `setRoutes(keep)` is two allow-listed names differing by a plural, one about a trip and one about lines, and the page already uses the singular for a third thing. Both issues say "trip" in prose.

**Where, and whether kept.** A trip changes what the map shows and nothing the project keeps, which is the transport's rule in cell 03 ("drives the engine's page and never the project"). Keeping it in the record would make it an input to exports that have no beat for it.

## Decision

**The page finds the trip** (c): the engine emits the network's graph with the page, the page's script computes the trip, and the engine's tests assert it through the page on a fixture. **The cost is stops plus a fixed penalty per change**, the penalty a constant the engine publishes, proposed as four stops; ties go to fewer changes, then to the line's label, then to the station's id, so two calls give one answer. **A hidden line is routed around**; with no trip left, the page says so, names the hidden lines, and leaves the map whole. **The seam is `setTrip(from, to)` and `setTrip(null)`**, with `state().trip` either `null` or the legs; the page's internal `setRoute` is renamed to keep the word clear. **The app offers the trip in cell 03** as a third section beside the transport, start and end as editable comboboxes and the legs as an ordered list. **A trip is view state, not record state**: never written to the project, restored with the view, labels and clock when a rebuild reloads the page. **The one additive schema change** is a `stations` list, id and name, on `map.build`'s result, so the pickers name what `setTrip` accepts. **A storyboard beat is deferred**; `state().trip` is what a beat would replay, and nothing here forecloses one.

**As of 6 Oct 2026: how far the rest fades.** Everything keyed to a line the trip does not ride takes opacity 0.16, the lowest rung of the page's own ladder (its time chart's busiest lines): the line's group, its station dots, its trains and its name in the linear view's gutter. Station names off the trip are hidden, not faded; a station the trip passes keeps its name, chosen by station, not line, since the map keeps one opaque label per station and it may sit on a line off the trip. A faded line is never more distinct from the trip than the trip is from the ground; 0.16 keeps most of it: a mid-grey line against its faded twin is 3.62 to 3.93:1 on the warm-dark grounds, 2.93:1 on sepia (3.46 unfaded); 0.28 gives 3.03 and 2.57. No feed colour changes; the steps are the text alternative.

**As of 6 Oct 2026: the penalty stays at four stops.** A throwaway router over the 22 stored octi graphs (389,476 ordered station pairs; a stop is a station the line calls at; LOOM's `excluded_conn` and `not_serving` honoured) finds no cliff between three and six: most answers move below two, and each later step moves 3.7–6.4% of pairs, most in New York, and next to none in the median network. Fewest changes first rides up to 37 extra stops to avoid one change. Four stops at a 1.5–2 minute interstation is 6–8 minutes, beside the 8 in-vehicle minutes reported for a rail-to-rail change. Criterion: on BART, 12th Street / Oakland City Center to Warm Springs / South Fremont rides 10 stops with no change, not 9 with one; on SF Muni Metro, Balboa Park to Right Of Way/Ocean Ave changes once (10 stops) rather than riding the M 15.

| P | pairs whose answer moves (all 22) | median network | longest detour accepted at the higher P (stops over the fewest) |
|---|---|---|---|
| 0 → 2 | 29.6% | 3.0% | 9 |
| 2 → 3 | 6.4% | 0.02% | 12 |
| 3 → 4 | 3.7% | 0 | 14 |
| 4 → 6 | 5.4% | 0 | 18 |
| 6 → 8 | 3.8% | 0 | 21 |
| 8 → ∞ | 5.9% | 0 | 37 (World Trade Center to Broad St, New York) |

## Consequences

**The page grows a router and a graph.** The graph is the line graph the layout already carries, not the timetable. The page's size before and after is measured and written here before the record is Accepted.

**Hidden lines change the answer.** A person who hid a line to tidy the view may get a longer trip and not know why, so the step list says which lines the trip avoided whenever any are hidden.

**The app gains a control kind.** The kit has no combobox; one is written under `src/renderer/src/kit/` to the APG pattern, the first control here with a popup and `aria-activedescendant`, so the accessibility sweep learns to walk it.

**Python tests drive the page.** The fixture assertions on `state().trip` run the page, as the capture tests already do.

**Three documents gain sentences**: acceptance, stranger and accessibility quote the section's heading, the pickers' names and the leg sentence.

**As of 6 Oct 2026:** honouring LOOM's `not_serving` disconnects 12.5% of the registry's station pairs (Seattle from 2,582 to 1,670, Metra from 57,360 to 22,178), so the router must not trust `not_serving` without a check.

**Evidence.** APG combobox: "List autocomplete with manual selection: When the popup is triggered, it presents suggested values."; Escape "Closes the popup and returns focus to the combobox."; "DOM focus remains on the combobox and the combobox has aria-activedescendant set to a value that refers to the focused element within the popup." (https://www.w3.org/WAI/ARIA/apg/patterns/combobox/). OpenTripPlanner, quoted above (https://docs.opentripplanner.org/en/latest/RouteRequest/). Mapway's schematic-map planners offer "guides that take you step-by-step through your route on the metro map, highlighting changes." (https://www.mapway.com/apps/tokyo-metro-subway/). Transit: "Route names, stops, and trip durations are presented in concise, easy-to-understand sentences." (https://resources.transitapp.com/article/522-transit-and-universal-accessibility). WCAG 4.1.3: status messages are "presented to the user by assistive technologies without receiving focus" (https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). None gives a penalty value or a fade amount; those are judgements. The pages were read as served and the words are quoted from them.
