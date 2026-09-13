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
- [x] T013 Review fixes: zlib and bzip2 sources for the Windows LOOM tools with the LOOM jobs waiting for `loom-source` and the MSYS2 record; a tag moved since its push refused; a rerun keeps the draft's notes; the release job's actions pinned to commits; `vendor.yml` not started by a tag; reproducible outer archives; the command line tested; `research.md` §6
- [x] T014 Second review: MSYS2's source packages for the pinned zlib and bzip2 revisions in `loom-windows-toolchain`, the gate on the full revision; `python` waits for `engine-source`; `signed()` shared in `scripts/vendor-signature.sh`; `git ls-remote` retried; `research.md` §7
- [x] T015 CI on 777acdb: `pacman-key --verify` refused for want of write access to the runner's keyring; MSYS2's source packages verified with the shared `signed()` against a pinned key instead; `research.md` §8
- [ ] T010 The branch's CI run: `build.yml` on the branch with the release job skipped and every other job green; the source jobs' artefacts inspected
- [ ] T011 After merge, with the maintainer's go-ahead: push `v0.1.0-rc.1`, read the draft prerelease and its assets, then delete the draft and the tag (SC-001)
- [ ] T012 A person installs from the draft on a machine that never had the checkout, following only `docs/install.md` (SC-003, A6-04)
