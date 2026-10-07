# ADR-052: A caption, the clock's corner, and the safe zones as data

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

`ExportOptions` has `title` (a boolean: the city and the network), `clock` (a boolean) and `tag` (a filename suffix), and no free text. The page draws the overlay by its own CSS: the name block top-left, the time bottom-right (`page.html:274–277`). The bundled ffmpeg cannot draw text; every word in an export is drawn by the page and captured (engine issue #40).

**A caption is a person's text.** E17 escaped the feed's text the page embeds; a caption is set as text or it is the same fault.

**The page's safe-zone overlay is stale.** `Preset.safe_zones` is true for `instagram-story`, `instagram-reel` and `instagram-reel-gif`, and under `?safe=1` `present.js` draws three boxes: 12% top, 22% bottom, and a rail 18% wide from 40% to 78% down. Meta's current Reels template, as traced by Cadenus (July 2026, read raw): "keep 270 pixels clear at the top, 672 at the bottom and 64 on each side — and note the bottom-right corner, where the button rail extends the clear area to 227 pixels from the right edge." For Stories: "roughly the top 14 percent (about 270 pixels) and the bottom 20 percent (about 385 pixels)". The page's bottom zone is 22% where Reels' is 35%; a caption placed by the overlay lands under Instagram's own.

**The top gutter is where a caption fits.** On a portrait frame around a wide network, `frame_top` 0.46 puts nearly half the padding above the network, under the title; Instagram's top 14% is the only part of it that is spoken for.

## Options

Caption: **(a)** on the page's address, as the title is; **(b)** rendered into the SVG by the engine. The page already draws every word.

Clock: **(a)** four corners; **(b)** free coordinates. Corners are what presets and safe zones can reason about.

Zones: **(a)** numbers in `present.js`; **(b)** a table in `export.py` that the plan passes to the page; **(c)** both, which drift.

## Decision

(a), (a), (b). `ExportOptions.caption` is a string of at most 80 characters with no line break, drawn by the page as text (`textContent`, never markup) under the title in the overlay's name block, in both themes; at 1,080 wide that is two lines at the overlay's size, and the bound is this project's, not a platform's. `ExportOptions.clock_corner` is `top-left | top-right | bottom-left | bottom-right`, default `bottom-right`, where the clock sits today, so an export that asks for nothing keeps its pixels; on a `safe_zones` preset the default is `top-right`, and there `bottom-right` is refused with a sentence naming the rail, and `bottom-left` adds a note. Both travel on the page's address and are echoed in `CaptureJob`, so the app's preview and the file agree. The safe zones become a table in `export.py`, per platform, as fractions of the frame with the date they were measured: Reels top 0.14, bottom 0.35, sides 0.06, a rail 0.21 of the width in the lower right; Stories bottom 0.20. The rail's vertical extent is taken from Meta's file when the table is written (a summariser reported it starting about 1,150 px down; unverified). The plan writes the zones onto the address and the page draws what it is given, so the overlay has one source, and a test pins the numbers.

## Consequences

**Schema moves with v0.12.0.** Page work in `present.js` and `page.html`.

**The overlay stops understating the bottom zone**, and the `-safe` preview file changes.

**As of 6 Oct 2026, a correction of premise.** The record as first written said the clock sat top-right; it sits bottom-right (`page.html:274–277`). The default corner therefore follows the clock, and the reel's and story's clock moves to the top-right out from under the platform's rail on purpose; nothing else moves.

**Nothing moves for an export that asks for neither.** An omitted caption and the default corner give today's pixels; the determinism fixture is unchanged.

**A caption is not alt text.** The sidecar's alt is ADR-independent and #41's.

**What to watch.** Meta moving its zones: the table carries a date. TikTok has no preset; if one comes, it is a row in the table, not a number in the page.
