# Changelog

What changed in each version of Legible Cities that a person can install.
The format is [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
Each release's notes on the Releases page are filled from its section here;
[`docs/releasing.md`](docs/releasing.md) says how. Beside Keep a Changelog's
headings, every section carries Known issues, which may say "None.", and
links are inline, with no images and no reference-style links.

## [Unreleased]

## [1.0.0]

### Added

- Cell 02 has **Layout tuning**: LOOM's own settings for laying a project
  out, such as the merge distance and the grid size.
- Cell 01 draws each stage of the layout as the run reaches it.
- Cell 03 plans a **Trip**: choose where it starts and ends, and it lists
  the steps between them and shows the trip on the map.
- Cell 04 has the map's sizes as numeric fields, looks, marker shapes, the
  trains and the label typeface. A map's theme is chosen by its picture.
- Cell 05 has options for each line: its name, whether it is shown, and
  its width, casing and dash.
- Cell 06 can open an export on a title card with the network drawing in,
  and adds a caption, the clock's corner and an alt text.
- The geographic view has buttons to pan, zoom and fit, and the network is
  described in words beside it.
- The Library's cards show a picture of each map.
- Settings shows the app's version, as do the diagnostics and, on a Mac,
  the About box. A release candidate says which one it is
  ("1.0.0-rc.2"), and a build that is not a release names its commit.
- The window opens where you left it, on a display that is still attached.
- Each installer and `SHA256SUMS.txt` has a signed attestation, which
  [the install guide](docs/install.md#check-who-built-it-optional) shows how
  to check.
- The install guide has a troubleshooting section, and
  [`SUPPORT.md`](SUPPORT.md) says where to ask for help.
- The app has its own menu, with Settings, New project and a Help menu
  that opens the guides and the form for reporting a problem. A release has
  no Reload and no developer tools.
- **Put back** stands beside the three resets (every line's colour, the
  map's sizes and the layout tuning) and undoes the reset in one step.
- Before a second export of the same preset, cell 06 says which file it
  will replace and that a filename tag keeps both.
- [What 1.0 keeps](docs/compatibility.md) says which of your files a later
  1.x will still read.

### Changed

- The engine that draws the maps moves from v0.10.1 to v0.21.1. The first
  time you open a project that has a map, the map is drawn again from the
  project's stored layout, so its stations do not move, though the names
  on it may be placed differently.
- A project 1.0 redraws or you change opens read-only in 0.1.0.
  [Updating from an earlier release](docs/install.md#updating-from-an-earlier-release)
  says how to keep a copy you can go back to.
- A GIF's colours are chosen from the map it shows.
- A message that refuses something now starts with what to do about it.
- A screen reader hears an export's progress by stage.
- Cell 03 is called **Day**, and its name is no longer cut short in the
  rail.
- The forced layout is **Lay out from scratch…**, beside **Lay out again**;
  presets are named by platform and what they make ("LinkedIn square GIF");
  days are written out ("17 September 2026"); and a project whose cells are
  all ready says "map drawn from every cell".

### Fixed

- A train follows its own line through a junction on every map.
- Quitting waits for the engine to stop, so nothing is left running.
- Moving through a project by keyboard no longer hides the focused control
  under the project's header.
- Choices made one after another in cells 04 and 05 are no longer lost.
- A screen reader announces a status sentence again when it repeats.

### Security

- A feed downloaded from an address can no longer reach this computer or
  its local network, through a redirect or through a host name that
  resolves to a local address (engine v0.21.1;
  [engine issue 90](https://github.com/richc117/legible-cities/issues/90)).

### Known issues

- The installers are not signed. macOS and Windows warn the first time you
  open the app, and again for each new version you install over it;
  [the install guide](docs/install.md) shows the way past each warning.
- The app does not check for updates, and does not tell you that a newer
  version exists. New versions are on the
  [Releases page](https://github.com/richc117/legible-cities-app/releases):
  install one over the old one.
- An export's frame cannot be cropped or rotated. The map is padded to the
  preset's shape and never cropped, so no station is cut off.

## [0.1.0] - 2026-10-08

### Added

- The first release, for macOS and Windows. The Library lists your
  projects, the sample cities and your feeds. A project is a notebook of six
  cells, from the feed to the export, with the map between cells 02 and 03,
  and it exports stills, reels and GIFs.

### Known issues

- The installers are not signed, and macOS and Windows warn the first time
  you open the app.
- The app does not check for updates.

[Unreleased]: https://github.com/richc117/legible-cities-app/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/richc117/legible-cities-app/releases/tag/v0.1.0
