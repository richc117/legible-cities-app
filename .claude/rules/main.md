---
paths:
  - "src/main/**"
  - "src/preload/**"
---

# The main and preload processes

There is no application code yet; these rules exist so the first commit that
adds `src/main/` or `src/preload/` does not have to rediscover them. See
`CLAUDE.md` for the short form and `docs/adr/` for why.

## Child processes

Every spawn, without exception:

- an **argument array**, never a shell string, whatever the arguments look
  like today;
- `windowsHide: true`, or a console window flashes on Windows;
- a **timeout**, because LOOM and ffmpeg can both wedge on bad input;
- **stderr captured to the log**, not dropped - it is the only diagnosis a
  user can send us;
- a **clean shutdown on quit**, so nothing outlives the app.

## Native dialogs

Prefer the page's own `<dialog>` for anything the app has to say: the
renderer owns modality and focus the accessible way, and a state sent over
the bridge is all it needs. A native `dialog.showMessageBox` with no parent
runs synchronously on macOS and blocks the main process, quit included;
with a parent it still held a quit on Linux under a display server. Keep
native dialogs for what only the OS can do (choosing a file or a folder).

## Ordering over the bridge

An `ipcMain.handle` reply is not ordered against `webContents.send`
events. If the page must see events before the answer they lead up to
(progress before a result), send the answer as an event on the same
channel and let the preload make the promise.

## Where things are written

Never inside the app bundle: it is read-only on macOS and it is wiped on
update. The engine's home is `SCHEMATIC_HOME` under the user-data folder;
exports go where the user chose. A path that is not one of those two is a
bug. See ADR-016.

## The protocol is a contract

JSON-RPC 2.0 over stdio. The types are generated from the engine's JSON
Schema, so a change on one side is a build error on the other rather than a
runtime surprise. Do not hand-write a method signature, and do not add a
method here before the engine has it and the pin has moved. See ADR-010.

## Capture

A project's layout is computed once and stored with the project; a render
or an export reads it and never runs the layout stages on its own.
Re-layout is a button with a warning. See ADR-023.

Every capture, without exception:

- `setCapture(true)` **before any wait**, stills included. The engine's own
  recorder waits with the clock running on the still path, and its stills
  are not reproducible for exactly that reason.
- `settle()` before the first frame, then `advance(1/fps)` per frame.
- **Two animation frames between the step and the capture.** A capture
  returns the last *painted* frame, not the state just set; without the
  wait one frame in sixty differs, intermittently, which is the worst way
  to be wrong.
- Compare in RGB with a channel tolerance of 8: never RGBA, never equality.

How the frames are taken is **ADR-024**, and every clause of it was paid
for:

- **Offscreen.** `BrowserWindow({ show: false, webPreferences: { offscreen:
  true, backgroundThrottling: false } })`. Onscreen capture is 222 levels
  from the reference on every frame, on glyph and stroke edges, and no
  colour-profile, hardware-acceleration or LCD-text switch closes it.
- **Navigate, then emulate.** `Emulation.setDeviceMetricsOverride` - and
  `webContents.enableDeviceEmulation` - on a web contents that has never
  navigated is a null dereference that takes the process down. Any
  document, `about:blank` included, prevents it. A factor of 1 crashes as
  readily as 2, so this is not about scale.
- **`Page.captureScreenshot` with a CSS-pixel `clip` at `scale: 1`**, taken
  from `getBoundingClientRect()`. That is what Playwright issues underneath,
  and it is why the two agree.
- **Never `capturePage()`.** It ignores the emulated scale factor and
  follows the window, and its rect is in device-independent pixels while the
  DOM measures in CSS pixels - a correctly *sized* image of the wrong
  region.
- **A session the export controls: an in-memory partition, never the
  interface's default session.** Electron persists a per-host
  zoom level into the profile. One stray `zoomFactor` leaves every later
  capture of that origin silently scaled, with no error anywhere; it cost
  spike A0-07 two sessions.
- **Never open DevTools on that window.** It detaches the debugger.

A beat that does not name `at` is not reproducible on any host: the page
runs its own clock at `speed` times real time from load until
`setCapture(true)` stops it. Every storyboard in the engine's `export.py`
opens with `at`, and the app must too.

The tolerance of 8 measures whether two runs share a rasteriser. It cannot
compare two browser binaries - Playwright's own headless shell and full
Chromium disagree by 99 levels at the same version - so never write an
acceptance criterion that compares the app's pixels with another program's
without naming which binary.

`docs/adr/spikes/offscreen-capture.md` has what was measured and why.

## The preload bridge

The bridge is the whole attack surface between the page and the machine.
Expose named, typed, narrow methods over `contextBridge`; never expose
`ipcRenderer` itself, a path the renderer chose, or anything that takes a
command to run. Validate on the main side, not in the renderer, because only
the main side is trusted.

## Serving `app://local`

One custom scheme, one host, for both the UI and the generated project
pages. Resolve every request inside the allowed roots and refuse anything
that escapes them after normalisation.

It is **not** what makes the viewer work, whatever ADR-013 said. That record
claimed a parent can drive a framed page only when the two share an origin;
that is false, and A3-02 corrected it (ADR-028). `webFrameMain.executeJavaScript`
injects into a frame's main world from the browser process and the sandbox
does not stop it, which is how the app drives a page it cannot otherwise
reach.

The generated pages get **their own** policy, never the interface's: the
interface's says `frame-ancestors 'none'` and would block the viewer
outright. And the frame carries `sandbox="allow-scripts"` and nothing else.
**Never add `allow-same-origin` to it.** One word beside the other gives the
page back its origin, and a page with both can read the bridge, call it, and
remove its own sandbox attribute; that was demonstrated before it was
closed. `tests/e2e/viewer.spec.ts` asserts the attribute's exact value and
drives a hostile page against every route out.
