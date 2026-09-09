# ADR-024: Capture runs in the app, offscreen, through the debugger

- **Status:** Accepted
- **Date:** 2026-09-08
- **Supersedes:** none
- **Superseded by:** none

## Context

The app has to turn the engine's animation page into a sequence of frames.
The engine already does this, in `bin/_record.js`: Playwright launches
Chromium, sets a viewport and a device scale factor, steps the page's clock
by `1/fps`, and screenshots the `#stage` element once per frame. The
question spike A0-07 was opened to answer is whether the app can do the same
thing in its own process, or whether it has to ship Playwright and a second
Chromium beside the Electron it already carries.

Three sessions answered it. The report is
`docs/adr/spikes/offscreen-capture.md`; what matters here is what it
measured.

Capture through `webContents.debugger` - `Emulation.setDeviceMetricsOverride`
to set the frame and the scale factor, `Page.captureScreenshot` with a
CSS-pixel clip to take it - is byte-identical across runs, agrees with the
reference to within one channel level on every frame, and takes 117 ms per
frame against the recorder's 50. Those are the same two commands Playwright
issues underneath; the app is not doing something different, it is doing the
same thing without the second browser.

Three facts had to be established before any of that could be believed.

**The parity failure the first two sessions measured was ours.** A bare
`electron script.js` shares one profile with every other bare Electron run on
the machine, and Electron persists a per-host zoom level into it. Session
one's first harness set `zoomFactor: 2`, and the level it wrote stayed in the
profile, applied to `app://local`, for every session afterwards. Every
measurement in sessions one and two was taken on a page zoomed to 200%. With
a profile of its own, nothing doubles.

**A tolerance of 8 cannot compare two browser binaries.** Playwright's own
headless shell and full Chromium, at the same version, disagree with each
other on 60 of 60 frames by 99 levels. The engine's tolerance measures
whether two runs share a rasteriser, which is what the engine uses it for.
Against the reference that shares its rasterisation path - Playwright's full
Chromium - Electron's offscreen capture is within 1.

**Onscreen Electron does not share it.** Rendered through the GPU it is 222
levels from every other configuration measured, including its own offscreen
capture, on glyph and stroke edges. Forcing sRGB, disabling hardware
acceleration and disabling LCD text each changed nothing.

Two Electron defects sit on the path and are avoidable rather than blocking.
Emulating a web contents that has never navigated is a null dereference and
takes the process down; any document, `about:blank` included, prevents it.
And offscreen rendering without emulation tells the page a scale factor of 1
and then rasterises `capturePage()` at 2, which is electron/electron#53675,
still open - emulating the frame makes the page, a CDP screenshot and the
capture agree, so the app does not need the answer.

ADR-028 asked for this to be re-measured now that the viewer's frame is
sandboxed, and the answer is that the sandbox does not reach the export.
The viewer is a frame inside the interface's window, where a bridge exists a
frame away and the sandbox is what keeps the page off it. An export loads
the page as the top-level document of a window built for that one job, with
no preload, no bridge and nothing to reach: what the sandbox protects is not
present. The measurements above were taken that way, which is the way an
export will run.

## Options

**(a) Capture in the app, offscreen, through the debugger.** Nothing extra
ships. The app already has the Chromium. Costs a hidden window per export,
the two Electron defects above as things a future upgrade could reintroduce,
and 2.3 times the recorder's time per frame.

**(b) Capture in the app onscreen.** Half the time of (a) and the same
correctness on paper, but 222 levels from the reference on every frame with
no switch that closes the gap, and one level of run-to-run noise from the
GPU. It also means a real window, which has to be kept off the user's
screen and out of their way.

**(c) Ship the recorder.** `playwright-core` plus a pinned Chromium in
`extraResources`, capture behind `export.capture` in the sidecar, a
vendoring job, a notice, and `bin/_record.js` stops loading Playwright from
`site/node_modules`. It buys pixel-for-pixel agreement with whatever the
engine's own recorder produces today, and it costs roughly 150 MB per
platform, a second browser to keep patched, and a vendoring job that has to
stay green on four targets.

**(d) `capturePage()` instead of the debugger.** Rejected on measurement
rather than on principle: it ignores the emulated scale factor entirely and
follows the window, so it reads 1080x1920 whether the page has been told 1,
2 or 3. Its rect is in device-independent pixels while the DOM measures in
CSS pixels, which is the trap the rules already name. It is not a capture
path for work that has to be independent of the display.

## Decision

Capture runs in the app: a hidden `BrowserWindow` with `offscreen: true`,
navigated first and then emulated through `webContents.debugger`, stepped by
hand and screenshotted with `Page.captureScreenshot` at a CSS-pixel clip.
The app does not ship Playwright or a second Chromium. Option (c) stays
written down as the fallback if an Electron upgrade breaks the route, and
option (b) is refused outright: onscreen capture must not be used for an
export.

## Consequences

The app's export path is one process and one browser. `A0-08` can proceed on
frames the app produces, and `A5-02` has a capture step that is specified
rather than open.

**Exports no longer depend on the attached display.** The emulated scale
factor wins over the display's in both directions, which is the property the
constitution's third principle asks for and the one session one could not
get.

**The app's frames match Playwright's full Chromium, not the headless shell
`bin/_record.js` launches today.** Those two differ by 99 levels on every
frame. So Phase 3's exit criterion - LA built through the app equal to the
engine CLI's output from the same stored layout within RGB 8 - cannot pass
as written against today's engine. Either the engine's recorder moves to
`channel: "chromium"`, which is an engine issue and changes the engine's own
output, or that criterion becomes a comparison of geometry rather than
pixels. This must be settled before Phase 3, not during it.

**Two Electron behaviours have to be pinned by tests, because both are
silent when they regress.** Emulating before a document exists crashes the
process; a persisted per-host zoom level scales everything with no error
anywhere. The export path uses a profile it controls, and the capture code
navigates before it emulates.

**Capture is 2.3 times slower than the recorder** - about 95 seconds for an
`instagram-reel` against 41. Acceptable for a desktop app with a progress
line and a cancel; worth re-measuring if a preset ever gets much longer.

**The export window loads an untrusted page as a top-level document.** The
engine embeds a feed's line and station names in it, so it is
third-party-derived, and ADR-028 is about keeping exactly that page away
from the app. The export window must therefore carry no preload, no node
integration, no bridge of any kind, and a session that is not the
interface's - it exists to be screenshotted and destroyed. A preload added
to it later would undo ADR-028 through the back door.

**A hidden window is still a window.** It has to be created for the export
and destroyed with it, it must never be shown, and DevTools must never be
opened on it, which detaches the debugger.

The determinism gate (`A5-04`) compares the app's own exports with each
other on three runners, which is what this makes meaningful: byte-identical
across runs on the machine measured here, and independent of what that
machine is plugged into.
