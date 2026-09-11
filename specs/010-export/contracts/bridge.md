# Contract: `window.api.export`

Exposed by the preload beside `api.projects`, `api.viewer` and
`api.engine`. Typed in `src/shared/api.ts`; the shapes in
`src/shared/export.ts`. The export runs in the main process
(`src/main/export.ts`); the page starts it, watches it and stops it, and
is told the file's name.

```ts
export: {
  run(projectId: string, preset: OfferedPreset): { id: string; result: Promise<ExportResult> }
  cancel(id: string): Promise<void>
  reveal(id: string): Promise<void>
  onProgress(listener: (p: ExportProgress) => void): () => void   // returns unsubscribe
}
```

## Shapes

| Shape | Fields |
|---|---|
| `OfferedPreset` | one of `OFFERED_PRESETS`, each checked against the engine's `PresetName` at build time; `'instagram-reel'` alone until A5-01 |
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
- Progress arrives in stage order; the outcome arrives after the last
  report, on the same ordered channel.

## Channels

| Channel | Direction | Arguments | Answer |
|---|---|---|---|
| `export:run` | invoke | `token, projectId, preset` | `{ accepted: true }`, or `{ accepted: false, error }` for a call refused before it started (resolved, never rejected, so `data` survives the trip) |
| `export:cancel` | invoke | `token` | `undefined` |
| `export:reveal` | invoke | `token` | `undefined` |
| `export:progress` | send | `ExportProgress` | — |
| `export:settled` | send | `ExportSettled` | — |

Every invoke handler refuses a caller that is not the window's top frame.
The token is `[A-Za-z0-9-]{1,64}`; the project identifier is validated as
the projects bridge validates it; the preset must be offered.

## The flow, in the main process

1. Read the record; refuse read-only, no layout, no service day.
2. `export.plan { key, preset, page: app://local/projects/<id>/<feed>.html, date, options: { theme } }`;
   `theme` is `light` for a sepia record and `dark` otherwise.
3. Validate the plan's capture half with `validateCaptureJob`; refuse a
   file name that is not a bare name.
4. Capture into `<SCHEMATIC_HOME>/frames/<token>/`, progress per frame.
5. `export.encode { plan, source: <frames>, dest: <export folder>/<project>/<file>, provenance: { service_date } }`;
   progress from the engine's `job/progress` fraction.
6. Remove the frames, whichever way it ended. Remember `dest` for the
   reveal.

The export folder is `LEGIBLE_EXPORT_FOLDER`, or `<desktop>/Legible
Cities`. The project's folder is its name made safe for a filesystem, or
its identifier when nothing safe is left.
