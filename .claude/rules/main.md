---
paths:
  - "src/main/**"
  - "src/preload/**"
---

# The main and preload processes

These rules were written before the first commit that added `src/main/` and
`src/preload/`, and every one has been paid for since. See `CLAUDE.md` for
the short form and `docs/adr/` for why.

## Child processes

Every spawn, without exception:

- an **argument array**, never a shell string, whatever the arguments look
  like today;
- `windowsHide: true`, or a console window flashes on Windows;
- a **timeout**, because LOOM and ffmpeg can both wedge on bad input;
- **stderr captured to the log**, not dropped - it is the only diagnosis a
  user can send us;
- a **clean shutdown on quit**, so nothing outlives the app.

The first-run check (`src/main/first-run.ts`) runs the bundled tools on
every start of a packaged app, and only once the engine's first start has
settled, so its spawns never compete with the handshake
(`src/main/index.ts`): `gtfs2graph`'s output must parse as a line graph,
because a zero exit proves nothing, and a failure opens one dialog naming
the tool, never over the mismatch dialog.

## Native dialogs

Prefer the page's own `<dialog>` for anything the app has to say: the
renderer owns modality and focus the accessible way, and a state sent over
the bridge is all it needs. A native `dialog.showMessageBox` with no parent
runs synchronously on macOS and blocks the main process, quit included;
with a parent it still held a quit on Linux under a display server. Keep
native dialogs for what only the OS can do (choosing a file or a folder).
One deliberate exception: the box shown when the main window's renderer dies
(`crashBox`, issue 432) is unparented, because the page is what died and a
box hung from its window must never hold a quit.

## Uncaught failures

`src/main/process-handlers.ts` logs an uncaught exception and quits once, and
logs an unhandled rejection and carries on: a bug that used to be loud is now
a log line, so read the logs (`main.log`) when something odd happens.

## Ordering over the bridge

An `ipcMain.handle` reply is not ordered against `webContents.send`
events. If the page must see events before the answer they lead up to
(progress before a result), send the answer as an event on the same
channel and let the preload make the promise.

## The record session

Every read and write of a project's record goes through the store's
per-project queue (`ProjectStore.#serial`), `get` included, so a read
answers with every write sent before it. A `projects:*` handler reaches the
store in the turn it is handed its message: no `await` before the store
call, or a call sent later can reach the queue first
(`tests/unit/ipc.test.ts` reads the handlers for one). A writer changes the
fields it names and no other, and `drawn` is made from what the run sent
(`SentSet`, validated field by field), never from the record at the write.
docs/ARCHITECTURE.md, "The record session" (spec 037). The record's code is
split by process (issue 492): `src/shared/project/` for what both use,
`src/main/record/` for what main alone does with it - the parser, what it
carries, the whole-object validators, `drawnFromSent`. Nothing under
`src/shared/` may import from here, and `tests/unit/import-graph.test.ts`
says so.

## Where things are written

Never inside the app bundle: it is read-only on macOS and it is wiped on
update. The engine's home is `SCHEMATIC_HOME` under the user-data folder;
exports go where the user chose: a project's own folder where it chose
one, else `LEGIBLE_EXPORT_FOLDER`, else the folder Settings names, else a
`Legible Cities` folder on the desktop; in a folder per project. A
project's own folder is refused inside or around the engine's home, and
inside or around the engine folder waiting for a restart where Settings
has taken one, which is asked of Settings each time a folder is judged
(`destinationRefusal`, issue 206). An
export's frames live under the engine home (`frames/<token>/`) only while
it runs, and a start empties that folder - **but only if the app
made it**. The home is a setting and can name anybody's directory, so a
`frames` folder the app did not create carries no mark and is left alone.
Every folder above it is resolved through its links, and a link where the
frames folder should be is refused rather than followed, as the reset
refuses one. The folder itself is never removed, and the app marks a folder
whenever it makes one - at start and before each export, because the reset
takes the mark with the folder. Removing it outright, on the home as configured,
was a real bug (`src/main/frames.ts`). A file replaced by renaming a
temporary copy over it goes through `renameOver` in
`src/main/replace-file.ts`: on Windows a rename over a file another handle
has open (a scanner's, or our own reader's) is refused, and that is the
suspected, unproven cause of choices lost on the Windows runner (issue 93),
so the retry there is a defence. The logs, `main.log` and
`engine.log` with one `.old.log` each, go to `app.getPath('logs')`, which
is the platform's log folder and never the engine's home, so the reset
does not reach them; in development `LEGIBLE_USER_DATA` or `LEGIBLE_LOGS`
moves them, and an end-to-end launch always has one of the two, or it
writes a person's own log (`src/main/log-file.ts`, specs/023). A path that
is not one of those is a bug. See ADR-016.

Every log line, and "Copy diagnostics" again, has its URLs' user
information, query values and fragments redacted (`src/main/redact.ts`); the
copy writes the home folder as `~`, its 8.3 short form on Windows included,
and is checked for the home afterwards (`src/main/diagnostics-text.ts`).

## The reset

"Reset engine data" (`src/main/settings.ts`, `src/main/settings-ipc.ts`)
is the one destructive act; `docs/ARCHITECTURE.md` has it in full. What a
change to it must keep:

- It removes four folders under the engine's home - `projects`, `out`,
  `data` and `frames` - and **never the home itself**, which a person can
  point at `~/Documents` in one click. The engine's `config.py` is where
  the list comes from; read it before adding a name. A folder that turns
  out to be a symbolic link is left alone and reported, never unlinked.
- **The home is resolved through `realpath` before any guard judges it**,
  and so is everything it is compared with: the guards are textual, and a
  home that is itself a link would pass them all and then remove four
  folders from wherever it points.
- Main refuses while a reset is already running, while an export, an
  engine request or a record write is in flight, and for a home so high up
  that the four names would mean something else; the screen refuses
  separately while a layout run or an export is open, because only the
  renderer sees the gaps between a run's steps. The flag goes up **before
  the first `await`**, and while it is up every engine request, export and
  record write is refused.
- A project's own export folder is kept out of the reset's reach at three
  doors (issue 206): the reset, which refuses while a project under the
  home in force exports to a folder inside the home or around it; the
  choice of the engine's folder in Settings, the default included; and the
  project's folder, judged against
  the home in force and the engine folder waiting for a restart, where it
  is chosen and again at each export (`destinationRefusal`, handed a
  function for the folder waiting and asking it at every judgement).
  `destinationsInTheWay` is the pure rule on Settings' side, on real paths.
  No door sees a record left behind in a previous home. The reset also
  refuses when the app's own export folder is the home, holds it, or is
  inside one of the four (`settings-ipc.ts`).
- A projects folder that cannot be listed refuses the choice and the reset,
  because it hides every project (`destinations()` reads strictly; `list()`
  does not, so the front door still opens); one record that cannot be read
  is skipped and refuses nothing, because the reset is the remedy for bad
  records.
- Every check over folders has one deadline (`FOLDERS_TIMEOUT_MS`,
  `inTime`): a folder that stalls refuses, with nothing changed or removed;
  a check that lapsed is abandoned, so checks only read and whatever acts
  on their answer comes after them; the refusal names the project whose
  folder did not answer; and a folder that has not answered is not asked
  again (`oneAtATime`), because each unanswered question holds one of the
  four threads files are read with.
- Every refusal over exported files asks for the files to be moved out
  **and then** the folder changed, in that order: changing a folder moves
  nothing, and a reset that goes ahead removes what was exported into one
  of the four. The screen promises only that exported files outside the
  four folders are not touched.

## The protocol is a contract

JSON-RPC 2.0 over stdio. The types are generated from the engine's JSON
Schema, so a change on one side is a build error on the other rather than a
runtime surprise. Do not hand-write a method signature, and do not add a
method here before the engine has it and the pin has moved. See ADR-010.
The page reaches only the methods in `PAGE_METHODS` (`src/main/engine-ipc.ts`):
a new method the interface calls is added there, on purpose; `export.plan`,
`export.encode` and `engine.shutdown` are main-only and stay off it.

## Capture

A project's layout is computed once and stored with the project under the
engine's own id, the hash of the layout's inputs; a render or an export
reads it and never runs the layout stages on its own, and `map.build` is
always given the id. Re-layout is a button with a warning. See ADR-023 and
ADR-033.

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

## The export

The flow lives in the main process (`src/main/export.ts`), because the
capture does; the page starts, watches and stops it through `api.export`
and is told the file's name, never its path. **An export's plan never
carries `safe`**: the safe zones are for cell 06's preview alone. The
engine's plan goes through
`validateCaptureJob` before a window exists, and its file name must be a
bare name: both arrive from another process. The frames are removed when
the export ends, whichever way. A layout run and an export of one project
never overlap: the export reads the page a layout rewrites. The screen holds
that rule with disabled buttons; **main holds only part of it** (issue 491,
spec 037). `ProjectActivity` (`src/main/projectActivity.ts`) marks a project
while a `map.build` writing its `out` folder is in flight (set in
`engine-ipc.ts` before the guard's await, cleared in `finally`, so a failed
or cancelled request clears it), while its export runs, and while its
deletion runs. What main refuses: an export may not start while the map is
being written, with nothing planned or written; a deletion may not run while
a request names the project or it exports, with the record and `out/<id>`
untouched; and a `map.build` is refused while the project's deletion runs,
while its export runs, and for an `out` that names no project record (issue
505), so a layout's closing `map.build` cannot make `out/<id>` again for a
project deleted while its `graph.build` ran. That last question is the
store's (`ProjectStore.recordGone`, queued behind the project's writes),
asked within `FOLDERS_TIMEOUT_MS`, and a lapse refuses too; a record that is
there but cannot be read is let through. **The bridge marks first, then
asks**: `requestRefusal` and `beginRequest` in one turn, then the lookup's
await, then the guard's, whose sentence wins and whose last look at the
reset comes after every await. An export or a deletion begun while the
bridge awaits meets the mark. Of those, the export and the deletion also
refuse for a project whose `map.build` a bound ended (`inactive`, from
`Sidecar.expire`) while the engine still reports a request it stopped
answering (`Sidecar.abandoned`), since a mark follows the engine's answer
and not its work; the bridge calls `activity.abandon(project)`, only that
project is held, and the hold ends when the count reads 0.
`requestRefusal` checks the delete and export marks, not that hold. A
stop's failed requests are not counted, so for at most `shutdownMs` they
leave no mark (a known limit, `projectActivity.ts`). The sentences are
`src/shared/activity.ts`. **The screen alone still holds** a layout's
earlier steps: `graph.build` names a feed, not a project, so main cannot tell
whose it is, and it writes only `data/graphs/<key>/`.

## The hygiene hook and a commit

`.claude/hooks/guard-git.sh` runs the scanners over the *staged* tree
before any command that commits or pushes, so an edit and its commit
cannot share one shell command: stage and check first, commit in the
next. A private address a test needs (the guard in `feeds-ipc.ts` refuses
the RFC 1918 ranges) is assembled at run time with a comment saying why,
never written out, or the scanner refuses the file as it should.

## The preload bridge

The bridge is the whole attack surface between the page and the machine.
Expose named, typed, narrow methods over `contextBridge`; never expose
`ipcRenderer` itself, a path the renderer chose, or anything that takes a
command to run. Validate on the main side, not in the renderer, because only
the main side is trusted. So `feeds.add` is refused for a path no dialog
answered, and `feeds.remove` for a feed a project names
(`src/main/feeds-ipc.ts`).

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
