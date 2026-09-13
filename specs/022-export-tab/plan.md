# Implementation Plan: The export tab

**Branch**: `A5-01-export-tab` | **Date**: 2026-09-12 | **Spec**: [spec.md](spec.md)

## Summary

A5-02b's pipeline is already general: `Exporter` in `src/main/export.ts`
plans, captures and encodes whatever preset it is handed, and
`OFFERED_PRESETS` is the gate. This feature widens the gate to the
thirteen social presets and passes a choice (preset, storyboard, options)
where it passed a preset name. It adds a planning call for the preview,
writes the choice to the record, and puts it all behind a Map | Export tab
strip in the project panel.

## Constitution Check

| Principle | Reading |
|---|---|
| I. One renderer | The preview is the engine's page at the address the engine planned; the safe zones, title, clock and frame are the page's own drawing (`safe=1`, `frame=`, `title=`, `clock=`). The app draws nothing but controls. |
| II. The engine is the source of truth | Presets, storyboards, defaults and refusals come from `export.presets`, `export.storyboards` and `export.plan`. The app's list is a subset checked against the generated `PresetName`. |
| III. Determinism is a feature | The capture path is unchanged. `safe` is forced off in the export's plan and forced on only in the preview's. The stored layout is never re-run. |
| IV. No network without a reason | Nothing is fetched. |
| V. Hygiene by tools | The choice crosses the bridge inward and is validated in the main-side handler (preset in the offered list, storyboard in the generated union, options against `ExportOptions`, tag against `Token`); a URL crosses outward. |
| VI. Accessible by default | WAI-ARIA tabs; native selects and checkboxes through the kit; every control labelled; reduced motion honoured for the frame's resize; new pairs in the contrast test. |
| VII. Records | ADR-028 covers a frame navigated from main; no new record. |

## Design

**The choice.** `ExportChoice = { preset: OfferedPreset; storyboard?:
StoryboardName; options: ExportChoiceOptions }` in `src/shared/export.ts`,
where `ExportChoiceOptions` is `ExportOptions` without `theme`, `safe`,
`storyboard` and `fade` (the theme is the project's, safe is the app's to
set, the storyboard sits beside it, fade is not offered). `DEFAULT_CHOICE`
is `instagram-reel` with no options. `validateExportChoice(value): string |
null` is used by the handlers and by `parseRecord`.

**The record.** `export: ExportChoice` on `ProjectRecord`, read with
`DEFAULT_CHOICE` when missing or invalid, like `theme`. No version bump:
an older app ignores the field, as it did `lineOrder`. A saved preset or
storyboard the engine no longer lists is caught by the tab, not the
record: the record cannot know the engine's list.

**The bridge.**
- `api.projects.setExport(id, choice)` writes `export` and `modified`;
  refuses a read-only record.
- `api.export.run(projectId, choice)` replaces `run(projectId, preset)`.
  `Exporter.start` takes the choice and builds `export.plan`'s `options`
  from it, plus the project's theme, with `safe` never set.
- `api.export.preview(projectId, choice)` asks `export.plan` with `safe:
  true` and the project's page, and answers `{ url, notes } | { error }`.
  It runs through the same engine and the same reset guard as an export,
  but it is not a job: no frames, no progress, no record write.
- The lists come from the renderer's typed `EngineClient`
  (`export.presets`, `export.storyboards`), fetched once per engine
  generation and filtered to `OFFERED_PRESETS`.

**The preview.** `Viewer` takes an optional `address` prop. Without it the
frame shows `pageUrl(project)` with controls, as now; with it the frame
shows the planned address and is sized by CSS `aspect-ratio` from the
preset's width and height, inside the space the map had. Attachment is
unchanged: the planned address starts with
`app://local/projects/<id>/`, which is the prefix `viewer.ts` attaches
by. A plan is asked 250 ms after the last change (a duration token, not a
literal). An answer to anything but the newest request is dropped. A
refusal keeps the last address and shows the sentence.

**The tab strip.** `src/renderer/src/kit/Tabs.tsx`: a `tablist` of buttons
with roving `tabIndex`, arrow keys, Home and End, and panels with
`role="tabpanel"` and `aria-labelledby`. `ProjectView` renders it inside
the project panel: Map holds the existing panels, Export holds
`ExportTab`. The tab is local state, not stored.

**The export tab.** `src/renderer/src/ExportTab.tsx` composes a preset
select (native `<select>` with `<optgroup>` per platform, through the kit's
`Select`), a storyboard select for video and GIF presets, the options, and
the existing `ExportRun` view with its button renamed "Export". Its state
is the record's choice; a change writes it through `setExport` (select and
checkbox at once, the `at` and tag inputs on commit) and schedules a
preview. The lines option is a group of checkboxes over the project's
lines, labelled as `LineColours` labels them.

**The stand-in engine.** `tests/fake-engine/schematic/serve.py` answers
`export.presets` and `export.storyboards` with the engine's real tables
(copied from the pinned engine's `export.py` with a comment naming the
tag, and held equal by a test against the generated unions), and
`export.plan` for every offered preset: a still plan for `still`, a beats
plan for video and GIF. The URL it answers carries the options it was
asked, so a test can read them.

## Source code

```text
src/shared/export.ts                         # OFFERED_PRESETS (13), ExportChoice, DEFAULT_CHOICE, validateExportChoice
src/shared/project.ts                        # ProjectRecord.export, parseRecord
src/shared/api.ts, src/preload/index.ts      # setExport; export.run(choice); export.preview
src/shared/api.ts (CHANNELS)                 # exportPreview, projectsSetExport
src/main/export.ts                           # start(choice): options from the choice, safe never set; preview()
src/main/export-ipc.ts, src/main/ipc.ts      # handlers, validated
src/main/projects.ts                         # setExport in the store
src/renderer/src/kit/Tabs.tsx, kit/index.ts  # the tab strip
src/renderer/src/ExportTab.tsx               # preset, storyboard, options, the run
src/renderer/src/ExportRun.tsx               # "Export", takes the choice
src/renderer/src/engine/exportRun.ts         # start(project, engine, choice)
src/renderer/src/Viewer.tsx                  # optional planned address and aspect ratio
src/renderer/src/ProjectView.tsx             # Map | Export
src/renderer/src/styles/app.css              # tab strip, export tab, preview sizing (tokens only)
docs/DESIGN.md                               # 8.2: Tabs, the export tab
tests/fake-engine/schematic/serve.py         # presets, storyboards, plans for every offered preset
tests/unit/{export,export-run,project,projects-store,ipc,export-ipc,tabs,contrast}.test.ts
tests/e2e/export-tab.spec.ts                 # the scenarios, against the stand-in
docs/ARCHITECTURE.md, specs/010-export/contracts/bridge.md, CLAUDE.md
```

## Must not touch

`src/main/log.ts`, `src/main/settings-ipc.ts`, `src/renderer/src/Settings.tsx`
(A6-03's lane), `vendor/`, `.github/` (A0-06's). `src/main/index.ts` only
if a handler's registration needs a new argument, and then one line.
