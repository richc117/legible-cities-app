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

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Issues are the unit of work; every
feature starts as a spec with acceptance criteria. Please read the
[code of conduct](CODE_OF_CONDUCT.md) and, before pushing, run
`bin/preflight`, which refuses personal paths, addresses and keys.

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
