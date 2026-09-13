# Contract: `window.api.export`

Exposed by the preload beside `api.projects`, `api.viewer` and
`api.engine`. Typed in `src/shared/api.ts`; the shapes in
`src/shared/export.ts`. The export runs in the main process
(`src/main/export.ts`); the page starts it, watches it and stops it, and
is told the file's name.

```ts
export: {
  run(projectId: string, choice: ExportChoice): { id: string; result: Promise<ExportResult> }
  preview(projectId: string, choice: ExportChoice): Promise<ExportPreview>
  cancel(id: string): Promise<void>
  reveal(id: string): Promise<void>
  onProgress(listener: (p: ExportProgress) => void): () => void   // returns unsubscribe
}
```

## Shapes

| Shape | Fields |
|---|---|
| `OfferedPreset` | one of `OFFERED_PRESETS`, each checked against the engine's `PresetName` at build time: the thirteen social presets since A5-01 (`instagram-reel` alone before) |
| `ExportChoice` | `{ preset: OfferedPreset, storyboard?: StoryboardName, options: ExportChoiceOptions }`; the options are the engine's `ExportOptions` without `theme`, `safe`, `storyboard` and `fade`, and a field absent is the engine's default (specs/022-export-tab) |
| `ExportPreview` | `{ ok: true, url, width, height, notes }` or `{ ok: false, error: { code, message, data? } }` |
| `ExportProgress` | `id` (the token), `stage` (`plan`, `capture` or `encode`), `fraction` (0 to 1 within the stage), `message` (a sentence, never a path) |
| `ExportResult` | `file` (the name, never the path), `bytes`, `frames` |
| `ExportSettled` | `{ id, ok: true, result }` or `{ id, ok: false, error: { code, message, data? } }` |

## Behaviour

- `run()` returns synchronously with the token so the page can subscribe
  before anything arrives. `result` resolves with `ExportResult` or rejects
  with the engine's error shape: the engine's own when the engine refused
  or failed, `-32800` when cancelled, `-32004` (`exportFailed`) when the
  app's own half failed, `-32600` (`badCall`) for a refusal before it
  started. The `data.hint` is what the interface shows.
- A project that is read-only, has no layout or no service day rejects
  before the engine is asked. A second export of a project already being
  exported is refused at once, as is a reused token.
- `cancel(id)` stops the export wherever it is; for an unknown or finished
  id it resolves and does nothing.
- `reveal(id)` shows the file a finished export wrote; for any other id it
  resolves and does nothing. The page never holds the path.
- `preview()` answers the engine's plan for the choice on the project's
  page, with `safe: true` exactly when the engine's `export.presets` says
  the preset has `safe_zones`; a planned address that is not the project's
  own page is refused. It resolves in every case: a refusal, the reset's
  guard, a project with no layout and a choice the handler refused all
  arrive as `{ ok: false, error }`. Nothing is captured, written or
  reported.
- Progress arrives in stage order; the outcome arrives after the last
  report, on the same ordered channel.

## Channels

| Channel | Direction | Arguments | Answer |
|---|---|---|---|
| `export:run` | invoke | `token, projectId, choice` | `{ accepted: true }`, or `{ accepted: false, error }` for a call refused before it started (resolved, never rejected, so `data` survives the trip) |
| `export:cancel` | invoke | `token` | `undefined` |
| `export:reveal` | invoke | `token` | `undefined` |
| `export:preview` | invoke | `projectId, choice` | `ExportPreview`, resolved, never rejected, so `data` survives the trip |
| `export:progress` | send | `ExportProgress` | — |
| `export:settled` | send | `ExportSettled` | — |

Every invoke handler refuses a caller that is not the window's top frame.
The token is `[A-Za-z0-9-]{1,64}`; the project identifier is validated as
the projects bridge validates it; the choice must pass `validateExportChoice`
(an offered preset, a storyboard the engine has, only the options the tab
sets, each held to the engine's schema - `Clock` for `at`, `Token` for
`tag`, the record's label rules for `lines`), and the exporter is handed a
copy with nothing else on it.

## The flow, in the main process

1. Read the record; refuse read-only, no layout, no service day.
2. `export.plan { key, preset, page: app://local/projects/<id>/<feed>.html, date, options }`,
   where `options` is the choice's options as far as the preset takes them,
   its `storyboard` when one is set, and `theme`: `light` for a sepia record
   and `dark` otherwise. `export.presets` is read first: no `view` or `at`
   for a video or GIF preset, no `storyboard` for a still, no `quality` for
   a `jpg` still. `safe` is never sent for an export. A plan whose mode or
   format disagrees with the preset, or a `jpg` still with `keep`, is
   refused.
3. Validate the plan's capture half with `validateCaptureJob`; refuse a
   file name that is not a bare name.
4. Capture into `<SCHEMATIC_HOME>/frames/<token>/`, progress per frame. A
   still plan has no beats; it is captured as one beat of one frame that
   seeks to the plan's `at` at speed 0.
5. `export.encode { plan, source: <frames, or the still's one frame>, dest: <export folder>/<project>/<file>, provenance: { service_date } }`;
   progress from the engine's `job/progress` fraction.
6. Remove the frames, whichever way it ended. Remember `dest` for the
   reveal.

The export folder is `LEGIBLE_EXPORT_FOLDER`, or `<desktop>/Legible
Cities`. The project's folder is its name made safe for a filesystem, or
its identifier when nothing safe is left.
