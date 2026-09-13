# Tasks: The export tab

- [x] T001 `OFFERED_PRESETS` to the thirteen social presets; `ExportChoice`,
      `DEFAULT_CHOICE` and `validateExportChoice` in `src/shared/export.ts`,
      with unit tests (every preset, storyboard, option and a bad tag).
- [x] T002 `ProjectRecord.export`, read with the default; `setExport` in the
      API, preload, channels, main-side handler and store; unit tests.
- [x] T003 `Exporter.start` takes the choice and builds `export.plan`'s
      options from it and the project's theme, `safe` never set;
      `export.run(projectId, choice)` end to end; unit tests including
      "safe is never sent".
- [x] T004 `export.preview(projectId, choice)`: `export.plan` with `safe:
      true` and the project's page, `{ url, notes }` or the refusal; reset
      guard applies; unit tests.
- [x] T005 The stand-in engine: `export.presets`, `export.storyboards`, and
      plans for every offered preset echoing their options; a test holding
      its tables equal to the generated unions.
- [x] T006 `Tabs` in the kit (WAI-ARIA tabs), its unit test, and its rule
      in `docs/DESIGN.md` 8.2.
- [x] T007 `Viewer` takes a planned address and the preset's aspect ratio,
      attaching as before; reduced motion honoured.
- [x] T008 `ExportTab`: the preset select grouped by platform, the
      storyboard select for video and GIF, the options, the run; writes
      the choice; debounced preview with stale answers dropped; refusal
      sentences; the edge cases in the spec (no page, run in flight,
      export in flight, engine away, read-only, a saved choice no longer
      offered).
- [x] T009 `ProjectView`: Map | Export; the existing panels under Map.
- [x] T010 Styles from tokens only; new text and control pairs in the
      contrast test.
- [x] T011 End-to-end `tests/e2e/export-tab.spec.ts` against the stand-in:
      a still, a video and a GIF for each of Instagram, LinkedIn and
      Bluesky from one press each, sidecars read; the preview address per
      option and safe zones per preset; storyboard choice; the geographic
      refusal; remembered on reopen; keyboard-only operation of the tabs.
      Written, not run, by the lane.
- [x] T012 ARCHITECTURE, spec 010's bridge contract, CLAUDE.md's "Where
      things stand".
- [x] T013 Lint, typecheck, unit and the build.
