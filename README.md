# Legible Cities

A desktop app for macOS and Windows that turns a public transit timetable
(a GTFS feed) into a schematic map and a timetable-driven animation, and
exports them as stills, reels and GIFs. It is the
[Legible Cities](https://richc117.github.io/legible-cities/) pipeline behind a
window, for people who do not use a terminal.

**Status: pre-alpha.** This repository currently holds its charter: licence,
contribution guide, templates and the decision-record conventions. There is
no application to build yet. Work proceeds through the issues and milestones
on this repository; Phase 0 is spikes and scaffolding.

## What it will do

1. **Add a feed** from a file, a URL or a built-in list of networks.
2. **Inspect it**: routes, agencies, service window, and the network drawn
   where it really runs.
3. **Schematise** it with one button.
4. **Style** the lines: colours, order, theme.
5. **Export** for Instagram, LinkedIn, Bluesky and a portfolio, using the
   export presets the engine already defines.

## How it is built

- An [Electron](https://www.electronjs.org/) shell (React, TypeScript).
- The existing Python engine, [`legible-cities`](https://github.com/richc117/legible-cities),
  bundled as a sidecar and driven over JSON-RPC on stdio. The engine is the
  source of truth: it emits a self-contained HTML animation page, and the app
  shows that page rather than drawing a map of its own.
- [LOOM](https://github.com/ad-freiburg/loom), the schematisation suite from
  the University of Freiburg, as native binaries built in CI.
- A bundled FFmpeg for encoding.

The founding decisions (the shell, the engine boundary, the licence, native
LOOM, bundled FFmpeg, the page as viewer) were made before this repository
existed and are being written up as its first decision records under
`docs/adr/`; see the README there for the convention.

## Developing

The skeleton runs today: one window, an empty Library, the `app://local`
origin, and a check on three platforms. It draws no map and runs no engine
yet; `docs/ARCHITECTURE.md` says what exists and what each later issue adds.

You need Node.js 22 or later. Optionally, for the development loop and the
tokens test, check out the engine beside this repository and point
`LEGIBLE_ENGINE_CHECKOUT` at it in `.env.local`:

```
cp .env.example .env.local        # then edit; the file is gitignored
npm ci
npx install-electron --no         # the Electron binary is fetched separately since Electron 42
npm run dev                       # the window; interface edits hot-reload
```

The terminal shows the three configured locations and their sources before
the window opens. The checks, which `.github/workflows/ci.yml` runs on
Ubuntu, macOS and Windows for every change:

```
npm run lint          # eslint and prettier
npm run typecheck     # tsc, both projects
npm test              # vitest: path validation, configuration, tokens drift
npm run build         # electron-vite build into out/
npm run test:e2e      # Playwright launches the built app and quits it
```

On Linux the last one needs a display server: `xvfb-run -a npm run test:e2e`.
`specs/001-electron-skeleton/quickstart.md` walks through what each run
proves.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues are the unit of work; every
feature starts as a spec with acceptance criteria. Please read the
[code of conduct](CODE_OF_CONDUCT.md), and run `pre-commit install` once in
your checkout so that `gitleaks` and `bin/preflight` see every commit: this
is a public repository, and they refuse keys, personal paths and addresses
before those become history.

## Licence

Copyright (C) 2026 Richard Caballero.

The code in this repository is free software: you can redistribute it and/or
modify it under the terms of the [GNU General Public License](LICENSE) as
published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version. Third-party components
and their licences are listed in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Maps made with the app
derive from each transit agency's published feed and remain subject to that
agency's terms.

## Credits

Built by Richard Caballero. Schematisation by
[LOOM](https://github.com/ad-freiburg/loom) (University of Freiburg,
GPL-3.0). The view-switcher icons inside the engine's animation page are Esri's
Calcite UI icons, redistributed unmodified under Esri's licence. Transit data comes from the
agencies that publish it.
