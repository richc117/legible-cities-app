# Tasks: Line order, and what is drawn over what

- [x] T001 The engine's `line_order` fix released as **v0.8.2** (93d615b,
      both remotes, engine issue 28 closed), the pin moved from v0.8.0, and
      the schema and the types regenerated - which brought v0.8.1's own
      additive descriptions with it.
- [x] T002 `validateLineOrder` and `orderOf` on the record; `parseRecord`
      reads an order the store would write and no other.
- [x] T003 `completeOrder` in the API, the preload, the channels and the
      main-side handler.
- [x] T004 The store writes the order and refuses a project with no layout.
- [x] T005 Every `map.build` carries the order; `reorder()` on the run and
      its sentences.
- [x] T006 The pure half: `arrange`, `move`, `sameOrder`, `isAlphabetical`.
- [x] T007 `LineOrder` on the project screen, and the design document's rule.
- [x] T008 Unit tests (the pure half, the store, the bridge, the run) and
      the end-to-end scenarios.
- [x] T009 ARCHITECTURE, CLAUDE.md, spec 003's record contract.
- [ ] T010 Lint, typecheck, unit and the build; the scanners; the reviewer;
      then the pull request.
