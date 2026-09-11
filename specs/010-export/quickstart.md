# Quickstart: the export

```
npm run build                                          # both main entries
npx vitest run tests/unit/export.test.ts tests/unit/export-ipc.test.ts tests/unit/export-run.test.ts
npx playwright test tests/e2e/export.spec.ts           # the built app, the stand-in engine and page
LEGIBLE_REEL_TEST=1 npx playwright test tests/e2e/reel.spec.ts   # the real reel, twice, with a checkout and ffmpeg
```

In the app: open a laid-out project and press "Export reel". The file goes
to `LEGIBLE_EXPORT_FOLDER`, or a `Legible Cities` folder on the desktop, in
a folder named after the project; "Reveal" opens it. A second export of the
same project replaces the first.

From the page:

```ts
const { id, result } = window.api.export.run(project.id, 'instagram-reel')
const off = window.api.export.onProgress((p) => {
  if (p.id === id) console.log(p.stage, p.fraction, p.message)
})
const { file, bytes, frames } = await result   // rejects with the engine's error shape
off()
await window.api.export.reveal(id)
```

The frames live under `<SCHEMATIC_HOME>/frames/<token>/` only while the
export runs; nothing else of the export's touches the engine home.
