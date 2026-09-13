# Research: A release on a tag, and the install document

## 1. Path filters and tag pushes (FR-001)

GitHub's "Workflow syntax for GitHub Actions", read 2026-09-13, under
`on.push.<branches|tags|branches-ignore|tags-ignore|paths|paths-ignore>`:

> Path filters are not evaluated for pushes of tags.

> If you define only `tags`/`tags-ignore` or only
> `branches`/`branches-ignore`, the workflow won't run for events affecting
> the undefined Git ref.

> If you define both `branches`/`branches-ignore` and
> `paths`/`paths-ignore`, the workflow will only run when both filters are
> satisfied.

So `build.yml`'s push trigger lists both `branches: ['**']` and
`tags: ['v*']` beside its existing `paths`. Adding `tags` alone would have
stopped every branch push from building; with both, a branch push is still
filtered by the paths and a tag push runs whatever changed.

The same rule means **`vendor.yml`, whose push trigger lists only `paths`,
also runs on every pushed tag**, a second full vendor run beside the one
`build.yml` calls. It is not changed here (this lane adds jobs to
`vendor.yml` and nothing else); see the report.

From "Using conditions to control job execution" and "Expressions": a
default `success()` applies to an `if` without a status function, and a
skipped job reports success. The release job's `if` therefore names
`!cancelled()` and reads `needs.vendor.result` and `needs.package.result`
itself, rather than relying on how the default treats the packaging job's
own `if: !cancelled()`. A matrix job's result is `success` only when every
leg succeeded.

## 2. The prototype of the two source jobs (US3)

Each new job's script was extracted from `vendor.yml` with Ruby's YAML
parser (which also proved the file parses) and run in an `ubuntu:22.04`
container with git, python3 and ca-certificates installed, from a copy of
the worktree, on 2026-09-13:

| | |
|---|---|
| LOOM at `1e47578381` | submodules `src/cppgtfs` at `0a3bbd657a`, `src/util` at `205dbe6b41`, neither prefixed `-`, `+` or `U`; the tree clean; 526 entries, 11.9 MB gzipped |
| Windows port at `8c521a1815` | 539 entries, 37.9 MB gzipped (it carries older copies of LOOM's submodules) |
| engine at `v0.8.3` | an annotated tag; commit `f92c21f2a3`; `__version__ = "0.8.3"`; no `.gitmodules`; 136 entries, 0.8 MB gzipped |
| no `.git` entry in any archive | checked by the jobs themselves |
| reproducible | the engine archive's sha256 was identical in two runs (`d7d14197…`) |

The first draft piped `tar -tzf` into `head`, which under `pipefail` dies of
SIGPIPE, the trap `vendor.yml` already records; the listing is captured and
then tested.

## 3. The installers as the packaging jobs upload them

- electron-builder 26.15.3's default names: a dmg is
  `${productName}-${version}-${arch}.dmg` with the arch omitted for x64
  (`Legible Cities-0.1.0-arm64.dmg`, `Legible Cities-0.1.0.dmg`), and nsis
  `${productName} Setup ${version}.exe`. Both carry a space, which GitHub
  replaces in an asset's name, so the release job renames them
  (`Legible-Cities-<version>-mac-arm64.dmg`, `-mac-x64.dmg`,
  `-windows-x64-setup.exe`) and tells the Macs apart by the artefact's
  name, not the file's.
- The nsis target writes `<installer>.__uninstaller.exe` into `release/`
  while it builds, then unlinks it (`NsisTarget.js`, line 302), so
  `release/*.exe` matches one file. The script refuses an artefact with
  more than one all the same, naming them.
- `upload-artifact` with two paths (`release/*.dmg` and
  `vendor/manifest-<target>.json`) stores them under their least common
  ancestor, so the files sit in `release/` and `vendor/` inside the
  artefact; the script searches the artefact's folder for both.
- `download-artifact` with a `pattern` that matches exactly one artefact
  unpacks it without a folder of its name, so each artefact is downloaded
  by name into its own folder.

## 4. Where a packaged app writes, for `docs/install.md`

- `productName` is `Legible Cities`, so Electron's user-data folder is
  `~/Library/Application Support/Legible Cities` and `%APPDATA%\Legible
  Cities`; the engine's home defaults to `engine/` under it
  (`src/main/config.ts`); `settings.json` sits directly under it.
- Logs: `app.getPath('logs')`, which is `~/Library/Logs/Legible Cities` on
  macOS and `logs\` under the user-data folder on Windows
  (`scripts/launch-packaged.mjs` relies on both).
- Exports: `<desktop>/Legible Cities`, a folder per project.
- nsis defaults (no `nsis` block in `electron-builder.yml`): one-click,
  per user, a desktop and Start menu shortcut, run after finish, and app
  data kept on uninstall. The per-user folder is
  `$LocalAppData\Programs\<name>`, where for a one-click per-user install
  the name is the package's sanitised `name`, `legible-cities-app`, not the
  product name (`getWindowsInstallationDirName`, `multiUser.nsh`).
- `appId` `com.richardcaballero.legiblecities` names the macOS preferences
  file and saved window state, which the document lists as "if present".
- The Gatekeeper and SmartScreen wording is Apple's and Microsoft's for an
  unsigned app on macOS 15 and later, on 13 and 14, and on Windows 10 and
  11. No person has followed the document yet (SC-003, A6-04).

## 5. GitHub's side

- `gh`, which the runner images carry (2.86 was read here): `gh release create --draft --verify-tag`,
  `gh release edit --draft=true --prerelease=<bool>`, `gh release upload
  --clobber` and `gh release delete-asset --yes` all address a Release by
  tag, and are understood to find a draft by listing when the tag endpoint
  does not return one (a draft is not served by `releases/tags/<tag>`); the
  rehearsal (SC-001) is what confirms it for a draft.
- The job lists Releases itself with `gh api --paginate --jq '.[] | {…}'`,
  one JSON object per line, so the script decides from the whole list:
  create, update the one draft, or refuse a published Release or two drafts.
- A release asset's `digest` (`sha256:<hex>`) is read back after the upload
  and compared with the file; an asset without one is compared by size and
  warned about.
- `make_latest` does not apply to drafts or prereleases; the workflow never
  passes `--latest`.
