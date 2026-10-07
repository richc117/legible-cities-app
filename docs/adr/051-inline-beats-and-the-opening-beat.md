# ADR-051: A storyboard is a name or a list of beats, and the opening beat is named

- **Status:** Proposed
- **Date:** 2026-10-02
- **Supersedes:** none
- **Superseded by:** none

## Context

`STORYBOARDS` is eight named tuples of `Beat`, and `ExportOptions.storyboard` is the closed enum of their names. `Beat` is already fully expressive: seconds, view, labels, `at`, speed, sweep, hours, span, tween, with `None` inheriting from the beat before. The schema's `StoryboardBeat` already describes it, every field present and nullable, and `CaptureJob.beats` already carries resolved beats to whatever records. Only the authoring door is shut (engine issue #39).

**#31 is the same code path.** `export.plan` accepts `view` and `at` for every preset and writes both on the page's address; for a video the first beat names its own view and clock, and `beat_payload` gives an unset `tween` the value `min(secs, 1.2)`, so a reel asked for in `linear` opens on linear and morphs to the storyboard's map over 1.2 seconds. The app strips `view` and `at` from a playing preset's plan meanwhile.

**The opening beat needs `tween=0`.** Frame 0 has to already be in a view; `test_export.py` asserts it for the eight names.

**Sweeps have a readability floor.** A sweep over 60 simulated seconds per frame is reported in the plan's `notes`. The longest shipped storyboard is about 29 seconds; at 30 fps and 2x, 90 seconds is 2,700 frames.

## Options

For the door: **(a)** a `beats` parameter beside `storyboard`, two ways to say one thing; **(b)** `storyboard` is `oneOf` a name or a list.

For #31: **(1)** refuse `view` and `at` on a video preset; **(2)** let them override the opening beat.

For the alt text: name the storyboard, or describe the views visited.

## Decision

(b), (2), and describe. `ExportOptions.storyboard` becomes `oneOf [StoryboardName, array of StoryboardBeat]`: 1 to 16 beats, each 0.5 to 30 seconds, 90 seconds in all; `hours` at most 24; `speed` 0 or more; a `span` in clock order; anything else is refused with the `params` kind and a sentence naming the beat's index and the field. The first beat of a list names a `view` and has `tween` 0: a null `tween` on the first beat is read as 0 and a non-zero one is refused, because frame 0 must already be in a view; that reading belongs to an authored list and to the override rewrite below, never to `beat_payload` itself, since five of the eight named storyboards open with a null `tween` that `beat_payload` turns into `min(secs, 1.2)` and a test pins their plans. For a named storyboard given `view` or `at`, the plan rewrites the opening beat to that view and clock with `tween` 0, so the address and the first beat agree and `check_geographic` judges the rewritten beat. For a list, `view` and `at` are refused: the first beat is where they go. `CaptureJob.storyboard` is the name, or the literal `custom` for a list. The sidecar's alt and `storyboard_views` describe a list by the views it visits, as they already describe a name. The sweep note applies to a list's beats.

## Consequences

**As of 6 Oct 2026, a correction of scope.** The null-tween rule is applied where a list is read and where a named storyboard's opening beat is rewritten, and `_capture_job` accepts the literal `custom`; `beat_payload` is byte-for-byte unchanged, which is what keeps the eight names' plans as they are.

**Schema moves with v0.12.0.** The eight names produce the plans they produce today.

**Cell 06 gets durations, a start time and a speed as one thing**: a beat list, previewed from the same plan the capture uses.

**#31 closes into #39.** Its case is a test: a named storyboard with `view` and `at` opens on them with no morph; a list's first beat is checked.

**#44's title card and draw-in have a place to hang**: a beat in a list.

**What to watch.** A 90-second list at `high` quality is 2,700 frames at 2x; the app says the frame count before a capture starts, and the 90-second ceiling is this record's number, not a platform's.
