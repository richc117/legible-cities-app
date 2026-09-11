# Tasks: The service day, chosen by the engine and changed by a person

- [x] T001 Pin v0.6.0 and regenerate the types.
- [ ] T002 `ServiceWindow` on the record, its validator and parsing; `LayoutDone.service`; `RebuildDone`; the bridge's `completeRebuild` in the API and the preload.
- [ ] T003 The store keeps the window with the layout and writes a chosen day only inside it; the bridge's main side checks both shapes.
- [ ] T004 The run asks `feeds.service` between its two calls and draws the engine's day; `rebuild()` draws a chosen day from the stored layout; the sentences.
- [ ] T005 `ServiceDay` on the project screen: the day, the window, the bounded native date control, the engine's day offered; the viewer reloads after a run; the design document's rule.
- [ ] T006 The stand-in engine answers `feeds.service`.
- [ ] T007 Unit tests (record, store, bridge, run), the real-engine test, the end-to-end scenarios.
- [ ] T008 ARCHITECTURE, CLAUDE.md, spec 003's record contract, spec 007's bridge contract.
- [ ] T009 Lint, typecheck, unit, build, end to end, the scanners, the reviewer; the pull request.
