# ADR-038: The sidecar runtime, measured on three targets

- **Status:** Accepted
- **Date:** 2026-09-12
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** [ADR-020](020-sidecar-packaging.md), whose decision - the
  sidecar ships as a pinned python-build-standalone runtime - stands, and
  three of whose reasons do not: that `--no-deps` is load-bearing, that
  Windows is undecided by measurement, and the start-time comparison.

## Context

ADR-020 was decided on one machine, macOS arm64, before the engine had
trimmed its dependencies (E02) and before `schematic.serve` existed (E09a).
Its reasoning rests on three things that A0-06's second half, on 2026-09-12,
has now measured differently. The spike report's section of that date,
`docs/adr/spikes/sidecar-packaging.md`, has the method and the numbers;
vendor run 34732070984 is the runners' source.

**`--no-deps` was not load-bearing; it was hiding a broken runtime.** E02
left the engine declaring exactly what the sidecar imports: pandas,
python-lsp-jsonrpc and requests. The script still installed the engine with
`--no-deps` beside pandas and requests alone, so the runtime had no
python-lsp-jsonrpc and could not start `schematic.serve`, and its check,
which imported only `schematic, pandas, requests`, passed. The flag is gone,
and the check now runs `python -m schematic.serve --schema` and compares the
output's hash with `engine.schema_sha256`.

**Windows is measured.** The same script and the same release run on
`windows-latest` and `macos-15-intel` as on `macos-15`, green on all three:

| Target | Size | Files | Start, no bytecode | Start, cached bytecode |
|---|---|---|---|---|
| darwin-arm64, runner | 109 MB | 2568 | 1.51, 2.22, 1.83 s | 0.34, 0.30 s |
| darwin-x64, runner | 112 MB | 2568 | 3.46, 3.43, 3.34 s | 0.84, 0.80 s |
| win-x64, runner | 118 MB | 4399 | 2.67, 2.63, 2.65 s | 0.67, 0.63 s |
| darwin-arm64, a developer Mac | 109 MB | 2568 | 0.79, 0.72, 0.71 s | 0.18, 0.18 s |

The cached column leaves out each series' first run, which compiles. The
Windows asset carries no readline and no `_dbm` or `_gdbm` extension at all.

**The start-time comparison does not hold as written.** ADR-020's 0.12 s
against PyInstaller's 0.19 s timed a stand-in entry point that imported
`schematic` and `pandas`, with bytecode present. The real entry point takes
about 0.7 s on the machine that produced 0.12 s when there is no bytecode,
and about 0.18 s when there is. PyInstaller was not measured again, so start
time no longer argues for either option.

**"A property of the pin" is true of the interpreter and not yet of the
packages.** The interpreter is pinned by release and checksum. The packages
installed into it are resolved by pip at build time from the engine's
minimums, unhashed, and on Windows the wheels bring binaries of their own:
NumPy's OpenBLAS, which statically carries the GCC runtime under
GPL-3.0-or-later with the runtime library exception, and three copies of
the MSVC C++ runtime.

## Options

**Leave ADR-020 as written.** Cheapest, and it would keep telling a reader
that a flag is load-bearing when removing it fixed a broken runtime, and
that a start-time number favours the choice when it was never measured on
the real entry point.

**Supersede it.** Wrong in kind: nothing about the choice has been replaced,
and the repository's convention supersedes a decision only when the
decision changes.

**Amend it** with the measurements, which is what the convention in
`docs/adr/README.md` is for when a decision stands and its reasoning does
not.

## Decision

ADR-020's decision stands on all three targets: python-build-standalone,
pinned by release and checksum, stripped after install, with the engine at
its pinned tag and the dependencies the engine declares. ADR-020 named two
things that decide it, and one of them, start time, no longer does: it is
not a reason for either option until both are measured on
`schematic.serve`. The signing-surface count paired with it (77 Mach-O
files against 121) is ADR-020's, from macOS arm64, not measured again. The
other stands and is now checked on every run: the interpreter's contents and
licence surface are a property of the pin, by file name on all three targets
and on macOS by what every binary links. The packages installed into it are
not yet a property of anything but the day of the build, which is what
A0-10 has to change.

## Consequences

The recipe is `scripts/vendor-python.sh` on three targets. It builds in a
staging folder and renames into place only after the schema check, installs
with `--only-binary :all:`, and logs pip's freeze; the gate in `vendor.yml`
refuses GDBM and GNU readline by name everywhere and by link on macOS, where
it also requires libpython to link libedit and import readline's symbols
from it. The measurements above predate these gates. The link check, the
`--only-binary` install and the frozen list were exercised on a developer
Mac (arm64), each refusal against a planted failure, and by vendor run
34733777983 on the three runners.

A0-10 inherits four things this record makes visible:

- **Bytecode.** A runtime with no bytecode starts in 1.5 to 3.5 s on the
  runners; with bytecode, 0.3 to 0.84 s. Shipping compiled bytecode, or
  letting the first start write it somewhere outside a signed bundle, is a
  packaging decision, and the handshake's timeout should be read against the
  slow column until it is made.
- **A lock.** Until the runtime installs from `uv export --frozen` with
  `--require-hashes`, what ships is whatever PyPI serves on the day, within
  the engine's minimums; a new major is allowed. The freeze in the log makes
  that visible, not impossible.
- **Notices for the wheels' binaries.** OpenBLAS with LAPACK and the GCC
  runtime, and the MSVC C++ runtime, are Windows-only and not yet in the
  Licences screen. The GPL component among them is covered by an exception
  and is invisible to a name-based gate.
- **Build paths.** pip records the wheel's temporary path in
  `direct_url.json` and writes absolute shebangs into the console scripts it
  generates, and the artefact zip drops the executable bit and follows
  symbolic links. An installer is built from the artefact with both
  restored, or strips them.

Windows' runtime has 1831 more files than macOS's; 1703 of the 1822 in the
artefacts are the interpreter's Tcl/Tk data and the `tzdata` package pandas
requires only on Windows. The strip removes `tkinter` but not the Tcl/Tk
data, which the sidecar never loads either; that is a size lever left for
A0-10.
