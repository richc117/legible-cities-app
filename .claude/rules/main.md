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
- **Two animation frames between the step and the capture.** `capturePage()`
  returns the last *painted* frame, not the state just set; without the
  wait one frame in sixty differs, intermittently, which is the worst way
  to be wrong.
- Compare in RGB with a channel tolerance of 8: never RGBA, never equality.
- Never hand `getBoundingClientRect()` to `capturePage()`. The rect is in
  device-independent pixels, the DOM measures in CSS pixels, and offscreen
  they differ; the result is a correctly *sized* image of the wrong region.

Exported pixels must not depend on the display attached to the machine.
How the scale factor is set is ADR-024, pending;
`docs/adr/spikes/offscreen-capture.md` has what was measured and why.

## The preload bridge

The bridge is the whole attack surface between the page and the machine.
Expose named, typed, narrow methods over `contextBridge`; never expose
`ipcRenderer` itself, a path the renderer chose, or anything that takes a
command to run. Validate on the main side, not in the renderer, because only
the main side is trusted.

## Serving `app://local`

One custom scheme, one host, for both the UI and the generated project
pages. It exists to make the iframe same-origin; a second origin breaks the
viewer silently. Resolve every request inside the allowed roots and refuse
anything that escapes them after normalisation.
