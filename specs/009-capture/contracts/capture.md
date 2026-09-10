# Contract: the capture

The main-process function `capture(job, options)` in
`src/main/capture-window.ts`, over the orchestrator in `src/main/capture.ts`.
Nothing crosses the preload bridge in this feature.

## The job

`CaptureJob` in `src/shared/capture.ts`. The shape is the engine's: the job
`bin/_record.js` receives, its beats as `export.beat_payload` builds them,
so `export.plan`'s answer (engine issue E09b) maps onto it without
translation.

| Field | Meaning | Refused when |
|---|---|---|
| `url` | the project page, `app://local/projects/<id>/<file>.html` plus its present-mode query | any other origin or path; a bad project id |
| `width`, `height` | the viewport in CSS pixels | not whole, or above 8192 |
| `scale` | the device scale factor the page is emulated at | not 1, 2 or 3 |
| `fps` | frames per second of the page's clock | not a whole number from 1 to 120 |
| `settle` | milliseconds allowed, clock stopped, for the first geometry pass and the fonts | not 0 to 60000 |
| `beats[]` | `secs`, `view`, `labels`, `at` (seconds), `speed`, `sweep`, `hours`, `lo`, `hi`, `tween` | empty; a beat of no length; a view the page lacks; a `sweep` that is not true or false; `at`, `hours`, `lo`, `hi` or `tween` that are not seconds; a sweep with no span; a first beat that names no `at` and sweeps no named span |

A frame is `round(width * scale)` by `round(height * scale)` device pixels
of the stage; the total is the sum over beats of `round(secs * fps)`.

## The sequence

In order, each step under a timeout that names it:

1. Create the window: hidden, offscreen, background throttling off, no
   preload, node integration off, context isolation and sandbox on,
   partition `capture` (in memory).
2. `loadURL(job.url)`. A document first, or the next step crashes the
   process. The load is judged by the page's own events for that URL: a
   404 from the origin's handler is refused at once, and a navigation the
   page tries elsewhere is refused without failing the load.
3. Attach the debugger at 1.3; `Emulation.setDeviceMetricsOverride`
   (width, height, scale, not mobile); `Emulation.setEmulatedMedia`
   (prefers-reduced-motion: no-preference).
4. Poll for `window.__present.state` up to the page timeout.
5. `__present.setCapture(true)` - before any wait.
6. `document.fonts.ready`; wait `settle` ms.
7. `__present.bounds()`, `__present.state()`; refuse `shown === 0` with
   `no trains at HH:MM; this feed runs T0-T1`.
8. The stage's `getBoundingClientRect()` in CSS pixels; `__present.settle()`.
9. Per beat: apply `at` (seek), `labels`, `speed`, `view` (`setGeo` and
   `setView`, as the recorder does), `setPlaying`; a sweep in hours starts
   from the current clock.
10. Per frame: `advance(1/fps)` or `seek` along the sweep; two
    `requestAnimationFrame`s; `Page.captureScreenshot` (png, the clip at
    scale 1, not beyond the viewport); write `NNNNNN.png`; report progress.
11. Destroy the window. On cancel or failure, remove the directory first.

Only numbers are ever interpolated into the page's script; a beat is
passed through `JSON.stringify`. What the page reports back is cut to
printable ASCII before it can reach a sentence.

## The result

`{ frames, width, height, first }`: frames written, a frame's size in
device pixels, and the page's state after the settle.

## Errors

`CaptureError` with a message for a person; `cancelled` is true for the one
that is not a failure. A bad job, or a frames path that is not absolute, is refused before a
window exists.
