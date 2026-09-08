# Quickstart: Design system foundations

```
npm run dev
```

Expected, in the warm-dark theme (macOS Appearance dark, or the OS
preference): a header 40px high with the mark at 16px and the engine's
status at 12px; the Library as a list of 28px rows, names at 13px, meta at
12px in the faint colour; "New project" as the kit's primary button at 28px.
Switch the OS to light: everything, the kit's buttons included, is on the
sepia ground with no element left dark.

Open "New project": the dialog's title at 15px, the fields as the kit's
inputs at 28px, the focus ring on the name field. Escape closes it.

Empty the Library: the mark at 24px, one sentence, one action.

The progress line: `npm run dev` with `?progress` on the interface URL
is not provided; instead `tests/unit/progress-line.test.tsx` renders the
four states and the Playwright test screenshots it; look at
`test-results/` after `npm run test:e2e`.

## The checks

```
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

`npm test` includes the contrast test (every pair, both themes), the
no-literals test, the FigUI3 guard and the icon manifest. To see the
guard refuse: add `import '@rogieking/figui3/fig-editor.js'` anywhere in
the renderer and run `npm run build`; it fails with the ADR-026 message.

## The icon

```
scripts/render-icon.sh    # mark.svg -> build/icon.png at 1024px, on the sepia ground
npm run dist              # electron-builder derives .icns and .ico from it
```

## Manual checks (SC-006, SC-007)

The app icon in the dock and in Task Manager; VoiceOver over the status
line, a Library row and each dialog: the icon is never read.
