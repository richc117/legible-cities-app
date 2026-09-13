# Tasks: The licence texts the installers owe

- [ ] T001 Research: the `full` archive for release 20260901 on each target (asset names, sizes, sha256), its `licenses/` folder and the metadata naming linked libraries and their licence files; `research.md`
- [ ] T002 Pins: the `full` archive checksums per target
- [ ] T003 `scripts/vendor-python.sh`: fetch, verify, extract texts and metadata, agreement check, delete the archive
- [ ] T004 `vendor.yml` python job and `scripts/check-vendored.mjs` (+ unit test) refuse a package without the texts
- [ ] T005 The component list (shared), `src/main` handlers opening fixed paths, preload bridge, channel table, units for the guard
- [ ] T006 `Settings.tsx` Licences section; design-system rules; contrast pairs if new
- [ ] T007 e2e: the section in development; add it to `tests/e2e/accessibility.spec.ts`; a row in `docs/accessibility.md`; a step in `docs/acceptance.md`
- [ ] T008 `THIRD_PARTY_NOTICES.md`, ADR-042 amending ADR-035, `docs/ARCHITECTURE.md`, `CLAUDE.md`
