# Tasks: Vendored components and installers

- [ ] T001 Correct `spec.md`: FR-012, A-005, A-006 and the size edge case,
      as the plan lists.
- [ ] T002 `vendor.yml` gains `workflow_call:`; nothing else in it changes.
- [ ] T003 `scripts/check-vendored.mjs <target>`: presence of each component,
      architecture (Mach-O, PE), executable bits, and the manifest written
      from `vendor/pins.json` with its hash; unit tests with fixture trees
      (a missing component, a wrong architecture, a stale manifest) that
      fail naming the component and target.
- [ ] T004 `electron-builder.yml`: `extraResources` per target, failing on a
      missing source; dmg arm64 and x64, nsis x64; unsigned and accepting an
      identity later without a layout change.
- [ ] T005 `src/main/config.ts`: packaged defaults for `loomBin` and `ffmpeg`
      from `resources/`, only when present and not set by the environment;
      their source reported as bundled; unit tests.
- [ ] T006 `.github/workflows/build.yml`:
      - vendor through `workflow_call`, then one packaging job per target;
      - download the artefacts, restore the executable bits, check, compile
        bytecode with `unchecked-hash`, package, upload `installer-<target>`;
      - `contents: read`, `persist-credentials: false`, `timeout-minutes`.
- [ ] T007 `scripts/launch-packaged.mjs`: launch the unpacked build once with a
      temporary `LEGIBLE_USER_DATA`, wait for the engine ready, quit, check
      the bundle's file list is unchanged and the log names the bundled
      origins. Run it in each packaging job before upload.
- [ ] T008 `package.json` `dist:check`; no dependency changes.
- [ ] T009 ADR-035 and its row; `THIRD_PARTY_NOTICES.md` rows for what is now
      bundled; ARCHITECTURE and CLAUDE.md.
- [ ] T010 Lint, typecheck, unit and the build; `actionlint` if installed;
      the check script run locally against a hand-made darwin-arm64 tree
      (the vendor scripts can produce python and ffmpeg locally; LOOM from
      the last vendor run's artefact with `gh run download`).
