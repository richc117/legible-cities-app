# Implementation Plan: The theme a project's map is drawn in

**Branch**: `A4-03-theme` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

Everything downstream of the choice already exists: the record's `theme`,
the page's `?theme=`, the export's `themeFor`. This adds the choice itself -
a switch on the project screen, a bridge method that writes it, and a
viewer that reads the project rather than the interface.

It is the smallest of Phase 4 by a distance, because a theme is neither a
layout nor a render: the engine's SVG carries its furniture's colours as
CSS variables with literal fallbacks, so the page restyles itself from its
own address and the line colours never move.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One picture | The switch is two buttons; the theming is the engine page's own, applied by the page before paint. |
| II. The engine is the source of truth | The theme names are the engine's (`warm-dark`/`sepia` on the page, `dark`/`light` in the export's options); the app translates, chooses nothing. |
| III. Determinism is a feature | No engine request at all: no layout, no map build, no capture. |
| IV. No network without a reason | Nothing is fetched. |
| V. Hygiene by tools | One enum crosses the bridge inward; a record comes out. |
| VI. Accessible by default | Two named buttons with `aria-pressed`, the pair labelled, contrast already asserted per theme by the token tests. |
| VII. Records | ADR-028 already holds that the page is driven by its address and from the main process. No new record. |

## Design

**The choice.** `Theme = 'warm-dark' | 'sepia'`, the record's own field
since A1-05. `isTheme` and `validateTheme` in `src/shared/project.ts`, used
by `parseRecord` (which has been open-coding the check), by the main-side
handler and by the store.

**The bridge.** `api.projects.setTheme(id, theme)` - named for what it does
rather than for when it is called, because unlike `completeColors` and
`completeOrder` there is nothing to finish first. It writes `theme` and
`modified` and nothing else, and it refuses a read-only record.

**The screen.** `ThemeSwitch` in `src/renderer/src/ThemeSwitch.tsx`: a
heading, a sentence, and the pair of buttons in the toolbar shape the
geographic view's stage toggle already uses - the chosen one `primary` and
`aria-pressed`, the pair in a group named for what it sets. Disabled while
an export runs, because a theme change reloads the very frame the capture
is reading.

**The viewer.** `pageUrl` takes the project's theme. The media-query
listener and `themeNow` go: the map no longer follows the interface, which
is the behaviour change this feature is, and the comment naming A4-03 goes
with them.

**The export.** Unchanged. `themeFor` has mapped the record onto the
engine's `dark`/`light` since A5-02b; what changes is that the record now
holds something other than the default.

**The stand-in.** `export.plan` hardcodes `"theme": "dark"` in its answer
and in the URL it hands back. It echoes what it was asked now: a test
double that ignores an input cannot show that input arriving.

## Source code

```text
src/shared/project.ts                              # isTheme, validateTheme, parseRecord
src/shared/api.ts, src/preload/index.ts            # setTheme
src/main/ipc.ts, src/main/projects.ts              # the theme validated, then stored
src/renderer/src/ThemeSwitch.tsx                   # the switch
src/renderer/src/ProjectView.tsx                   # one line for it, and the record it writes back
src/renderer/src/Viewer.tsx                        # the project's theme, not the interface's
src/renderer/src/styles/app.css, docs/DESIGN.md    # the switch's rule (8.2)
tests/fake-engine/schematic/serve.py               # the stand-in echoes the theme it was asked for
tests/unit/{project,projects-store,ipc}.test.ts
tests/e2e/theme.spec.ts                            # the switch, the frame, the record, the export
docs/ARCHITECTURE.md, CLAUDE.md, specs/003 contracts
```
