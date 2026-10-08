# ADR-050: The frame is padded, never cropped

- **Status:** Accepted
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

The wireframes put fit, crop, rotate and a margin in pixels beside the map (engine issue #38). Two exist under other names, one is refused on purpose, and one does not exist.

**Fit** is `map.build`'s `width`: the engine fits the whole graph to it.

**Margin** is `Style.padding`, on the wire from ADR-049.

**Crop** is refused in as many words. `export.padded_box` grows a viewBox to a preset's aspect and never shrinks it; its docstring says "Never crops -- that would cut off stations." The extra height is split unevenly (`frame_top`, 0.46 by default), so a portrait frame around a wide network has its gutter where the title and clock sit, and the network is not centred into it.

**Rotate** does not exist. Labels are placed against edge angles with oriented boxes (`labels.py`), so any rotation re-runs placement; and `octi` lays the network on an axis-aligned grid, so any turn but a multiple of 90 degrees stops reading as octilinear.

The wireframes' clip mask from a GeoJSON file is three features under one word (the viewBox, the drawn geometry, or which stations enter the graph) and waits on a designer's intent.

A person who wants less network already has two tools: `ExportOptions.lines` keeps the named lines and hides the rest, and the page refits its box to what is visible.

## Options

**(a) Allow a crop that may cut a station, behind a warning.** Buys a tighter frame. Costs a map that lies about where a line ends, and a sidecar that would have to say so.

**(b) Refuse crop; padding is the frame's one freedom.** Costs nothing; it is what the code does.

**(c) Rotation now, any angle.** Re-placement, and a map no longer on the grid.

**(d) Rotation later, in 90-degree steps, at render time.** Re-placement from the stored layout; the grid survives; taken only against a measured need.

## Decision

(b) and (d). The frame is never cropped and a station is never cut. Margin is `padding`; fit is `width`; both are on the wire with ADR-049 and need nothing more. Rotation is deferred: if it is ever taken it is a `map.build` option in steps of 90 degrees that re-runs label placement from the stored layout and never changes the layout, and the need that takes it is a wide network in a 9:16 reel, measured, not assumed. The clip mask stays out until a designer says which of the three it means.

## Consequences

**No code.** #38 closes with this record; nothing changes what is drawn.

**Cell 03 offers no crop or rotate control and says why**, in one sentence beside the margin.

**As of 8 Oct 2026, accepted.** The margin is the **Margin** field in cell 04 (`padding`, 0 to 200 in the map's own units, issue 350), with the sentence beside it: "The frame is padded, never cropped or rotated: a station is never cut off, and a tighter frame is a smaller margin." The record asked for it in cell 03; it sits beside the margin, which is in cell 04. Fit is `width`, which the app does not offer. Nothing offers crop or rotation, and nothing was added to the engine. Cell 03's own older sentence (`FrameCell.tsx`), which says how the map is cropped, turned, margined and masked belongs in that cell and is not drawn yet, predates this record and now says what this one refuses; it is not reworded here.

**What would reopen it.** Reels of wide networks where the map is a band across an empty frame. `frame_top`'s gutter is the mitigation today; a count of such exports is the evidence.
