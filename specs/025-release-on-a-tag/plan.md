# Implementation Plan: A release on a tag, and the install document

**Branch**: `A6-01-release-on-a-tag` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

## Summary

`build.yml` runs on a pushed `v*` tag as well as its branch triggers, and a
last `release` job drafts a GitHub Release once the vendor jobs and all
three packaging jobs succeeded. A new `scripts/release.mjs`, unit-tested,
makes every decision; the workflow does what it answers. Two new vendor
jobs build LOOM's and the engine's source archives from the pins beside
`ffmpeg-source`. `docs/install.md` is written for a person who has never
seen the repository, and linked from the README.

## Technical Context

GitHub Actions (`build.yml`, `vendor.yml`), Node 22 with its built-ins only
for the script, `gh` and `jq` from the Ubuntu runner image, Vitest for the
script's units. No new dependency; `package.json` and `package-lock.json`
change only their version, to 0.1.0.

## Constitution Check

- **Public repository**: no machine path, address or key in the notes, the
  document or the archives; `BUILD.txt` names only the repositories and
  commits.
- **Child processes**: the script spawns git and tar with argument arrays,
  `windowsHide` and a five-minute timeout, and prints their standard error
  on failure.
- **Least privilege**: the workflow stays `contents: read`; the release job
  alone has `contents: write`, only on a pushed tag; its checkout keeps no
  credentials, and one step holds the token.
- **Never write inside the bundle**: nothing here touches the app; the
  document states where it writes, from `src/main/config.ts` and
  `docs/ARCHITECTURE.md`.
- **Decisions get a record**: ADR-041.

## Design

### The trigger (FR-001)

`push: { branches: ['**'], tags: ['v*'], paths: [...] }`. GitHub ignores
the paths for a tag push, and would stop running for branches if only tags
were listed (research §1).

### The release job (FR-002, FR-004)

`needs: [vendor, package]`; `if: !cancelled() && push && refs/tags/v* &&
needs.vendor.result == 'success' && needs.package.result == 'success'`;
`permissions: contents: write`; `concurrency: release-<ref>`. Steps:

1. Checkout with `fetch-depth: 0`, `persist-credentials: false`.
2. `release.mjs decide "$TAG" --main refs/remotes/origin/main` writes the
   Release's name, label and prerelease flag to the step's outputs, or fails.
3. Six downloads by name into `downloaded/<artefact>/`.
4. `release.mjs assemble` into `release-assets/`.
5. `release.mjs notes` into `$RUNNER_TEMP/notes.md`.
6. With `GH_TOKEN`: list the Releases; `release.mjs existing` answers
   create, update (with the stale assets) or refuse; `gh release create
   --draft --verify-tag` or `gh release edit --draft=true`; delete the stale
   assets; `gh release upload --clobber`; list again; `release.mjs verify`.

### The script (FR-003, FR-005, FR-006, SC-002)

Pure functions the test calls: `parseTag`, `decide`, `planAssets`,
`checkManifest`, `formatSums`/`parseSums`, `notesValues`/`fillNotes`,
`releaseAction`, `verifyUploaded`, `formatOutputs`; git helpers
`tagCommit` and `isOnMain`, tested over a temporary repository; `assemble`
with tar injected. A CLI over them, in the style of `check-vendored.mjs`.

### The source jobs (US3)

`loom-source` and `engine-source` in `vendor.yml`, on `ubuntu-22.04`, each
checking its clone against the pins (LOOM's and the port's commits, every
submodule against LOOM's tree, the engine's version at its tag) and
uploading tars without git metadata, sorted with fixed owners and times,
with copies of the scripts, pins and workflow and a `BUILD.txt`.
`ffmpeg-source` is unchanged. The release job archives each artefact folder
as one tar that unpacks into a folder of the asset's name.

### The notes (FR-006)

`.github/release-notes.md` with `{{key}}` placeholders; `fillNotes` refuses
a key nothing fills. Values from the tag, `package.json` and the pins; an
`-rc.N` tag opens with a release-candidate note.

### The document (US2, FR-008)

`docs/install.md`: requirements, which file (and which Mac), optional
checksum check, macOS 15+ (Privacy & Security › Open Anyway) and 13-14
(Control-click › Open), Windows SmartScreen (More info › Run anyway), what
is written where on each OS, a complete uninstall with Reset engine data,
and a report with Copy diagnostics. No screenshots. The README links it
near its top.
