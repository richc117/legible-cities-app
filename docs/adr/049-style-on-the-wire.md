# ADR-049: Style goes on the wire as the engine's own fields

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

`render.Style` holds the map's numbers: `line_width 7.0`, `line_gap 1.6` (the parallel-track pitch as a multiple of the width), `station_radius 4.2`, `interchange_radius 6.0`, `station_stroke 2.2`, `label_size 11.0`, `label_offset 9.0`, `padding 24.0`, and five colours. `pipeline.run()` takes one. `serve.py`'s `map.build` never constructs one, so every map the app has drawn is `Style(themed=True)` (engine issue #36).

The app has carried `ProjectStyle` on every record since A1-05: `lineWidth`, `stationRadius`, `interchangeRadius`, `labelSize`, validated, stored, never sent. Its `DEFAULT_STYLE` is `10, 8, 11, 26`, under a comment calling them the engine's defaults. They are not; the engine's are `7.0, 4.2, 6.0, 11.0`. Nobody has seen the app's numbers drawn. The day the parameter exists, an app that sends what it stores changes every existing project's map.

**There is one unit.** The engine fits the graph to `width` (1,800 by default) and draws in SVG user units at that width; `line_width 7` is seven of 1,800. Nothing is in screen pixels.

**Two of the wireframes' frame controls are already here.** The margin is `padding`; fit is `width` (ADR-050). `label_char_width` is the placer's advance-width assumption, not a choice, and `themed` is how the page recolours furniture; neither goes on the wire.

**What comparable tools expose** (summarised, not read raw): Metro Map Maker offers line size in five percentage steps and no typeface; Mapbox's line layer is `line-width`, `line-gap-width`, `line-dasharray`. Numbers a person can read, not a taste slider.

Any new field moves the schema's fingerprint. This one rides the v0.12.0 pin.

## Options

**(a) The four fields the app stores.** Smallest. Leaves gap, stroke, offset and padding unreachable and buys a second schema move for the margin.

**(b) Every `Style` field a person could mean, all optional, each with a range.** One move; the Style cell's numeric fields (the post-MVP backlog's "line width, station radius, label size with live re-render") and ADR-050's margin land together.

**(c) Named presets only** (engine #45). A name over numbers nobody can send yet. The numbers come first.

For the app's old defaults: **(i)** send them and change every map; **(ii)** rebase `DEFAULT_STYLE` to the engine's values and read a record equal to the old defaults as unset; **(iii)** convert by ratio, inventing a scale.

## Decision

(b) and (ii). `MapBuildParams.style` is an optional object of optional fields: `line_width` (1 to 24), `line_gap` (1 to 3, a ratio), `station_radius` (1 to 20), `interchange_radius` (1 to 30, never below `station_radius`), `station_stroke` (0 to 8), `label_size` (6 to 32), `label_offset` (0 to 40), `padding` (0 to 200), and `background`, `station_fill`, `station_stroke_color`, `label_color` as `HexColor`. `default_color` stays the parameter it is. Units are SVG user units at the map's `width`, and the schema's descriptions say so. An omitted field is the engine's default; an omitted object draws exactly what is drawn today. A field out of range is refused with the `params` kind and a sentence naming the field. In the app, `DEFAULT_STYLE` becomes the engine's values, the record version moves, and a stored style equal to the old defaults in every field is read as unset; any other stored value is kept. The app sends only fields a person has set. The engine accepts the four colours; the app does not offer them in Phase 8, because the page's theme owns the furniture.

## Consequences

**One schema move, shared.** The fingerprint, `npm run typegen` and the vendored runtime move once for this record and ADR-051 to ADR-053, at v0.12.0.

**Cell 04 gets its numbers**, with the live redraw the backlog asked for, and the record stops storing fields it never sends.

**Padding closes #38's margin.** ADR-050 says so.

**A labelled map re-fits.** `label_size` and `label_offset` re-run the placer, so the viewBox and `data-viewbox-nolabels` move with them. Determinism is untouched: the layout is stored and the render is a function of it.

**What to watch.** `line_gap` moves the parallel-track pitch the page's dots ride. A test draws one feed with and without a style and asserts the SVG differs where the style says and in no node coordinate.

**As of 6 Oct 2026: the app never sends `background`, nor the other three colours.** In the SVG `background` is only the fallback in `var(--map-bg, …)` on the backdrop and the label halo (`render.py:315, 355`); the page defines `--map-bg` in both themes and makes it transparent in present mode (`page.html:37, 44, 249`), the export's SVG path resolves the variables from `PALETTES`, and E39's thumbnails resolve them the same way. Only a standalone SVG outside any page reaches the literal, and the app shows none; the engine keeps the field for the command line and the site. Criterion: the app's type for `map.build`'s `style` has no `background`, `station_fill`, `station_stroke_color` or `label_color`, and a unit test on the params the layout run sends asserts none of the four is present.
