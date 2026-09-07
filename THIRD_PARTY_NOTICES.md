# Third-party notices

The app is licensed under the GNU General Public License v3.0 or later (see
`LICENSE`). It is built from, and will ship with, the components below. Each
keeps its own licence; the table is kept current as components are added or
removed. **Nothing is bundled yet**; the rows marked "planned" describe the
intended build.

| Component | Role | Licence | Source |
|---|---|---|---|
| LOOM (planned) | Schematisation: `gtfs2graph`, `topo`, `loom`, `octi`, shipped as native binaries built in this repository's CI from a pinned commit | GPL-3.0 | https://github.com/ad-freiburg/loom |
| LOOM Windows compatibility patches (planned) | Building LOOM under MSYS2 on Windows | GPL-3.0 | https://github.com/transportforcairo/loom-windows-port |
| `legible-cities` engine (planned) | The Python pipeline: feeds, rendering, scheduling, animation, export | To be released under GPL-3.0-or-later; its repository does not yet carry a licence file, and nothing is bundled until it does | https://github.com/richc117/legible-cities |
| Esri Calcite UI icons | View-switcher icons inside the engine's animation page; redistributed **unmodified** as the licence requires | Esri Master License Agreement | https://github.com/Esri/calcite-ui-icons |
| FFmpeg (planned) | Encoding MP4 and GIF exports; a GPL build because it links x264 | GPL-2.0-or-later (this build; LGPL-2.1-or-later without `--enable-gpl`) | https://git.ffmpeg.org/ffmpeg.git |
| x264 (planned) | H.264 encoder linked into the FFmpeg build | GPL-2.0-or-later | https://code.videolan.org/videolan/x264 |
| Electron (planned) | Application shell; includes Chromium and Node.js under their own licences | MIT | https://www.electronjs.org/ |
| React (planned) | User interface | MIT | https://react.dev/ |
| python-build-standalone (candidate, pending a spike) | The bundled Python interpreter | PSF-2.0 (CPython); MPL-2.0 (the project's build code); bundled libraries under their own licences, listed in each archive's `PYTHON.json` and `licenses/` directory. A 2023-or-later release is required so that no GPL readline or GDBM is linked | https://github.com/astral-sh/python-build-standalone |
| PyInstaller (candidate, pending a spike) | Alternative way to bundle the interpreter | GPL-2.0-or-later with the bootloader exception | https://pyinstaller.org/ |
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
