# Feature Specification: The geographic view, two stages of the layout drawn where they run

**Feature Branch**: `A2-03-geographic`

**Created**: 2026-09-11

**Status**: Draft

**Input**: Planned issue A2-03 (#21). Engine v0.7.x answers `render.stage`:
one stored stage graph of a layout, by the layout's id, as a
self-contained SVG with its counts (nodes, stations, junctions, edges,
lines) and its size. The stages a person wants to see are the first, as
the feed draws its routes (`gtfs2graph`), and the third, after LOOM has
sorted the lines onto shared track (`loom`), before the schematiser
straightens anything.

## Overview

A project with a layout gains a geographic view: the engine's drawing of
a stage, in a frame sandboxed at least as strictly as the viewer's, never
inline in the interface's document, with pan and zoom done to the frame
from outside, a toggle between the two stages, and the stage's counts as
the engine sent them. The app draws nothing and counts nothing: the SVG
and the numbers are the engine's, and the view reuses its renderer
rather than writing one (principle I). When the layout changes, because
a narrower mode or another operator was chosen and the project laid out
again, the view draws the new layout's stages.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - See where the routes run, and what sorting did (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a laid-out project, **When** the geographic view is opened,
   **Then** the `gtfs2graph` stage is drawn in a sandboxed frame and its
   counts are shown; the toggle draws the `loom` stage, with its own
   counts; the counts are the engine's, never computed by the app.
2. **Given** Los Angeles against the real engine, **Then** each stage
   draws in under a second, and the `loom` stage has no more nodes than
   the `gtfs2graph` stage (a merge, never a literal count: `topo` is not
   reproducible, ADR-023).
3. **Given** the pane, **When** the wheel turns or the keys `+`, `-`, the
   arrows and `0` are pressed, **Then** the drawing zooms and pans and
   nothing inside the frame runs; reduced motion means no transition.
4. **Given** the engine not ready, or the stage refused, **Then** the
   pane says why and the rest of the screen works.

### User Story 2 - A narrower choice visibly removes routes (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a laid-out project drawn whole, **When** a narrower mode is
   chosen and the project laid out again, **Then** the view draws the
   new layout, with fewer lines in its counts and in the drawing.

### Edge Cases

- A stage is read once per layout, stage and width per session, and kept;
  a re-layout under the same id (forced) is a new set, and the run's
  `made` moving forgets it.
- The SVG is themed through CSS variables with fallbacks; inside an opaque
  frame the fallbacks apply, so the drawing is the engine's default
  theme until A4-03.
- The frame carries `sandbox` with no permissions at all: the drawing has
  no script to run, and pan and zoom are the interface's transforms on
  the frame, never a script inside it.

## Requirements _(mandatory)_

- **FR-001**: The geographic view MUST show `render.stage`'s SVG in an
  iframe with an empty `sandbox`, through `srcdoc`, and MUST never put
  the SVG into the interface's document.
- **FR-002**: Pan and zoom MUST be transforms on the frame from the
  interface, reachable by wheel, drag and keyboard, with a labelled pane
  and no transition under reduced motion.
- **FR-003**: The toggle MUST offer the `gtfs2graph` and `loom` stages by
  their engine names with a gloss, and the counts MUST be the result's.
- **FR-004**: The view MUST read the stage by the project's stored layout
  id and MUST follow the record when the id or `made` changes.
- **FR-005**: The stand-in MUST answer `render.stage` with an SVG and
  counts that follow the layout's inputs, so a narrower mode shows fewer
  lines end to end.

## Success Criteria _(mandatory)_

- **SC-001**: End to end against the stand-in: the two stages and their
  counts, the toggle, the sandbox's exact value, pan and zoom by keyboard,
  the refused case, and fewer lines after a narrower mode and a re-run.
- **SC-002**: Against the real engine, Los Angeles's two stages by the
  sidecar, each under a second, `loom` with no more nodes than
  `gtfs2graph`, and the counts equal to `graph.build`'s.

## Dependencies

- A2-02; E15 and E09c (engine v0.7.0); E04b.
