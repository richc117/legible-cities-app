# Spike: offscreen capture

- **Question:** Can an offscreen Electron `BrowserWindow` reproduce the
  engine's own recorder frame for frame - within an RGB channel tolerance of
  8, at device scale factor 2 - deterministically across runs, and how fast?
- **Timebox:** one weekend.
- **Started:** 2026-09-07
- **Ended:** 2026-09-07 (determinism and speed answered; parity open)
- **Branch:** `spike/offscreen-capture` (deleted when this lands; the report
  is the deliverable)

## Method

Apple Silicon MacBook Pro, macOS 15, Retina display. Electron 44.2.0, Node
25.6.1. The page is the engine's committed `out/la-metro-rail.html`, served
over a custom `app://local` scheme registered standard and secure, as ADR-013
requires.

The reference is the engine's own recorder, `bin/_record.js`, driven with the
job it takes from `export.py`: Playwright chromium, viewport 540x960,
`deviceScaleFactor: 2`, `reducedMotion: "no-preference"`, settle 1200 ms,
then `setCapture(true)`, `settle()`, and 60 frames of `advance(1/30)`,
screenshotting the `#stage` element each time. It produces 1080x1920 PNGs.

The Electron harness does the same sequence against the same page, capturing
`#stage`'s rectangle with `capturePage(rect)`. Comparison is the engine's own
test: RGB, worst channel difference per frame, `DRIFT = 8`.

Two things had to be corrected before any number meant anything.

**The page is older than the recorder.** `bin/_record.js` calls
`__present.setGeo()` whenever a beat names a view; the committed page has no
such method, and the reference run died on it. The beat drops `view`, which
does not affect what is being measured - the capture path, not the
storyboard.

**`zoomFactor` is not a scale factor.** The first harness set
`webPreferences.zoomFactor = 2` and produced 540x960 output from a 270x480
CSS viewport - it scales the page's layout, not the backing store.

## Measurements

### Reaching device scale factor 2

The issue named two routes. A third exists on a Retina display, because the
window inherits the display's scale factor.

| Route | Result |
|---|---|
| `enableDeviceEmulation({deviceScaleFactor: 2})` | **SIGSEGV** |
| Window at 1080x1920, display supplies scale 2 | works: `devicePixelRatio` 2, `innerWidth` 540, `innerHeight` 960, output 1080x1920 |
| Window at 540x960, display supplies scale 2 | works, but CSS viewport is 270x480 - half the reference |

The crash is not an offscreen problem. It reproduces with `offscreen: false`
as well, so it is `enableDeviceEmulation` itself on this Electron and this
platform - and it is the only route that does not depend on what display the
machine happens to have.

The second route reproduces the reference's CSS viewport and pixel ratio
exactly, so it is what the rest of these numbers use.

### Determinism across runs

| Configuration | Worst channel diff between two runs | Frames over 8 |
|---|---|---|
| `advance()` then `capturePage()` | 32/255 | 1 of 60 |
| ...with `setPlaying(true)` | 218/255 | 12 of 60 |
| ...with two `requestAnimationFrame`s between advance and capture | **0/255** | **0 of 60** |

`capturePage()` returns the last *painted* frame, which need not reflect the
state JavaScript has just set. Waiting two animation frames - long enough for
style, layout and paint - makes consecutive runs **byte-identical**. Without
it the failure is intermittent and looks exactly like the engine's own note
about a nondeterministic clock moving a channel by 30 to 130.

### Parity against the engine's recorder

| Measure | Result |
|---|---|
| Worst channel diff | 242/255 |
| Frames over the tolerance | 60 of 60 |
| Difference bounding box | (39, 565, 1080, 1920), identical on every frame |
| First non-background row, recorder | 565 |
| First non-background row, Electron | **1130** |

The two agree exactly above row 565 - same background, same colour - and
disagree everywhere below. The difference does not grow across the sixty
frames, so it is not the clock, and it is unchanged by `setPlaying`. Content
sits at exactly **twice** the vertical offset, which is a scale factor being
applied twice rather than a layout that merely differs.

### Speed

| Recorder | ms/frame |
|---|---|
| Playwright, the engine's `_record.js` | 50 |
| Electron offscreen, no paint sync | 20 |
| Electron offscreen, paint-synced | 48-53 |

Offscreen capture is about 2.5x faster than Playwright until the
synchronisation that makes it correct is added, at which point the two are
the same speed.

## What surprised us

**Determinism was free once the capture waited for a paint, and impossible
before it.** The naive loop - advance the clock, capture - fails
intermittently, one frame in sixty, by an amount that looks exactly like a
clock caught mid-tween. Two animation frames between the two makes sixty
frames byte-identical across runs. It is one line, and without it the whole
export path would have been flaky in a way that only shows up occasionally,
which is the worst way for it to show up.

**The documented way to set the scale factor crashes.**
`enableDeviceEmulation` segfaults Electron 44.2.0 on macOS arm64, with
offscreen rendering on or off. What works instead is sizing the window to
1080x1920 and letting a Retina display supply the factor - which is not a
solution, because it means the output depends on which display the machine
has. A user on a non-Retina monitor would get half the pixels.

**Speed was not the constraint anyone expected.** Offscreen capture is 2.5x
faster than Playwright right up until the synchronisation that makes it
correct, after which the two are indistinguishable - 48-53 ms/frame against
50. There is no performance argument for Electron capture. The argument has
to be that it removes a Playwright dependency from the shipped app, which it
does.

**The pixels disagree in a way the clock cannot explain.** The bounding box
of the difference is identical on all sixty frames, the top of the image
matches exactly, and content sits at precisely twice the vertical offset.
A doubling is a scale factor applied twice, not a rendering difference, and
it points back at the same axis the crash is on.

## What we ruled out

**`webPreferences.zoomFactor` as a scale factor.** It scales layout, not the
backing store: a 540x960 window at `zoomFactor: 2` lays out at 270x480 CSS
and captures 540x960. Not a route to device scale 2.

**Blaming the clock for the parity failure.** Tested and false: the
difference does not grow across sixty frames and does not move when
`setPlaying` changes. It is constant and positional.

**Blaming the CSS viewport.** Also tested and false. The working
configuration reports `devicePixelRatio` 2, `innerWidth` 540 and
`innerHeight` 960 - identical to the reference's viewport.

**Comparing without paint synchronisation.** Any determinism number taken
that way describes the scheduler, not the renderer.

## Recommendation

**Offscreen Electron capture is deterministic and fast enough, and it is not
yet a replacement for the recorder.** Two of the three acceptance criteria
pass: two runs agree - byte-identical, better than the tolerance asks - and
the rate is recorded at 48-53 ms/frame. Parity at RGB 8 fails, on every
frame, by a margin that is not close.

Do not adopt it for the export path on this evidence, and do not abandon it
either. What stands between the two is a single unexplained doubling and a
crash in the one API that would remove the display dependency. Both are
tractable and neither has been chased:

1. Find the doubling. The next step is to compare what the page measures in
   each host - `devicePixelRatio` against whatever the layout actually uses
   - rather than to compare pixels. The clue is exact: 565 becomes 1130.
2. Establish whether the `enableDeviceEmulation` crash is known upstream, and
   whether a fixed Electron release exists. Until it is resolved, capture
   output depends on the display attached to the machine doing the capture,
   which no export path can accept.

**What would change our mind.** If the doubling turns out to be the page
reading the host's scale factor, then the fix belongs in the engine's page
rather than in the app, and this stops being an app spike. If
`enableDeviceEmulation` stays broken, the honest answer is to keep the
Playwright recorder and pay the packaging cost, because a capture that
depends on the user's monitor is not deterministic in any sense that matters.

**The timebox is not spent** and A0-08, which depends on this, should wait:
encoding a frame sequence is a different question, but choosing where the
frames come from is this one.

## Follow-up

- No decision record yet, deliberately. The question is answered for
  determinism and speed and open on parity, and a record written now would
  have to be superseded by the one written after the doubling is understood.
- The harness and the comparison script are in this spike's working
  directory rather than committed: they hard-code a machine path to the
  engine checkout, and this repository refuses those. They land with A0-08 or
  with the capture work, whichever comes first, with the path taken from
  configuration.
- `enableDeviceEmulation` segfaulting is worth reporting upstream once it is
  reduced to a case that does not involve this project's page.
