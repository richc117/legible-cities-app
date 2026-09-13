# Spike: sidecar packaging

- **Question:** Which way of shipping Python gives the smallest,
  fastest-starting, easiest-to-sign sidecar for the engine and its runtime
  dependencies - a pinned python-build-standalone runtime, or a PyInstaller
  one-dir build?
- **Timebox:** one weekend. Ends when the question is answered for the
  platforms available, or the timebox closes.
- **Started:** 2026-09-07
- **Ended:** 2026-09-07 (macOS measured; Windows not, see Recommendation).
  The Intel and Windows targets ran on 2026-09-12; see the last section.
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

## 2026-09-12: darwin-x64 and win-x64 (A0-06, second half)

The recipe now runs on the two targets the first session could not reach,
from the `python` job in `.github/workflows/vendor.yml`, with the same
script and the same licence gate as darwin-arm64. The engine is the pinned
tag (v0.8.2), installed with the three dependencies it declares.

### What changed in the recipe, and why

- **`--no-deps` is gone.** E02 trimmed the engine's declared dependencies to
  pandas, python-lsp-jsonrpc and requests, which is what the sidecar
  imports. The script had kept installing only pandas and requests beside a
  `--no-deps` engine, so the vendored runtime **could not start the
  sidecar**: `schematic.serve` imports `pylsp_jsonrpc`, and the final check
  imported only `schematic, pandas, requests`, which passed. python-lsp-jsonrpc
  brings ujson with it.
- **The check runs what the app runs.** `python -m schematic.serve --schema`
  must exit 0, and the SHA-256 of its output must equal
  `engine.schema_sha256` in the pins. At v0.8.2 the engine writes the schema
  through text-mode stdout, so on Windows every line ends in `\r\n`; the
  script strips carriage returns before hashing, and that line can go once
  the pin moves past the engine release that writes to `sys.stdout.buffer`.
- **The check writes no bytecode** (`PYTHONDONTWRITEBYTECODE=1`). Before, the
  import check ran after the strip and put `__pycache__` back for every
  module it imported, so the size line measured a runtime that was no
  longer the stripped one.
- **Windows' `.pdb` debug symbols are stripped**: 86 MB uncompressed in the
  Windows asset, none on macOS.
- **Hashes are taken by Python**, not `shasum`, so the one script runs under
  Git Bash on `windows-latest` as it does on macOS; Python's own output is
  written without a newline, which a Windows Python would end in `\r`.

### The two assets

Both from release `20260901`, CPython 3.12.14, `install_only`. Upstream
publishes no checksums, so both hashes were computed on this Mac (arm64)
from a `curl -fsSL` download, with `shasum -a 256` and again with Python's
`hashlib`, which agreed. The same download of the darwin-arm64 asset
reproduced the hash already pinned, which is the control.

| Target | Asset | SHA-256 |
|---|---|---|
| darwin-x64 | `cpython-3.12.14+20260901-x86_64-apple-darwin-install_only.tar.gz` | `2e31b23f3f1319f707d0e620b48847a0046577541d357276821f9f1b5492e0ba` |
| win-x64 | `cpython-3.12.14+20260901-x86_64-pc-windows-msvc-install_only.tar.gz` | `e90c1b6419da3bd812dd73bb3de40287a21abf153438147639ec5e20375ea93f` |

### The Windows layout, from the tarball listing

- The interpreter is `python/python.exe`, at the root of the unpacked tree
  (not under `bin/`), beside `python312.dll`, `python3.dll` and the two
  `vcruntime140` DLLs. The copies under `Lib/venv/scripts/nt/` are venv
  launchers. `src/main/interpreter.ts` already looks for
  `python/python.exe` under the resources folder of a packaged Windows
  build; getting the target's tree there is A0-10's.
- **No readline of any kind**, and no `_dbm` or `_gdbm` extension: only the
  pure-Python `Lib/dbm/` package, whose `gnu.py` imports an extension that is
  not there. On macOS both x64 and arm64 carry `_dbm` and no gdbm; arm64's
  `_dbm` links only libSystem (measured 2026-09-07), and x64's has not been
  looked at with `otool`.
- The DLLs are OpenSSL 3 (`libcrypto-3-x64`, `libssl-3-x64`), `libffi-8`,
  `sqlite3`, Tcl/Tk (`tcl86t`, `tk86t` and three under `tcl/`), the Python
  DLLs and the MSVC runtime. None is GPL. The gate now also refuses a
  `*readline*.dll` or `*readline*.pyd`, which could only arrive from a
  package, and prints every shared library the runtime carries so a new one
  shows up in the log of the run that brought it.

### Measurements

Size and file count are the script's own line; cold start is three runs of
`python -m schematic.serve --schema` from the job's timing step, first with
no bytecode at all (the runtime as vendored), then with a bytecode cache
outside the runtime, whose first run compiles. Runner timings are one
virtual machine each and are indicative, not a budget.

| Target | Size | Files | Cold start, no bytecode | Cold start, cached bytecode | Source |
|---|---|---|---|---|---|
| darwin-arm64, this Mac (arm64) | 109 MB | 2568 | 0.79, 0.72, 0.71 s | 0.99 (compiling), 0.18, 0.18 s | local run of the script |
| darwin-arm64, runner (`macos-15`) | 109 MB | 2568 | 1.51, 2.22, 1.83 s | 1.71 (compiling), 0.34, 0.30 s | vendor run 34732070984 |
| darwin-x64, runner (`macos-15-intel`) | 112 MB | 2568 | 3.46, 3.43, 3.34 s | 3.82 (compiling), 0.84, 0.80 s | vendor run 34732070984 |
| win-x64, runner (`windows-latest`) | 118 MB | 4399 | 2.67, 2.63, 2.65 s | 3.02 (compiling), 0.67, 0.63 s | vendor run 34732070984 |

**The Windows runner's tree is the larger one**: 4399 files against 2568 on
both macOS targets. The uploaded artifacts of the same run (which count
4398 and 2576) say where the difference is. The Windows interpreter's
Tcl/Tk tree under `python/tcl/` - Tcl and Tk 8.6 and Tix, with their
encodings and message catalogues - is 1265 files, against 196 in macOS's
`tcl9.0`, `tk9.0`, `itcl4.3.8` and `thread3.0.6` folders under
`python/lib/`. And pandas declares `tzdata; sys_platform == "win32"`, so the
Windows runtime alone carries the `tzdata` package: 634 files. Those two
account for 1703 of the 1822. The strip removes `tkinter` but not the Tcl/Tk
data it loads, which the sidecar never uses either; that is a lever for
A0-10, not changed here.

**The first session's 0.12 s does not carry over.** It timed a stand-in that
imported `schematic` and `pandas` with bytecode present. The real entry
point with no bytecode takes about 0.7 s here, and about 0.18 s once
bytecode exists. Whether the installer ships compiled bytecode, or lets the
first start write it somewhere outside a signed bundle, is A0-10's to decide;
the handshake's budget should be read against the no-bytecode column until
it does.

### Still open

- The runtime's Python packages are resolved by pip at build time, not from
  the engine's `uv.lock`, so two runs a month apart can vendor different
  patch versions of pandas or NumPy. The schema check does not notice that.
- `THIRD_PARTY_NOTICES.md` names pandas, NumPy, requests, python-lsp-jsonrpc
  and ujson, but not the rest of what pip installs (certifi, charset-normalizer,
  idna, urllib3, python-dateutil, six); A0-10's Licences screen needs them.
- **Libraries the wheels bring on Windows only**, listed by the gate's
  shared-library line in run 34732070984 and found in the run's artifact.
  Neither is in `THIRD_PARTY_NOTICES.md` yet; both are for A0-10's Licences
  screen.
  - `numpy.libs/libscipy_openblas64_-ed4f167a5330424524f45258e7ca2c8d.dll`,
    NumPy's bundled OpenBLAS. NumPy's own `licenses/LICENSE.txt` in the wheel
    names three things inside that one DLL: OpenBLAS (BSD-3-Clause), LAPACK
    (BSD-3-Clause-Open-MPI), and the **GCC runtime library, statically
    linked, GPL-3.0-or-later WITH GCC-exception-3.1**. The runtime library
    exception permits distributing code compiled with that runtime under
    other terms, so this most likely adds a notice rather than a source
    obligation (A0-10 to confirm); but it is a GPL
    component the name-based gate cannot see, and the notices should say so.
    Neither macOS target has it: both NumPy wheels are `macosx_14_0`
    (arm64 and x86_64) and carry no OpenBLAS, gfortran or quadmath library
    at all.
  - `msvcp140-a4c2229bdc2a2a630acdc095b4d86008.dll`, three copies (one each
    under `numpy.libs/` and `pandas.libs/`, one at the top of
    `site-packages/` from ujson) with the same SHA-256 in all three wheels'
    `RECORD`: the MSVC C++ runtime, vendored and renamed by delvewheel, as
    each wheel's `DELVEWHEEL` file records. None of the three wheels ships a
    licence file for it. It is Microsoft's redistributable code; the nearest
    text in the runtime is the "Additional Conditions for this Windows binary
    build" section of python-build-standalone's own `python/LICENSE.txt`,
    which covers the Microsoft Distributable Code linked into the
    interpreter and requires distributors to pass Microsoft's terms on.
