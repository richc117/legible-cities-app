# Third-party notices

The app is licensed under the GNU General Public License v3.0 or later (see
`LICENSE`). It is built from, and ships with, the components below. Each
keeps its own licence; the table is kept current as components are added or
removed. **The installers `.github/workflows/build.yml` makes are test
builds until a release** (ADR-035), though as artefacts of this public
repository they are downloadable for 30 days, and so conveyed; a pushed
release tag attaches them to a draft GitHub Release (ADR-041). They bundle
the runtime, the engine, LOOM and ffmpeg for their target and carry
`LICENSE` and this file beside them.

**Where the notices are read.** In the installed app, **Settings ›
Licences** names the app's licence and every component below that ships,
with its licence, and opens three things from the app itself: this file,
the folder of the Python runtime's licence texts (`python/licenses/` in
the app's resources), and Chromium's licences as Electron ships them
(`LICENSES.chromium.html`, beside Electron's own `LICENSE.electron.txt`:
in the resources on a Mac, beside the executable on Windows). The same
files are inside every installer, and a GitHub Release carries this file
in the app's source archive. `vendor-manifest.json` inside the app
records each component's pin: the runtime's release, asset and checksum,
the engine's tag, the name and version of every Python package installed
in the runtime, LOOM's commit (and the Windows port's), and FFmpeg's
version and configure line with the checksums of the FFmpeg, x264 and
(on Windows) zlib sources it was built from. It does not record the
versions of the libraries linked into the Python runtime and wheels; the
licence texts of the runtime's are in `python/licenses/`, and every Python
package installed in the runtime keeps its own licence files in its
`.dist-info` folder there, as the package ships them. The
ffmpeg they carry is built in this repository (ADR-040), and every
Release attaches the GPL components' sources, and the source of the LGPL
FFmpeg library inside Electron, beside them (below).

| Component | Role | Licence | Source |
|---|---|---|---|
| LOOM | Schematisation: `gtfs2graph`, `topo`, `loom`, `octi`, native binaries built in this repository's CI from the commit pinned in `vendor/pins.json`, and bundled under `loom/` in the app's resources | GPL-3.0 | https://github.com/ad-freiburg/loom |
| LOOM Windows compatibility changes, by Transport for Cairo | Building LOOM under MSYS2 on Windows. At build time the vendor workflow takes `win_compat.h` and five `cppgtfs` files (the `timezone` identifier rename) from the port at the commit pinned in `vendor/pins.json`, and applies the port's other documented changes to our own tree with `scripts/loom-windows-patch.py`. Shims only; the port states, and our parity check assumes, no change to LOOM's algorithms | GPL-3.0 | https://github.com/transportforcairo/loom-windows-port |
| `legible-cities` engine | The Python pipeline: feeds, rendering, scheduling, animation, export | GPL-3.0-or-later: the pinned tag carries the GPL-3.0 text as `LICENSE` and declares it in `pyproject.toml` (`license-files`). Installed into the bundled runtime at the tag in `vendor/pins.json`, its licence in its `.dist-info` | https://github.com/richc117/legible-cities |
| Esri Calcite UI icons | Four view-switcher icons inside the engine's animation page, which the app embeds; the engine redistributes them **unmodified** with the agreement's notice, and its issue E16 replaces them with Phosphor (ADR-026). The app's own tree carries none | Esri Master License Agreement | https://github.com/Esri/calcite-ui-icons |
| FigUI3 core | The interface's control kit: `fig.css` and `fig.js` of `@rogieking/figui3` **9.0.0**, pinned exactly. The package is split-licensed and its `package.json` says only "SEE LICENSE IN LICENSE": the core is MIT; the editor and lab bundles are PolyForm Shield 1.0.0 and are never imported (the build refuses them, `scripts/figui-guard.ts`; ADR-026). The core vendors `@ungap/custom-elements-builtin` (ISC) | MIT (core); ISC (the vendored polyfill) | https://github.com/rogie/figui3 |
| Phosphor Icons | The interface's icons, vendored unmodified from `@phosphor-icons/core` **2.1.1** under `src/renderer/src/icons/phosphor/` with the licence beside them; the light weight at 16px, the regular at 24px, the fill weight for toggled states | MIT | https://github.com/phosphor-icons/core |
| FFmpeg (ADR-012, ADR-040) | Encoding MP4 and GIF exports, bundled under `ffmpeg/` in the app's resources: `ffmpeg` and `ffprobe` of **FFmpeg 9.0.1**, built in this repository by `scripts/vendor-ffmpeg.sh` in the `ffmpeg` jobs of `.github/workflows/vendor.yml`, natively on each target, from the release tarball pinned by URL and sha256 in `vendor/pins.json`, whose signature by FFmpeg's release signing key the vendor workflow verifies, and proven by the same script before it is vendored. Configured `--enable-gpl --enable-version3` with `--disable-everything --disable-autodetect --disable-network`, and only the codecs, formats, filters and protocols the engine's export uses enabled back, with three more that the checks use: the `testsrc` filter the vendoring proof makes frames with, and the `rawvideo` encoder and muxer and `gif` decoder the determinism test reads exports back with; the configure line of every target is in the pins and printed by `ffmpeg -version`. The only external libraries are x264 and zlib (the operating system's on macOS; linked statically on Windows), and the vendor jobs refuse any other. **No freetype, fontconfig, HarfBuzz, libass, libdvdread or libdvdcss**: the export needs none, because the page draws every word in it. The vendor job also builds a Linux x64 binary for tests, and neither ships nor uploads it. Patent licensing for H.264 and AAC encoders is not assessed in this repository | GPL-3.0-or-later (`--enable-gpl --enable-version3`) | https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz (tag `n9.0.1`, commit `bf1b838f2a`), and the `ffmpeg-source` artefact on each release |
| x264 | H.264 encoder statically linked into both FFmpeg binaries on every target: commit `0480cb05fa`, pinned with the sha256 of its `git archive` tar in `vendor/pins.json`, configured 8-bit 4:2:0 without its command-line tool, OpenCL or input libraries | GPL-2.0-or-later | https://code.videolan.org/videolan/x264, and the `ffmpeg-source` artefact on each release |
| zlib | Compression for FFmpeg's PNG encoder and decoder. Linked statically into the Windows binaries from the **1.3.2** release tarball pinned in `vendor/pins.json`; on macOS FFmpeg links the operating system's `/usr/lib/libz.1.dylib`, which is not shipped. Also linked statically into the Windows LOOM tools `topo`, `loom` and `octi`, from MSYS2 UCRT64's zlib package, which the vendor workflow refuses unless it is the revision **1.3.2-2** pinned under `loom_windows_static`, built by MSYS2 from the 1.3.2 release with MSYS2's patches; on macOS LOOM links the system's | Zlib | https://github.com/madler/zlib, and the `ffmpeg-source` and LOOM source archives on each release |
| bzip2 (libbzip2) | Decompression in the Windows LOOM tools `topo`, `loom` and `octi`, linked statically from MSYS2 UCRT64's bzip2 package, which the vendor workflow refuses unless it is the revision **1.0.8-4** pinned under `loom_windows_static` in `vendor/pins.json`, built by MSYS2 from the 1.0.8 release with MSYS2's patches; its notice is below. On macOS LOOM links the system's `libbz2`, which is not shipped | bzip2-1.0.6 (BSD-style) | https://sourceware.org/bzip2/, and the LOOM source archive on each release |
| GCC runtime library and mingw-w64 runtime, with winpthreads | Linked statically into the Windows FFmpeg binaries by MSYS2 UCRT64's GCC with `-static`: GCC's `libgcc`, mingw-w64's CRT startup code and import libraries, and mingw-w64's winpthreads, which the toolchain brings in although FFmpeg and x264 use Win32 threads (the Windows binaries carry its source file names). They import only Windows' own DLLs, the Universal CRT among them, which the vendor job checks. The same are linked statically into the four Windows LOOM tools by the same toolchain with `-static` (`scripts/loom-windows-patch.py`), with GCC's C++ library `libstdc++` besides, since LOOM is C++; each release's LOOM source archive names the exact MSYS2 package revisions (`TOOLCHAIN-win-x64.txt`). The notices of both are below, from mingw-w64 at commit `9c1abbbf55`, which MSYS2's crt, headers and winpthreads packages `14.0.0.r375.g9c1abbbf5` in the build were made from | GPL-3.0-or-later WITH GCC-exception-3.1 (libgcc, libstdc++); the mingw-w64 runtime's own terms, with parts under the BSD-style, MIT and permissive notices its licence file lists, all quoted below (mingw-w64's CRT); MIT, with parts derived from Lockless Inc.'s Posix Threads library under BSD-3-Clause (winpthreads) | https://gcc.gnu.org/ and https://www.mingw-w64.org/ |
| Electron | Application shell; includes Chromium and Node.js under their own licences, which Electron ships in `LICENSES.chromium.html`. Pinned in `package.json`. electron-builder keeps that file and Electron's `LICENSE` (as `LICENSE.electron.txt`) beside the Windows executable and deletes both from a Mac app, so `electron-builder.yml` copies them into the Mac app's resources, and the packaging check refuses an app on either system without them. Electron's own licence is quoted below | MIT (Electron); Chromium's and Node.js's licences as `LICENSES.chromium.html` gives them | https://www.electronjs.org/ |
| FFmpeg inside Electron | Chromium's media decoder, which Electron ships as a shared library: `libffmpeg.dylib` in `Electron Framework.framework/Versions/A/Libraries/` on macOS and `ffmpeg.dll` beside the executable on Windows. The app never calls it, and it is not the FFmpeg above. Electron **44.2.0** builds it from Chromium **152.0.7977.76**'s copy of FFmpeg, `chromium/third_party/ffmpeg` at commit `2b68d2babae7` (the `ffmpeg_revision` of Chromium's DEPS; the library reports `git-2026-07-15-6cfe2122b0`), with Chrome branding (`ffmpeg_branding = "Chrome"`, `proprietary_codecs = true`) as a shared library, and one Electron patch to its `BUILD.gn`. Chromium's configuration for that branding has `CONFIG_GPL`, `CONFIG_NONFREE` and `CONFIG_VERSION3` at 0 and enables the decoders h264, aac, flac, mp3, vorbis, libopus and nine PCM formats, the parsers aac, flac, h264, mpegaudio, opus, vorbis and vp9, and the demuxers aac, flac, matroska, mov, mp3, ogg and wav (read from the Mac library's symbol table and Chromium's `codec_list.c`, `parser_list.c` and `demuxer_list.c` on 2026-09-13). libopus, from Chromium's `third_party/opus`, is linked statically inside it. FFmpeg's licence notice and the full LGPL-2.1 text are in Electron's `LICENSES.chromium.html`. Pinned by git object id under `electron_ffmpeg` in `vendor/pins.json` (ADR-043). Patent licensing for the H.264 and AAC decoders is not assessed in this repository | LGPL-2.1-or-later (FFmpeg as configured); BSD-3-Clause (libopus) | https://chromium.googlesource.com/chromium/third_party/ffmpeg at `2b68d2babae73714846961fb0ee47e3b3d2e39a9`, and the `electron-ffmpeg-source` archive on each release |
| React | User interface | MIT | https://react.dev/ |
| electron-vite, Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, electron-builder | Development tooling: build, test, style. Present in the repository, not shipped in the app | MIT (electron-vite, Vite, Vitest, ESLint, Prettier, electron-builder); Apache-2.0 (Playwright, TypeScript) | package.json |
| python-build-standalone (ADR-020, ADR-038) | The bundled Python interpreter, under `python/` in the app's resources: pinned by release and by a checksum this repository records in `vendor/pins.json`, stripped after install, its bytecode compiled at build (ADR-035) | PSF-2.0 (CPython); MPL-2.0 (the project's build code); bundled libraries under their own licences (the next two rows). CPython's `LICENSE.txt` ships inside it; the texts the `install_only` asset lacks ship beside it in `python/licenses/`, taken from the same build's `full` archive (ADR-042). Verified 2026-09-07: the interpreter links libedit, not GNU readline, and no GDBM; the Windows asset, listed 2026-09-12, carries no readline and no `_dbm` or `_gdbm` extension at all; `vendor.yml` fails the build if either appears by file name on all three targets, and on the two macOS targets also if any Mach-O in the runtime links a library named for readline or gdbm, or `libpython` defines readline's symbols itself; Windows is checked by name only | https://github.com/astral-sh/python-build-standalone |
| Libraries linked into the Python runtime | Linked into the bundled interpreter and its extension modules by python-build-standalone, or compiled in from CPython's own tree: OpenSSL, libffi, xz (liblzma), bzip2, zlib (Windows; macOS links the system's), mpdecimal, Expat, SQLite, Tcl/Tk, Tix (Windows) and libuuid. Their licence texts ship in `python/licenses/` in the app's resources, with python-build-standalone's `PYTHON.json` for the build, both from the pinned release's `full` archive for the target, checked by sha256; the vendor workflow and the packaging check refuse a runtime whose texts, build metadata and the reviewed lists in `vendor/pins.json` disagree, and look in the Windows DLLs for the zlib, Expat and libmpdec the metadata does not name (ADR-042). The folder also carries texts python-build-standalone publishes for libraries these builds do not link: Berkeley DB and the X11 libraries on every target, Tix on macOS, and on Windows libedit, ncurses and OpenSSL 1.1, which the pins list as such. The macOS metadata names OpenSSL 1.1's text beside OpenSSL 3's for `_hashlib` and `_ssl`, whose one build variant links OpenSSL 3's static libraries, so that text ships there as named | OpenSSL: Apache-2.0; libffi, Expat: MIT; xz: 0BSD; bzip2: bzip2-1.0.6; zlib: Zlib; mpdecimal: BSD-2-Clause; SQLite: public domain; Tcl/Tk, Tix: TCL; libuuid: BSD-3-Clause; each as its text in `python/licenses/` says | https://github.com/astral-sh/python-build-standalone |
| Software incorporated into CPython | Code CPython carries from other projects (the Mersenne Twister, SipHash, `dtoa.c`, HACL* and BLAKE2 among the hash functions, parts of `asyncio`, and the rest CPython's documentation lists), whose notices are not in the `LICENSE.txt` the runtime ships. CPython's `Doc/license.rst` at the tag of the pinned version, fetched by commit and checked by sha256, ships as `python/licenses/CPython-Doc-license.rst` (ADR-042) | Each as `CPython-Doc-license.rst` quotes it | https://github.com/python/cpython/blob/v3.12.14/Doc/license.rst |
| PyInstaller (measured, not chosen: ADR-020) | Was the alternative way to bundle the interpreter; not used and not shipped | GPL-2.0-or-later with the bootloader exception | https://pyinstaller.org/ |
| pandas | GTFS tables in the engine | BSD-3-Clause | https://pandas.pydata.org/ |
| NumPy | Dependency of pandas | BSD-3-Clause. The Windows wheel's `numpy.libs/libscipy_openblas64_*.dll` also carries OpenBLAS (BSD-3-Clause), LAPACK (BSD-3-Clause-Open-MPI) and the GCC runtime library, statically linked, under GPL-3.0-or-later WITH GCC-exception-3.1, as NumPy's own licence file in the wheel states; the macOS wheels carry no OpenBLAS | https://numpy.org/ |
| requests | Feed download in the engine | Apache-2.0 | https://requests.readthedocs.io/ |
| vscode-jsonrpc (planned) | JSON-RPC over stdio, app side | MIT | https://github.com/microsoft/vscode-languageserver-node |
| python-lsp-jsonrpc | JSON-RPC over stdio, engine side; one of the engine's three declared dependencies, installed into the vendored runtime by `scripts/vendor-python.sh` since A0-06 | MIT | https://github.com/python-lsp/python-lsp-jsonrpc |
| ujson | Dependency of python-lsp-jsonrpc: a compiled JSON encoder and decoder, installed into the vendored runtime with it | BSD-3-Clause AND TCL (its package metadata and `LICENSE.txt`: the numeric decoder is derived from Tcl's, and portions from stringencoders are BSD-3-Clause too) | https://github.com/ultrajson/ultrajson |
| certifi, charset-normalizer, idna, urllib3, python-dateutil, six, tzdata | What the engine's three dependencies bring into the bundled runtime, installed by `scripts/vendor-python.sh` at the versions `vendor-manifest.json` records for each build: certifi's CA bundle, charset-normalizer, idna and urllib3 for requests; python-dateutil and six for pandas; tzdata for pandas on Windows only | MPL-2.0 (certifi); MIT (charset-normalizer, urllib3, six); BSD-3-Clause (idna); Apache-2.0 AND BSD-3-Clause (python-dateutil: changes since 2017 under Apache-2.0, and its licence file applies BSD-3-Clause to all of it); Apache-2.0 (tzdata) | Each package's page on https://pypi.org/ |
| pip | The installer, left in the bundled runtime by `scripts/vendor-python.sh`, at the version the manifest records. It vendors, each with its licence file in pip's `.dist-info/licenses/`: CacheControl, certifi, distlib, distro, idna, msgpack, packaging, pkg_resources, platformdirs, Pygments, pyproject-hooks, requests, resolvelib, rich, tomli, tomli-w, truststore and urllib3 | MIT (pip, platformdirs, pkg_resources, pyproject-hooks, rich, tomli, tomli-w, truststore, urllib3); Apache-2.0 (CacheControl, distro, msgpack, requests); Apache-2.0 OR BSD-2-Clause (packaging); MPL-2.0 (certifi); PSF-2.0 (distlib); BSD-3-Clause (idna); BSD-2-Clause (Pygments); ISC (resolvelib) | https://pip.pypa.io/ |
| react-colorful | The colour picker in the Line colours panel (A4-01): **5.8.1**, pinned exactly, no dependencies of its own. A build-time dependency for the same reason the control kit is: the renderer's packages are bundled by Vite, and the packager copies every production dependency whole | MIT | https://github.com/omgovich/react-colorful |
| Spec Kit | Spec templates and scripts, committed under `.specify/` (its agent skills are installed outside the repository). Development tooling: present in this repository, not shipped in the app | MIT | https://github.com/github/spec-kit |
| BART GTFS feed (test fixture) | The determinism test's fixture (A5-04): BART's published GTFS zip, byte for byte, and the LOOM stage graphs made from it, under `tests/fixtures/determinism/bart/`, whose README says where each came from. Test data: present in this repository, not shipped in the app | BART Developer License Agreement: a non-exclusive, limited and revocable right to use, reproduce and redistribute BART Data, provided as is, with BART's trademarks not used in association with it; BART may modify or revoke the agreement at any time (read 2026-09-12) | https://www.bart.gov/schedules/developers/developer-license-agreement |
| Contributor Covenant 2.1 | The code of conduct text | CC BY 4.0 | https://www.contributor-covenant.org/ |

## Obligations we take on

- **GPL components** (LOOM, FFmpeg with x264, the engine): every GitHub
  Release attaches, beside the three installers and `SHA256SUMS.txt`, one
  archive of the Corresponding Source of each, built by the vendor workflow
  in the same run as the installers from the same `vendor/pins.json`, and
  refused if the run's pins, app version or run do not match the
  installers' manifests (`scripts/release.mjs`, ADR-041). The installed app
  ships `LICENSE` and this file, and Settings › Licences opens this file.
  - `ffmpeg-<version>-source.tar`, the `ffmpeg-source` artefact: FFmpeg is
    built in this repository (ADR-040), so its Corresponding Source is
    FFmpeg's release tarball, x264 at its pinned commit, zlib's release
    tarball for the Windows binaries, and `scripts/vendor-ffmpeg.sh` with
    every configure line, each verified against the pins (FFmpeg's and
    zlib's signatures too), with copies of the pins and the vendor workflow
    and a `BUILD.txt` naming the repository commit. The manifest names the
    same sources by hash.
  - `loom-<commit>-source.tar`, the `loom-source` artefact: LOOM at the
    pinned commit with its `cppgtfs` and `util` submodules at the commits
    that commit records, each checked before it is archived; Transport for
    Cairo's Windows port at its pinned commit;
    `scripts/loom-windows-patch.py`, which applies the port's changes for
    the Windows build; the upstream release tarballs of zlib 1.3.2 and
    bzip2 1.0.8, each checked against its sha256 and its publisher's
    signature, and MSYS2's source packages (PKGBUILD, patches and upstream
    tarball) for the exact revisions the Windows tools link statically,
    each checked against its pinned sha256 and MSYS2's signature; copies of the pins and the vendor workflow,
    whose `loom` and `loom-windows` jobs are the build instructions; a
    `BUILD.txt` naming the commits and tarballs; and
    `TOOLCHAIN-win-x64.txt`, the `loom-windows` job's record of the MSYS2
    package revisions it linked in. The LOOM jobs wait for this one, so no
    LOOM binary is uploaded in a run whose sources did not verify.
  - `legible-cities-engine-<version>-source.tar`, the `engine-source`
    artefact: the engine at the pinned tag, its version checked against
    the pin as the runtime's vendoring checks it, with
    `scripts/vendor-python.sh`, which installs it, and a `BUILD.txt` naming
    the commit the tag resolved to.
  - The app's own source is the archive GitHub attaches to every Release of
    its tag.
- **The FFmpeg library inside Electron** (LGPL-2.1-or-later, with libopus
  inside): LGPL-2.1 section 4 asks whoever distributes the library in object
  form to accompany it with its complete corresponding source, or to offer
  equivalent access to it from the same place, and this project distributes
  it in every installer. So every GitHub Release also attaches
  `electron-ffmpeg-<electron version>-source.tar.xz`, the
  `electron-ffmpeg-source` artefact, attached as that job packed it (ADR-043):
  Chromium's FFmpeg at the commit Chromium's DEPS pins, with its `BUILD.gn`
  and generated configuration; Chromium's `third_party/opus`, `media/ffmpeg`
  (the scripts that generate that configuration) and `build` (the GN
  configuration it imports) at the Chromium commit Electron's DEPS names;
  Electron's FFmpeg patch and release gn args; copies of the script, the
  pins and the vendor workflow; and a `BUILD.txt` saying what each part is
  and how the library is built. Each part is verified by its git object id
  against `vendor/pins.json` before it is packed, and the job refuses a run
  whose `package-lock.json` installs another Electron than the pins are for.
  No installer is packaged in a run whose archive did not verify
  (`build.yml`). `v0.1.0-rc.2`, published before this decision, is given
  the archive after publication, from this change's first CI run; it ships
  the same Electron 44.2.0.
- **mingw-w64 runtime**, linked into the Windows ffmpeg and ffprobe and
  the Windows LOOM tools. Its
  `COPYING.MinGW-w64-runtime.txt` at commit `9c1abbbf55`, verbatim but for
  one e-mail address this public repository does not reproduce (the file
  itself carries it:
  https://github.com/mingw-w64/mingw-w64/blob/9c1abbbf55a3de2febee4d1f685b1bda20774c5e/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt):

  ```text
  MinGW-w64 runtime licensing
  ***************************

  This program or library was built using MinGW-w64 and statically
  linked against the MinGW-w64 runtime. Some parts of the runtime
  are under licenses which require that the copyright and license
  notices are included when distributing the code in binary form.
  These notices are listed below.


  ========================
  Overall copyright notice
  ========================

  Copyright (c) 2009, 2010, 2011, 2012, 2013 by the mingw-w64 project

  This license has been certified as open source. It has also been designated
  as GPL compatible by the Free Software Foundation (FSF).

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

     1. Redistributions in source code must retain the accompanying copyright
        notice, this list of conditions, and the following disclaimer.
     2. Redistributions in binary form must reproduce the accompanying
        copyright notice, this list of conditions, and the following disclaimer
        in the documentation and/or other materials provided with the
        distribution.
     3. Names of the copyright holders must not be used to endorse or promote
        products derived from this software without prior written permission
        from the copyright holders.
     4. The right to distribute this software or to use it for any purpose does
        not give you the right to use Servicemarks (sm) or Trademarks (tm) of
        the copyright holders.  Use of them is covered by separate agreement
        with the copyright holders.
     5. If any files are modified, you must cause the modified files to carry
        prominent notices stating that you changed the files and the date of
        any change.

  Disclaimer

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS ``AS IS'' AND ANY EXPRESSED
  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
  OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO
  EVENT SHALL THE COPYRIGHT HOLDERS BE LIABLE FOR ANY DIRECT, INDIRECT,
  INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA,
  OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
  LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE,
  EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

  ========================================
  getopt, getopt_long, and getop_long_only
  ========================================

  Copyright (c) 2002 Todd C. Miller [address omitted]

  Permission to use, copy, modify, and distribute this software for any
  purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies.

  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
  WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
  MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
  ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
  ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
  OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

  Sponsored in part by the Defense Advanced Research Projects
  Agency (DARPA) and Air Force Research Laboratory, Air Force
  Materiel Command, USAF, under agreement number F39502-99-1-0512.

          *       *       *       *       *       *       *

  Copyright (c) 2000 The NetBSD Foundation, Inc.
  All rights reserved.

  This code is derived from software contributed to The NetBSD Foundation
  by Dieter Baron and Thomas Klausner.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:
   1. Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
   2. Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE NETBSD FOUNDATION, INC. AND CONTRIBUTORS
  ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
  TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
  PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION OR CONTRIBUTORS
  BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.


  ===============================================================
  gdtoa: Converting between IEEE floating point numbers and ASCII
  ===============================================================

  The author of this software is David M. Gay.

  Copyright (C) 1997, 1998, 1999, 2000, 2001 by Lucent Technologies
  All Rights Reserved

  Permission to use, copy, modify, and distribute this software and
  its documentation for any purpose and without fee is hereby
  granted, provided that the above copyright notice appear in all
  copies and that both that the copyright notice and this
  permission notice and warranty disclaimer appear in supporting
  documentation, and that the name of Lucent or any of its entities
  not be used in advertising or publicity pertaining to
  distribution of the software without specific, written prior
  permission.

  LUCENT DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE,
  INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
  IN NO EVENT SHALL LUCENT OR ANY OF ITS ENTITIES BE LIABLE FOR ANY
  SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
  IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
  ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
  THIS SOFTWARE.

          *       *       *       *       *       *       *

  The author of this software is David M. Gay.

  Copyright (C) 2005 by David M. Gay
  All Rights Reserved

  Permission to use, copy, modify, and distribute this software and its
  documentation for any purpose and without fee is hereby granted,
  provided that the above copyright notice appear in all copies and that
  both that the copyright notice and this permission notice and warranty
  disclaimer appear in supporting documentation, and that the name of
  the author or any of his current or former employers not be used in
  advertising or publicity pertaining to distribution of the software
  without specific, written prior permission.

  THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE,
  INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.  IN
  NO EVENT SHALL THE AUTHOR OR ANY OF HIS CURRENT OR FORMER EMPLOYERS BE
  LIABLE FOR ANY SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY
  DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
  WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
  ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
  SOFTWARE.

          *       *       *       *       *       *       *

  The author of this software is David M. Gay.

  Copyright (C) 2004 by David M. Gay.
  All Rights Reserved
  Based on material in the rest of /netlib/fp/gdota.tar.gz,
  which is copyright (C) 1998, 2000 by Lucent Technologies.

  Permission to use, copy, modify, and distribute this software and
  its documentation for any purpose and without fee is hereby
  granted, provided that the above copyright notice appear in all
  copies and that both that the copyright notice and this
  permission notice and warranty disclaimer appear in supporting
  documentation, and that the name of Lucent or any of its entities
  not be used in advertising or publicity pertaining to
  distribution of the software without specific, written prior
  permission.

  LUCENT DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE,
  INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS.
  IN NO EVENT SHALL LUCENT OR ANY OF ITS ENTITIES BE LIABLE FOR ANY
  SPECIAL, INDIRECT OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
  IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
  ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
  THIS SOFTWARE.


  =========================
  Parts of the math library
  =========================

  Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

  Developed at SunSoft, a Sun Microsystems, Inc. business.
  Permission to use, copy, modify, and distribute this
  software is freely granted, provided that this notice
  is preserved.

          *       *       *       *       *       *       *

  Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

  Developed at SunPro, a Sun Microsystems, Inc. business.
  Permission to use, copy, modify, and distribute this
  software is freely granted, provided that this notice
  is preserved.

          *       *       *       *       *       *       *

  FIXME: Cephes math lib
  Copyright (C) 1984-1998 Stephen L. Moshier

  It sounds vague, but as to be found at
  <http://lists.debian.org/debian-legal/2004/12/msg00295.html>, it gives an
  impression that the author could be willing to give an explicit
  permission to distribute those files e.g. under a BSD style license. So
  probably there is no problem here, although it could be good to get a
  permission from the author and then add a license into the Cephes files
  in MinGW runtime. At least on follow-up it is marked that debian sees the
  version a-like BSD one. As MinGW.org (where those cephes parts are coming
  from) distributes them now over 6 years, it should be fine.

  =================================================
  Some string, memory and time conversion functions
  =================================================

  Copyright © 2005-2020 Rich Felker, et al.

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  ===================================
  Headers and IDLs imported from Wine
  ===================================

  Some header and IDL files were imported from the Wine project. These files
  are prominent maked in source. Their copyright belongs to contributors and
  they are distributed under LGPL license.

  Disclaimer

  This library is free software; you can redistribute it and/or
  modify it under the terms of the GNU Lesser General Public
  License as published by the Free Software Foundation; either
  version 2.1 of the License, or (at your option) any later version.

  This library is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
  Lesser General Public License for more details.
  ```
- **winpthreads** (MIT, with parts BSD-3-Clause), linked into the Windows
  ffmpeg and ffprobe and the Windows LOOM tools. Its `COPYING`, verbatim, identical at commit
  `9c1abbbf55`:

  > Copyright (c) 2011 mingw-w64 project
  >
  > Permission is hereby granted, free of charge, to any person obtaining a
  > copy of this software and associated documentation files (the "Software"),
  > to deal in the Software without restriction, including without limitation
  > the rights to use, copy, modify, merge, publish, distribute, sublicense,
  > and/or sell copies of the Software, and to permit persons to whom the
  > Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  > FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
  > DEALINGS IN THE SOFTWARE.
  >
  >
  > /*
  >  * Parts of this library are derived by:
  >  *
  >  * Posix Threads library for Microsoft Windows
  >  *
  >  * Use at own risk, there is no implied warranty to this code.
  >  * It uses undocumented features of Microsoft Windows that can change
  >  * at any time in the future.
  >  *
  >  * (C) 2010 Lockless Inc.
  >  * All rights reserved.
  >  *
  >  * Redistribution and use in source and binary forms, with or without modification,
  >  * are permitted provided that the following conditions are met:
  >  *
  >  *
  >  *  * Redistributions of source code must retain the above copyright notice,
  >  *    this list of conditions and the following disclaimer.
  >  *  * Redistributions in binary form must reproduce the above copyright notice,
  >  *    this list of conditions and the following disclaimer in the documentation
  >  *    and/or other materials provided with the distribution.
  >  *  * Neither the name of Lockless Inc. nor the names of its contributors may be
  >  *    used to endorse or promote products derived from this software without
  >  *    specific prior written permission.
  >  *
  >  * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AN
  >  * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  >  * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
  >  * IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT,
  >  * INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
  >  * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  >  * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
  >  * LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
  >  * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
  >  * OF THE POSSIBILITY OF SUCH DAMAGE.
  >  */
- **bzip2** (libbzip2 1.0.8), linked into the Windows LOOM tools. Its
  `LICENSE`, verbatim from the 1.0.8 release tarball but for trailing
  spaces and one e-mail address this public repository does not reproduce:

  ```text
  This program, "bzip2", the associated library "libbzip2", and all
  documentation, are copyright (C) 1996-2019 Julian R Seward.  All
  rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

  1. Redistributions of source code must retain the above copyright
     notice, this list of conditions and the following disclaimer.

  2. The origin of this software must not be misrepresented; you must
     not claim that you wrote the original software.  If you use this
     software in a product, an acknowledgment in the product
     documentation would be appreciated but is not required.

  3. Altered source versions must be plainly marked as such, and must
     not be misrepresented as being the original software.

  4. The name of the author may not be used to endorse or promote
     products derived from this software without specific prior written
     permission.

  THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS
  OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
  WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
  DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
  DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE
  GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
  WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
  NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
  SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

  Julian Seward, [address omitted]
  bzip2/libbzip2 version 1.0.8 of 13 July 2019
  ```
- **zlib**, linked into the Windows FFmpeg and LOOM binaries. Its licence
  asks for no notice in a binary; its terms are in `zlib.h` and `LICENSE`
  inside the release tarball attached with each release's sources.
- **FigUI3 core, Phosphor Icons and react-colorful** (MIT): the kit and the
  picker are compiled into the interface and the icons are inlined into it,
  so no licence file reaches the built app on its own; this file, which the
  installed app ships and Settings › Licences opens, carries the notices
  instead. All three are build-time dependencies on purpose: the packager
  copies every production dependency whole, and in the kit's case the
  package's other half is not ours to ship.

  > FigUI3 core: Copyright (c) 2026 Rogie King
  >
  > Phosphor Icons: Copyright (c) 2023 Phosphor Icons
  >
  > react-colorful: Copyright (c) 2020-present Vlad Shilov
  >
  > Permission is hereby granted, free of charge, to any person obtaining a
  > copy of this software and associated documentation files (the
  > "Software"), to deal in the Software without restriction, including
  > without limitation the rights to use, copy, modify, merge, publish,
  > distribute, sublicense, and/or sell copies of the Software, and to
  > permit persons to whom the Software is furnished to do so, subject to
  > the following conditions: The above copyright notice and this
  > permission notice shall be included in all copies or substantial
  > portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT
  > WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  > THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  > NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
  > LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  > OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
  > WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
- **The Python runtime's libraries and CPython's incorporated software**:
  the texts are files rather than quotations here, in `python/licenses/`
  inside the app's resources, which Settings › Licences shows (ADR-042).
- **Electron** (MIT). Its `LICENSE`, verbatim, which the installers also
  carry as `LICENSE.electron.txt`:

  > Copyright (c) Electron contributors
  >
  > Copyright (c) 2013-2020 GitHub Inc.
  >
  > Permission is hereby granted, free of charge, to any person obtaining
  > a copy of this software and associated documentation files (the
  > "Software"), to deal in the Software without restriction, including
  > without limitation the rights to use, copy, modify, merge, publish,
  > distribute, sublicense, and/or sell copies of the Software, and to
  > permit persons to whom the Software is furnished to do so, subject to
  > the following conditions:
  >
  > The above copyright notice and this permission notice shall be
  > included in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
  > EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  > MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
  > NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
  > LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
  > OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
  > WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
- **Esri Calcite UI icons**: inside the engine's page only, redistributed
  without modification, with this notice, which the engine keeps beside the
  files:

  > COPYRIGHT Esri. All rights reserved under the copyright laws of the United
  > States and applicable international laws, treaties, and conventions. This
  > material is licensed for use under the Esri Master License Agreement (MLA).
  > You may redistribute and use this code without modification, provided you
  > adhere to the terms of the MLA and include this copyright notice.
- **Transit data**: maps made with the app derive from each agency's
  published feed and remain subject to that agency's terms. The app does not
  redistribute feeds.
