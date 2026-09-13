# Third-party notices

The app is licensed under the GNU General Public License v3.0 or later (see
`LICENSE`). It is built from, and will ship with, the components below. Each
keeps its own licence; the table is kept current as components are added or
removed. **Nothing is bundled yet**; the rows marked "planned" describe the
intended build.

| Component | Role | Licence | Source |
|---|---|---|---|
| LOOM (planned) | Schematisation: `gtfs2graph`, `topo`, `loom`, `octi`, shipped as native binaries built in this repository's CI from a pinned commit | GPL-3.0 | https://github.com/ad-freiburg/loom |
| LOOM Windows compatibility changes, by Transport for Cairo | Building LOOM under MSYS2 on Windows. At build time the vendor workflow takes `win_compat.h` and five `cppgtfs` files (the `timezone` identifier rename) from the port at the commit pinned in `vendor/pins.json`, and applies the port's other documented changes to our own tree with `scripts/loom-windows-patch.py`. Shims only; the port states, and our parity check assumes, no change to LOOM's algorithms | GPL-3.0 | https://github.com/transportforcairo/loom-windows-port |
| `legible-cities` engine (planned) | The Python pipeline: feeds, rendering, scheduling, animation, export | To be released under GPL-3.0-or-later; its repository does not yet carry a licence file, and nothing is bundled until it does | https://github.com/richc117/legible-cities |
| Esri Calcite UI icons | Four view-switcher icons inside the engine's animation page, which the app embeds; the engine redistributes them **unmodified** with the agreement's notice, and its issue E16 replaces them with Phosphor (ADR-026). The app's own tree carries none | Esri Master License Agreement | https://github.com/Esri/calcite-ui-icons |
| FigUI3 core | The interface's control kit: `fig.css` and `fig.js` of `@rogieking/figui3` **9.0.0**, pinned exactly. The package is split-licensed and its `package.json` says only "SEE LICENSE IN LICENSE": the core is MIT; the editor and lab bundles are PolyForm Shield 1.0.0 and are never imported (the build refuses them, `scripts/figui-guard.ts`; ADR-026). The core vendors `@ungap/custom-elements-builtin` (ISC) | MIT (core); ISC (the vendored polyfill) | https://github.com/rogie/figui3 |
| Phosphor Icons | The interface's icons, vendored unmodified from `@phosphor-icons/core` **2.1.1** under `src/renderer/src/icons/phosphor/` with the licence beside them; the light weight at 16px, the regular at 24px, the fill weight for toggled states | MIT | https://github.com/phosphor-icons/core |
| FFmpeg (planned) | Encoding MP4 and GIF exports; a GPL build because it links x264 | GPL-2.0-or-later (this build; LGPL-2.1-or-later without `--enable-gpl`) | https://git.ffmpeg.org/ffmpeg.git |
| x264 (planned) | H.264 encoder linked into the FFmpeg build | GPL-2.0-or-later | https://code.videolan.org/videolan/x264 |
| Electron | Application shell; includes Chromium and Node.js under their own licences. Pinned in `package.json` | MIT | https://www.electronjs.org/ |
| React | User interface | MIT | https://react.dev/ |
| electron-vite, Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, electron-builder | Development tooling: build, test, style. Present in the repository, not shipped in the app | MIT (electron-vite, Vite, Vitest, ESLint, Prettier, electron-builder); Apache-2.0 (Playwright, TypeScript) | package.json |
| python-build-standalone (planned; ADR-020) | The bundled Python interpreter, pinned by release and by a checksum this repository records in `vendor/pins.json`, stripped after install | PSF-2.0 (CPython); MPL-2.0 (the project's build code); bundled libraries under their own licences. The runtime's own `licenses/` directory and manifest ship inside it and are referenced from the app's Licences screen. Verified 2026-09-07: the interpreter links libedit, not GNU readline, and no GDBM; the Windows asset, listed 2026-09-12, carries no readline and no `_dbm` or `_gdbm` extension at all; `vendor.yml` fails the build on all three targets if either appears | https://github.com/astral-sh/python-build-standalone |
| PyInstaller (measured, not chosen: ADR-020) | Was the alternative way to bundle the interpreter; not used and not shipped | GPL-2.0-or-later with the bootloader exception | https://pyinstaller.org/ |
| pandas (planned) | GTFS tables in the engine | BSD-3-Clause | https://pandas.pydata.org/ |
| NumPy (planned) | Dependency of pandas | BSD-3-Clause | https://numpy.org/ |
| requests (planned) | Feed download in the engine | Apache-2.0 | https://requests.readthedocs.io/ |
| vscode-jsonrpc (planned) | JSON-RPC over stdio, app side | MIT | https://github.com/microsoft/vscode-languageserver-node |
| python-lsp-jsonrpc (planned) | JSON-RPC over stdio, engine side; one of the engine's three declared dependencies, installed into the vendored runtime by `scripts/vendor-python.sh` since A0-06 | MIT | https://github.com/python-lsp/python-lsp-jsonrpc |
| ujson (planned) | Dependency of python-lsp-jsonrpc: a compiled JSON encoder and decoder, installed into the vendored runtime with it | BSD-3-Clause AND TCL (its package metadata and `LICENSE.txt`: the numeric decoder is derived from Tcl's, and portions from stringencoders are BSD-3-Clause too) | https://github.com/ultrajson/ultrajson |
| react-colorful | The colour picker in the Line colours panel (A4-01): **5.8.1**, pinned exactly, no dependencies of its own. A build-time dependency for the same reason the control kit is: the renderer's packages are bundled by Vite, and the packager copies every production dependency whole | MIT | https://github.com/omgovich/react-colorful |
| Spec Kit | Spec templates and scripts, committed under `.specify/` (its agent skills are installed outside the repository). Development tooling: present in this repository, not shipped in the app | MIT | https://github.com/github/spec-kit |
| Contributor Covenant 2.1 | The code of conduct text | CC BY 4.0 | https://www.contributor-covenant.org/ |

## Obligations we take on

- **GPL components** (LOOM, FFmpeg with x264, the engine): each release
  attaches source archives for the exact versions it bundles, beside the
  binaries, together with the build scripts and the FFmpeg configure line
  used. The installed app ships `LICENSE` and this file and shows them in
  its Licences screen.
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
