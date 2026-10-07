# ADR-055: A GIF export takes a fixed palette composed from the plan

- **Status:** Proposed
- **Date:** 2026-10-06
- **Supersedes:** none
- **Superseded by:** none

## Context

A GIF export runs two ffmpeg passes: palettegen with stats_mode=diff builds a 256-entry colour table from the pixels that change between frames, then paletteuse maps every frame to it with Bayer dithering at scale 3. The table is a function of pixel statistics, so noise the constitution tolerates moves it. Measured on BART's instagram-reel-gif (108 frames at 630×1120, both themes): identical frames encode byte-identically, but a near twin, 2% of each frame's edge pixels moved by 1 to 8 per channel, moved 254 of the 256 entries and changed about 57 million pixels the two inputs agreed on, by up to 134 on a channel. One 10×10 box in one frame moved 37 entries in dark and 131 in light and changed pixels outside the box in all 108 frames. A determinism check on the delivered GIF cannot be reliable while this holds.

The measurements are on engine issue 33 (the comment of 6 Oct 2026): four
palette arms over BART's `instagram-reel-gif` frames in both themes, each
encoded from the source frames, from a near twin within tolerance 8, and
from a copy with one 10×10 box added to one frame. The arms reused the
engine's own second pass (`paletteuse=dither=bayer:bayer_scale=3`) and
changed only how the palette is made, so the measurement is of the thing
that would ship. The constitution's tolerance (RGB, 8 of 255 per channel)
is the yardstick; the app's determinism test (A5-04, ADR-039) gates on the
captured frames today and checks the delivered GIF for structure only
because of this defect.

## Options

- A, today: palettegen with stats_mode=diff, so any changed pixel can move the table (mean error 1.85 dark, 1.42 light).
- B: stats_mode=full with no reserved transparent entry, more faithful than A (1.19, 1.27), but its table still moves under sub-tolerance noise, and under the box in light.
- C: B with the palette pass reading a copy quantised to 4 bits per channel, which survives the box but not the near twin and, with the ground off the 16-step grid, doubles the error (3.01, 3.23).
- D: a fixed palette composed from the plan, no palettegen: ground, text, muted, a 16-step ground-to-text ramp, and per distinct line colour the colour, k − 1 steps toward the ground and its midpoint with the text (k = 6 to 33 colours, 3 to 59), the rest ground.

## Decision

Adopt D, with k = 6 up to 33 distinct line colours, k = 3 up to 59, and B beyond, without the guarantees below. "Within 8 in, within 8 out" is not the criterion, because no arm met it: on the near twin D's decoded frames still differ by up to 153 on a channel, at pixels near the boundary between two entries; the largest flips are blends of two line colours. What D met on BART in both themes: identical frames give byte-identical GIFs; frames within 8 give byte-identical colour tables; no pixel the inputs agree on differs in the outputs; fewer pixels differ out than in; nothing moves outside the box. It gains fidelity and halves the file: mean error 1.36 dark and 0.28 light against today's 1.85 and 1.42, worst frame 1.77 and 0.70 against 1.87 and 1.47, at 51% and 53% of today's bytes.

## Consequences

The encode's GIF branch drops palettegen: the engine writes a 16×16 RGB palette from the theme's tokens and the map's resolved line colours (zlib and struct suffice); the paletteuse pass is unchanged. The table depends on the plan, not the pixels, so it is testable without a capture: BART composes 68 distinct entries (3 + 16 + 7 × 7) and 188 ground; two encodes are byte-identical; a within-8 pair gives identical tables, no amplified pixel and no more differing pixels out than in; a one-box pair differs only inside the box. The app's determinism test can then compare the GIFs' tables and require their differing pixels to lie where the captures differ, never within 8 per pixel. GIFs halve; colours the plan does not name, such as two lines' anti-aliased overlap, take the nearest entry, costing in dark 0.5 of a level against B's worst frame.

**What this record does not settle.** The other GIF presets
(`linkedin-gif`, `bluesky-gif`, `portfolio-gif`) were not measured, nor
the issue's own failing export pair; the near twin is a harsher, synthetic
stand-in. The test bounds for fidelity (mean at most 1.5, worst frame at
most 2.0) sit just above what was measured and are to be confirmed on the
first real run. The change lands in the engine as a v0.12.0 candidate
(issue 33); the app's gate follows at the pin that carries it, and this
record becomes Accepted when both are in.
