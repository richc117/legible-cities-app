# ADR-020: The Python sidecar ships as a pinned python-build-standalone runtime

- **Status:** Accepted
- **Date:** 2026-09-07
- **Supersedes:** none
- **Superseded by:** none
- **Amended by:** [ADR-038](038-the-sidecar-runtime-measured-on-three-targets.md)

## Context

ADR-002 put the engine in Python, running as a sidecar. A user's machine has
no Python, or has the wrong one, so the app ships an interpreter. Two ways
were on the table, and `THIRD_PARTY_NOTICES.md` has carried both as
candidates since the repository was chartered.

The spike is `docs/adr/spikes/sidecar-packaging.md`. It measured macOS arm64
only; there is no Windows host here and no CI.

## Options

**python-build-standalone**: a pinned, redistributable CPython build,
unpacked and then `pip install`ed into. A real interpreter with a real
filesystem layout.

**PyInstaller one-dir**: a frozen bundle containing only what the entry point
imports, with a launcher binary. One-file was excluded before measuring: it
unpacks to a temporary directory at every start, which hides the child
process's real path.

Measured, with the engine plus pandas and requests in both cases:

| | python-build-standalone | PyInstaller one-dir |
|---|---|---|
| Size, stripped | 108 MB | **53 MB** |
| Files | 2542 | **154** |
| Cold start, 5 runs | **0.12 s** | 0.19 s |
| Mach-O binaries to sign | **77** | 121 |
| Licence surface beyond CPython | none | **GNU readline, GPL-3.0-or-later** |

## Decision

python-build-standalone, pinned by release and by a checksum we compute
ourselves, unpacked and stripped after install. `scripts/vendor-python.sh`
implements it and `vendor/pins.json` holds the pin.

The size comparison favours the other option and is not what decides it. Two
things do.

**Start time and signing surface both favour the interpreter**, which was not
the expected result: the bundle with a sixteenth of the files ships half
again as many Mach-O binaries, because it flattens every shared library of
every package into one directory.

**The bundle's contents depended on the machine that built it.** PyInstaller
collected GNU readline - GPL-3.0-or-later - from the build host's Homebrew,
because the interpreter it ran under linked it. Nothing in the sidecar
imports `readline`. It would have been licence-compatible with this app and
would have added a source-offer obligation nobody had written down. A
packaging step whose output changes with the developer's `brew list` is not
one to build a release process on.

By contrast the interpreter's licence surface is checkable and was checked:
it links `libedit`, not GNU readline, and `_dbm` links only `libSystem`, so
no GDBM. That is the property `THIRD_PARTY_NOTICES.md` already demanded, and
it is a property of the pin.

## Consequences

The installer carries about 55 MB more than it would otherwise. Beside
Electron, LOOM and FFmpeg this is not the number worth optimising, and the
lever that matters is stripping - `__pycache__`, test suites, `idlelib`,
`tkinter`, `turtledemo` - which removes 78 MB, against about 1 MB for
choosing upstream's `install_only_stripped` asset over `install_only`.

Upstream publishes no checksum manifest, so the hash in `vendor/pins.json`
is ours, recorded on first download. `scripts/vendor-python.sh` fails on a
mismatch rather than continuing. This means a legitimate upstream re-release
also fails the build, which is correct: someone should look.

The sidecar keeps a real interpreter with a real `site-packages`, so an
optional dependency or a plugin loaded at runtime remains possible. That
freedom is why the decision would be close rather than obvious if size ever
became the complaint.

`--no-deps` is load-bearing in the vendoring script, because the engine still
declares jupyterlab and matplotlib as runtime dependencies. It is a
workaround for E02 not having happened, and it should be removed - with a
re-measurement - when it does.

Windows is undecided by measurement. The same release publishes
`x86_64-pc-windows-msvc` assets and the recipe should carry, but nothing
here demonstrates it, and the spike's acceptance criterion asking for both
operating systems is unmet.
