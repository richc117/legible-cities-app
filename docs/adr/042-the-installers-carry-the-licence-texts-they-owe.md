# ADR-042: The installers carry the licence texts they owe, and the app opens them

- **Status:** Accepted
- **Date:** 2026-09-13
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-035](035-installers-are-built-from-the-same-runs-vendor-artefacts.md):
  the licence texts its Consequences left to "the Licences screen and
  A6-01" ship inside every installer, and the screen is a section of
  Settings. It also corrects what ADR-020 and ADR-038 imply the runtime
  carries: CPython's `LICENSE.txt` and, since this record, the texts below.

## Context

Issue 108. The installers carry python-build-standalone's `install_only`
runtime (release 20260901, CPython 3.12.14) for darwin-arm64, darwin-x64
and win-x64. It carries CPython's `LICENSE.txt` and nothing for the
libraries linked into the interpreter and its extension modules - OpenSSL,
libffi, xz, bzip2, mpdecimal, Expat, SQLite, Tcl/Tk, libuuid, and zlib on
Windows - whose licences ask for their notices to accompany the binaries.
ADR-035 and `THIRD_PARTY_NOTICES.md` said a Licences screen would supply
them; there was no such screen, and ADR-041's release does not attach them.

The maintainer decided on 2026-09-13, in spec 027: a Licences section in
Settings, and the `licenses/` folder vendored from the same release's
`full` archive, pinned by checksum, with a check that fails when the
shipped texts and the runtime disagree.

What that archive holds was measured before anything was built
(`specs/027-licences/research.md`):

- **The archives exist and are practical.** 43 to 55 MB each, the size of
  the `install_only` assets already fetched, `.tar.zst`, each carrying
  `python/licenses/` (19 texts, about 170 KB, the same names on every
  target) and `python/PYTHON.json`, whose `build_info.extensions` gives
  each extension module's `license_paths`.
- **The metadata is not enough on its own.** On macOS it names
  `LICENSE.zlib-ng.txt`, which the archive does not carry; those modules
  link the system's libz, so nothing is owed. On Windows it names nothing
  for the zlib 1.3.2 compiled into `python312.dll`, the Expat 2.8.3 in
  `pyexpat.pyd` or the libmpdec in `_decimal.pyd`, which come from
  CPython's own tree; their texts are in the folder, unaccounted for.
- **The folder is a catalogue,** with texts for libraries these builds do
  not link (Berkeley DB, the X11 libraries, OpenSSL 1.1 - which the macOS
  metadata names anyway, beside OpenSSL 3, for `_hashlib` and `_ssl`).
- **CPython's own incorporated software** (HACL*, BLAKE2, SipHash,
  `dtoa.c` and the rest of its documentation's "Licenses and
  Acknowledgements for Incorporated Software") is in no text the runtime
  ships.

And one found by issue 109's research: **electron-builder 26.15.3 deletes
Electron's `LICENSE` and `LICENSES.chromium.html` from a Mac app**
(`app-builder-lib/out/electron/electronMac.js`), so the published
`v0.1.0-rc.2` Mac installers carry neither. The Windows installer keeps
both beside the executable, as `LICENSE.electron.txt` and
`LICENSES.chromium.html`; that was checked by listing the rc.2 build's
`installer-win-x64` artefact.

## Options

**Paste the texts into `THIRD_PARTY_NOTICES.md`** with a check that the
list matches. One file to read, but about 170 KB of other projects' text in
this repository, copied by hand at every release bump, and a check that
compares a hand-kept list with another hand-kept list.

**Vendor the folder and trust the metadata.** The folder ships as
python-build-standalone publishes it and the check is metadata against
folder. It fails on macOS from the first run, and passes on Windows with
three libraries never looked at.

**Vendor the folder and hold the metadata to reviewed lists.** Per target,
`vendor/pins.json` records the `full` archive's name and sha256, and three
lists: `unlisted` (texts owed that the metadata names for nothing, each
with the file it is compiled into and strings found there), `named_absent`
(texts it names that the archive lacks, each with why nothing is owed) and
`not_linked` (texts carried that nothing names). The check fails whenever
the metadata, the folder and the lists disagree, in either direction, and
whenever an entry stops being true.

For the Mac's Electron and Chromium licences: an `afterExtract` hook
copying electron-builder's own extracted files, which would make a check
module write into the bundle and adds a hook; or `mac.extraResources` from
the Electron binary in `node_modules`, which the packaging job then has to
fetch.

## Decision

The third option, and `extraResources`.

`scripts/vendor-python.sh` fetches the target's `full` archive, checks its
sha256 against the pins, streams only `python/PYTHON.json` and
`python/licenses/` out of it with `zstd` and `tar`, and puts both into the
runtime beside the interpreter's tree. It fetches CPython's
`Doc/license.rst` by the commit of the pinned version's tag, checks its
sha256, and adds it to that folder as `CPython-Doc-license.rst`. Then,
before the engine is installed, it runs
`node scripts/check-vendored.mjs <target> --licences <runtime>`, which
requires: the metadata to be this build's (version and target triple);
every text it names to be carried or `named_absent`; every text carried to
be named, `unlisted` or `not_linked`, exactly once; every `named_absent`
still named and still absent, every `unlisted` and `not_linked` still
unnamed and still carried; each `unlisted` entry's strings still in its
file; and CPython's text to be the pinned one. The same check runs in
`check-vendored.mjs`'s tree check, so the packaging job and the
`afterPack` hook refuse a runtime without the texts, and the manifest
records the archive and the text they came from. The python job looks for
`zstd` where the runner images and Git for Windows put one and fails
naming the runner when there is none.

**A new python-build-standalone release fails the job until a person
rereads the three lists against its metadata.** That is the intended cost:
the lists are the part a machine cannot decide, and moving a pin is already
a reviewed change.

The Mac app gets `LICENSE.electron.txt` and `LICENSES.chromium.html` in
its resources from `node_modules/electron/dist`, which the packaging job
now fetches with `npx install-electron --no` on macOS; the `afterPack`
check refuses an app on either system without both where the app looks
for them. Electron's MIT licence is also quoted in `THIRD_PARTY_NOTICES.md`.

Settings gains a Licences section: the app's licence, every shipped
component with its licence from one list in `src/shared/licences.ts` (held
to the notices file's table by a unit test, both ways), and three buttons -
the notices in the platform's viewer, the licence texts' folder in its file
browser, Chromium's licences in its browser. The bridge's four methods take
nothing; the paths are fixed in the main process under
`process.resourcesPath` (Chromium's beside the executable on Windows). In a
development run, where none of the three exists, each button stays in the
Tab order, `aria-disabled`, and says why.

## Consequences

The python job downloads 43 to 55 MB more per target and writes about
170 KB of it. The runtime grows by about 300 KB with the metadata and
CPython's text; the Mac app by about 20 MB with Chromium's licences.

The check depends on `zstd` and Node on each runner, which the first CI run
of this change proves or refutes; the step that looks for `zstd` says which
runner lacked it.

The Windows `unlisted` strings are version strings as well as proof of
presence, so a runtime whose zlib, Expat or libmpdec changes version fails
until the entry is reread, as a release would.

The texts are what python-build-standalone publishes, not upstream's own
files; a text that is wrong upstream is wrong here. Nothing checks the
licences of the wheels installed into the runtime beyond what they carry in
their `.dist-info` folders, and ADR-038's note about the Windows NumPy
wheel's OpenBLAS and GCC runtime stands.

Electron's own FFmpeg library and what it owes is issue 109, not this
record.
