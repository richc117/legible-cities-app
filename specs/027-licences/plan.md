# Implementation Plan: The licence texts the installers owe, and where a person reads them

**Branch**: `108-python-licence-texts` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **Decision**: ADR-042

## Summary

The python job takes `licenses/` and `PYTHON.json` from the same
python-build-standalone build's `full` archive into the vendored runtime,
adds CPython's `Doc/license.rst`, and runs one agreement check that the
packaging check and the `afterPack` hook run again. The Mac app gets
Electron's and Chromium's licences back. Settings gains a Licences section
over a bridge whose methods take nothing.

## Technical Context

Bash under Git Bash on Windows (`scripts/vendor-python.sh`), Node for the
check (`scripts/check-vendored.mjs`, no dependency), `zstd` on the runners
for the `.tar.zst` archive. Electron main process and React renderer for
the section. Vitest units with fixture trees and injected shell functions;
Playwright end-to-end in development. No new dependency, no engine change.

## Constitution Check

- **Never write inside the bundle**: nothing is written at run time; the
  texts are laid down at build, before packaging. `launch-packaged.mjs`'s
  bundle-unchanged check is untouched.
- **Nothing crosses the bridge inward**: the four `licences:` methods ignore
  their arguments; the paths are fixed under `process.resourcesPath` in
  the main process, and every handler answers the top frame only.
- **Child processes**: none added. Opening goes through `shell.openPath`
  and `shell.showItemInFolder`.
- **Design system**: existing classes (`fields`, `message`, `toolbar`) and
  the kit's `Button` with `aria-disabled`; no literal; no new text or
  control pair; a row in `docs/DESIGN.md` 8.2.
- **Accessibility**: a named region, a definition list, unavailable buttons
  kept in the Tab order and described by why, a polite status line; in the
  accessibility sweep and `docs/accessibility.md`.

## Design

### The agreement (FR-001, FR-002, FR-003)

`checkPythonLicences({ python, target, pins })` in `check-vendored.mjs`
reads `python/PYTHON.json` and `python/licenses/`, takes the licence paths
the metadata names (the top-level `license_path` and every extension
variant's `license_paths`), and holds them to
`python.targets.<target>.licences` as US1 scenario 2 enumerates. CPython's
text is checked by its pinned sha256 and set aside. It runs:

1. from `vendor-python.sh` as `--licences <runtime>`, right after the
   runtime is unpacked and the texts are copied in, before pip;
2. inside `checkTree`, so `npm run dist:check` and the `afterPack` hook
   refuse a runtime without agreeing texts.

The manifest's `python.licence_texts` records the full archive and
CPython's text by hash.

### Electron's and Chromium's licences (FR-008)

`mac.extraResources` copies `node_modules/electron/dist/LICENSE` and
`LICENSES.chromium.html` into the resources as `LICENSE.electron.txt` and
`LICENSES.chromium.html`; `build.yml`'s packaging job runs
`npx install-electron --no` on macOS so they exist. `checkResources`
requires both, beside the executable on Windows and in the resources on a
Mac.

### The section (FR-004 to FR-006)

`src/shared/licences.ts` holds `APP_LICENCE`, `BUNDLED_COMPONENTS` (each
with the exact first cell of its notices row) and the view type.
`src/main/licences-ipc.ts` answers `licences:read` with each file's state
(`available`, `development`, `missing`) and opens the notices, the texts'
folder and Chromium's licences. `Settings.tsx` renders the list and the
three buttons from `licenceButtons`, a function the units call without
rendering.

## Verification

- Units: the agreement against fixture runtimes and spoiled ones; the pins'
  lists' shape; the component list against `THIRD_PARTY_NOTICES.md` both
  ways; the handlers' guard, fixed paths and development state.
- Local: `vendor-python.sh darwin-arm64` in scratch against the engine at
  its tag; the Windows lists against the real Windows archive's DLLs.
- CI (SC-001, SC-002): `vendor.yml` on three targets and `build.yml`'s
  packaging and launch check.
- End-to-end, written: the section in development in `settings.spec.ts`,
  and in the accessibility sweep.
- By a person (SC-004): step 19 of `docs/acceptance.md`.
