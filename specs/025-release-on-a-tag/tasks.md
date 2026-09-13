# Tasks: A release on a tag, and the install document

- [x] T001 `package.json` and `package-lock.json` to 0.1.0 with `npm version 0.1.0 --no-git-tag-version` (FR-007)
- [x] T002 Read GitHub's documented behaviour for path filters on tag pushes; `research.md` §1 (FR-001)
- [x] T003 `scripts/release.mjs`: tag, version and ancestry decisions; asset plan and manifest check; sums; notes; what to do with an existing Release; the check after upload (FR-003 to FR-006)
- [x] T004 `tests/unit/release.test.ts`: every refusal and the workflow's shape (SC-002)
- [x] T005 `.github/release-notes.md`, filled completely by the script's values (FR-006)
- [x] T006 `vendor.yml`: `loom-source` and `engine-source`, prototyped in an `ubuntu:22.04` container; `research.md` §2 (US3)
- [x] T007 `build.yml`: the tag trigger, the release job, the head comment (FR-001, FR-002, FR-004, FR-005)
- [x] T008 `docs/install.md` and the README's link (US2, FR-008)
- [x] T009 `THIRD_PARTY_NOTICES.md` obligations (FR-009); `docs/ARCHITECTURE.md` a section; ADR-041 and its index row; `CLAUDE.md` a sentence
- [ ] T010 The branch's CI run: `build.yml` on the branch with the release job skipped and every other job green; the source jobs' artefacts inspected
- [ ] T011 After merge, with the maintainer's go-ahead: push `v0.1.0-rc.1`, read the draft prerelease and its assets, then delete the draft and the tag (SC-001)
- [ ] T012 A person installs from the draft on a machine that never had the checkout, following only `docs/install.md` (SC-003, A6-04)
