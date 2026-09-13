# Implementation Plan: The geographic view

**Branch**: `A2-03-geographic` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

A `StageView` component on the project screen for a laid-out project: a
toggle between the two stages, the counts, and a pane holding an iframe
with `sandbox=""` and the engine's SVG as `srcdoc`, sized from the
result, panned and zoomed by transforms on the frame from wheel, drag and
keys. Stages are read through the typed client and cached per layout,
stage and width, keyed also by the record's `made`. The stand-in answers
`render.stage`. A section in the design document for the pane.

## Constitution Check

| Principle | Reading |
|---|---|
| I | The drawing is the engine's SVG; the app transforms a frame. |
| II | The counts are the result's; nothing is counted here. |
| V | An SVG string and numbers cross; no path. |
| VI | A labelled, focusable pane with keyboard pan and zoom; the toggle two buttons with `aria-pressed`; no transition under reduced motion. |
| The page is contained | `sandbox=""`: no scripts, no origin. |

## Source code

```text
src/renderer/src/StageView.tsx, engine/stages.ts, ProjectView.tsx, styles/app.css, docs/DESIGN.md
tests/fake-engine/schematic/serve.py             # render.stage
tests/unit/stage-view.test.ts, tests/unit/layout-real.test.ts, tests/e2e/geographic.spec.ts
docs/ARCHITECTURE.md, CLAUDE.md
```
