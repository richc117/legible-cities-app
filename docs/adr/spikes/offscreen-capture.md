# Spike: offscreen capture

- **Question:** Can an offscreen Electron `BrowserWindow` reproduce the
  engine's own recorder frame for frame - within an RGB channel tolerance of
  8, at device scale factor 2 - deterministically across runs, and how fast?
- **Timebox:** one weekend.
- **Started:** 2026-09-07
- **Ended:** 2026-09-08. Answered in three sessions; the last one answers
  all of it, and corrects the first two. **Read "Session three" before
  acting on anything above it.**
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

## Session two: what the doubling is

Not the page. A probe run under both hosts - same expression, same waits -
returns identical values for everything the rendering depends on:

| | Playwright | Electron |
|---|---|---|
| `devicePixelRatio` | 2 | 2 |
| `innerWidth` x `innerHeight` | 540 x 960 | 540 x 960 |
| `#stage` rect | 0, 0, 540, 960 | 0, 0, 540, 960 |
| `svg` `viewBox` | `-78.95 -1062.71 2013.71 3579.93` | identical |
| inner transforms | `rotate(-45 627.43 338.42)`, … | identical |
| clock, trains shown | 08:02, 64 | 08:02, 64 |

Only `screen` and `outer` differ, and the page does not lay out from either.
The DOM is the same in both. So the difference is in the capture.

**The capture scale is applied twice.** Asking `capturePage()` for the whole
page, from a 540x960 CSS viewport, returns **2160x3840** - an effective
factor of 4, not 2. Passing a rect makes it worse rather than better, because
the rect is in device-independent pixels while `getBoundingClientRect()`
returns CSS pixels, and on this window one CSS pixel is two of them:

| Rect passed | Output |
|---|---|
| none | 2160 x 3840 |
| `{0, 0, 1080, 1920}` | 2160 x 3840 |
| `{0, 0, 540, 960}` - `#stage`'s CSS rect | 1080 x 1920 |

The last one is the right *size* by accident: it captures the top-left
quarter of the page and rasterises it at 4x. That is the whole finding.
Content the recorder puts at CSS y=282 lands at 282x2=565 in its output and
282x4=1128 in Electron's - which is the 1130 measured in session one, to
within a rounding.

**Neither API that would fix it works.** On a minimal page, with no large
SVG involved:

| Configuration | page sees `devicePixelRatio` | CSS viewport | capture |
|---|---|---|---|
| offscreen | **1** | 540 x 960 | 1080 x 1920 |
| offscreen, `--force-device-scale-factor=2` | **1** - ignored | 540 x 960 | 1080 x 1920 |
| onscreen | 2 | 540 x 917 | 1080 x 1834 |

Offscreen, the page is told the scale factor is 1 and is then rasterised at
2. The switch that should set it is ignored, and `enableDeviceEmulation`
segfaults. So a page whose layout consults `devicePixelRatio` - as this one
evidently does - cannot be made to agree with a Playwright capture through
either documented route.

The segfault in session one was this configuration meeting the real page; on
a trivial page the same switches do not crash. That narrows the crash but
does not explain it, and it was not chased further.

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

## Recommendation after sessions one and two

Superseded by session three below, which found that the parity failure this
section is about was a stale browser zoom level in a shared profile. Kept as
written, because what it ruled out is still ruled out.

**Offscreen Electron capture is deterministic and fast enough, and it is not
yet a replacement for the recorder.** Two of the three acceptance criteria
pass: two runs agree - byte-identical, better than the tolerance asks - and
the rate is recorded at 48-53 ms/frame. Parity at RGB 8 fails, on every
frame, by a margin that is not close.

Do not adopt it for the export path on this evidence, and do not abandon it
either. What stands between the two is a single unexplained doubling and a
crash in the one API that would remove the display dependency. Both are
tractable and neither has been chased:

1. ~~Find the doubling.~~ Done, in session two: the capture scale is applied
   twice, the rect argument is in device-independent pixels rather than CSS
   pixels, and offscreen rendering tells the page a scale factor it does not
   then rasterise at.
2. **Reported upstream**: https://github.com/electron/electron/issues/53675,
   with a self-contained reproduction that needs no network and no local
   files. Whether any Electron release renders offscreen at a scale the page
   has been told about is now their question; A0-08 waits on the answer.

   Worth knowing while waiting: electron#13069, a 2018 pull request that
   would have added `scaleFactor` to `webPreferences`, says the offscreen
   factor "was previously locked to 1.0". It was closed unmerged. If that is
   still true, this behaviour is long-standing rather than a regression, and
   waiting for a fix is not a plan.

**What would change our mind.** If the doubling turns out to be the page
reading the host's scale factor, then the fix belongs in the engine's page
rather than in the app, and this stops being an app spike. If
`enableDeviceEmulation` stays broken, the honest answer is to keep the
Playwright recorder and pay the packaging cost, because a capture that
depends on the user's monitor is not deterministic in any sense that matters.

**The timebox is not spent** and A0-08, which depends on this, should wait:
encoding a frame sequence is a different question, but choosing where the
frames come from is this one.

## Follow-up after sessions one and two

- No decision record yet, deliberately. The question is answered for
  determinism and speed and open on parity, and a record written now would
  have to be superseded by the one written after the doubling is understood.
- The harness and the comparison script are in this spike's working
  directory rather than committed: they hard-code a machine path to the
  engine checkout, and this repository refuses those. They land with A0-08 or
  with the capture work, whichever comes first, with the path taken from
  configuration.
- The `enableDeviceEmulation` segfault was deliberately left out of that
  report: it does not reproduce on the trivial page, and filing a crash with
  no reduction wastes a maintainer's time. It is mentioned there as observed
  and unreduced, which is the honest amount to say.

## Session three: the CDP route, and what sessions one and two measured

Same machine, same page, same reference. Electron 44.2.0 (Chromium
152.0.7977.76); Playwright 1.62.1, whose two Chromium binaries are both
151.0.7922.34. The route the issue named, in the order it turned out to
need: navigate, attach `webContents.debugger` at 1.3, send
`Emulation.setDeviceMetricsOverride`, then per frame step the clock, wait
two animation frames, and `Page.captureScreenshot` with `#stage`'s rect as
a CSS-pixel `clip` at `scale: 1`.

**All three acceptance criteria pass.** Three offscreen runs are
byte-identical with each other, they agree with the reference to within one
channel level on every frame, and the rate is 117 ms/frame. Getting there
meant finding that the first two sessions had been measuring a machine
rather than a renderer.

### The doubling was a stale zoom level, and it was ours

A bare `electron script.js` has no application name, so it shares one
profile - `~/Library/Application Support/Electron` - with every other bare
Electron run on the machine. Electron persists a **per-host zoom level**
into that profile. Session one's first harness set
`webPreferences.zoomFactor = 2`, found that it scaled layout rather than the
backing store, and moved on. The zoom level it wrote stayed:

```json
{"partition":{"per_host_zoom_levels":{"…":{"local":3.8017840169239308}}}}
```

Chromium's zoom levels are logarithmic, base 1.2, so 3.8017840169239308 is a
factor of exactly 2, applied to the host `local` - which is
`app://local`, the origin every harness since has served the page from.

With that level in place the page loads at `devicePixelRatio` 4 in a 270x480
CSS viewport and `#stage` measures 270x480, with no emulation of any kind
involved. With a profile of its own the same window, the same page and the
same code give `devicePixelRatio` 2, a 540x960 viewport, `#stage` at
540x960, and a 1080x1920 capture:

| Profile | `devicePixelRatio` | CSS viewport | `#stage` | capture |
|---|---|---|---|---|
| shared, after session one | 4 | 270 x 480 | 270 x 480 | 540 x 960 |
| its own | 2 | 540 x 960 | 540 x 960 | 1080 x 1920 |

That is the doubling session one measured as "content at exactly twice the
vertical offset" and session two attributed to a capture scale applied
twice. Both sessions' harnesses were reading a page zoomed to 200%.

Session two's conclusion is not simply wrong - `capturePage()`'s rect really
is in device-independent pixels while the DOM measures in CSS pixels, and
that trap is real - but the number that made it look load-bearing was this.

### The segfault is not about scale, or offscreen, or the API

`enableDeviceEmulation` crashed session one. It still crashes, and so does
the CDP command, and the cause is neither the scale factor nor offscreen
rendering. Nine configurations, one process each:

| Window | Command | Result |
|---|---|---|
| hidden, never navigated | none | works |
| hidden, never navigated | `setDeviceMetricsOverride`, factor 1 | **SIGSEGV** |
| hidden, never navigated | `setDeviceMetricsOverride`, factor 2 | **SIGSEGV** |
| shown, never navigated | `setDeviceMetricsOverride`, factor 2 | **SIGSEGV** |
| offscreen, never navigated | `setDeviceMetricsOverride`, factor 2 | **SIGSEGV** |
| hidden, never navigated | `enableDeviceEmulation`, factor 2 | **SIGSEGV** |
| offscreen, never navigated | `enableDeviceEmulation`, factor 2 | **SIGSEGV** |
| hidden, after `about:blank` | `setDeviceMetricsOverride`, factor 2 | works |
| hidden, after a real document | either, any factor | works |

Emulating a web contents that has never navigated is a null dereference:
`EXC_BAD_ACCESS`, `KERN_INVALID_ADDRESS at 0x00000000000000f8`, a field read
off a pointer that does not exist until there is a document. A factor of 1
crashes as readily as 2, so the crash says nothing about scale. Any
document, `about:blank` included, prevents it.

This is a smaller and cleaner reproduction than session one had - fifteen
lines, no page, no network - and it is written up for reporting.

### The emulated scale factor is the one that is used

On a display whose own factor is 2, with a document loaded first:

| Emulated factor | page sees | CSS viewport | `Page.captureScreenshot` | `capturePage()` |
|---|---|---|---|---|
| 1 | 1 | 540 x 960 | 540 x 960 | 1080 x 1920 |
| 2 | 2 | 540 x 960 | 1080 x 1920 | 1080 x 1920 |
| 3 | 3 | 540 x 960 | 1620 x 2880 | 1080 x 1920 |

The override wins in both directions - below the display's factor and above
it - so what the machine is plugged into stops deciding what is exported.
That was the one thing session one could not get, and the whole reason it
called its working configuration "not a solution".

`capturePage()` ignores the override entirely and follows the window, which
is why it reads 1080x1920 in all three rows. It is not a capture path for
this work.

### The upstream report stands, on a clean profile

electron/electron#53675 says offscreen rendering rasterises at a scale the
page has not been told about. Retested with a profile of its own and no
emulation at all:

| Window | page sees | `Page.captureScreenshot` | `capturePage()` |
|---|---|---|---|
| offscreen | 1 | 540 x 960 | **1080 x 1920** |
| onscreen | 2 | 1080 x 1920 | 1080 x 1920 |

Offscreen, the page is told 1, a CDP screenshot agrees with it, and
`capturePage()` rasterises at 2. Emulating the frame makes all three agree,
so the app does not need the answer - but the report is accurate and worth
leaving open.

### A beat that does not name `at` is not reproducible anywhere

The first parity run failed, and so did the determinism run, and the cause
was in the job rather than in either host. The page starts its own animation
loop when it loads and runs the clock at `speed` times real time until
`setCapture(true)` stops it. A beat that does not `seek` therefore begins
wherever the load and the 1200 ms settle happened to leave it: two runs
started 0.05 s apart in map time, and 60 of 60 frames differed by up to 82
levels.

Every storyboard in the engine's `export.py` opens with a beat that names
`at`, which is why nothing has ever noticed. The measurements below use a
beat built by the engine's own `beat_payload` from its own `Beat`, so the
job cannot drift from what a real export sends.

### Determinism

Sixty frames, three independent runs each in a fresh profile.

| Recorder | Worst channel difference between runs | Frames over 8 |
|---|---|---|
| Playwright, `bin/_record.js` | 0/255 | 0 of 60 |
| Electron offscreen, through CDP | **0/255** | **0 of 60** |
| Electron onscreen, through CDP | 1/255 | 0 of 60 |

Offscreen capture is byte-identical run to run. Onscreen it is not quite,
by one level on a small number of pixels, well inside the tolerance but not
free of the GPU.

The page's own state was read through `window.__present.state()` after every
one of the sixty advances in both hosts and compared: the clock, the train
count and the view agree exactly, frame for frame. Whatever differs in the
pixels, the two hosts are being driven identically.

### Parity, and what the tolerance actually measures

Every pair, sixty frames, RGB, worst channel difference:

| Pair | Worst | Frames over 8 |
|---|---|---|
| Playwright headless shell vs itself | 0 | 0 of 60 |
| Playwright full Chromium vs itself | 0 | 0 of 60 |
| **Electron offscreen vs Playwright full Chromium** | **1** | **0 of 60** |
| Playwright headless shell vs Playwright full Chromium | 99 | 60 of 60 |
| Electron offscreen vs Playwright headless shell | 99 | 60 of 60 |
| Electron onscreen vs any of the above | 222 | 60 of 60 |

Read the fourth row first. Playwright's own two Chromium binaries, at the
same version, disagree with each other on every frame by twelve times the
tolerance. `chromium.launch()` gets the **headless shell**; `channel:
"chromium"` gets the full browser; they do not rasterise the same way. So
"parity within RGB 8 against the recorder" was never a test of Electron. A
tolerance of 8 measures whether two runs share a rasteriser, which is
exactly what the engine uses it for and exactly what it cannot answer across
two binaries.

Against the reference that shares its rasterisation path, Electron's
offscreen capture is within one channel level on every frame - across a
Chromium major version, 152 against 151.

Onscreen, Electron is the outlier at 222 from everything including its own
offscreen capture. Forcing an sRGB colour profile, disabling hardware
acceleration and disabling LCD text each changed nothing. The differences
sit on glyph edges and stroke edges - 0.8% of the frame, no positional
offset in any direction, no missing content - but they are far outside the
tolerance and there is no switch that closes them. **Capture offscreen.**

### Speed

| Recorder | ms/frame |
|---|---|
| Playwright, `bin/_record.js` | 50-53 |
| Electron onscreen, paint-synced | 50 |
| Electron offscreen, paint-synced | 117 |

The configuration that is correct is the slow one: 2.3 times the recorder.
An `instagram-reel` is 27 seconds at 30 fps, so 810 frames - about 95
seconds of capture against 41. Session one's faster offscreen numbers were
`capturePage()`, which cannot be used here.

### The sequence, in full

```
BrowserWindow({ show: false, width, height, useContentSize: true,
                webPreferences: { offscreen: true, backgroundThrottling: false } })
loadURL(page)                       # a document first, or the next line crashes
debugger.attach('1.3')
Emulation.setDeviceMetricsOverride({ width, height, deviceScaleFactor, mobile: false })
wait for window.__present.state
await document.fonts.ready ; wait settle ms
clip = #stage.getBoundingClientRect()          # CSS pixels, which is what a clip is
__present.setCapture(true) ; __present.settle()
per beat:   seek(at) ; setLabels ; setSpeed ; setView/setGeo ; setPlaying
per frame:  advance(1/fps)
            two requestAnimationFrames
            Page.captureScreenshot({ format:'png', clip:{...clip, scale:1},
                                     captureBeyondViewport: false })
```

Its own `userData` per run, or a persisted zoom level will scale everything
silently. Never open DevTools on that window: it detaches the debugger.

### Recommendation

**Adopt it.** In-process capture through the debugger, offscreen, is
deterministic, display-independent and correct, and it removes Playwright
and a second Chromium from what the app would otherwise have to ship. The
decision is ADR-024.

Two things it costs, both recorded there: the capture is 2.3 times slower
than the recorder, and it matches Playwright's **full** Chromium rather than
the headless shell that `bin/_record.js` launches today, so any comparison
between the app's export and the engine's own has to name which.
