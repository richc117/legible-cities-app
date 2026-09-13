# Research: the `full` archives of python-build-standalone 20260901 (T001)

Measured on 2026-09-13 by downloading each archive, listing it, and
extracting `python/PYTHON.json` and `python/licenses/` from it. The archives
were deleted afterwards.

## The archives

The `install_only` assets the pins name are repackagings of these builds'
`install/` trees: the `pgo+lto` build on macOS and the `pgo` build on
Windows. (A `debug-full` exists for macOS too; it is not the build the
runtime comes from.)

| Target       | Asset                                                                |      Bytes | sha256                                                             |
| ------------ | -------------------------------------------------------------------- | ---------: | ------------------------------------------------------------------ |
| darwin-arm64 | `cpython-3.12.14+20260901-aarch64-apple-darwin-pgo+lto-full.tar.zst` | 54,682,677 | `dbefa04d4107b449e17022f9c78d3eacbd37a1aa8c166c6220dbd95addf3f318` |
| darwin-x64   | `cpython-3.12.14+20260901-x86_64-apple-darwin-pgo+lto-full.tar.zst`  | 54,241,471 | `47fdddfa61d5f76472b7fc303c38689504d1ccec430d0017c5fa8459d0d567bf` |
| win-x64      | `cpython-3.12.14+20260901-x86_64-pc-windows-msvc-pgo-full.tar.zst`   | 43,477,314 | `b7cf8be5cd5222d1e456fbf71257efe558d84fe092757b6892c16584e5df01c2` |

Each hash was computed on download and matches the `digest` GitHub records
for the asset (`gh api repos/astral-sh/python-build-standalone/releases/tags/20260901`).
The same API's digests for the three `install_only` assets match the hashes
already in `vendor/pins.json`, so the pins' note ("upstream publishes no
checksum manifest") is still true of upstream, and GitHub's own record is a
second witness.

**Size is not a problem.** 43-55 MB each, the same order as the
`install_only` assets the job already fetches (25-46 MB). Streaming
`zstd -dc | tar xf - python/PYTHON.json python/licenses` extracts only the
members needed, and nothing but the archive touches the disk.

**The format is.** The archives are `.tar.zst`. No Python below 3.14 reads
zstd, so the job needs a `zstd` binary on each runner. It is in the
`macos-15`, `macos-15-intel` and `windows-latest` images' tool lists, but
that has not been proven by a run.

## What each archive carries

- **`python/licenses/`, 19 texts, about 170 KB, the same 19 names on all
  three targets.** Windows' copies differ only in line endings (CRLF):
  `bdb`, `bzip2`, `cpython`, `expat`, `libX11`, `libXau`, `libedit`,
  `libffi`, `liblzma`, `libuuid`, `libxcb`, `mpdecimal`, `ncurses`,
  `openssl-1.1`, `openssl-3`, `sqlite`, `tcl`, `tix`, `zlib`. The folder is
  the project's whole catalogue, not a list for this build: it carries texts
  for libraries these builds do not link (Berkeley DB, the three X11
  libraries, OpenSSL 1.1).
- **`python/PYTHON.json`**, format version 8, 62-126 KB. The top level
  names CPython's licences (`Python-2.0`, `CNRI-Python`) and
  `licenses/LICENSE.cpython.txt`. `build_info.extensions` gives, per
  extension module, `links` (each with `system: true`, `path_static` or
  `path_dynamic`), `licenses` (SPDX names) and `license_paths`.

So the folder and the metadata exist on every target. **The metadata does
not name every linked library, and on macOS it names a text the archive
lacks.**

## Where the metadata and the binaries disagree

1. **darwin-arm64 and darwin-x64: a named text is not carried.** `zlib`,
   `binascii`, `_sqlite3` and `_tkinter` name
   `licenses/LICENSE.zlib-ng.txt` beside `licenses/LICENSE.zlib.txt`. The
   folder has no `LICENSE.zlib-ng.txt`. Every one of those links `z` with
   `system: true`, which is macOS's own libz, so no zlib text is owed on
   macOS at all. The metadata looks shared with the Linux builds, which use
   zlib-ng.
2. **win-x64: three statically linked libraries are not named.**
   - zlib 1.3.2 is compiled into `python312.dll` (its version string and
     its error messages are in the DLL). The `zlib` and `binascii` entries
     are `in_core: true` with no `links`, `licenses` or `license_paths`.
   - Expat 2.8.3 is compiled into `DLLs/pyexpat.pyd` (`expat_2.8.3` is in
     the file). `pyexpat` has no licence entry.
   - libmpdec is compiled into `DLLs/_decimal.pyd` (`__libmpdec_version__`,
     and the build's source paths under `Modules\_decimal\libmpdec`).
     `_decimal` has no licence entry.

   All three come from CPython's own source tree and its Windows externals
   rather than from python-build-standalone's builds, which is presumably
   why the metadata is silent. Their texts are in the folder
   (`expat`, `mpdecimal`, `zlib`). CPython's Windows `LICENSE.txt`, which
   the `install_only` runtime already ships, appends only the Microsoft
   redistributable terms, bzip2, Tcl/Tk and Tix; it names none of these
   three, nor OpenSSL, libffi, xz or SQLite.

3. **win-x64: stale link names.** `_hashlib` and `_ssl` link
   `libcrypto-1_1-x64` and `libssl-1_1-x64`, but the DLLs in the tree are
   `libcrypto-3-x64.dll` and `libssl-3-x64.dll`. The licence path they name
   (`openssl-3`) is the right one.
4. **Texts for system libraries.** On macOS `readline` (libedit),
   `_curses` and `_curses_panel` (ncurses) name texts, but link the
   operating system's copies (`system: true`); nothing is owed for those,
   and shipping the texts does no harm.

Also seen, and not the metadata's to name: `build/lib/libclang_rt.osx.a`
(LLVM's compiler runtime, whose licence exception asks for no notice in
binaries) and `build/lib/libzstd.a` (no 3.12 module links it).

## What this means for FR-002

The spec's assumption was that `PYTHON.json` names the linked libraries and
their licence files. It does, but not completely, so an agreement check
built on the metadata alone either:

- **fails on macOS** from the first run, because a named text is missing
  (finding 1), or
- **passes on Windows** with three statically linked libraries never
  checked (finding 2).

It also cannot require "no text for a library the build does not link",
because the folder is a catalogue (bdb, the X11 libraries, openssl-1.1).

## Proposal (not built; waiting for a decision)

Ship the whole `licenses/` folder and `PYTHON.json` under each target's
runtime (`python/licenses/`, `python/PYTHON.json`; about 250-300 KB), and
make the agreement a check of the metadata **against a list the pins hold
and a person reviews**:

- `python.targets.<t>.full` holds `asset` and `sha256` for the archive.
- `python.licences.<t>` holds:
  - `unlisted`: texts owed although the metadata names no library for them,
    each with its evidence (win-x64: `expat`, `mpdecimal`, `zlib`, as
    above);
  - `named_absent`: texts the metadata names that the archive does not
    carry, each with why nothing is owed (darwin: `zlib-ng`, which is
    linked only as the system's libz);
  - `not_linked`: texts carried that no extension names (bdb, libX11,
    libXau and libxcb everywhere; tix on macOS; libedit, ncurses and
    openssl-1.1 on Windows).
- The job computes the texts the metadata names, adds `unlisted`, removes
  `named_absent`, and requires every result to exist in the folder. It also
  requires every file in the folder to be accounted for by exactly one of
  "named", `unlisted` or `not_linked`, and every entry in the pins' lists to
  still be true (a `named_absent` that appears, an `unlisted` that the
  metadata starts naming). Any difference fails the job and names the
  entry, so a new release cannot ship until someone rereads the list.
- The Windows entries in `unlisted` are also checked in the job: the
  version strings above are looked for in `python312.dll`, `pyexpat.pyd`
  and `_decimal.pyd`, so the reason for listing them is re-proved each run.

The alternative, shipping the folder with no agreement check, satisfies
"every statically linked library has its text in the installer" today
(the folder carries every text found owed above, and more) but not the issue's
"a check fails if the pinned runtime and the shipped texts disagree".
