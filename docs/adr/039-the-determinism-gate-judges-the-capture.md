# ADR-039: The determinism gate judges the capture, and the file for its structure

- **Status:** Accepted
- **Date:** 2026-09-12
- **Supersedes:** none
- **Superseded by:** none

## Context

Principle III of the constitution says that two exports of the same project
agree within the published threshold - RGB, a channel tolerance of 8 - and
that a test says so. A5-04 is that test: the committed BART fixture exported
twice through the Export tab, as a draft `instagram-reel-gif`, against the
real engine and the vendored ffmpeg, on three platforms
(`tests/e2e/determinism.spec.ts`, `.github/workflows/determinism.yml`).

The first version compared the two delivered GIFs, and it failed most of the
time on a loaded machine. Keeping the captured frames (`LEGIBLE_KEEP_FRAMES`,
development only) showed why. At engine v0.8.2, five unaltered runs captured
frames that agreed within the tolerance every time - 108 or 93 of 108 PNG
files byte-identical, the rest below 8 - while four of the five GIF pairs
differed past it in all 108 frames, by up to 221 levels. The engine's GIF
encode builds one palette from every captured frame
(`palettegen=stats_mode=diff`), so differences below the tolerance move
palette entries, and with them colours in every frame. ffmpeg is not the
cause: the same commands on one folder of frames are byte-identical run to
run, concurrently and single-threaded. **The delivered GIF provably does not
preserve the tolerance** (engine issue 33).

The capture does, with one exception. At engine v0.8.3, twelve of thirteen
unaltered runs passed on the captured frames; one, under load, captured one
frame over 8 (app issue 100). And the capture verdict does not catch
everything the rules name: a page whose clock is never stopped fails it, from
either side of `setCapture`, but removing the paint wait before each capture
passed three runs of three.

`docs/ARCHITECTURE.md`, "The capture", has every number.

## Options

**Judge the GIFs, as principle III's wording reads.** The gate would be red
on most runs for a reason the app cannot fix, and a gate that is usually red
is ignored, which is worse than none.

**Loosen the GIF comparison** - a higher tolerance, or a preset without a
per-file palette. The first abandons the published threshold; the second
stops testing the export a person makes. Both were ruled out.

**Judge the captured frames at the tolerance, and check the file for its
structure.** The capture is the app's half of an export and the render
principle III is about; the file's structure - both there, the preset's
size, the captured number of frames, not trivially small, moving - is what
the app can promise of the engine's encode until the engine fixes it. It
leaves the delivered file's pixels unjudged, and says so.

**Wait for the engine.** Nothing would guard the capture meanwhile, and the
capture is where the app's own determinism rules live.

## Decision

The maintainer's: the determinism gate judges the captured frames - the same
number, each the preset's size, every frame within a channel tolerance of 8
in RGB, and the first and last differing past it - and checks the delivered
file for structure only, reporting its pixel comparison without asserting
it, until engine issue 33 is fixed. The layout checks, and the checks that
the engine received two `export.encode` and no `graph.build`, stand as they
are. When issue 33 is fixed, the file's pixels return to the verdict and
this record is superseded.

## Consequences

- **A5-04's criteria are met for the capture and not for the delivered
  file.** "The same export twice agrees within the pixel threshold" holds of
  what the app captured; of the GIF a person receives, it does not yet hold,
  and the test says so in its log and its report rather than in its verdict.
- **The paint-wait rule is untested** (app issue 100). Removing it passed the
  capture verdict three times of three, so a regression there would not turn
  the gate red. The rule stays in the code and in `.claude/rules/main.md`;
  a test that catches it is issue 100's to find.
- **The gate can go red rarely, and correctly.** One unaltered run of
  thirteen, under load, captured a frame from the wrong paint. That is a
  real defect in the capture (issue 100), not noise to retry away; the
  workflow keeps the per-frame report from every run so how often it
  happens is visible.
- The test depends on a development-only hook, `LEGIBLE_KEEP_FRAMES`, which a
  packaged app ignores (`keptFramesFolder` in `src/main/export.ts`).
- Windows layout determinism, which ADR-021 expected A5-04 to measure, is
  still unmeasured: the test reads a stored layout and never runs LOOM
  (ADR-023).
