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

## 6. After the review (2026-09-13)

**What the Windows LOOM tools link.** The `loom-win-x64` artefact of build
run 34750505248, read with `strings`: `topo`, `loom` and `octi` carry
`inflate 1.3.2 Copyright` and `bzip2/libbzip2` `1.0.8, 13-Jul-2019`; all
four carry winpthreads' name, about 900 libstdc++ symbols and
`GCC: (Rev3, Built by MSYS2 project) 16.2.0`; none carries protobuf,
although the job installs it. MSYS2's packages on the day were
`mingw-w64-ucrt-x86_64-zlib 1.3.2-2` and `mingw-w64-ucrt-x86_64-bzip2
1.0.8-4` (packages.msys2.org).

**The tarballs.** `bzip2-1.0.8.tar.gz` from sourceware is sha256
`ab5a0317…2269`; its `.sig` names issuer `12768A96…9A78`, a subkey whose
primary key is `EC3CFE88F6CA0788774F5C1D1AA44BE649DE760A`, fetched from
keyserver.ubuntu.com, with `GOODSIG` and `VALIDSIG` and no revocation. zlib
1.3.2's tarball, signature and key are the ones `ffmpeg-source` already
verifies. The extended `loom-source` script ran in `ubuntu:22.04` and
verified both; with bzip2's fingerprint changed to zlib's key it refused.
The `loom-windows` record step ran against a stand-in `pacman` and
`python`: it wrote the record for the pinned versions, and refused bzip2
1.0.9 and a missing bzip2.

**The order.** `loom-windows` must record the packages it built with, so
the record cannot come before it; the tarballs can. So `loom-source`
fetches and verifies the pinned tarballs first, the LOOM jobs need it (no
LOOM binary without its verified source, ADR-040's rule), `loom-windows`
refuses a package whose version is not pinned, and the release puts the
record inside LOOM's archive.

**The token in the release job.** At the pinned commits: `actions/checkout`
v7.0.1 (`3d3c42e5…90b1`) has `token`, defaulting to `github.token`;
`actions/setup-node` v6.5.0 (`24997072…9c38`) has `token`, defaulting to
`github.token` on github.com, for Node's version list; and
`actions/download-artifact` v8.0.1 (`3e5f45b2…7e7c`) has `github-token`
with no default, needed only for another run or repository. The tags `v7`,
`v6` and `v8` named the same commits on 2026-09-13.

**A moved tag.** The checkout forces `refs/tags/<tag>` to the run's commit,
so only the remote says where the tag points now: `git ls-remote origin
refs/tags/<tag> refs/tags/<tag>^{}`, the peeled line for an annotated tag.
The unit test pushes, moves and deletes a tag on a bare repository and runs
the command line against a clone of it.

**`vendor.yml` on a tag.** Its push trigger named only paths, which GitHub
does not evaluate for a tag push, so every tag started it; it names
branches now.
