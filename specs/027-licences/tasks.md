# Tasks: The licence texts the installers owe

- [x] T001 Research: the `full` archive for release 20260901 on each target (asset names, sizes, sha256), its `licenses/` folder and the metadata naming linked libraries and their licence files; `research.md`
- [x] T002 Pins: the `full` archive checksums per target
- [x] T003 `scripts/vendor-python.sh`: fetch, verify, extract texts and metadata, agreement check, delete the archive
- [x] T004 `vendor.yml` python job and `scripts/check-vendored.mjs` (+ unit test) refuse a package without the texts
- [x] T005 The component list (shared), `src/main` handlers opening fixed paths, preload bridge, channel table, units for the guard
- [x] T006 `Settings.tsx` Licences section; design-system rules; contrast pairs if new
- [x] T007 e2e: the section in development; add it to `tests/e2e/accessibility.spec.ts`; a row in `docs/accessibility.md`; a step in `docs/acceptance.md` (run green by the coordinator on macOS)
- [x] T008 `THIRD_PARTY_NOTICES.md`, ADR-042 amending ADR-035, `docs/ARCHITECTURE.md`, `CLAUDE.md`
