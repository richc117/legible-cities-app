# Third-party notices

The app is licensed under the GNU General Public License v3.0 or later (see
`LICENSE`). It is built from, and ships with, the components below. Each
keeps its own licence; the table is kept current as components are added or
removed. **The installers `.github/workflows/build.yml` makes are test
builds until a release** (ADR-035), though as artefacts of this public
repository they are downloadable for 30 days, and so conveyed. They bundle
the runtime, the engine, LOOM and ffmpeg for their target and carry
`LICENSE` and this file beside them. `vendor-manifest.json` inside the app
records each component's pin: the runtime's release, asset and checksum,
the engine's tag, the name and version of every Python package installed
in the runtime, LOOM's commit (and the Windows port's), and FFmpeg's
version and configure line with the checksums of the FFmpeg, x264 and
(on Windows) zlib sources it was built from. It does not record the
versions of the libraries linked into the Python runtime and wheels. The
ffmpeg they carry is built in this repository (ADR-040), and the GPL
sources are attached with the release (A6-01).

| Component | Role | Licence | Source |
|---|---|---|---|
| LOOM | Schematisation: `gtfs2graph`, `topo`, `loom`, `octi`, native binaries built in this repository's CI from the commit pinned in `vendor/pins.json`, and bundled under `loom/` in the app's resources | GPL-3.0 | https://github.com/ad-freiburg/loom |
| LOOM Windows compatibility changes, by Transport for Cairo | Building LOOM under MSYS2 on Windows. At build time the vendor workflow takes `win_compat.h` and five `cppgtfs` files (the `timezone` identifier rename) from the port at the commit pinned in `vendor/pins.json`, and applies the port's other documented changes to our own tree with `scripts/loom-windows-patch.py`. Shims only; the port states, and our parity check assumes, no change to LOOM's algorithms | GPL-3.0 | https://github.com/transportforcairo/loom-windows-port |
| `legible-cities` engine | The Python pipeline: feeds, rendering, scheduling, animation, export | GPL-3.0-or-later: the pinned tag carries the GPL-3.0 text as `LICENSE` and declares it in `pyproject.toml` (`license-files`). Installed into the bundled runtime at the tag in `vendor/pins.json`, its licence in its `.dist-info` | https://github.com/richc117/legible-cities |
| Esri Calcite UI icons | Four view-switcher icons inside the engine's animation page, which the app embeds; the engine redistributes them **unmodified** with the agreement's notice, and its issue E16 replaces them with Phosphor (ADR-026). The app's own tree carries none | Esri Master License Agreement | https://github.com/Esri/calcite-ui-icons |
| FigUI3 core | The interface's control kit: `fig.css` and `fig.js` of `@rogieking/figui3` **9.0.0**, pinned exactly. The package is split-licensed and its `package.json` says only "SEE LICENSE IN LICENSE": the core is MIT; the editor and lab bundles are PolyForm Shield 1.0.0 and are never imported (the build refuses them, `scripts/figui-guard.ts`; ADR-026). The core vendors `@ungap/custom-elements-builtin` (ISC) | MIT (core); ISC (the vendored polyfill) | https://github.com/rogie/figui3 |
| Phosphor Icons | The interface's icons, vendored unmodified from `@phosphor-icons/core` **2.1.1** under `src/renderer/src/icons/phosphor/` with the licence beside them; the light weight at 16px, the regular at 24px, the fill weight for toggled states | MIT | https://github.com/phosphor-icons/core |
| FFmpeg (ADR-012, ADR-040) | Encoding MP4 and GIF exports, bundled under `ffmpeg/` in the app's resources: `ffmpeg` and `ffprobe` of **FFmpeg 9.0.1**, built in this repository by `scripts/vendor-ffmpeg.sh` in the `ffmpeg` jobs of `.github/workflows/vendor.yml`, natively on each target, from the release tarball pinned by URL and sha256 in `vendor/pins.json`, and proven by the same script before it is vendored. Configured `--enable-gpl --enable-version3` with `--disable-everything --disable-autodetect --disable-network`, and only the codecs, formats, filters and protocols the engine's export uses enabled back; the configure line of every target is in the pins and printed by `ffmpeg -version`. The only external libraries are x264 and zlib (the operating system's on macOS; linked statically on Windows), and the vendor jobs refuse any other. **No freetype, fontconfig, HarfBuzz, libass, libdvdread or libdvdcss**: the export needs none, because the page draws every word in it. The vendor job also builds a Linux x64 binary for tests, and neither ships nor uploads it. Patent licensing for H.264 and AAC encoders is not assessed in this repository | GPL-3.0-or-later (`--enable-gpl --enable-version3`) | https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz (tag `n9.0.1`, commit `bf1b838f2a`), and the `ffmpeg-source` artefact on each release |
| x264 | H.264 encoder statically linked into both FFmpeg binaries on every target: commit `0480cb05fa`, pinned with the sha256 of its `git archive` tar in `vendor/pins.json`, configured 8-bit 4:2:0 without its command-line tool, OpenCL or input libraries | GPL-2.0-or-later | https://code.videolan.org/videolan/x264, and the `ffmpeg-source` artefact on each release |
| zlib | Compression for FFmpeg's PNG encoder and decoder. Linked statically into the Windows binaries from the **1.3.2** release tarball pinned in `vendor/pins.json`; on macOS FFmpeg links the operating system's `/usr/lib/libz.1.dylib`, which is not shipped | Zlib | https://github.com/madler/zlib, and the `ffmpeg-source` artefact on each release |
| GCC runtime library and mingw-w64 runtime | Linked statically into the Windows FFmpeg binaries by MSYS2 UCRT64's GCC, as into every MinGW executable: GCC's `libgcc` and mingw-w64's CRT startup code and import libraries. The binaries import only Windows' own DLLs, the Universal CRT among them, which the vendor job checks | GPL-3.0-or-later WITH GCC-exception-3.1 (libgcc); ZPL-2.1, MIT and public domain (mingw-w64's runtime) | https://gcc.gnu.org/ and https://www.mingw-w64.org/ |
| Electron | Application shell; includes Chromium and Node.js under their own licences. Pinned in `package.json` | MIT | https://www.electronjs.org/ |
| React | User interface | MIT | https://react.dev/ |
| electron-vite, Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, electron-builder | Development tooling: build, test, style. Present in the repository, not shipped in the app | MIT (electron-vite, Vite, Vitest, ESLint, Prettier, electron-builder); Apache-2.0 (Playwright, TypeScript) | package.json |
| python-build-standalone (ADR-020, ADR-038) | The bundled Python interpreter, under `python/` in the app's resources: pinned by release and by a checksum this repository records in `vendor/pins.json`, stripped after install, its bytecode compiled at build (ADR-035) | PSF-2.0 (CPython); MPL-2.0 (the project's build code); bundled libraries under their own licences. CPython's `LICENSE.txt` ships inside it; the `install_only` asset this project pins carries no `licenses/` folder for the libraries python-build-standalone links statically (that is in the full archive), so those notices are owed by the Licences screen and the release (ADR-035). Verified 2026-09-07: the interpreter links libedit, not GNU readline, and no GDBM; the Windows asset, listed 2026-09-12, carries no readline and no `_dbm` or `_gdbm` extension at all; `vendor.yml` fails the build if either appears by file name on all three targets, and on the two macOS targets also if any Mach-O in the runtime links a library named for readline or gdbm, or `libpython` defines readline's symbols itself; Windows is checked by name only | https://github.com/astral-sh/python-build-standalone |
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

- **GPL components** (LOOM, FFmpeg with x264, the engine): each release
  attaches source archives for the exact versions it bundles, beside the
  binaries, together with the build scripts and the FFmpeg configure line
  used. The installed app ships `LICENSE` and this file and shows them in
  its Licences screen. FFmpeg is built in this repository (ADR-040), so its
  Corresponding Source is FFmpeg's release tarball, x264 at its pinned
  commit, zlib's release tarball for the Windows binaries, and
  `scripts/vendor-ffmpeg.sh` with every configure line: the vendor workflow
  that builds the binaries uploads exactly those, verified against the
  pins, as the `ffmpeg-source` artefact of the same run, with a `BUILD.txt`
  naming the repository commit, and A6-01 attaches that artefact to each
  release. The manifest names the same sources by hash.
- **FigUI3 core, Phosphor Icons and react-colorful** (MIT): the kit and the
  picker are compiled into the interface and the icons are inlined into it,
  so no licence file reaches the built app on its own; this file, which the
  installed app ships and its Licences screen shows, carries the notices
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
