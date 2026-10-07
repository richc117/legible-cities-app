# ADR-053: A line can be renamed and hidden; width, casing and dash wait on the pitch

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

`map.build` takes `colors`, `default_color` and `line_order`, and that is all a person can say about one line (engine issue #42). `render.line_colors()` resolves every line once and `RenderResult.colors` carries it to `animate.build`, so the page's `data.lines` has every drawn line and nothing falls back on its own. That seam is where a name rides.

**Hiding exists twice, narrowly.** `ExportOptions.lines` keeps the named lines for one export (the page's `?lines=` calls `setRoutes`), and the viewer's `setRoutes` hides in the page. `map.build`'s SVG, the thumbnails (#51) and the page's chips draw everything.

**Width, casing and dash are geometry.** `offsets.py` computes the parallel-track pitch from `Style.spacing` for every line on an edge; a per-line width changes its neighbours' offsets; a casing is a second stroke under the first; a dash is a stroke attribute, but the page's track under the moving dots must match. All three reach `offsets.py`, `render.py`, `animate.py` and the page.

**Practice has the vocabulary** (summarised, not read raw): Metro Map Maker exposes line size in steps and named styles such as dashed and hollow; Mapbox has `line-width`, `line-gap-width` for a casing, and `line-dasharray`. The words are settled; the geometry is the work.

A trip through a hidden line is #49's question. Labelling a terminus differently is its own issue.

## Options

**(a) All five properties in one change.** The two cheap ones wait on the three expensive ones.

**(b) Name and hidden now; width, casing and dash as a new issue blocked on a pitch design.**

**(c) Hidden app-side only, through `lines`.** The SVG, the thumbnails and the chips keep drawing hidden lines.

## Decision

(b). `MapBuildParams.lines` is an object keyed by line label, each value `{ name?: string of 1 to 40 characters, hidden?: boolean }`, every field optional; a label the layout does not carry is ignored, as `colors` does. A name is written wherever the label is: the page's chips, rows and time-chart bands, the train's `<title>`, the sidecar's lines, and the SVG's line text where it has any. A hidden line is drawn nowhere: not in the SVG, the thumbnails, the chips, the rows, the chart, nor as moving dots; its trips are not scheduled; a station served only by hidden lines is not drawn; the parallel-track pitch is computed over the lines that remain, as `line_order` already changes the stacking. The layout id does not move: hiding is a drawing choice. `ExportOptions.lines` stays as the export-time filter over what the map shows. Route mode, when it exists, does not traverse a hidden line and says so. Width, casing and dash are a new issue, blocked on a note in `offsets.py` saying how a per-line width enters the pitch.

## Consequences

**Schema moves with v0.12.0.**

**Cell 05 gets a name field and a switch per line**, beside the colour and the grip.

**Two hiding mechanisms coexist.** The map's is the one the app offers; the export's `lines` is reached only through it, or the preview and the file disagree.

**What to watch.** A hidden line that was alone on an edge removes that track; the geographic morph pairs by station and must still pair. A test asserts that hiding a line leaves the four stage files byte-identical and the page's `data.lines` without it.

**As of 6 Oct 2026: yes, because hiding is done once, on the graph.** `map.build` removes the hidden labels from the line graph it reads (an edge left with no line, then a node left with no edge, dropped) before matching, scheduling, drawing and animating, so `names` (`animate.py:353–356`), the linear rows and the morph, which pairs drawn tracks by `station_id` (`animate.py:120–212`), see only drawn stations; the `loom` graph needs no filter. Measured: Grey hidden on BART drops two stations, 112 of 118 tracks pairing (113 of 119 whole); K hidden on LA drops ten, 113 of 113 pairing. Cell 01's geographic pane and its words describe the layout, every line: `render.stage` takes no hidden set. Criterion: with Grey hidden, Oakland International Airport is absent from the SVG, `names` and both thumbnails, `data.lines` has no Grey, the stage files hash as before, and `render.stage`'s description still lists Grey.
