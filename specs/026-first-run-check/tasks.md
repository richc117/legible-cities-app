# Tasks: The first-run check of the bundled tools

- [x] T001 Fixture: `resources/first-run-gtfs/`; run the real `gtfs2graph` over it by hand; `research.md` with the command, exit and output size
- [x] T002 `src/shared/first-run.ts`: types and sentences
- [x] T003 Target selection beside `bundledComponents` (`src/main/config.ts` or `first-run.ts`), with units
- [x] T004 `src/main/first-run.ts`: the spawns, timeouts, parsing, quit handling, with units over a fake spawner
- [x] T005 `src/main/first-run-ipc.ts`, the channel table, the preload bridge, units for the guard
- [x] T006 `index.ts`: start after the engine's first start settles; end children at quit; `electron-builder.yml` extraResources
- [x] T007 `FirstRunDialog.tsx` and `App.tsx` (never over the mismatch dialog)
- [x] T008 `Settings.tsx`: the Bundled tools row
- [x] T009 `diagnostics-text.ts` section and its test
- [x] T010 `scripts/launch-packaged.mjs` assertion and its unit test
- [x] T011 `tests/e2e/first-run.spec.ts` (written, not run); existing e2e launches checked
- [x] T012 `docs/DESIGN.md` section 8.2 if the dialog adds a rule; `docs/ARCHITECTURE.md` a paragraph; `CLAUDE.md`'s "Where things stand" a sentence
