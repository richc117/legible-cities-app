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
| Esri Calcite UI icons | View-switcher icons inside the engine's animation page; redistributed **unmodified** as the licence requires | Esri Master License Agreement | https://github.com/Esri/calcite-ui-icons |
| FFmpeg (planned) | Encoding MP4 and GIF exports; a GPL build because it links x264 | GPL-2.0-or-later (this build; LGPL-2.1-or-later without `--enable-gpl`) | https://git.ffmpeg.org/ffmpeg.git |
| x264 (planned) | H.264 encoder linked into the FFmpeg build | GPL-2.0-or-later | https://code.videolan.org/videolan/x264 |
| Electron | Application shell; includes Chromium and Node.js under their own licences. Pinned in `package.json` | MIT | https://www.electronjs.org/ |
| React | User interface | MIT | https://react.dev/ |
| electron-vite, Vite, Vitest, Playwright, TypeScript, ESLint, Prettier, electron-builder | Development tooling: build, test, style. Present in the repository, not shipped in the app | MIT (electron-vite, Vite, Vitest, ESLint, Prettier, electron-builder); Apache-2.0 (Playwright, TypeScript) | package.json |
| python-build-standalone (planned; ADR-020) | The bundled Python interpreter, pinned by release and by a checksum this repository records in `vendor/pins.json`, stripped after install | PSF-2.0 (CPython); MPL-2.0 (the project's build code); bundled libraries under their own licences. The runtime's own `licenses/` directory and manifest ship inside it and are referenced from the app's Licences screen. Verified 2026-09-07: the interpreter links libedit, not GNU readline, and no GDBM; `vendor.yml` fails the build if either appears | https://github.com/astral-sh/python-build-standalone |
| PyInstaller (measured, not chosen: ADR-020) | Was the alternative way to bundle the interpreter; not used and not shipped | GPL-2.0-or-later with the bootloader exception | https://pyinstaller.org/ |
| pandas (planned) | GTFS tables in the engine | BSD-3-Clause | https://pandas.pydata.org/ |
| NumPy (planned) | Dependency of pandas | BSD-3-Clause | https://numpy.org/ |
| requests (planned) | Feed download in the engine | Apache-2.0 | https://requests.readthedocs.io/ |
| vscode-jsonrpc (planned) | JSON-RPC over stdio, app side | MIT | https://github.com/microsoft/vscode-languageserver-node |
| python-lsp-jsonrpc (planned) | JSON-RPC over stdio, engine side | MIT | https://github.com/python-lsp/python-lsp-jsonrpc |
| react-colorful (planned) | Colour picker | MIT | https://github.com/omgovich/react-colorful |
| Spec Kit | Spec templates, scripts and agent skills, committed under `.specify/` and `.claude/skills/speckit-*`. Development tooling: present in this repository, not shipped in the app | MIT | https://github.com/github/spec-kit |
| Contributor Covenant 2.1 | The code of conduct text | CC BY 4.0 | https://www.contributor-covenant.org/ |

## Obligations we take on

- **GPL components** (LOOM, FFmpeg with x264, the engine): each release
  attaches source archives for the exact versions it bundles, beside the
  binaries, together with the build scripts and the FFmpeg configure line
  used. The installed app ships `LICENSE` and this file and shows them in
  its Licences screen.
- **Esri Calcite UI icons**: redistributed without modification, with this
  notice, which the engine also keeps beside the files:

  > COPYRIGHT Esri. All rights reserved under the copyright laws of the United
  > States and applicable international laws, treaties, and conventions. This
  > material is licensed for use under the Esri Master License Agreement (MLA).
  > You may redistribute and use this code without modification, provided you
  > adhere to the terms of the MLA and include this copyright notice.
- **Transit data**: maps made with the app derive from each agency's
  published feed and remain subject to that agency's terms. The app does not
  redistribute feeds.
