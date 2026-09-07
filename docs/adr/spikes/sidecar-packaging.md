# Spike: sidecar packaging

- **Question:** Which way of shipping Python gives the smallest,
  fastest-starting, easiest-to-sign sidecar for the engine and its runtime
  dependencies - a pinned python-build-standalone runtime, or a PyInstaller
  one-dir build?
- **Timebox:** one weekend. Ends when the question is answered for the
  platforms available, or the timebox closes.
- **Started:** 2026-09-07
- **Ended:** 2026-09-07 (macOS measured; Windows not, see Recommendation)
- **Branch:** `spike/sidecar-packaging` (deleted when this lands; the report
  is the deliverable)

## Method

One machine: Apple Silicon MacBook Pro, macOS 15 (Darwin 25.6). CPython
3.12.14 from python-build-standalone release `20260901`; PyInstaller 6.22.2;
pandas 3.0.5.

**Two things the issue assumed were not true, and both change the numbers.**

1. The engine's `pyproject.toml` lists **seven** runtime dependencies -
   pandas, geopandas, shapely, networkx, requests, jupyterlab, matplotlib -
   not the "pandas + requests" the question names. E02, which trims them, has
   not happened. Measuring today's set would have produced numbers that are
   wrong the moment it does.
2. `schematic.serve` does not exist yet (E09), so "time `engine.info` cold and
   warm" cannot be measured as written.

So both builds install the engine with `--no-deps` plus pandas and requests -
the set E02 is heading for - and cold start is measured with a stand-in entry
point that imports `schematic` and `pandas` and writes one JSON line, which is
the same work the real sidecar will do before it answers anything.

**Windows was not measured.** There is no Windows host here and no CI; the
acceptance criterion asking for both operating systems is unmet, and the
report says so rather than extrapolating.

Both variants were built the same way and measured the same way:

- **python-build-standalone**: fetch the pinned tarball, verify sha256,
  unpack, `pip install pandas requests`, `pip install --no-deps <engine>`,
  then strip `__pycache__`, `tests`, `idlelib`, `tkinter`, `turtledemo`.
- **PyInstaller**: a venv with the same packages, `pyinstaller --onedir`.

Sizes are `du -sh`, file counts `find -type f`, start times
`/usr/bin/time -p` over five runs. **Start times are warm-cache**: every run
followed another, so they measure interpreter and import cost, not first-open
disk cost on a user's machine.

## Measurements

macOS arm64, engine + pandas + requests in both cases.

| Measure | python-build-standalone | PyInstaller one-dir |
|---|---|---|
| Size, installed and stripped | 108 MB | **53 MB** |
| Files | 2542 | **154** |
| Cold start, 5 runs | **0.12 s** (0.12 every run) | 0.19 s (0.19-0.20) |
| Mach-O binaries to sign | **77** | 121 |
| Licence surface beyond CPython | none found | **GNU readline, GPL-3.0-or-later** |
| Reproducibility | pinned tarball, checksum enforced | depends on the build machine |

### Size, in stages

| Stage | Size | Files |
|---|---|---|
| python-build-standalone, unpacked | 67 MB | 1653 |
| + pandas, requests, engine | 186 MB | 6726 |
| + stripped | **108 MB** | **2542** |

Stripping removes 78 MB and 4184 files and the runtime still imports
everything the sidecar needs. The `install_only_stripped` asset upstream is
not worth choosing over `install_only`: 24 MB against 24 MB compressed, 66 MB
against 67 MB unpacked - about 1 MB, against the 78 MB our own strip removes.

### The licence finding

`THIRD_PARTY_NOTICES.md` already requires a python-build-standalone release
new enough that no GPL readline or GDBM is linked. That was checked, and it
holds: the interpreter links `libedit` (BSD), and `_dbm` links only
`libSystem` - macOS's own ndbm. No gdbm anywhere in the tree.

The PyInstaller bundle ships `libreadline.8.dylib` and
`readline.cpython-312-darwin.so`. Traced back, they come from the build
machine's pyenv interpreter, which links
`/opt/homebrew/opt/readline/lib/libreadline.8.dylib` - Homebrew's `readline`
formula, licensed **GPL-3.0-or-later**.

Nothing in the sidecar imports `readline`. It was collected because the
interpreter that PyInstaller ran under happened to link it. That is the
finding: **PyInstaller's licence surface is a property of the machine that
ran the build**, and it arrives silently.

### Checksums

python-build-standalone publishes no checksum manifest and no per-asset
`.sha256` in release `20260901` - 871 assets, none of them checksums. So the
hash in `vendor/pins.json` is one we computed on first download; every later
build is verified against it by `scripts/vendor-python.sh`, which fails
rather than continuing on a mismatch.

## What surprised us

**The smaller bundle is the slower one, and the harder one to sign.**
PyInstaller wins on size by 55 MB and on file count by a factor of sixteen,
which is what one expects from a bundler that ships only what is imported.
It then loses on start time - 0.19 s against 0.12 s - and it ships **more**
Mach-O binaries than the full interpreter does: 121 against 77. Fewer files
overall, more things a notarisation pass has to walk.

**PyInstaller bundled a GPL library nothing imports.** GNU readline, pulled
in from the build machine's Homebrew because the interpreter that ran the
build linked it. Licence-compatible with a GPL-3.0-or-later app, so it would
not have broken anything - it would have quietly added a source-offer
obligation that no one wrote down, discovered later by someone reading the
bundle. The same build on a machine with a differently-configured Python
would ship a different set. That is the argument against PyInstaller here,
and it is not about size.

**Stripping matters more than choosing the smaller upstream asset.**
`install_only_stripped` saves about 1 MB over `install_only`. Removing
`__pycache__`, test suites, `idlelib`, `tkinter` and `turtledemo` saves 78 MB.
The obvious lever is the wrong one by two orders of magnitude.

**The question's premise had drifted from the code.** Two of its assumptions
- that the engine depends on pandas and requests, and that
`schematic.serve` exists - are both things the roadmap schedules *after* this
spike. Measuring what the issue literally asked for would have produced a
sidecar three times the size, of a shape nobody intends to ship.

## What we ruled out

**PyInstaller one-file.** Never measured, and the issue was right to exclude
it: it unpacks to a temporary directory at every start, which hides the child
process's real path and adds start-up cost the one-dir form does not have.

**`install_only_stripped`.** Measured, and it buys about 1 MB. Not worth
carrying a second asset name in the pins for.

**Trusting an upstream checksum.** There is not one to trust. Ours is
computed once and enforced thereafter.

**Measuring the engine's current dependency set.** Deliberately not done: it
includes jupyterlab and matplotlib, which a sidecar never imports, and the
numbers would have described a build nobody intends to ship.

## Recommendation

**python-build-standalone**, pinned by release and checksum, stripped after
install. `scripts/vendor-python.sh` implements it.

It is faster to start (0.12 s against 0.19 s), presents a smaller signing
surface (77 Mach-O files against 121), and - the reason that actually
decides it - its contents are a property of the pin rather than of whoever
ran the build. PyInstaller's bundle depended on the build machine badly
enough to acquire a GPL library that nothing in the sidecar imports.

It costs 55 MB. On a desktop application that will also ship LOOM binaries,
an FFmpeg build and Electron, that is not the number to optimise, and 78 MB
of it comes back from stripping rather than from the choice of tool.

**What would change our mind.** If the installer size becomes the thing
users complain about, PyInstaller's 53 MB is real and the licence problem is
solvable by building in a controlled container rather than on a developer
machine - which CI would do anyway. If the engine ever needs to load a
plugin or an optional dependency at runtime, PyInstaller's frozen import
graph becomes a hard blocker and this decision stops being close.

**The timebox is not spent, and the question is half answered.** macOS arm64
is measured; Windows is not, for want of a host. The recipe should carry -
python-build-standalone publishes `x86_64-pc-windows-msvc` assets in the same
release - but nothing here demonstrates that, and the acceptance criterion
asking for both operating systems is unmet.

## Follow-up

- Decision record: `docs/adr/020-sidecar-packaging.md`
- `scripts/vendor-python.sh` and the `python` block in `vendor/pins.json`
  are the deliverables; the `vendor.yml` job for them is written but, like
  the LOOM job beside it, has never run.
- Blocked on E02: the engine still declares jupyterlab and matplotlib as
  runtime dependencies, so `--no-deps` is load-bearing in the vendoring
  script. When E02 lands, drop the flag and re-measure.
- Blocked on E09: cold start was measured with a stand-in entry point. Re-run
  against the real `schematic.serve` before trusting the number for a
  handshake budget.
- Windows x64 remains unmeasured, as it does for A0-05. One CI decision
  unblocks both.
- Add python-build-standalone's own licence files to the shipped runtime and
  reference them from `THIRD_PARTY_NOTICES.md`; the `install_only` asset does
  not carry the `PYTHON.json` manifest the full tarballs do.
