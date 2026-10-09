# Sample city thumbnails

A small picture of every sample city's map, once in each of the interface's
two palettes, for the desktop app's front door. The app never draws a map, so
these are the engine's.

- Engine: 0.12.0
- LOOM commit: not recorded (the host did not name it)
- Made on: 2026-10-08
- Files: 44
- Total size: 619102 bytes (the pictures; this file is not counted)

Each is `<key>-dark.svg` or `<key>-light.svg`. A picture is the network alone,
about 400 units wide: no labels, no ground, in the feed's own line colours and
the engine's own line order, with every colour a literal so that it holds up
inside an `<img>`. It is drawn from the layout the feed names at this LOOM, so
it is a picture of that layout and not a layout: a later engine, LOOM or feed
leaves it showing the earlier map until the script is run again.

## No picture

None: every preset has one.

## Making them again

From a checkout of the engine at the tag the app pins, with the sample feeds
downloaded and laid out at the LOOM it pins (`bin/run-all` does both):

    bin/thumbnails <folder>

It reads the stored layouts and makes none, and it writes these files into the
folder, which it creates if it is missing. It removes a picture an earlier run
left there for a preset that now has none, so the folder says what this file
says. The SVGs carry no date, so a second run over the same layouts changes the
date in this file and nothing else.
