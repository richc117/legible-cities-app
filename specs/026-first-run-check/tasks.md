# Tasks: The first-run check of the bundled tools

- [ ] T001 Fixture: `resources/first-run-gtfs/`; run the real `gtfs2graph` over it by hand; `research.md` with the command, exit and output size
- [ ] T002 `src/shared/first-run.ts`: types and sentences
- [ ] T003 Target selection beside `bundledComponents` (`src/main/config.ts` or `first-run.ts`), with units
- [ ] T004 `src/main/first-run.ts`: the spawns, timeouts, parsing, quit handling, with units over a fake spawner
- [ ] T005 `src/main/first-run-ipc.ts`, the channel table, the preload bridge, units for the guard
- [ ] T006 `index.ts`: start after the engine's first start settles; end children at quit; `electron-builder.yml` extraResources
- [ ] T007 `FirstRunDialog.tsx` and `App.tsx` (never over the mismatch dialog)
- [ ] T008 `Settings.tsx`: the Bundled tools row
- [ ] T009 `diagnostics-text.ts` section and its test
- [ ] T010 `scripts/launch-packaged.mjs` assertion and its unit test
- [ ] T011 `tests/e2e/first-run.spec.ts` (written, not run); existing e2e launches checked
- [ ] T012 `docs/DESIGN.md` section 8.2 if the dialog adds a rule; `docs/ARCHITECTURE.md` a paragraph; `CLAUDE.md`'s "Where things stand" a sentence
