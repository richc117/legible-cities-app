# Architecture

What exists, in the present tense. The decision records under `docs/adr/`
say why, each feature's spec under `specs/` says it at length, and this
page says what; what is deliberately not here is the table at the end.

It runs from the outside in: the processes, the engine and the record
everything shares; then the screens a person meets, the notebook and the
front door; then the machinery behind them; and last what ships the app,
what draws it and what checks it.

## Three processes, one origin, one bridge

```
┌──────────────────────── Electron app ─────────────────────────┐      ┌─────────────────────┐
│  Renderer (React)            Main (Node)                      │      │ Engine (Python)     │
│  ┌───────────────────┐       ┌──────────────────────────┐     │      │ python -m           │
│  │ Library           │◄─IPC─►│ window, single instance  │     │      │   schematic.serve   │
│  │ project notebook  │       │ app:// protocol handler  │     │ stdio│                     │
│  │ engine status     │       │ projects:* → the store   │     │◄────►│ JSON-RPC 2.0,       │
│  │ window.api ───────┼───────┤ engine:*   → the sidecar ├─────┼──────┤ Content-Length      │
│  └───────────────────┘       │ viewer:* → the frame     │     │stderr│ frames; LOOM as its │
│   origin: app://local        └──────────────────────────┘     │→ log │ own child processes │
└───────────────────────────────────────────────────────────────┘      └─────────────────────┘
        userData/engine = SCHEMATIC_HOME
          projects/<id>/project.json   written by the store
          out/<id>/                    served read-only; removed on delete
          frames/<token>/              an export's frames, only while it runs
          feeds/, data/graphs/, out/   the engine's, under the same home
```

- **Main** (`src/main/`): the app lifecycle, the one window, the
  single-instance lock, the `app://` protocol handler, the project store
  and the handlers behind the bridge, configuration and the log, the
  viewer's driver (two frames per window, by role - the `map` and cell
  06's `export` preview - each matched once at attach and then held by
  identity and injected into from here; ADR-028, ADR-046), and the
  engine's supervisor: the one long-lived child process the app starts
  (a packaged app's first-run check starts the bundled tools once each,
  "The first-run check").
- **Preload** (`src/preload/`): a `contextBridge` exposing `window.api` and
  nothing else. `contextIsolation` on, `nodeIntegration` off, `sandbox` on,
  and the spellchecker off, in the main window (`spellcheck: false`) and in
  both sessions (`setSpellCheckerEnabled(false)`), because on Windows and
  Linux its service fetches dictionaries from a CDN; off on every platform,
  macOS included, for one behaviour everywhere.
- **Renderer** (`src/renderer/`): React. It draws the Library (the front
  door) and its New project sheet, and a project as a notebook of six
  cells with the viewer's sandboxed frame in the column between cells 02
  and 03 and a second one inside cell 06 while it is open, with a header,
  a rail and a foot (ADR-045, ADR-046; "The notebook" and "The front door"
  below, `docs/DESIGN.md` sections 8.2 and 9, and
  `specs/028-the-notebook/contracts/run-graph.md`, say how); it knows
  projects by identifier and never sees a path. It never draws a map: the engine's animation page
  is the viewer (constitution, principle I).

## The origin: `app://local`

One custom scheme and host, registered as a standard, secure origin before
the app is ready and handled in the main process. Two path prefixes:

| Path | Serves |
|---|---|
| `/ui/…` | The interface: built assets in a packaged app, the Vite dev server proxied through the same handler in development, so the page's origin is `app://local` either way |
| `/projects/<id>/…` | Generated project output, from `<SCHEMATIC_HOME>/out/<id>/`, read only |

Anything else is a clean 404. The identifier and the path are validated
before a filesystem path is built: identifiers match
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; path segments are decoded once each
and refused if empty, `.`, `..`, or containing a separator, a backslash or
a control character; the target's real path must lie under the project
directory's real path, so a symbolic link pointing outward is refused like
a traversal. Refusals are 403 or 404 with a one-word body and never a
path. The full contract:
`specs/001-electron-skeleton/contracts/origin.md`.

One origin is what the app has; it is no longer what makes the viewer work.
ADR-013 said a parent can drive a framed page only when the two share an
origin, and A3-02 found that false: the main process injects into a frame's
main world whatever its origin, and the sandbox does not stop it. So the
viewer's frame is sandboxed to an opaque origin instead, and the app reaches
into it from the privileged side (ADR-028).

## The bridge: `window.api`

Typed in `src/shared/api.ts`, which the preload and the renderer both
import; the `Api` interface there is the list of methods, and the tables
below describe them by namespace: the project record under `api.projects`,
the viewer's frames under `api.viewer`, the engine under `api.engine`, the
one file chooser under `api.feeds`, the export under `api.export`, one
clipboard write under `api.clipboard`, a job's copied log under `api.jobs`,
the app's own settings under `api.settings`, the first-run check under
`api.firstRun`, and the licences under `api.licences`.

| `api.projects` | Does |
|---|---|
| `list()` | the Library's entries, newest opened first (a project never opened since `opened` was kept by when it was made, A5.6-04); an unreadable record is skipped and logged, never shown broken |
| `get(id)` | one record, with `readOnly` set when a newer version of the app wrote it |
| `create({ name, feed, mode?, agency? })` | a new record, every other field at its default |
| `rename(id, name)` | changes `name` and `modified` and nothing else |
| `delete(id)` | removes the project and its output, and reports what could not be removed by folder role |
| `markOpened(id)` | writes `opened` onto the record as stored and nothing else - not `modified`, and not a read-only project (A5.6-04) |
| `completeLayout(id, done)` | records the layout's id, the feed's window and the service day a finished run produced; the id is the engine's own, as `graph.build` answered it (A3-01, ADR-033), the window is `feeds.service`'s answer (A3-04, ADR-031) |
| `completeRebuild(id, done)` | records the day a finished rebuild drew the map for, inside the stored window or not at all (A3-04) |
| `setInputs(id, { mode?, agency? })` | stores the mode, the agency or both, as a person chose them with the feed in view; the next layout passes them to the engine, which names a layout for them (A2-02) |
| `setDate(id, date)` | stores the service day a person chose, at once and before anything is drawn for it; it refuses exactly what `completeRebuild` refuses and never touches `drawn`, so a day chosen and not yet drawn is what the notebook's cell 03 reports (A5.5-15) |
| `completeColors(id, palette, sent, stations?)` | records the line colours a person chose, once the map has been drawn with them; every label and every colour is checked on the main side first (A4-01) |
| `completeLines(id, lines, sent, stations?)` | records each line's own options (its name, whether it is hidden, its width, its casing and its dash, issue 394) once the map has been drawn with them, as the colours are; the whole set the cell showed is written and the record keeps only the fields away from the engine's own; every label and field is checked on the main side first |
| `setTuning(id, tuning)` | records the layout's tuning (the grid and the numeric fields, issue 385) at once, with nothing laid out for it; the record keeps only the fields away from LOOM's own, and the grid and every number are held to the engine's own rules on the main side first |
| `completeOrder(id, order, sent, stations?)` | records the order a person arranged the lines in, once the map has been drawn in it; every label is checked on the main side first, and the same line twice is refused (A4-02) |
| `completeStyle(id, style, sent, stations?)` | records the sizes and looks a person chose for the map, in the engine's own names, once the map has been drawn with them, as the colours and the order are; every number is held to the engine's range and the two radii to the engine's rule on the main side first, in the engine's own sentences (issue 350, ADR-049) |
| `setTheme(id, theme)` | records the theme the project's map is drawn in, at once rather than after a build: a theme is neither a layout nor a render, and the page restyles in place when told (the app calls its `setTheme` after the write; the next load carries the theme on its address; A4-03, issue 349) |
| `setExport(id, choice)` | records what the project is set to export - a preset, a storyboard, the options - at once; every field is held to the engine's own rules on the main side first (A5-01) |

Each `complete…` method that ends a draw carries `sent`, what the draw's
`map.build` was sent, which the store keeps as `drawn`, and the stations the
build answered ("The record session", "Route mode").

| `api.viewer` | Does |
|---|---|
| `viewer.attach(projectId, role)` | holds the project page's frame in a role, `map` or `export`, by identity once it has loaded, and answers whether it did (ADR-028). The role is read from the address once, here: `safe=1` is always the export's, the app's own `controls=1` the map's, and anything else under the project's folder a planned page without safe zones, the export's; the frame the other role holds is never taken (ADR-046) |
| `viewer.release(role)` | lets that role's frame go, and keeps the other |
| `viewer.call(role, method, ...args)` | one of the page's `__present` methods by name, run in the frame held for the role from the main process; a name outside the shared list is refused, and the export's frame is asked `state` (whether it loaded) and refused everything else |
| `viewer.seams()` | the names of the functions on the map's page's `__present`, or null where it did not say, listed by a fixed script that calls none of them and read as data in both processes (`readSeams`); it takes nothing, is asked of the map's frame only, and rejects while no map is held. It is how a page an older engine drew is told (issue 465), beside the version `drawn.engine` names (issue 494) |

| `api.engine` | Does |
|---|---|
| `engine.state()` | the engine's state: starting, ready, restarting, unavailable, mismatched or stopped, with a reason where there is one |
| `engine.request(method, params?)` | a request to the engine, as `{ id, result }`: the id is a token the preload mints, the result settles with the engine's answer or its error (`code`, `message`, `data: { kind, detail, hint }`) unchanged |
| `engine.cancel(id)` | `$/cancelRequest` for that request |
| `engine.onState`, `onProgress`, `onLog` | subscriptions; each returns its unsubscribe |

| `api.feeds` | Does |
|---|---|
| `feeds.pickZip()` | opens the platform's file chooser for a GTFS zip and remembers the answer; the one native dialog for a file, since a page cannot choose one (A2-01) |

| `api.export` | Does |
|---|---|
| `export.run(projectId, choice)` | an export of one preset with its storyboard and options, as `{ id, result }`: the main process asks the engine for the plan, takes the page's frames itself and asks the engine to encode them; the result is the file's name and size, never its path (A5-02b, A5-01) |
| `export.preview(projectId, choice)` | the address cell 06's own preview frame shows while the cell is open (ADR-046): the engine's plan for the choice with the safe zones asked for exactly where the preset has them; `{ ok, url, width, height, notes }` or the engine's refusal as data; nothing is captured or written (A5-01) |
| `export.cancel(id)` | stops it wherever it is: the plan or encode request is cancelled, the capture aborted |
| `export.reveal(id)` | shows a finished export's file in the platform's file browser; the page names the export, the main process knows the file |
| `export.outputs(projectId)` | what the project has produced, newest first, one row per sidecar in the folder it exports to, read from disk; no path comes back (A5.5-21, "The rail and Outputs") |
| `export.revealOutput(projectId, file)` | shows one of those in the platform's file browser by the file's bare name, checked against the folder's own contents on the main side; false when the file is no longer there |
| `export.chooseDestination(id)` | opens the platform's folder chooser for one project's exports and applies its own answer, then hands back the record; no path crosses inward, as Settings' two folders do not (A1-04, A5.5-19) |
| `export.useAppFolder(id)` | forgets that folder, so the project's exports go to the app's again; it takes no path at all (A5.5-19) |
| `export.onProgress` | a subscription; each report names the stage (plan, capture, encode), how far it is, and a sentence |

`chooseDestination` and `useAppFolder` both write a project's record, so
both are refused while the engine's data is being reset, as every other
record write is.

| `api.clipboard`, `api.jobs`, `api.settings` | Does |
|---|---|
| `clipboard.write(text)` | puts text on the clipboard and nothing else; the page may write it, never read it, because the app refuses every permission request and Chromium's own clipboard write is one (`specs/017-diagnostics`) |
| `jobs.copyLog(text)` | puts one job's log on the clipboard: the page composes the text (at most 256 KB, checked in main), and the main process redacts every web address's secrets and writes the home folder as `~` through the same lookup and deadline as the diagnostics copy, refusing if a home survives (A1-03) |
| `settings.read()` | the two folders in force, where each came from, whether the environment names it, any folder waiting for a restart, and the theme (A1-04) |
| `settings.setTheme(theme)` | one of system, warm-dark and sepia; anything else is refused |
| `settings.chooseEngineFolder()`, `chooseExportFolder()` | opens the platform's folder chooser and applies its own answer; no path crosses the bridge inward; the engine's folder is refused, and nothing stored, while a project exports to a folder of its own that is inside the folder chosen, is it, or holds it, naming the project (issue 206) |
| `settings.useDefaultEngineFolder()`, `useDefaultExportFolder()` | forgets the stored folder and takes the default again; for the engine's folder it is refused, and the stored folder kept, on the rule that refuses a chosen one: while a project exports to a folder of its own that is inside the default folder, is it, or holds it (issue 206) |
| `settings.engineSize()` | walks the engine's home, bounded and never through a symbolic link |
| `settings.openLogsFolder()` | makes the platform's log folder for this app if it is missing, and opens it |
| `settings.resetEngineData()` | removes `projects`, `out`, `data` and `frames` beneath the engine's home, never the home itself; answers what went and what would not; refused while anything is writing under it, and while a project under this home exports to a folder of its own that is inside the home, is it, or holds it, naming the project (issue 206; choosing the engine's folder is refused on the same rule, a project's folder is refused against the engine folder waiting for a restart, and none of the three sees a record left behind in a previous home) |
| `settings.copyDiagnostics(reports)` | puts what a bug report needs on the clipboard: the versions, the operating system, `engine.info`, the last 200 lines of both logs and the reports given, each project's diagnostics as its panel copies them (at most `DIAGNOSTICS_REPORTS`, checked in main); composed in the main process with the home folder written as `~`; nothing is sent (A6-03) |

| `api.firstRun`, `api.licences` | Does |
|---|---|
| `firstRun.get()`, `onChanged` | the first-run check's result, and each change to it (A6-02, "The first-run check"); nothing the page sends reaches a spawn |
| `firstRun.openInstallGuide()` | opens the install document in the platform's browser, at an address the main process holds |
| `licences.read()` | whether the notices, the runtime's licence texts and Chromium's licences are there to open (issue 108, "Licences") |
| `licences.openNotices()`, `showTexts()`, `openChromium()` | open each of them; none takes an argument, since the paths are fixed in the app and held by the main process |

The engine bridge is deliberately untyped beyond a method name and an
object of parameters: the typed client over it is generated from the
engine's schema and wraps it (A1-02, "The protocol, as types"). An engine error crosses as a plain object rather than an
`Error`, because Electron keeps only an error's message and the engine's
`data.hint` is what the interface shows. A request's answer arrives as an
event on the same ordered channel as its progress and log lines, after
them, because Electron does not order an invoke's reply against events.

Every argument is validated on the main side, with the validators in
`src/shared/project/validate.ts` that the form also uses and those only main
runs in `src/main/record/validate.ts`; a refusal is a rejected
promise whose message is the sentence a person reads, never a path. Every
handler checks that `event.senderFrame` is the window's top frame and
refuses any other caller, which is another web contents: a second window,
a webview. It could not distinguish a same-origin iframe calling
`parent.api`, because the bridge's functions run in the top frame that
exposed them; that is why the viewer's frame is sandboxed to an opaque
origin and never shares the interface's (ADR-028). Nothing that crosses the
bridge, in either direction, is a filesystem path the renderer did not ask
for, and no method takes one the renderer chose. What does carry a path is
named: the engine's answers, which `engine.request` hands on unchanged and
whose paths the renderer keeps off the screen (`graph.build`'s stage
graphs, the folder the write stage reports; "The layout run"); the engine's
`job/log` lines (`engine.onLog`), which cell 02 draws as they come and
which are redacted for URLs only, so an engine path can reach the screen
there ("The log files"); the zip `feeds.pickZip`
answered, which goes back only as the source of a `feeds.add` the main
process holds to its own dialog's answer ("The feeds"); and the folders a
person chose, which Settings and cell 06 show to the person whose folders
they are. The renderer addresses a project by its identifier only. Each addition is a
reviewed change to the type, the preload and the main-side handler
together. Contracts: `specs/003-project/contracts/bridge.md`,
`specs/004-sidecar-supervisor/contracts/bridge.md`,
`specs/007-layout-run/contracts/bridge.md`,
`specs/008-viewer/contracts/viewer.md`,
`specs/010-export/contracts/bridge.md`,
`specs/012-service-date/contracts/bridge.md`,
`specs/014-feeds/contracts/bridge.md`,
`specs/017-diagnostics/contracts/bridge.md`,
`specs/018-colours/contracts/bridge.md`,
`specs/019-settings/contracts/bridge.md`,
`specs/020-line-order/contracts/bridge.md`,
`specs/021-theme/contracts/bridge.md` and
`specs/037-record-session/contracts/bridge.md`.

## The engine process

The engine is `python -m schematic.serve` from the pinned engine
(`vendor/pins.json`, `engine` block: tag, version, protocol), run by the
first interpreter of these that exists and by nothing else: the one
`LEGIBLE_ENGINE_PYTHON` names; in development, the engine checkout's own
`.venv`; in a packaged app, the bundled runtime under the app's resources,
started with `PYTHONDONTWRITEBYTECODE=1` so nothing it imports is ever
written into the bundle (see "Packaging" below). With none, the state is *unavailable* with a sentence that names the key to
set, and the app is otherwise usable.

`src/main/sidecar.ts` spawns it with an argument array, `windowsHide`, a
process group of its own on POSIX, and an environment built from an
allowlist (the path, the home, the temporary directory, the locale, proxy
and certificate variables, `DOCKER_*` for the development backend, the
engine's `SCHEMATIC_*` keys (set in `engineEnvironment`, `src/main/interpreter.ts`, which is the list), and `PYTHONPATH` in development only, which
is how the tests substitute a stand-in engine). Every stderr line goes to the
log as it arrives under the `engine` tag. `src/main/jsonrpc.ts` speaks
JSON-RPC 2.0 with `Content-Length` framing over the child's stdio, our own
client rather than a library because the engine keys its notifications by
the request id, which the client must therefore assign and know.

The handshake is `engine.info`, bounded at 10 s: the version and the
protocol must equal the pin, or the page's own dialog names both and the
state is *mismatched* for the rest of the run. Every other request has an
inactivity bound (10 min without a `job/progress` or `job/log` line for it),
after which the app cancels it and says so. A request may also be sent with
a deadline of its own (`request(method, params, { deadlineMs })`), which
neither progress nor a cancel extends: past it the app sends
`$/cancelRequest`, unless a cancel already did, and ends the request with
the same `inactive` error; an answer that comes later is dropped. Ending a
request is not ending the engine's work, so a request either bound ended
is still counted as in flight until its late answer arrives or that
engine's process has exited (not merely begun to be ended), and the reset
of the engine's data refuses meanwhile. A request that times out is not a
failure, so nothing restarts an engine that never answers it; the reset's
refusal then says so and that quitting and reopening the app is the way
out. The deadline is
cleared by the answer, and with every request when the engine exits or the
app quits. No request is sent with one now: `feeds.remove` was, 30 s (issue
107), while the engine ran it on its one reader thread, and since engine
v0.11.0 it is a job that can be cancelled, so a person stops a removal with
Cancel and an engine that has stopped answering ends it through the
inactivity bound like any other request (issue 351, "The feeds" below). The
option stays, with its tests, for a request whose work is short and known.
The pinned engine runs `feeds.remove` as a job, like `feeds.add`: the reader
keeps answering while it works, a cancel before the write of
`user-feeds.json` keeps the feed with every file in place and is answered
with the cancelled error, and a cancel after it is not honoured, the files
are removed to the end, and the answer carries `cancel_too_late`. An exit
nobody asked for
rejects the requests in flight, restarts the engine after 1, 2 and 4 s, and
gives up after three consecutive failures; the count starts afresh once
the engine has answered a request or been ready for 30 s. On quit the app
asks (`engine.shutdown`, 3 s), terminates (the group on POSIX, the tree with
`taskkill /T /F` on Windows, 3 s), then kills, and only then exits. The
state is one line in the interface's header, a polite live region.
Contract: `specs/004-sidecar-supervisor/contracts/sidecar.md`.

The tests run the supervisor against a stand-in engine,
`tests/fake-engine/schematic/serve.py`: a standard-library Python module
that speaks the same framing and is told how to behave by a file in the
test's engine home, so the supervisor is proven on runners that have no
engine. The tests against the real engine, the `*-real` unit suites, run
where an interpreter with the engine is named - `LEGIBLE_ENGINE_PYTHON`, or
the virtual environment of the checkout `LEGIBLE_ENGINE_CHECKOUT` names, from
the environment or `.env.local` (`tests/support/real-engine.ts`) - and skip,
saying so, elsewhere; `determinism.yml` runs them against the engine it
installs and fails on a skip ("Checks").

## The protocol, as types

The engine describes its whole protocol as a JSON Schema and prints it on
demand. That description is the app's source for every method name, every
parameter and every result, so that a change on the engine's side the app
has not followed is a build error rather than a refused request in front of
a person (constitution, principle II).

| File | What it is |
|---|---|
| `vendor/protocol.schema.json` | the engine's description, printed by `python -m schematic.serve --schema` and committed byte for byte |
| `vendor/pins.json`, `engine.schema_sha256` | its fingerprint, beside the engine's tag and version |
| `src/shared/protocol.ts` | the types, generated from the description and committed; edits are lost |

`npm run typegen` writes all three from the engine checkout named by
`LEGIBLE_ENGINE_CHECKOUT`, or stops and changes nothing when there is none.
The generator is `scripts/protocol.ts`, and it has no dependency: the
description uses a closed set of JSON Schema keywords, some that shape a
type and the rest that constrain values and are ignored (`KNOWN` in
`scripts/protocol.ts` is the set). An unrecognised one stops the build
naming the keyword and its path rather than emitting a plausible wrong
type. A library was measured and rejected,
because running the output through a formatter would make the committed
file depend on that formatter's version
(`specs/006-typed-engine-client/research.md`, section 2).

The description also says the animation page `map.build` writes, as a host
drives it (`page`, engine v0.21.0, issue 607), and the app keeps no copy of
its own of any of it. `page.seam` is the methods of the page's
`window.__present`, each with its positional arguments, its answer and the
version it arrived at, generated as `PageSeam`, `PAGE_SEAM_NAMES` and
`PAGE_SEAM_SINCE`; the capture's calls of the seam are typed by `PageSeam`
(`seamCall` in `src/main/capture.ts`), the map's allowlist `VIEWER_METHODS`
must name methods of it, and a page lacking one of `PAGE_SEAM_NAMES` is
older than the pin. `page.requires` is the Content-Security-Policy
directives a frame hosting the page must allow, generated as
`PAGE_REQUIRES`, which the project pages' policy is composed from
(`PROJECT_CSP` in `src/main/protocol.ts`), and `page.fetches` says the page
fetches nothing, which is why that policy has no `connect-src`: the
generator refuses a page that would fetch, a directive that is not one
whole directive, and a version that is not three numbers. Nothing reads the
schema at run time; the constants are generated TypeScript.

Three checks keep the copy honest. Two need no engine and so run on every
machine that builds the app: the fingerprint must match the committed
description, and regenerating the module from that description must
reproduce the committed file byte for byte. The third asks the engine in
the checkout for its description and fails on any difference, naming the
first differing line and the command that fixes it; with no checkout it
reports itself skipped rather than passed.

The renderer reaches the engine through
`src/renderer/src/engine/client.ts`, one client for the whole interface
(`engineClient()` in `engine/runs.ts`): the runs, the inspections and the
feed list all ask through it, and the status line reads the bridge directly
for the one thing the client does not carry, the engine's own state.
The bridge underneath stays untyped on purpose, because transport should not
know the engine's methods; the client is the layer that does. It takes the
bridge in its constructor, so its tests need no Electron, and it neither
tightens nor relaxes the description anywhere. A request hands back a
handle: the engine's result, that one request's progress and log lines, and
cancellation by the token the preload minted. Two shapes the bridge carries
are the engine's with one named difference each: a notification's id is the
token rather than the engine's numbering, and an error's kind may be one of
the app's own as well as the engine's (`APP_ERROR_KINDS` and
`ENGINE_ERROR_KINDS` in `src/shared/engine.ts`), for a failure the engine
never saw. Both are derived from the generated types rather than copied, so
neither can drift. Contracts:
`specs/006-typed-engine-client/contracts/client.md` and `generation.md`.

## Configuration and the startup log

Four locations, one pin and one development pointer, from the process
environment, then `.env.local` (development only, gitignored; `.env.example`
documents it), then the two folders a person chose in Settings, then what a
packaged app carries (reported as `bundled`), then defaults:

| Key | Default |
|---|---|
| `SCHEMATIC_HOME` | the folder chosen in Settings, else `<userData>/engine` (ADR-016) |
| `SCHEMATIC_LOOM_BIN` | in a packaged app, `loom/` under its resources whenever that folder exists, so a missing tool is the engine's error and never a fall back to Docker; otherwise unset. A directory of native LOOM binaries, which the engine runs instead of its Docker image |
| `SCHEMATIC_LOOM_COMMIT` | passed when set, or with a LOOM directory, where the default is the app's pin (`loom.commit` in `vendor/pins.json`); the binaries cannot say which LOOM they are, so the engine reports what it is told as `engine.info.loom.commit` |
| `SCHEMATIC_FFMPEG` | in a packaged app, `ffmpeg/ffmpeg` (`.exe` on Windows) under its resources whenever the `ffmpeg/` folder exists; otherwise unset, and the engine takes the first on `PATH` |
| `LEGIBLE_EXPORT_FOLDER` | the folder chosen in Settings, else `<desktop>/Legible Cities`; where exports go, in a folder per project |
| `LEGIBLE_ENGINE_CHECKOUT` | unset; the tokens test reads the engine page from it, and the engine runs from its `.venv` |
| `LEGIBLE_ENGINE_PYTHON` | unset; an interpreter named explicitly (a path, or a bare command for PATH), which wins over the checkout |

At startup the main process logs every value with its source, and what is
unset, before the window opens, so a misconfigured run is diagnosable from
the terminal. Contract: `specs/001-electron-skeleton/contracts/config.md`.
The app writes to the engine home only under `projects/` and, while an
export runs, `frames/`; it removes only a project's `out/<id>/` on delete
and, at start, what is inside `frames/`; `feeds/` is the engine's and
untouched. The frames sweep empties a folder the app made and no other: the
home is a setting and can name anyone's directory, so the app marks a frames
folder it creates and refuses to empty one carrying no mark. Every folder
above it is resolved through its symbolic links, and a link where the frames
folder should be is refused rather than followed, as the reset refuses one.
It never removes the frames folder itself.
The one exception is "Reset engine data" in Settings, which removes
`projects/`, `out/`, `data/` and `frames/` beneath the home - never the
home itself, and never anything else in it (A1-04).

## The project record

A project is one folder under the engine home, named by its identifier:

```
<SCHEMATIC_HOME>/projects/<id>/project.json
```

The identifier is twelve characters, a letter followed by letters and
digits, generated by the main process on create and never derived from the
name: the name is a label and may be anything, while the identifier is what
the origin's rule and its reserved-name check accept. The record is JSON,
pretty-printed so a person can read it, and carries every field a later
feature owns at its default - mode, agency, service day, style, colour
overrides, default colour, line order, theme, stored layout - so that
feature usually changes a value, not the shape. A field added since is optional and absent until a person sets it, and the version does not move for it (below). The defaults mirror the engine's
own and are stored as data, not interpreted. Contract:
`specs/003-project/contracts/record.md`.

**Where the record's code lives** (spec 037, User Story 5). By what it
holds and by which process uses it, with no module every process imports
whole:

| Where | What |
| --- | --- |
| `src/shared/project/types.ts` | the record's types, the lists they are made from, the engine's tables and the defaults |
| `src/shared/project/validate.ts` | the validators and predicates both processes run |
| `src/shared/project/sentences.ts` | the engine's refusal sentences, word for word |
| `src/shared/project/helpers.ts` | what both derive: a style, a tuning and a line's options as sent, the day drawn, a day's refusal |
| `src/main/record/` | main only: `parse.ts` (the version, the parser and its readers), `carried.ts` (what a later build wrote, ADR-056), `validate.ts` (whole objects and a run's facts), `drawn.ts` (`drawnFromSent`), `helpers.ts` (the writers' and the list's) |
| `src/renderer/src/record.ts` | the interface only: the palette, the order, a free name, a run's sent set, the older-page check |

`tests/unit/import-graph.test.ts` holds the boundaries: nothing under
`src/renderer/` or `src/preload/` imports from `src/main/`, nothing under
`src/main/` or `src/preload/` from `src/renderer/`, nothing under
`src/shared/` from either, no value import cycle among `src/shared/`'s
modules (a type-only import is not one), and `src/shared/project.ts` is
gone for good.

**Versioning.** Every record carries a `version`, the number `RECORD_VERSION` in `src/main/record/parse.ts` (the contract in `specs/003-project/contracts/record.md` says what each number changed). The version moves when what an existing field means changes, and for no other reason: a field that is only added, optional, does not move it. A record from an earlier
version is read with its missing fields at their defaults and written back
in the current form only when something else changes. A record from a
later version - a higher number - is read-only: the Library lists it, the
project view says so, rename and delete are disabled, and the file is never
rewritten. A folder under `projects/` without a readable, valid record is
not a project: the Library skips it and the log names the folder.

**Writes are atomic.** The store writes a fresh temporary file beside the
record for each write (`project.json.<random>.tmp`) and renames it over
`project.json`, so a crash mid-write leaves the previous record rather than
a truncated one; readers ignore a stray `.tmp`. On Windows a rename over a file is refused while another handle
has it open - a scanner, or a read in this process - so there the rename
alone is tried again on `EPERM`, `EACCES` or `EBUSY` over about 1.3 seconds
before the write fails, and the settings file's is too; this is a defence,
because a held file is the suspected and not the proven cause of issue 93
(`src/main/replace-file.ts`). A write still retrying when the app quits is
dropped: the record stays whole, and a stray `.tmp` may remain, which
readers ignore. Rename changes exactly `name` and `modified`.

**Delete removes two folders**: `projects/<id>/` and the project's
generated output under `out/<id>/`, whether or not the latter exists.
Nothing else is touched - not `feeds/`, not another project - and whatever
could not be removed is reported by role, project or output, never by
path.

**Until the first layout**, `date` and `layout` are `null`: the project's
card on the front door says it is "not laid out yet", and cell 02 says
"This project is not laid out yet." at the top of the cell's body, where
it has no footer to draw. The service
day is resolved once, at the project's first layout, as the engine's choice,
and stored then; it is never re-resolved silently, and changing it is an
explicit action (ADR-031, which amends ADR-023 on the moment; "The service
day"). The layout is the stored layout's id, produced by that same first
layout: the engine's own, the hash of everything that went into the layout
(ADR-033; a record from before carries the app's digest of the stage
graphs, which the next run replaces).

## The record session

Every read and write of a project's record goes through one queue in the
main process, and that queue, with one property of the bridge, is the
whole of what keeps the record and the map on screen agreeing (spec 037,
part 1; issue 426 is the umbrella).

**One queue per project, in main.** `ProjectStore.#serial` chains every
writer of a project's record, `markOpened` and `setDestination` among
them: each reads the record as the write before it left it, changes the
fields it names, and writes it whole (`writeAtomic`), so two writers never
put back each other's field. `projects.get` waits in the same queue, so a
read answers with every write sent before it. A write that names one of two
fields leaves the other as it found it: the inputs' writer takes the mode,
the operator or both (`setInputs`, a patch). Every write raises the
record's `revision` by one; absent reads as 0 (ADR-056's additive rule).

**The ordering property.** For one renderer frame, Electron hands main the
`projects:*` invokes in the order they were sent, and every handler in
`src/main/ipc.ts` reaches the store's queue in the turn it is handed its
message, with no `await` before it. So a write's answer is the record with
that write and every earlier one applied, the answers come back in the
order the calls went, and a `get` sent after a write answers with it. A
call the handler refuses before the store - a shape it will not take, the
reset's flag, a frame that is not the interface's - is answered at once,
ahead of the queue; a control that takes "the last answer is the latest"
validates its choice before it sends it, as every one does.
`tests/e2e/record-order.spec.ts` holds the first half under a spinning main
process (looped with load on macOS and Windows before anything was built on
it); `tests/unit/ipc.test.ts` holds the second, by behaviour and by a read
of the handlers' source.

**A run reads its inputs from the store, once, at its start.** A layout,
a rebuild, Run all and the four redraws each read their record through the
run's `read` (`projects.get`) at the press, after `beforeStart` has flushed
the controls that hold a choice back on a timer (cell 03's day), and plan
from that, never from the record the screen handed, which can be a render
behind. A field committed by the very press that starts the run - a tuning
left for "Lay out", an operator chosen a moment before - was sent before
the read, so it is in what the run sends. The run is `running` from the
press, so Cancel is there while it reads, and a cancel ends the read.

**`drawn` is what the run sent.** Every completion carries its sent set
(`SentSet` in `src/shared/project/types.ts`): the layout and its `made`, the
day, the palette, the order, the style and the line options exactly as
`map.build` was built from them, made once in `#draw`. The store makes
`drawn` from that alone (`drawnFromSent`), with the theme from the record
at the write, since no draw sends one and the page is told it in place. A
choice written while the run went is the record's and not the map's, which
is what lets a cell say it is not drawn yet. The set comes from the less
trusted process, so the bridge and the store read it field by field with
the record's own validators and sentences (`validateSent`).

**The rule a new control follows.** Write the choice the moment it is
made, through the bridge, and take the answer when it comes; do not order
writes, queue them, or wait for one before sending the next, because the
bridge and the store keep the order. A control that holds a choice back on
a timer flushes it from the run's `beforeStart`, so a press sends it first.
A write names only the fields it changes. A control that shows its own
choice while the answer is on its way waits for the answer to its last
write before taking the record again (`LayoutTuning`'s, the theme
chooser's): the answers arrive in order, so the last write's answer is
the last to arrive. A run is never handed a record to trust: it reads its
own.

**A cheap edit goes through `useCheapEdit`, and nothing else.** A cheap
edit is a choice drawn by a `map.build` from the stored layout and never by
a re-layout - the line colours, the line order, the sizes with their looks
and markers, the line options - and it is shown at once and written only
once the map carries it, by the redraw's completion (part 2, issue 490;
`src/renderer/src/notebook/useCheapEdit.ts`). A new one gives the hook its
own kind of run, its fields as the record holds them, how two values
compare, the redraw that draws one, its delay, and what to do to put the
control back or take the record onto it; it keeps no timer, no reading of
the run's state and no comparison with the record of its own. The hook then
holds the rule for all of them, in this order. **The wait**: drawn the
delay after the last change, or, for the colours, at a gesture's end with
the colours on the way only shown (issue 262). **The hold**: while a run
goes, an export reads the page, a finished run's record is being read back,
or the run has moved on since the screen drew, the change is held and asked
again after the delay, never refused, and it is asked before the change is
compared with the record (`mustWait`, issue 399). **The put-back**: when the
panel's own redraw stops, or its start is refused at once, the control goes
back to the record and what was waiting is dropped (`stoppedNow`,
`refusedAtStart`, issues 360 and 399). **Adoption**: a record that arrives
is taken onto the control unless a change is waiting or under a hand, or
the panel's own redraw is going - until it ends the record does not hold
what it draws - while every other field is the record's at once, because
the panel reads it from the record and holds no copy. **The panel going**:
a change still waiting is flushed, as if its delay had run out; one the way
is not clear for waits on with no screen behind it and is drawn once the run
and the export let go of the page, from the record and the engine's state
read then through the bridge and compared with that record, never from the
last render's, which may be behind (a project laid out since, an engine
started since); a read refused because the project is gone ends it, and any
other refused read leaves it waiting. A stop of the panel's own kind meanwhile drops it, as with
the panel there, and a panel of the same kind that comes back for the run
takes it over, so two editors never hold one panel's whole value - the
palette, the order, the style, the lines - at once. A start refused then is
said on the project's status line, after the cell's failure, because the
control that would have gone back is gone (`sayRefusedGone`, read by
`useProjectState` as `refused`). The hook neither writes the record nor orders a write, so it
needs nothing from `beforeStart`: a cheap edit waiting when another run is
pressed is not part of that run, and is drawn after it. Its rows are
`tests/unit/cheap-edit.test.tsx`, one table per panel rendered through the
panel's cell, each row watched failing under a mutation of the hook.

## The notebook

A project's screen is a notebook of six numbered cells in one scrolling
column, read top to bottom in the order the work runs, with the map between
cells 02 and 03 and nothing pinned but the window's header
(`.app-header`; ADR-045, ADR-046;
`docs/DESIGN.md` sections 8.2 and 9). Its one specification is
`specs/028-the-notebook/contracts/run-graph.md`: which cell a run belongs
to, what `drawn` records, when a cell is stale and why a cheap edit never
is, and Revert. This section says where each of those lives in the code and
leaves the rules to the contract.

### The six cells

| Cell | Holds | Adapter under `src/renderer/src/notebook/cells/` |
| --- | --- | --- |
| 01 Data | `Inspect`, `StageView`, the feed's download (`DownloadLine`) | `DataCell.tsx` |
| 02 Process | `LayoutRun`, the layout's tuning (`LayoutTuning`), the engine's log (`EngineLog`), `Diagnostics` | `ProcessCell.tsx` |
| 03 Frame and service day | `ServiceDay`, the transport (`Transport`), the trip (`Trip`) | `FrameCell.tsx` |
| 04 Style | `ThemeSwitch`, `StyleFields` with `StyleLooks` | `StyleCell.tsx` |
| 05 Lines | `LineColours`, with each line's options under its row (`LineOptionsDisclosure`, held by `useLineOptions`), and `LineOrder` | `LinesCell.tsx` |
| 06 Export | `ExportTab` (with `ExportOpening`), which draws `ExportRun` itself, and the cell's own preview (`ExportPreview`) | `ExportCell.tsx` |

`Notebook.tsx` walks `CELL_LIST` (`src/renderer/src/runGraph.ts`, which
fixes the numbers and the names) and names no adapter: `notebook/cells.tsx`
maps a cell's id to its view, so a cell's own work edits its file under
`cells/` and nothing above it. Each adapter fills `notebook/Cell.tsx`, which
knows nothing about a project: a number, a name, a state, a summary for
while it is collapsed, its controls and an optional footer. The heading row
is the toggle, inside a real heading, because the notebook is walked by
heading. A collapsed cell keeps its controls in the document, so a change
waiting on a timer or a half-typed field is not lost by closing it. Which
cells are open is `Notebook.tsx`'s state and is never stored: a project with
a layout opens with cells 01 and 02 collapsed, so the map is the first tall
thing on screen, and one without opens with them open; cells 03 to 05 start
open and cell 06 closed (`startOpen`); and a cell never opens or closes
itself afterwards. Three cells have a provenance footer
(`notebook/CellFooter.tsx`): 02 the layout the map is drawn from, 03 the day
against the window the feed covers, 06 the last export's file and its
sidecar. 01, 04 and 05 have none, because they have nothing true to report.

What the cells share is one hook, `notebook/useProjectState.ts` - the
record and its writers, the two runs and whether either is going, and the
refs the focus handbacks point at - carried to them by contexts, so a cell
reads what it needs without a prop list. The contexts are split by who
reads what (issue 433): the record; the runs, with whether either goes;
the export's snapshot alone, which moves every frame; the actions, the
writers and callbacks made once per project; and three small ones for the
map - the redraw count (the map's frame and cell 03's transport), the
theme reload count (the frame alone) and what the opening redrew (cells 02
and 03). Each value is memoised over its own fields, so a part of the
screen renders for a change to what it reads and for nothing else; a run
snapshot still renders all six cells, because each row shows the run's
progress. They are composed in one place, `ProjectProviders` in
`notebook/context.tsx`, which `ProjectView.tsx` and the unit tests' harness
both draw, and the contexts themselves are private to that module. Three
things keep the memo honest: the screen's body is one element made once
(`PROJECT_SCREEN`), the notebook draws each cell, the map and the outputs
in a slot that passes them by while their props are unchanged, and
`tests/unit/cell-renders.test.tsx` counts each part against each kind of
change. What belongs to one component stays in it: the rename's field and
the delete's confirmation are the footer's own state, and their two writes
(`setName`, `deleteProject`) are the hook's, with the others.

### The header and Run all

`notebook/ProjectHeader.tsx` is the project's own header, not the window's
(ADR-036): the project's name as the screen's heading, one `role="status"`
line saying what the notebook is doing as a whole (`notebookSentence`), an
alert region of its own naming every cell that failed (`failureSentence`),
and Run all.

Run all brings the map up to date with cells 01 to 05 with the two runs the
notebook already has, never a sequence of its own
(`src/renderer/src/runAll.ts`). `runAllPlan` answers a layout run, unforced,
where nothing is laid out, a source in cell 01 or 02 is open, or a run of
either failed; a rebuild for the record's day from the stored layout where
only the cells below are behind - a day chosen and not drawn, or a redraw
of cell 03, 04 or 05 that failed; and nothing otherwise. It is never
a re-layout, which stays behind its warning (ADR-033), and **it never runs
cell 06**: an export writes a named file and can take minutes. Nothing on
screen says so (the sentence that did went in issue 276); the `export.plan`
assertions in `tests/e2e/layout.spec.ts` hold it. The button is drawn only while the plan
has something to run, and not while a run or an export goes, while a
finished run's record is read back, or for a read-only project
(`runAllOffered`); while the project's run goes it gives way to Stop, the
run's own cancel whichever cell started it. The plan is made again from the
record the run reads from the store at its start (`LayoutRun.runAll`), once
every write sent before the press has landed (issue 407, "The record
session"), and where that record leaves nothing to run the run withdraws
and nothing is drawn or written. `tests/unit/run-all.test.ts` holds the
plan as a table of records.

### The rail and Outputs

`notebook/Rail.tsx` is the project's left rail: the six cells as a numbered
stepper, and the project's Outputs under it. It is the project's, as the
inspector is the window's (ADR-036). It is a `<nav>` named "Steps" holding
an `<ol>` of buttons, deliberately not a tablist, because every cell stays
in the document and a tablist would promise that the other five are
hidden. A step's name is its number, its name and its state.
`aria-current="step"` follows the scroll and never takes focus; a press
opens the cell if it is closed, scrolls it clear of the header
(`notebook/railScroll.ts`) and moves focus to the cell's heading rather than
its toggle, where a reflexive Space would close it again.

Outputs (`notebook/Outputs.tsx`, and `src/main/outputs.ts` behind
`export.outputs`) lists what the project has produced, newest first, read
from disk rather than from the session, so a file is findable after a
restart: one row per sidecar the engine wrote beside a deliverable, in the
folder the project exports to now - its own destination or the app's
folder, under the folder named after the project - at most `OUTPUTS_MAX`
rows. It is read again whenever an export settles. A row says the preset
and when it was made, and no path. Reveal names the file by its bare name,
which the main process checks against what the folder holds before it joins
the two, so a name the page invented resolves to nothing; a file moved or
deleted since reads as gone and offers nothing to press. Because a person
may point a destination at a folder they already use, a sidecar over
`SIDECAR_MAX` is passed over unopened and one read opens at most
`SCAN_MAX`.

### The map block and cell 06's preview

The map is a block in the column after cell 02, whose layout it is drawn
from, and before cell 03, the first of the cells that act on it
(`notebook/Preview.tsx`, `styles/preview.css`). It scrolls with the cells;
it is not pinned, because a pinned band hides what it covers (ADR-046).
`Notebook.tsx` renders it in the same place in every render, so its frame is
one element for the life of the screen and is never moved between parents:
a reparent reloads the engine's page, as a changed address does, and a
reload loses its clock, its view and its scrub position. The block is there
whether or not there is a map. A project with no layout gets a shorter box
saying "This project has no map yet." with a way to cell 02, so a map
arriving later fills room kept for it, and the sentence sits in a status
region that is never removed, so the map's arrival is heard. "Skip past the
map" (`SkipPastMap.tsx`, issue 106) sits immediately before it and moves
focus to cell 03's heading, which is there whether the cell is open or not,
falling back to the screen's own heading (`skipPastMap` in
`notebook/useProjectState.ts`). The project is renamed and deleted in the
foot (`notebook/ProjectFooter.tsx`).

Cell 06's preview of the export is a frame of its own (`ExportPreview.tsx`),
mounted while the cell is open and gone when it closes, and the map's frame
is never sent there. The main process holds the two by role, `map` and
`export` ("The viewer"); "The export's choices" says what the preview
shows.

### The run graph and `drawn`

A cell's state - ready, running, stale or error, said as an icon and a word
and never as a colour alone - is derived, never stored.
`src/renderer/src/runGraph.ts` computes all six from the record and the runs
in flight, and is pure, so its model is a table of records in
`tests/unit/run-graph.test.ts`. Two things make it a derivation rather than
a set of flags. A run says which cell it belongs to through its own
snapshot (`cellOfRun`): a layout at its feed's download is cell 01's, a
rebuild cell 03's, a redraw for the sizes cell 04's, a recolour, a reorder
or a line's options cell 05's, any other layout run cell 02's, and the
export cell 06's. And the record says what the map on screen was drawn
from, in `drawn`, which the store makes from what the draw sent ("The
record session"), so staleness is the record compared with itself. The
rail, the header's sentence, the cells and the front door's cards
(`projectProgress.ts`) all read this one derivation, so none of them can
disagree about a project's state.

### Cheap edits and expensive edges

Stale is for the expensive edges only, the changes that cost a layout or a
rebuild to draw: the mode or the operator moved since the stored layout was
made (`built`), a tuning that would send other than the layout was asked
with (`laidOutWith`), a layout the map was not drawn from or one laid out
again since (`drawn.layout`, `made`), a re-layout stopped after it replaced
the stored set (the run's `replaced`), and a day chosen and not drawn
(`drawn.date`). Each marks the cells below its own and never its own, and a
cell names the nearest source above it; the contract's "When a cell is
stale" is the table. The map and every control stay where they are until a
person runs again.

The cheap edits raise no source. The colours, the order, the sizes with
their looks, markers, face and trains, and the line options redraw
themselves from the stored layout and are written only once the map carries
them, all through one hook (`useCheapEdit`, "The record session"), so their
cell reads running while they redraw and ready after, never stale; the theme
is written at once and the page restyles in place. A control that disables
itself under a person's hands takes the focus with it, and a refused change
is a lost one (ADR-045). Cell 03's day has the notebook's only Revert; the
contract's "Revert" says why cells 04 and 05 have none.

## The front door

The Library is the first screen (`Library.tsx`; A5.6-01, ADR-045, ADR-047),
and it answers the question a person arrives with: "Your projects", then
"Sample cities", then "Your feeds", with a sentence saying what the app is
above them while there are no projects. The two galleries are one kind of
card (`Card.tsx`) in one grid, and a card is one native button.

**Your projects** has the New project card first, so it keeps its slot when
the first project is made, then one card per project, newest opened first.
A card says where the project's feed runs and how far the project has got,
in the run graph's own terms (`progressWords` in `projectProgress.ts`: "01
Data running", "finished up to 01 Data; not laid out yet"), and shows the
thumbnail `map.build` wrote beside the project's page, in the palette of the
interface's theme rather than the project's (`frontDoorPictures.ts`). A
project with no thumbnail, or whose file does not load, draws its picture
area empty.

**Sample cities** is every preset in the engine's registry as a card, drawn
from `feeds.list` alone with nothing downloaded (`SampleCities.tsx`): the
name, where it runs, and whether its zip is on this machine. A route or
station count would mean downloading every feed at start, so a card has
none (ADR-047). Its picture is the engine's, made by the engine's own script
at the pinned LOOM and vendored under `src/renderer/src/samples/`
(`samplePictures.ts`), and shown in an image. A press makes the project from
the registry's entry - its name, made unique, its mode and its operator - and
opens its notebook with the layout already starting. The feed is fetched
inside that layout: the engine reports the download as stage `download`
(engine v0.10.0), cell 01 draws it (`DownloadLine.tsx`), and the run's own
cancel stops it and keeps nothing. A sample cancelled before its feed
arrived leaves no project behind either, since the project would name a
feed that never came (issue 178, `useProjectState.ts`); one cancelled after
keeps its project and its feed, with cell 02 ready to run.

**Your feeds** lists the feeds a person added, each a row with New project
and Remove (`FeedList.tsx`); "The feeds" says how one is added and removed.

The Library has no record of its own: it is the set of readable records
under `projects/`, sorted by when each was last opened, newest first.

New project is one sheet with three sources (`NewProjectSheet.tsx`,
A5.6-05). The first offers the listed feeds as a native select - the sample
cities and the feeds a person added, a group each - and falls back to a
typed key when the engine cannot be asked, so a project can still be made
without it.

Its other two sources are a GTFS zip on this computer, chosen in the
platform's own dialog, and a feed at an address. For either, "Add the feed"
adds it through `feeds.add` with its download on the progress line, and the
button then becomes Create: a feed is worth having without a project, so
Cancel after the add leaves it under "Your feeds", and a name a person has
not seen should not become a project's name unasked. The name is filled from
the feed's own unless a person has typed one, and is never written into a
field a person has in hand (issue 263). A listed feed's mode and operator
come from its registry entry, so a sample draws as the engine's site draws
it; a feed a person adds starts at every operator. A typed key is checked
for form only.

## The layout run

One action in cell 02, "Lay out", produces a map (`LayoutRun.tsx`, and the
run itself in `src/renderer/src/engine/layoutRun.ts`). The app asks the
engine for the project's layout, then for its map, and reports each stage as
the engine finishes it.

Both requests go through the typed client. The layout call answers with the
layout's id, its meta, the four stage graphs' paths and their summaries; the
map call takes that id and writes the page into
`<SCHEMATIC_HOME>/out/<project id>/`, which is exactly where the project
origin already serves from, so the viewer (A3-02) needs no copying. The map
call reports the four layout stages again as it reads them and never lays
out on the way to a map; a repeat for a stage already finished is ignored.

The engine reports a stage when that stage **finishes**, and the sentence
describes the stage that finished. So a report marks its own stage done and
sets the next one running, and the sentence on screen always describes the
last completed stage rather than the one being waited for. The last of
those sentences is the folder the engine wrote into, which is a path and
therefore not for a screen; the run replaces that one with what the stage
did, and leaves every other sentence alone, because a slash is not evidence
of a path (the schedule stage says "matched 114/114 stops").

Between the two, the run asks the engine which day to draw
(`feeds.service`, with the machine's date as the anchor and the lines the
layout drew): a short call once the feed is cached, reporting no stage; the
sentence on screen says the day is being chosen. When every call has
returned, one bridge call writes the record: the service day, the layout's
id, the feed's window and the modification time, with the facts the run
answered beside them (`built`, `made`, `laidOutWith`, `drawn`), together or
not at all. A failed run writes nothing, and can be run again; so does one
cancelled in time. On the pinned engine (since v0.18.0, its issue 80) what
the call in flight answers
says which a cancel was, never when Cancel was pressed: the cancelled error
means the call wrote nothing a client sees, and a result means it finished
and wrote what the result names, carrying `cancel_too_late` where the
cancel reached it after its point of no return. A map call that answers a
result is a finished draw, whoever cancelled: the record is written,
`drawn` moves and the frame loads the new page; and, where the result
carries `cancel_too_late`, the run says "The map was already drawn when you
cancelled; it is kept." Every draw - a layout, a rebuild, Run all, the four
redraws - reaches `map.build` through one place in the run (`#draw` in
`layoutRun.ts`), which is where that is decided. A layout call that answers
a result after a cancel has stored its layout: the run stops there, before
the day is asked for; and, where the result carries `cancel_too_late`, it
says "The layout was already made when you cancelled; the next run draws
from it."

"Re-layout" runs the layout call with `force`, behind a warning that the
layout engine is heuristic and a new layout may place stations differently.
The engine keeps the stored layout until the new set is whole, so a failure,
or a cancel before the new set is moved in, leaves the project exactly as it
was; a cancel after that is too late (engine v0.18.0), and the run stops
with the layout replaced, as a re-layout stopped between its calls does.
The record is written only when the run finishes, and says the map came
from a fresh layout.
"Lay out again" is the unforced case, which reuses the stored layout.

A run belongs to its project rather than to the screen showing it, so a
person can start a layout, go back to the Library and come back to one still
running; the renderer keeps one client for all of them.

### What identifies a layout

The engine names it. A layout is stored at `data/graphs/<feed>/<id>/` with
a `.meta.json`, and `<id>` is the sha256 of everything that went into it:
the feed's bytes, the mode, the agency, the label options, the LOOM build
and the stage arguments. The same inputs name the same layout before
anything runs, two projects on one feed name the same layout unless their
inputs differ, and a layout is never rewritten in place: a forced rebuild
replaces it only once the new set is whole. The app records the id as
`graph.build` answered it and passes it to `map.build`, so a map is always
drawn from the layout the project names. The main process checks the id's
shape and writes it; it reads no file and needs no path (ADR-033, which
supersedes ADR-027 and the app's own digest of the stage graphs).

The id names the inputs, not the output: a re-layout runs every stage again
under the same id and may place stations differently, because `octi` is
not deterministic. What reproduces a map is the stored set, which is why
the engine keeps it and the app never asks for a layout on the way to a map.

Because two projects with the same inputs share one set, a re-layout from
one changes what the other draws from. The record therefore keeps the
engine's `made` beside the id, the time the set was written, which an
unforced answer repeats and a forced one rewrites. A run that answers the
project's own id with a later `made` was drawn from a layout laid out
again from another project, and the screen says so; cell 02's footer
shows the time beside the id (A3-06).

### Layout tuning

Cell 02's Layout tuning (`LayoutTuning.tsx`, `tuningRules.ts`; issue 385,
spec 033) is LOOM's own settings for the project's layout, by name: the grid
octi lays the network on, how far apart two stretches of track may be and
still merge, the grid's cell, and what octi pays for each bend. Each is a
field, with no slider mapped over it, in a closed disclosure under the run's
controls.

A tuning is an input to the layout run and to nothing else. It is written
to the record the moment it is committed (`setTuning`) - on Enter or on
leaving the field, never per keystroke - and the record keeps only the
fields away from LOOM's own numbers. A number the engine would refuse is
refused beside the field in the engine's own sentence, with nothing
written, and the main process holds the grid and every number to the same
rules (`src/shared/project/`). Nothing is laid out for it: the next layout
run sends it to `graph.build` (`layoutTuning`, which sends nothing at all
for no tuning, so an untuned project asks what it always has), and the
engine names a layout for those inputs. `completeLayout` writes what that
run sent as `laidOutWith`, beside the layout's id. Until a run does, the
record's tuning would send other than the stored layout was asked with,
which is the run graph's `tuning` source, and cell 02 says so under its run
(`tuningNotice`). Nothing in the section is disabled for a run or an export:
a tuning touches neither the page nor the stored layout, and a run already
going sends what it was started with.

### What the build had to fudge

`map.build` answers three things beside its files, and A3-03 keeps them:
`diagnostics`, the build's numbers as data; `caveats`, the same numbers as
sentences; and `issues`, one weighted proportion where 0 is clean. All
three are built once in the engine's `schematic/diagnostics.py`, so the
terminal, the site and this app say the same thing.

They live on the run's snapshot and nowhere else, set with the sentence
that says the run finished: never while it is still running, so the
figures cannot reach the screen before the map they describe, and never
for a run whose record could not be written. The panel, cell 02's
`Diagnostics`, describes the build
that just ran, which is why a failed, cancelled or never-run project has
none, and why a rebuild for another day replaces the figures with that
day's. The block is read rather than assumed, to the depth the panel
reaches into it: the renderer has no error boundary, so a block that is
not whole would take the window blank after the map had been drawn, and is
simply not shown instead. They are deliberately not written to the record: The
numbers go stale the moment another project re-lays out the set this one
draws from, and a record keeps what a build does not know (ADR-056), so a
figure written once would be carried by every build after it.

The app formats and never computes. Two of the engine's names are worth
reading twice: `degraded.skipped_calls` counts *trips* that skip an
unmatched stop rather than calls, and `stops.unmatched` is the first few
ids only, so the number that did not match is not in the block - the
caveat sentences carry it, which is why they are shown word for word. The
figures are a table under the design document's table rule, each row
offering its explanation on a control that answers a pointer and the
keyboard alike; "Copy as text" hands over what the panel shows, through
the bridge's one clipboard method, because the app refuses every
permission request and Chromium's own clipboard write is one
(`specs/017-diagnostics`).

### The service day

A map is drawn for one calendar day, and `map.build` never chooses it,
because its choice would depend on the day it was asked (ADR-031). The app
resolves the day once, at a project's first layout, and stores it: the run
asks `feeds.service` with the machine's date as the anchor and the lines
the layout drew, and the engine answers the feed's service window, the
busiest weekday scanning from that anchor, and the anchor itself, the same
on every machine (engine E21, v0.6.0). The record stores all four beside
the day, and every later build, capture and export is told the stored day.
A project keeps the day it has; the window is replaced at every layout
run, because a fresh feed may carry a fresh calendar; a record from before
the window was stored gains it at its next run.

Changing the day is a person's explicit action, in cell 03 of the
notebook: a native date control bounded by the stored window, with the
engine's day one press away. Choosing and drawing are two acts (A5.5-15).
The day is written to the record the moment it is chosen, through
`setDate`, and that write starts nothing; the cells below cell 03 then read
`stale`, because the record's day is not the one `drawn.date` says the map
was made for. "Draw for this day" is the press that closes the gap: a
rebuild, `map.build` from the stored layout's id, never `graph.build`, so
the stations do not move, and `completeRebuild` writes the day again with
`drawn` beside it. "Revert to `<day>`" is the other way to close it
(A5.5-12): `setDate` with `drawn.date`, one write and nothing drawn, offered
only while the gap is open and the record knows what the map was drawn for.
It is the notebook's only Revert; the run-graph contract says why cells 04
and 05 have none. Both writers refuse the same days in the same sentences,
in the main process, a day outside the window included. A failed rebuild,
or one cancelled in time, keeps the chosen day and leaves the map where it
was, so the cells below stay stale and the press is still offered; one whose
cancel came too late drew the day, and is written as any rebuild is. The
app parses and shows no time of day: a trip past midnight keeps its
`25:44`-style time in the page, which is the engine's
(`specs/012-service-date`, `specs/028-the-notebook`).

### The map's sizes and looks

Cell 04 holds the project's theme ("The theme" below) and how the map is
drawn (`StyleFields.tsx`, `StyleLooks.tsx`; issue 350, ADR-049, and issue
391, spec 034): the engine's named looks at the head of the group; the
sizes - the line width and gap, the two station radii and the station's
outline, the size and distance of the names, and the margin; the station's
and the interchange's marker and the label face; and the trains' dot size
and trail. The app draws a field or a select for each, in the engine's
names, and nothing else; the picture is the engine's. A size is a render,
never a layout (ADR-023): `map.build` draws the stored layout again
(`LayoutRun.restyle`) and the stations do not move. A field commits on Enter
or on leaving it, and a figure outside the engine's range, or an interchange
radius below the station radius, is refused beside the field in the
engine's own sentence. Every one of them is a cheap edit by the same path:
shown at once, drawn once after the delay, and written through
`completeStyle` once the map carries it. One Reset clears them all and
leaves the theme. There is a margin and no crop or rotate: the frame is
padded, never cropped, and rotation is deferred (ADR-050).

### Line colours

A line is drawn in the colour its feed publishes as `route_color`, and a
line whose feed publishes none is drawn in one default. Both are the
caller's to set: `map.build` takes `colors`, a colour
per line label over the feed's own, and `default_color`, and the engine
resolves each line once (`render.line_colors`, E06) so the map, the chips
over it and the time chart all draw from one table.

The record carries `colors` and `defaultColor`, and cell 05's colours
(`LineColours.tsx`) are what writes them. The panel lists one row per line label the
feed offers under the layout's own mode and agency, read from
`feeds.inspect` - the labels and the feed's colours are the engine's, and
the panel draws a swatch beside a name and nothing else. A colour is
built when the gesture that chose it ends - the picker's release, which
is a pointer's or an arrow key's, or the hex field's own button - and
never on a quiet interval (issue 262), so a drag of any speed is one
`map.build` from the stored layout's id and the stored day; the swatch
and the hex field follow every colour on the way and send nothing. A
release while a run or an export holds the page waits and builds once
when the way is clear. The other cheap edits - the order, the sizes and
the line options - are drawn a delay after the last change instead. A colour
is a render, never a layout, so the stations do not move (ADR-023). The
palette is written only when the map has been drawn, through
`completeColors`, as a chosen day is; a failed build, or one cancelled in
time, leaves the record alone and the panel goes back to it, and one whose
cancel came too late drew the colours and is written as any build is.
Every draw the run makes carries the record's palette, so a layout, a
re-layout and a chosen day all draw the colours the project chose
(`specs/018-colours`).

The engine ignores a colour for a label its stored layout does not carry,
which is why the panel can list the feed's labels rather than the layout's
and why an override outlives a narrower mode.

### Line order

One list decides two things on the engine's page: where two lines share
track the later of them is drawn over the earlier, and the page lists the
lines in rows in that same order. `map.build` takes it as `line_order`,
and without one the engine draws the lines alphabetically by label.

The record carries `lineOrder`, and cell 05's Line order panel
(`LineOrder.tsx`) is what writes it. It lists the same lines the colours do,
arranged by the record's order first and the rest as they came, with "Move
line X up" and "Move line X down" on each: two named buttons, so the feature
is reachable from the keyboard. A line can also be dragged by a grip at its
row's start (issue 283), the app's own pointer code as the geographic view's pan is
(pointer capture on the grip, the rows moved by transforms while it is
carried); the buttons stay, which is what made the drag safe to add, and
a drop is one change on the same timer as a press. A move is debounced
into one `map.build` from the stored layout and the stored day, and the
arrangement is written through `completeOrder` only once the map has been
drawn in it. Every draw the run makes carries the record's order, as it
carries the palette, so a layout, a re-layout, a chosen day and a colour
change all keep the arrangement (`specs/020-line-order`).

The order the app sends is the whole arrangement a person was looking at,
and the engine treats it as a preference rather than a list of what to
draw: the lines it names come first and every other line the layout carries
follows, while a label the layout does not carry is ignored (engine issue
28).

### Line options

Under each line's row in cell 05's colours is a closed disclosure, "Line
options" (`LineOptionsDisclosure.tsx`, `lineOptions.ts`; issue 394, spec
036, ADR-053), whose summary says what the line holds, and in it the line's
name, whether it is shown, its width, a casing with its colour, a dash, and
Reset line. A hidden line, a renamed chip and a bold, cased or dashed stroke
are the engine's: `map.build` is sent what a person chose as `lines`, by
line label in the engine's own `LineOptions`, and the map and every export
of it follow. The engine hides a line once, on the line graph, before
anything is matched or drawn, and refuses a map with every line hidden
(ADR-053).

Every option is a cheap edit of the colours' kind, held by `useLineOptions`
through `useCheapEdit`: shown at once, drawn after the delay from the stored
layout (`LayoutRun.redrawLines`, the colours' kind of run refined: its
snapshot carries both `recoloured` and `optioned`, `kindOfRun` answers
`options` and `cellOfRun` cell 05's `lines`), and written through `completeLines` only once the map carries
it - the whole set the cell showed, the record keeping only the fields away
from the engine's own. A casing's colour is built at a gesture's end, as a
line's own colour is (issue 262). The main process checks every label and
field against the engine's rules, in its sentences, and the store checks
them again. `drawn.lines` is the options as sent.

### The theme

The engine's page draws itself in one of two themes, warm-dark and sepia,
and reads which from `theme=` on its own address before its first paint, so
a frame never shows one and then the other. The record carries `theme`,
and cell 04's theme switch (`ThemeSwitch.tsx`) is what writes it (A4-03).

It is the project's theme, not the interface's: a theme belongs to the map, which is exported and published,
rather than to the room the person making it is sitting in. The interface
keeps its own theme in Settings and the two move independently.

A theme press does not reload the frame (issue 349). The page's seam has
`setTheme(name)` (engine v0.11.0, its issue 29), which restyles the page in
place, so the app writes the record and then calls `setTheme` on the
map's frame through the viewer bridge (`window.__present` is driven from the
main process, ADR-028). The page's address, its document, its clock, its
view, its labels and its scrub position are untouched. The address still
carries `theme=` for the next load: it is made again only when the project,
its feed or the number of redraws changes, with the project's theme at that
moment (`viewerAddress.ts`), and the viewer gives the project's theme to
every page that loads as the first call of its restore (`viewerRestore.ts`).
That call is given the theme as it stands at the moment it is sent, from a
memory the press writes the instant its record write returns, before it
sends its own `setTheme` (`themeMemory.ts`, `viewerGiveBack.ts`); the memory
is not the screen's state, which carries the theme only after a render and
its effects have run. Whichever of the press and the restore reaches the page
last therefore carries the same theme, and a theme written between an
address being made and its document arriving, or while the restore is being
sent, is never lost.

The one case that still navigates for a theme is a page drawn before the
engine had `setTheme` whose redraw as its project opened ("A page an older
engine drew", under "The viewer") could not run, the engine away for one: it has no `setTheme` and
says "this map cannot do that". The press then counts a reload, and the
frame is sent to the address with the project's theme by the path a redraw
takes, so the hour, the view, the labels, the speed and the pause are given
back. "The map is not on the screen" and every other failure are swallowed,
because the next load carries the theme.

Nothing is rebuilt for a theme, and no engine request is made at all: the
SVG carries its furniture's colours as CSS variables with literal
fallbacks, so the page restyles itself and the line colours do not move.
An export passes the same choice in the engine's own vocabulary - `themeFor`
maps the record's two onto `dark` and `light` in `export.plan`'s options,
and the engine turns anything that is not `dark` into `theme=sepia` on the
page it drives (`specs/021-theme`).

### Route mode

Cell 03's Trip section (`Trip.tsx`, with `tripState.ts` and `tripWords.ts`;
issue 272, spec 030, ADR-048) is a start and an end station, and the map
fades everything off the trip between them, which the steps then say in
words. **The page finds the trip and draws it; the app does neither**
(principle I). Once both pickers hold a station the section asks the map's
page `setTrip(from, to)` through the viewer bridge, from the main process,
and `setTrip(null)` when the trip stops being one - a picker emptied, "Show
the whole network" pressed, a station a new layout does not draw. What the
page answers, its `state().trip`, is read as untrusted data (`readTrip` in
`src/shared/trip.ts`) before a word of it is drawn, and a trip that is not
whole is refused with a sentence and never half drawn. The steps are the
app's words around the map's own station names and the page's line labels
(`tripWords.ts`), and they say which lines the trip avoided whenever a line
is hidden.

The pickers offer the map's own stations: the list `map.build` answers,
which every draw's completion hands the store and the record keeps as
`drawn.stations`, because a project opened again shows its map from the
stored files without a build. `src/shared/trip.ts` bounds what a list may
carry, and a list that is not whole is no list. A record from before the
list was kept offers none and says "Draw the map again to pick a trip.", as
a page drawn before the engine had `setTrip` (v0.13.0) does. A trip is view
state: it asks the engine nothing, builds no map, **is never written to the
record**, and marks no cell stale. A choice made while a run or an export
holds the page is refused beside its picker and not taken, and a page a run
reloads is given its trip back by the viewer's restore (`viewerRestore.ts`).

## The feeds

The front door lists the feeds the engine knows (`feeds.list`, engine
v0.7.0): the presets curated in the engine as "Sample cities", and the ones
a person added under "Your feeds", each with whether its zip is downloaded,
which is the engine's `cached` and never the app's guess. A feed is added
from a zip on disk or from a URL through `feeds.add`, from the New project
sheet, run from the page through the typed client with the download's bytes
and then the check on a progress line (`engine/feedAdd.ts`); a cancel lands
between the download's chunks and the engine keeps nothing, and a cancel
that comes after the feed is kept is too late (engine v0.18.0): the add ends with the feed, says so, and the front door lists it
whether or not the sheet is still open (`relistAfterAdd`); a refusal is
the engine's own sentence, which names the missing table. A
feed a person added is removed through `feeds.remove` behind a
confirmation; a preset has no Remove, and the engine refuses one anyway.

Two things only the main process can do sit in front of this. The file
chooser is the platform's, opened by the main process and parented to the
window, as the rules keep a native dialog for choosing a file or a folder
(the one other is the unparented box shown when the window's renderer
dies, `crashBox`, issue 432); the path it answers is
remembered, and a `feeds.add` that names any other path is refused before
the engine sees it. And a `feeds.remove` of a feed any project still
names is refused, naming how many, because the engine would take the
zip and the layouts those projects draw from. Both refusals are answered
as bad calls with a sentence, from a guard every engine request passes
(`src/main/feeds-ipc.ts`, `specs/014-feeds/contracts/bridge.md`).

The removal is a job the engine can be asked to stop (issue 351). While it
runs the confirmation keeps its Cancel, and a press sends the request's own
cancel through the sidecar, as a layout run's does; what the engine answers
says what happened. The cancelled error means the feed is still registered
with every file in place, and the page says the removal was cancelled and
the feed is still here; a plain `ok` means it is gone; `ok` with
`cancel_too_late` means the cancel came after the engine had written the
registry, so the files were removed to the end, and the page says the feed
was removed anyway. A row leaves only when the engine has said the feed is
gone, and the list is read again after every outcome. A removal has no
deadline of its own: an engine that has stopped answering ends it through
the inactivity bound, with a sentence that says the feed may or may not
have gone (issue 107), and closing that confirmation reads the list once
more.

## The Inspect view

Cell 01 (`Inspect.tsx`) reads the project's feed through `feeds.inspect` (engine v0.7.1),
once per feed and day per session, from the machine's date as the anchor
(a feed not yet on this machine is downloaded first, as laying it out
would), and
shows what the engine found: the operators, the stops by kind, the trips
and how many are headway templates, the service window and the day the
engine would draw, the warnings as sentences, a histogram of route types
and a table of routes with the colour the feed gives each, the label the
map draws, the name, the type and the trips. The app computes none of it
and draws none of it: the swatch is a coloured square beside a name.

With that in view a person chooses the two inputs a layout is named by:
the mode, what LOOM keeps, offered as the modes the engine named per
route type plus "all" and a typed one for a comma-joined or numeric mode;
and, when the feed carries more than one operator, the agency. The
histogram says which types the chosen mode keeps, from the engine's own
list of the mode names that keep each type. The choice is stored on the
record through one bridge method, validated with the record's rules, and
the next "Lay out" passes both to `graph.build`, an empty agency meaning
every operator, which names a layout for those inputs. The record also
keeps the mode and agency the engine made the stored layout with, from
its meta, so the run's sentence says when the choice has moved since. A
project created from a sample city or a listed feed starts with its feed's registry
entry's mode and agency, so a preset draws as the engine's site draws
it; a record from before holds the app's old defaults, and the view says
what the feed's own entry draws and offers it in one press.

## The geographic view

A project with a layout shows two of its stages drawn where they run, in
cell 01 (`StageView.tsx`): as
the feed draws its routes (`gtfs2graph`) and after LOOM has sorted the
lines onto shared track (`loom`), before anything is straightened. A
sentence under the section's heading says what the two are, and `topo` and
`octi` are deliberately not offered (issue 282). The
drawing is the engine's, asked for by the layout's id through
`render.stage` (engine v0.7.0) and kept per layout, set, stage, width and
service day for the session; the counts beside it are the engine's, shown as sent,
and never a number the app worked out (ADR-023: `topo` is not
reproducible, so a literal count is the wrong instrument). The SVG goes
into an iframe with an empty `sandbox`, no permission at all, through
`srcdoc`: nothing in it runs, it has no origin, and it is never inline
in the interface's document. Pan and zoom are the interface's transforms
on the frame, from the wheel, a drag, and the keys on a focusable pane
named for a screen reader, and the buttons above it (issue 546). A narrower mode chosen in the Inspect view and
a new layout draw fewer lines here, from the new layout's set.

While a layout run goes, the pane draws the layout as it solves (issue 382,
spec 032): each of the four stages as the run reports it, asked of the
engine with the run's layout and without a service day, since a day makes
the answer wait on octi (spec 032, FR-004), so its words carry no minutes;
the day is part of a drawing's cache key, and a run's drawings are cached
under no day and the run's own identity. Each is asked again, where the engine
answered that a stage is not there yet, when the stage it waits on is
reported; the reports are the clock and nothing is asked on a timer
(`engine/stages.ts`). Once the run has finished and its record has been read
back the view is the stored layout's again, and a run that stopped leaves
nothing of what it drew. The drawing is hidden from assistive technology, so
its text alternative is the engine's `description` of the same stage graph:
the pane's name carries the stage and its counts, and a disclosure, "The
network in words", holds the extent and one item per line, worded by
`networkWords.ts`, which orders and computes nothing (issue 105, spec 031).

## The viewer

A project that has a layout shows the page the engine wrote for it in the
map's frame, the block between cells 02 and 03 (`Viewer.tsx`; "The map block
and cell 06's preview"). The app draws no part of the map
(principle I) and puts no chrome over the page: its own controls are the
controls.

The frame carries `sandbox="allow-scripts"` and nothing else, so the page
runs at an opaque origin. **`allow-same-origin` must never be added beside
it**: one word restores the page's origin, and a page with both can read the
bridge, call it and remove its own sandbox attribute. That is not a
hypothetical. Before the sandbox (A3-02) a page in a plain frame read `parent.api`
and called it, listing every project and reading the engine's state, and the
main-process frame check could not see it, because the bridge's functions
run in the frame that exposed them.

That matters because the page is not the app's and is not trusted. The
engine embeds each project's line and station names in it, and those come
from a transit feed fetched over the network.

The app drives the page from the main process. `src/main/viewer.ts` holds
the frame by identity from the moment the interface attaches it, never looks
one up by address at the moment of use, and refuses to inject into the
interface's own frame under any circumstance. A call names one of the
methods the page exposes, checked against that list before a character is
sent, and its arguments go in as data inside a dispatcher the app wrote.
What comes back is data from a page we do not trust, and a page that throws
becomes a sentence.

Generated pages are served with a policy of their own, written fresh: the
interface's forbids being framed and would block the viewer outright. The
window refuses to open a window and refuses to be navigated away.

Reading the page's state is therefore a round trip through the main process
rather than a property access. That is fine for a control; a live clock
needs polling, which the transport does only while cell 03 is open ("The
transport"). Contracts:
`specs/008-viewer/contracts/viewer.md`; the decision and what it corrects:
ADR-028.

### The transport

Cell 03's transport (`Transport.tsx`, `transportState.ts`; A5.5-16) is the
scrub, play and speed of the map's service day, and it draws no map and
computes no time: `bounds` gives the day the page has, `state` where its
clock is, and `seek`, `setPlaying` and `setSpeed` move it, each a call on the
map's frame through the viewer bridge. It asks the engine nothing and
writes nothing, so no cell goes stale for it. The clock is read back, never
counted: a poll asks the page where it is while cell 03 is open and nothing
else holds the page (`pollsNow`), since the seam has no event and a
collapsed cell keeps its controls mounted. The map's page is loaded with
`controls=1`, which gives it its own view switcher and nothing else, so the
app's are the only transport on screen.

### A page an older engine drew

A page an older engine drew is redrawn when its project opens (issue 465).
**Older means drawn by an engine below the running one, by the version the
record names, or by an engine the record does not name, or lacking a seam
the pinned engine's page has**; any one is enough. Every draw's `drawn`
names the engine that answered it (`drawn.engine`, issue 494): the store asks the supervisor at each draw's write for
the version the last engine to pass the handshake answered
(`Sidecar.readyVersion`), which is kept through a restart and a stop, since
a completion reaches the store after its build was answered and the engine
may have gone between; and every process that passes the handshake answered
the pin's version exactly, so it is the version of whichever engine answered
the build. The renderer compares it with the running engine's, from the
ready state's `version` (`engineBefore` in `src/renderer/src/record.ts`): three
whole numbers. A running version that is not one - a pre-release, a local
suffix - says nothing, and the seam decides. A record's own value that is
not one is dropped as the record is read, so it is the same as none. Every
page waits for the engine's handshake before it is judged by version. The seam is asked of every page: once the first page
the map's frame loads has been given back its state, the main process lists
the functions on its `window.__present` by a fixed script that calls none
of them (`Viewer.seams`, `viewer.seams()` on the bridge), and **a page
lacking a seam the pinned engine's page has** (`PAGE_SEAM_NAMES`,
generated from the pinned engine's schema and held to the engine's template
by `tests/unit/viewer-real.test.ts`), whichever seam it lacks, is older
whatever version its record names. **A `drawn` that names no engine counts
as older** (decided by the maintainer, 25 Oct 2026): every record drawn
before issue 494 is one, so every existing project is redrawn once, the
first time it opens after the update. That is what reaches the pages engine
v0.15.0 to v0.18.x drew, which have every seam and draw what the engine has
since changed (engine issue 76's label face). A record with no `drawn` at
all has drawn nothing and is never redrawn. The redraw's own write names
the running engine, so it happens once; a build from before issue 425 that
writes the record afterwards drops the field again, and the next opening
here redraws it once more. The screen then asks for the
rebuild cell 03 makes for a day, for the day the record holds and the map
already shows: a `map.build` from the stored layout with the record's
colours, order, style and line options, never a re-layout (ADR-023), shown
and written as that rebuild always is, and failing as cell 03's own -
where cell 03 says, in words for a person who pressed nothing, that the map
could not be redrawn as the project opened, the engine's reason, and what
still holds of the map on screen for the seams it lacks, which for a page
older only by version is that the map stays as it was (issue 517,
`frameFailure` in `notebook/olderPage.ts`). It is
started through Run all's machinery rather than as cell 03's press, so the
day is decided from the record once the writes on their way have landed: a
start flushes cell 03's held day first, and a rebuild for the day the
screen held would draw the old day and write it back over the one just
chosen (the issue 407 fault). Where the record those writes leave asks for
nothing, Run all withdraws: no job ends, and nothing is drawn or written,
though for the round trip of the write it waited on its job is listed and
cell 03 reads running. Since that is when a person has just picked a day,
focus is first handed to the heading of the cell it is in, as cell 03's own
rebuild hands it, so a control the run disables does not drop it to the
body (`keepFocusInCell`). It is asked once per
opening of the screen, waits while the engine is not ready or a run or an
export holds the page, and is not asked at all where a draw would show
something the map did not already show - a day chosen and not drawn, a
layout the map was not drawn from, a day the store would refuse - or where
the record has no `drawn` to compare with or is not this build's to write
(`notebook/olderPage.ts`). A redraw that fails is not asked for again on
that opening; the next opening asks again.

## The capture

The middle of the export path, between the engine's plan and its encode
("The export" below; A5-02a, ADR-024). A
project page is loaded as the top-level document of a hidden offscreen
`BrowserWindow` with no preload, no node integration, the sandbox on, the
spellchecker off in the window and in its session (it would fetch
dictionaries from a CDN), and a
session of its own - the in-memory partition `capture`, which serves
project pages and nothing else and refuses every permission. Nothing the
interface's session holds reaches it, and a persisted per-host zoom level,
which scaled every frame of spike A0-07's first two sessions, is the reason
it is not the default session.

The order is the spike's and every step of it was paid for: navigate
first, because emulating a web contents that has never navigated is a null
dereference that takes the process down; then attach the debugger and
`Emulation.setDeviceMetricsOverride` to the job's size and scale factor,
which wins over the display's in both directions; `setCapture(true)` before
any wait, so the page's own clock stops before the fonts and the settle;
`bounds()` and `state()`, and a clock with no trains refused with the
recorder's sentence; the stage's rect in CSS pixels; `settle()`, waited
for, since the page's answers a promise that resolves once the map's face
has loaded (engine v0.15.0; an older page's answers nothing, and a promise
that never resolves ends in the frame's timeout); then per
frame `advance(1/fps)` or a `seek` along a sweep, two animation frames, and
`Page.captureScreenshot` at that clip with `scale: 1` - never
`capturePage()`, which ignores the emulation and follows the window.

A job whose beats open on a title card or draw the network in (engine
v0.15.0's `card` and `draw_in`; issue 392, spec 035) takes the engine
recorder's calls for them in the recorder's order (`bin/_record.js`): the
page is asked once whether it has `setCard` and `setDrawn`, and one drawn
before the pin is refused before any frame; after the settle, `setDrawn(0)`
when any beat draws in; `setCard` at each beat's start when any beat has a
card; and on each frame of the draw-in the step first and then
`setDrawn(i / (n - 1))`. A job with neither flag makes exactly the calls it
made before the opening but for the settle being waited for and the proof
below, held to a transcript by `tests/unit/capture-opening.test.ts`.

**Every frame is proven fresh**, not waited for and hoped (issue 100,
engine v0.20.0's issue 85). The page's script cannot say whether a
screenshot shows the paint after the step, because the script is always
current; only the picture can. So the capture adds `strip=8` to the
address it loads, and makes its window and its emulated viewport 8 CSS
pixels taller (`STRIP_PX`, small because the band is read once and thrown
away; at scale 1 the row read, half way down its eight rows, has four rows
of the band above it and three below). The page lays its stage, overlay and card out in the
viewport less the band, so the stage is the size it always was, and draws
in the band under it `state().draws` modulo 65536, sixteen bits as 32 black
and white blocks. The capture asks once whether the page took the band
(`data-strip` and `#present-strip`) and checks that the band sits right
under the stage, as wide as it. Then, after each step and the paint wait,
it reads `state().draws` - after the step, never predicted, since a call
can draw more than once - takes the stage and the band in one
`Page.captureScreenshot`, and reads the band out of the shot's own pixels:
each block at its middle, half way down, white at 192 and over in every
colour channel and black at 63 and under, every pair one of each, or no
number at all (`src/main/capture-strip.ts`, no dependency). Where the band
shows the count, the frame is kept; where it shows another, or none, the
capture waits for the paint again and takes it again, four shots in all
(`FRESH_TRIES`), and then fails the export in a sentence of its own
(`staleFrame`; `unreadFrame` when no shot read a count at all, each with
what to do next). The band is cropped before the frame is written, and
exactly: a PNG row's filter reads only the rows above it, so the kept file
is the shot's own filtered bytes for the stage's rows under a header that
says fewer rows, with nothing decoded and encoded again. Not Electron's
`nativeImage`, whose `toBitmap()` converts into sRGB by default and whose
bitmap round trip premultiplies alpha. The inflate and the deflate are
zlib's asynchronous ones, each a step of the capture's own, so a cancel or
a page gone is answered at once; the inflate is bounded by the size the
header says, and no header may say more than the shot of the largest job
`validateCaptureJob` takes (`MAX_IMAGE_BYTES`);
a video's frames are compressed at the fastest level, since ffmpeg decodes
them, and a still's at zlib's default, since its PNG may be the deliverable
(`still` in `CaptureOptions`). So every size downstream, the encode
and the determinism gate are what they were. Every change to the page comes
before the step whose count is read, because a call that does not draw
(`setLabels`, `setView`) can change the picture without moving the count: a
beat's settings are applied before its first step, the card at the beat's
start, and the draw-in's `setDrawn` after the step but drawing itself; a
still is one beat of one frame and is proven the same way. A one-off probe
while it was built, not kept in the repository, drove `runCapture` through
Playwright's Chromium (not Electron) against a small page engine v0.20.0
drew, and compared the proven frames with the same page captured without
the band, at scale 2: every channel of every pixel was the same, over a
plain beat and over a title card, a draw-in and a view's tween. What the
repository keeps is `tests/e2e/capture.spec.ts`, which makes the same
comparison in a real offscreen window on the captured stand-in.

A page an older engine drew has no band, and an export can still meet one:
stale never blocks an export (ADR-045), and a project whose page was drawn
before the pin moved and not redrawn - a record that cannot say what drew
it, a day chosen and not drawn, a redraw on open that failed
(`olderPage.ts`) - exports the page on disk. Such a page ignores `strip=`
and lays out in the taller viewport, so the capture emulates the job's own
size, loads the job's own address again, and captures it as every capture
did before the proof. `CaptureResult.proven` is then false, and the export says so twice
(`UNPROVEN_FRAMES` in `src/shared/export.ts`): on the capture's own stage,
after its last sentence, so the line stays in the job's log when the
encode's reports begin - the log keeps one line a stage and the page shows
the newest sentence, so a line on the encode's stage would be gone at its
first report - and, through the result's `unproven`, as the export
finishes, in cell 06 beside "Exported" and in the jobs inspector.
Only a page that does not count its draws is taken for an older engine's: a
page whose `state().draws` is a number but which drew no band for the
address is refused with a sentence, rather than captured unproven silently.

`src/main/capture.ts` is the order, behind a `CapturePage` interface, so
`tests/unit/capture.test.ts` asserts every step against a fake page, which
paints as a page does: a shot shows what the last paint wait painted and
its band the count it was painted at, so removing the paint wait or the
comparison keeps a frame from the wrong paint and fails a test;
`src/main/capture-window.ts` is the Electron half, and a second build
entry, so `tests/e2e/capture-harness.cjs` can load it into a bare Electron
and `tests/e2e/capture.spec.ts` can prove in a real window that two
captures of one job are byte-identical, that a zoom level seeded in the
default session changes nothing, that a cancel leaves no window and no
frames, that a frame proven by its band is the frame a capture without
the band takes, and that a page that never paints its step fails in the
capture's sentence (the captured stand-in, `capturedStandInSource` in
`tests/support/standInPage.ts`, which draws the band as the engine's page
does); `tests/e2e/export-fresh.spec.ts` does the last two through cell 06. The job's shape is the engine's recorder's (`src/shared/capture.ts`),
so `export.plan`'s answer maps onto it. A quit destroys any capture
window before the engine is stopped.

Whether that order is enough is measured, not assumed (A5-04).
`tests/e2e/determinism.spec.ts` seeds a temporary engine home from the
committed BART fixture - the feed's zip and one stored layout, whose id
`tests/unit/determinism-real.test.ts` checks is the one the pinned engine
addresses - has the real engine draw the project's page from it, and
exports the project's draft `instagram-reel-gif` through cell 06
twice. The app keeps each export's captured frames for the test
(`LEGIBLE_KEEP_FRAMES`, which the test sets and which `keptFramesFolder` in
`src/main/export.ts` ignores in a packaged app), and **the verdict is the
capture's** (ADR-039): the two captures must have the same number of
frames, each the preset's size, every frame within a channel tolerance of
8 in RGB, and must move - the first and
last captured frames differ by more than the tolerance, since two blank
captures agree perfectly, and the page must carry trips. The record's
layout id and `made`, and the stored set's meta and the sha256 of its four
stage files, must not move between the exports (`layoutDrift` in
`tests/support/determinism.ts`), and a `sitecustomize` on the engine's
`PYTHONPATH`, which the app passes in development only, records each
request's method so the test can assert two `export.encode` and no
`graph.build`. The pinned engine's sidecar carries no layout id, so the
record and the stored set are what name the layout. The delivered GIFs are
checked for their structure - both there, at the preset's size, holding
the captured number of frames, not trivially small, and moving - and, from
engine v0.17.0, whose GIF colour table is composed from the plan rather
than counted from the frames (ADR-055), they are judged by their colour
tables and by what moved: each global table has 256 entries, the format's
largest and not a count of the map, no image carries a table of its own,
and the two tables are byte for byte the same (`judgeTables` in
`tests/support/gif.ts`, which reads the container itself); and, decoded
frame by frame beside the two captures, the GIFs differ on no pixel the
captures agree on - agreeing exactly, in every channel - and in no frame
on more pixels than the captures do (`compareThroughGifs`). The tolerance
of 8 is the captures' verdict and is never applied to the GIFs: within 8
in, within 8 out does not hold, because a pixel near the boundary between
two entries flips by the gap between them, so their max-channel
comparison is written down, never asserted. What the table holds is the
engine's own test (`tests/test_gif_palette.py` there). Everything goes into
`captured-frames.json` among the test's results: per captured frame, the
pixels over the tolerance, the box they lie in and whether the frame is
the other run's frame before or after it; and for the GIFs their
max-channel comparison, their tables (`gif.tables`), and the pixels
differing between the captures and between the GIFs, per frame and in
all (`gif.pixels`). `.github/workflows/determinism.yml` proves the
fixture's id against the engine it installed and then runs the test on
Ubuntu, macOS and Windows,
once per pull request that touches what the export is made of, five
times on a weekly schedule, and as many times as a dispatch asks, under
load if asked; it keeps that report from every run, and the
two GIFs and the differing captured frames for a week when a run fails. It
is not a required check.

Why the GIFs were checked for structure only until engine v0.17.0 was
measured, against the real engine on one macOS machine with other work
loading it. At engine v0.8.2, five
unaltered runs kept their captured frames: in one, all 108 PNG files of the
two captures were byte-identical; in the other four, 93 were, the other 15
differed below the tolerance, and no frame had a pixel over 8. Four of
those five runs' GIFs nonetheless differed past the tolerance in all 108
frames, by up to 221 levels, along whole line colours, in files whose sizes
fell into two values. The engine's GIF encode builds one palette from every
captured frame (`palettegen=stats_mode=diff`), and differences below the
tolerance move palette entries, and with them colours in every frame, by
far more than it. ffmpeg itself is steady: the engine's two GIF commands,
run by the pinned ffmpeg on one folder of frames, gave byte-identical files
five times in a row, five times at once and once on a single thread, while
one 10x10 box added to one frame of 108 moved colours past the tolerance in
all 108. The delivered GIF did not preserve the tolerance, and that was
the engine's to fix (engine issue 33). With the table composed from the
plan it still cannot promise 8 per pixel, but two captures within the
tolerance get one table, and their GIFs move only where they moved
(ADR-055), which is what the test now asserts.

What the capture verdict catches was measured the same way at engine
v0.8.3, against which the fixture's layout id was proven too. Of thirteen
unaltered runs, twelve passed, with 93 or 108 captured PNG files
byte-identical and no frame over 8. One, with the machine loaded, failed:
107 of 108 captured frames identical and one frame over 8, by up to 221
levels. Its report was overwritten before it was read, so which frame, and
whether it was the other run's frame before or after, is not known; the
ten runs after it passed. That is a capture taking one frame from the
wrong paint under load (app issue 100), and the gate going red for it is
correct. With the page's `setCapture` doing nothing the test failed with
108 frames over 8, and with `capture.ts` never calling `setCapture(true)`
with 107: the rule that the clock stops before any wait is tested. With the
paint wait before each capture removed, the test **passed three runs of
three** on the capture, with 94 to 101 files identical and no frame over
8: the rule that every capture waits for the paint is **not** tested by
this verdict (issue 100). Since engine v0.20.0 the capture proves each
frame fresh instead (above), and removing the wait fails the capture's
unit tests; the verdict here is unchanged, since the band is cropped away
exactly before a frame is kept. Removing only the `cancelAnimationFrame` in the
page's `setCapture` was not run: it drops the one frame already queued,
which fires during the settle, before `settle()` snaps the transitions and
the first beat sets the clock, so it is not expected to change a frame.

History, measured on the GIFs at v0.8.2 before the verdict moved to the
capture and superseded by the above: two exports of the unaltered app were
byte-identical; with the paint wait removed, one run of three passed with a
maximum difference of 7 and two failed with 32; with the clock never
stopped, from either side, every frame differed by up to 254. Those GIF
failures may have been the palette's amplification (engine issue 33)
rather than the paint wait, and are not evidence that the paint-wait rule
holds.

The test never runs LOOM, by design (ADR-023): it reads a stored layout.
So whether a layout made on Windows is reproducible, which ADR-021 expected
this test to measure, is still unmeasured.

## The export

An export is one of the social presets (`OFFERED_PRESETS` in
`src/shared/export.ts`, which `tests/unit/export.test.ts` holds to thirteen,
every one the engine's), chosen in cell 06 of the project's notebook with a
storyboard and options (A5-02b, A5-01), over
the engine's `export.plan` and `export.encode` with the capture above in
the middle. The flow runs in the main process
(`src/main/export.ts`), because the capture does and is never exposed to
the page; the page starts it, watches it and can stop it through
`api.export`, on the same token-and-event pattern as the engine bridge, and
keeps its own view of it (`src/renderer/src/engine/exportRun.ts`) the way
it keeps the layout run's.

In order: the project's record is read, and a project that is read-only or
has no layout is refused before the engine is asked. `export.plan` gets the
project's feed, the preset, the page's address on the app's origin, the
day the page on disk was drawn for (ADR-031, `drawnDate`) and the record's
theme, and answers
with the recorder's job and what the encode needs back. The capture half of
that plan goes through the capture's own validator - a page off the origin,
a scale the capture does not do, a first beat that pins no clock - and is
refused before a window exists. The frames go to
`<SCHEMATIC_HOME>/frames/<token>/`, a folder that exists only while the
export runs; `export.encode` gets the plan back unchanged, that folder, the
file to write and that same drawn day as provenance - with the choice's alt
text beside it, trimmed, where a person wrote one (issue 352) - and writes
the file with its sidecar beside it. The drawn day and not the record's: since
A5.5-15 a person can choose a day and not draw it, the capture navigates to
the page the last draw wrote, and stale never blocks an export (ADR-045),
so reading `date` here would compute the beats and the clock for one day,
hand back frames of another and put the wrong day in the sidecar. The frames are removed when the export
ends, whichever way, and a start of the app removes the whole folder, so a
crash mid-export leaves nothing a later run reads.

The file goes under the project's own destination where it has one
(A5.5-19), and otherwise under the export folder - `LEGIBLE_EXPORT_FOLDER`,
or a `Legible Cities` folder on the desktop - in a folder named after the
project, under the engine's own file name; nothing is written inside the
user-data folder or the bundle (ADR-016). A project's destination is a
folder the platform's own dialog answered, judged when it was chosen and
again at each export. The app's own bundle and the engine's home are
refused, and so is the engine folder waiting for a restart, where Settings
has taken one that is not in force yet (issue 206): it is asked of
Settings at each judgement and never kept, and its refusal does not call
it the engine data folder, which it is not yet. The judgement has a
deadline, because a folder on a share that stalls neither answers nor
fails; when it lapses the folder is refused as one that could not be
checked, so an export to it is refused after five seconds rather than
never starting, before a plan is asked for and before any frames are made,
and is let go as any refused export is. **Any folder that holds one of
the three is refused too**: the file lands at
`<destination>/<project name>/`, and `folderName` passes "engine", "out",
"data", "projects", "frames" and the app's own name through unchanged, so
the folder one of them sits in is a single project name away from it.
Each refusal says which of them it is and which way round. Every path is
resolved through its links first, because the comparison is textual and
`SCHEMATIC_HOME` reaches the app unfiltered. The home's half is the
relation Settings already keeps in both directions over the app-wide export
folder, and the bundle's is kept the same way, because two guards in one
function over one kind of relation - one symmetric, one not - is what the
first version of this got wrong (`destinationRefusal` in
`src/main/export.ts`). The page is told the file's name
and never its path; "Reveal" names the export by its token and the main
process opens the folder it remembers writing to. A second export of the
same project replaces the first, as the engine's own command line does: the
pipeline is deterministic, so it is the same file.

Progress is three stages on the progress line - plan, capture, encode -
with a sentence each: the plan's frame count and rate, then frames captured
of the total, then frames encoded from the fraction ffmpeg reports through
the engine. A cancel reaches the export wherever it is: the plan or encode
request is cancelled, the capture aborted, and the app removes the frames.
The encode writes the file and its sidecar beside the destination as
`.part` files and moves them into place once whole (engine v0.18.0, its
issues 79 and 80), so a cancel or a failure before that removes only the
`.part` files and leaves an earlier export of the same name as it was; a
cancel after it is too late, and the export finishes, its file kept, and
says "The export was already written when you cancelled; it is kept." The
one failure that leaves something is the sidecar's own move, after the
file's, which leaves the new file beside the sidecar the folder had, so a
failure while the encode runs does not say "Nothing was written." outright
(`unfinishedSentence` in `ExportRun.tsx`); a cancel, a failure before the
encode, and the engine's params error still do. The engine judges an
encode's parameters before its job starts, so that refusal - a destination
that is its own source among them - comes back while the encode stage is
running and has written nothing; it is shown in the engine's words, as any
refusal is, and kept apart (`refused`) so "export again" is not offered for
a request that would only be refused again. The Outputs list reads only
sidecars, so neither a `.part` file nor `map.build`'s hidden staging folder
is ever a row. A layout run and an export of one project cannot overlap,
because the export reads the page a layout would rewrite: each button is
disabled while the other runs, and so is delete. That is the screen's rule,
and main holds only part of it (issue 491, spec 037). `ProjectActivity`
(`src/main/projectActivity.ts`) records which projects have a `map.build`
writing their `out` folder in flight (set by the engine bridge before the
guard's await, cleared in `finally`), which have an export running, and which
are being deleted. An export may not start while the map is being written,
planning and writing nothing; a deletion may not run while a request names
the project or it exports, leaving the record and `out/<id>` as they were;
and a `map.build` is refused while the deletion runs, while the project
exports (issue 505), and for an `out` that names no project record (issue
505). The bridge asks the store that last question
(`ProjectStore.recordGone`, queued behind the project's writes) within
`FOLDERS_TIMEOUT_MS`, and refuses on a lapse too; it is what keeps a
layout's closing `map.build` from making `out/<id>` again for a project
deleted while its `graph.build` ran. A record that is there but cannot be
read is let through, since its folder is still there for a deletion to
remove `out/<id>` with. The bridge raises the request's mark in the same
turn as its check and before the lookup's await, so an export or a deletion
begun while it waits meets the mark and is refused; the guard is asked after
the lookup, so its last look at the reset comes after every await and its
sentence wins over the lookup's. Each says why in a
sentence (`src/shared/activity.ts`), the screen's confirm re-reads its runs
and says the same. A mark follows the engine's answer, not its work, so when
a bound ends a project's `map.build` (`inactive`) while the engine still
reports a request it stopped answering (`Sidecar.abandoned`), the bridge
calls `abandon(project)` and an export or deletion of that project alone is
refused until the count reads 0; for a `map.build`, the deletion and export
marks are checked and that hold is not. Requests a stop fails are not
counted, so for at most `shutdownMs` they leave no mark. A layout's earlier
steps (`graph.build` names a feed, which projects share, not a project) are
the screen's alone; a project deleted while one runs loses nothing by it,
since `graph.build` writes only `data/graphs/<key>/`.

### The export's choices

The export's choices are cell 06 (`ExportTab.tsx`, `exportChoice.ts`; A5-01,
`specs/022-export-tab`), which starts closed. A collapsed cell stays
mounted, so a colour released while a run held the page, or a line order
waiting on its debounce, is not thrown away by closing a cell.

`ExportTab.tsx` is the composition, and each concern is a piece of its
own under `src/renderer/src/export/` (issue 433): `useExportTables` asks
the engine's tables, `useExportLines` reads the feed's lines,
`useExportChoice` holds the choice and is the one place it is written,
`useExportPreview` plans the preview, `ExportForm` draws every field from
Preset to the alt text, its typed drafts held above the form like the
folder (`useExportDrafts`), and `ExportDestination` is
"Where it goes", drawn as the form's last field, its folder held above the
form (`useDestination`) so a form drawn again after the engine comes back
shows what the last press answered. `ExportOpening.tsx` and
`ExportRun.tsx` stay where they were. No piece reaches into another: the
composition hands each what it needs of the others as props, and the
rules every piece applies are `exportChoice.ts`'s, which renders nothing.

Every list is the engine's. `export.presets` and `export.storyboards` are
asked once while the engine stays up, and the presets are narrowed to
`OFFERED_PRESETS` - the social ones, each checked against the generated
`PresetName`; the `portfolio-*` presets are the published site's. The choice - `{ preset, storyboard?, options, alt?, opening?,
cardSecs?, drawInSecs? }`, where the options
are the engine's `ExportOptions` without the theme (the project's), the
safe zones (the app's, for a preview only), the storyboard (beside them) and
the fade (not offered), `alt` is the sidecar's alt text, which is not a
plan option and travels in the encode's provenance (issue 352), and the
last three are what a video or GIF opens on - a title card, the network
drawing in, or both, and how long each lasts (issue 392) - is written
to the record the moment it is made,
a typed field when it is committed, through `setExport`. An option set back
to what the engine does without it is removed rather than sent. What is
sent is also narrowed by the preset, from `export.presets`, in the main
process before every plan (`sentChoice`): a view and a start time are a
still's only, since a storyboard's first beat names its own and the capture
applies it; a still the table says is JPEG is made at standard quality only,
because the capture writes PNG and the engine keeps a capture unchanged at
draft and high. The record keeps what a person chose. The opening is not
an engine option either ("The opening" below).

Where the file goes is the cell's one choice that is not the engine's
(A5.5-19), and it is not part of any plan: `export.encode` has always taken
an absolute destination, so a folder changes nothing about the preset, the
preview or the capture. It is chosen in the platform's own dialog, which
only the main process can open: the page asks by naming its project, the
main process opens the chooser, spends its answer through a `PickedPaths`
of its own, refuses a folder inside the app or inside the engine's home,
writes the record and hands it back. No path crosses the bridge inward, and
the folder that comes back out is shown to the person whose folder it is
and is in no message the app sends anywhere (`Destinations` in
`src/main/export.ts`). Writes to one record
take turns through a per-project chain in the store, so a choice made during
a re-layout cannot write back the old layout. A saved
preset or storyboard the engine no longer lists falls back to the reel,
and cell 06 says which name was dropped.

While cell 06 is open the preview is a frame of the cell's own (ADR-046):
mounted when the cell opens and gone when it closes, and the map's frame
is never sent there. The cell asks
`export.preview` 250 ms after the last change, drops an answer to anything
but the newest question, and hands the answer's address to its preview,
which shows it in its own sandboxed frame at the preset's aspect ratio,
fit into a bounded box with a caption. The address is the project's page
with the engine's query, so the frame is attached from the main process by
the project's prefix as the map is (ADR-028), in the `export` role, and
asked only whether it loaded; the main side refuses a planned address that
names any other page. The frame, the title, the clock and the safe zones are the page's own
drawing from that address (principle I). The preview asks for `safe`
exactly when the engine's table says the preset's platform draws over the
picture; an export's plan never carries it, because `planOptions` adds it
only when told to and the export never tells it. A refusal - a storyboard
visiting the geographic view on a feed without that geometry, say - keeps
the last good address in the frame, puts the engine's sentence under the
choosers, and disables Export until the choice changes. While a run
rewrites the page, or an export is under way, nothing is planned; while an
export is under way the choices are disabled.

A still has no beats in the engine's plan; the engine's recorder seeks to
`at` and takes one screenshot. The app's capture takes frames from beats,
so `jobOf` makes a still one beat one frame long that seeks to `at` and
stops the clock there, and `export.encode` is given that one frame as its
source. The capture itself is unchanged.

`tests/unit/export.test.ts` asserts the order, the parameters and the
cleanup against a fake engine, a fake store and a fake capture, and
`tests/unit/export-ipc.test.ts` the bridge's checks; `tests/e2e/export.spec.ts`
drives the built app against the stand-in engine, which plans a short job
for the animated stand-in page and encodes in shape - five steps of
progress, a file and a sidecar written as `.part` files and moved into
place, a cancel before that which leaves the destination as it was; and
`tests/e2e/reel.spec.ts`, opt-in with an engine checkout and ffmpeg,
exports the real Los Angeles reel twice and compares the two files frame by
frame in RGB with the tolerance of 8.

### The opening

A video or GIF can open on a title card, the network drawing in, or both,
before its storyboard, each for as long as a person sets (`ExportOpening.tsx`,
drawn after the storyboard for a preset that plays one; issue 392, spec 035,
ADR-051). Nothing in the app draws the card or the network: the engine's
page does both, in the export, driven by the capture ("The capture"). The
choice is written the moment it is made, as every choice in the cell is,
and the two durations are typed fields, committed on Enter or on leaving
them and refused beside the field, with nothing written; an emptied field
goes back to its default, which the record never holds. Every opening is
offered for every storyboard, whatever view it opens on.

An opening is not an engine option: for a plan that has one, and only then,
the main process asks `export.storyboards` for the storyboard's beats and
sends the plan a list in place of the storyboard's name - the card, then the
draw-in, at the page's own start clock, 07:00, on the storyboard's first view
where that is the map or the geographic one and on the map otherwise - so
the capture's first look for trains is where it has always been - then the
storyboard's own beats, its first jumping to its own clock and given the
tween of 0 it was always read with (`openingBeats` in
`src/shared/opening.ts`, spec 035). A plan without one is the request it
always was. A plan with one whose list cannot be made - the storyboard not
listed, or its first beat naming no clock - is refused, never planned by the
name without it.

## The inspector and its jobs

The window has a right-hand inspector (A1-03, `specs/024-jobs`, ADR-036):
rendered from `App.tsx` beside whichever of the three screens is open, not
from a project's screen, because the jobs it lists span projects. It starts
collapsed; a toggle in the header carries the running count in its text
and its accessible name. Beside the main region it is `--inspector-width`
wide (`styles/scale.css`) and the main region's width subtracts it; below 900px it covers the main region instead,
and Escape closes it.

A job is one read-only shape (`src/shared/jobs.ts`): an id per attempt, a
kind (`layout`, `rebuild`, `export`, `feed-add`), the project's id, a
label, the state, the stages, the last sentence, the engine's hint and
detail when it failed (both with their paths already taken out at the
error door, issue 419, so a copied log says "a file" where the detail
named one, and `engine.log` keeps the path for the engine's own failures;
an export's own failure keeps it nowhere), the last `MAX_LOG_LINES` log
lines and the start and end. The runs are not changed by it: `LayoutRun`,
`ExportRun` and `FeedAdd` each have a `job()` derived from the snapshot they already keep, plus what the
snapshot does not hold - the times, the detail and a bounded log buffer
fed by the request handles' `onLog` (an export's log is its progress
sentences, one line per stage, the newest replacing the last, since it has
no `job/log` stream). A line too long to keep is cut back to a separator or
a space, so no part of a folder name is left for the home-folder rule to
miss. A refused start is a failed
job of its own. Because a running job is derived, the inspector and the run's own
view cannot disagree about a state.

`runs.ts` keeps a `JobRegistry` over every run it makes. Running jobs are
read from the runs each time and never dropped; the moment a run's job
reaches a final state the registry copies it into a session list, newest
first, at most `MAX_FINISHED`, never adds a job it has copied before, and tells
its end listeners once. Tracking
a run is silent, because `layoutRunFor` is called while a screen renders.
Cancel in the inspector calls the run's own `cancel()`. A run knows its
project only by id, so the registry names the jobs from `projects.list()`
(`readProjectNames` in `runs.ts`),
read only when a name is needed - a job ending, or listed in the open
inspector, for a project it cannot name - rather than on every screen
change or every run. Those reads are few, but each is a store read, and it
can overlap a record being renamed into place. A rename hands the new name
in from the project screen, and a list read begun before a rename, a delete
or a reset applies nothing it would overwrite; a read asked for while one is
out is queued once behind it. A reset that removed the projects folder
forgets every project's jobs and names. The finished jobs and the names are copies kept
beside the runs, not derived from them; a project's are dropped only when
its own screen has deleted it, never because a list read missed a record
it could not read at that moment. The job list is the inspector's own
state, mounted only while it is open; `App.tsx` keeps just the running
count, which React does not re-render for when it has not changed, so a
run's progress never re-renders the screen beside it. Below 900px the main
region is `inert` while the inspector covers it. One visually hidden polite live region says
"<project>: <label>, <state>." once per job, emptied and then filled a frame
later so the same sentence twice is spoken twice, and never repeats the
engine's hint, which both views already show. Nothing is written to disk; a
relaunch starts with an empty list.

`tests/unit/jobs.test.ts`, `runs.test.ts`, `jobs-view.test.tsx`,
`jobs-ipc.test.ts` and the job tests in the three run suites hold this, and
`tests/e2e/jobs.spec.ts` drives it against the stand-in, which can refuse a
mode with the engine's `require_edges` sentence, send extra log lines with
the home folder in them, and record that a cancel during `octi` ended the
child it started.

## Settings and the reset

The Settings screen (`Settings.tsx`; `src/main/settings.ts` and
`src/main/settings-ipc.ts` behind it) holds the app's own settings, which
are one file, `settings.json`, directly under the user-data folder: the two folders a person chose and the interface's theme.
It also holds the app window's place - its bounds in the normal state and
whether it was maximised (issue 549) - which is not a setting a person sees:
the screen never shows it. `createWindow` opens the window there only when
one attached display holds the whole of it, raised to the minimum of 640 by
480 first, and otherwise at 1100 by 720 in the platform's place; maximised
is restored after the window is shown, either way (`src/main/window-bounds.ts`,
the pure rule). The place is written half a second after the window comes to
rest and once more as it closes, through `SettingsService.keepWindow` and the
store's `update`, so it and the screen's presses are one writer; it is not
written while a reset runs, a write that fails is a log line and nothing on
the screen, and a quit waits for the last one, bounded. The capture window
and the export preview are never stored. A file with no place, or one of the
wrong shape, opens at the default; and since the parser drops a key it does
not know, a file written with a place still opens in a build before it.
It is written the way a project record is - a fresh temporary name, then a
rename over the old file - and read the way a record is read, so a file
that is half written, hand edited or from a newer app starts the app with
the defaults it cannot use rather than stopping it. It is read before the
configuration resolves, because a stored folder is one of the things the
configuration decides. Its reads and writes run one after another; the
settings in force change only once a write has landed, and a change that
depends on the stored settings - the theme, a folder - goes through the
store's `update`, which reads, changes and writes in one turn.

Two rules hold the screen together. The environment still wins, so the
development loop and the end-to-end suite steer the app as they did, and a
folder the environment names is shown with its source and no way to change
it. And no path crosses the bridge inward: the main process opens the
folder chooser, remembers its own answer, applies it through the
remembered-path guard A2-01 built for the feeds, and hands back the whole
view. A folder inside the app's own bundle is refused even though the
dialog answered it, because the chooser will make one anywhere and the
bundle is read-only on macOS and wiped on update. The export folder is read
at each export, so a change takes effect at once; the engine's home was
threaded through the sidecar, the project store, the served roots, the
capture's session and the frames root before the window existed, so it
takes effect at the next start and the screen says so.

The reset is the one destructive act. It removes four folders beneath the
home - `projects`, `out`, `data` and `frames`, which is everything this app
and the engine put there - and never the home itself: that is a folder a
person can point at `~/Documents` in one click, so whatever else is in it
is theirs and stays. A folder that turns out to be a symbolic link is left
alone and reported, because removing one unlinks it rather than empties it.
The engine's own `config.py` is where the list comes from.

The home is resolved through `realpath` before any of this, and so is
everything it is compared against: the guards are textual, and a home that
is itself a link would pass every one of them and then remove four folders
from wherever it points.

Its gate is split, because the two sides know different things. The main
process refuses while a reset is already running, while an export is
running, while the engine is answering a request, or while a record is
being written - it counts all four - and for a home so high up that those
four names would mean something else. It does
not claim to know whether a multi-step layout run is open: that run is
`graph.build`, then `feeds.service`, then `map.build`, then a record write,
and nothing is in flight between them. The renderer holds the runs, and
outlives the views that started them, so the screen is what disables the
button while one is going. A flag on the settings service goes up before the
first `await`, since a second reset arriving while the first resolves paths
would otherwise find it down; while it is up it refuses every engine
request through the same guard the registry uses - asked on both sides of
the registry's own check, which reads the project list from disk - every
export through the exporter's own, and every write to a project record
through the project handlers', so nothing lands in a folder being walked
away.

The confirmation promises that exported files are not touched unless they
are inside one of the four folders, and a project can export to a folder
of its own (A5.5-19), so that folder must never be inside the home a
reset empties, be it, or hold it (issue 206): that is what keeps the
folders exports go to out of those four. An
export is written to `<folder>/<project name>/`: a folder under the home
can sit in one of the four, and a folder that is the home puts a project
named `out` there. The relation is kept at three doors, each of which
resolves both sides through `realOrResolved` first, because the comparison
is textual and a folder reached through a link passes every textual check.
Two of them ask one pure function, `destinationsInTheWay` in
`src/main/settings.ts`, which judges a home against the folders the
projects already have; the third is `destinationRefusal` in
`src/main/export.ts`, which judges a folder a project is being given
against the homes.

- **The reset** refuses for the projects under the home in force, under
  the flag and after every other check, as the last thing before the
  removal.
- **The choice of the engine's folder** in Settings refuses a folder, the
  default included, that any project's export folder is inside or around.
  This is the door that closes the way a person actually gets there: the
  records live under the home and nothing moves them when the home moves,
  so once the app has started on the new home the project that exports
  there is a record in the old one. The choice is the last moment the
  store still holds it. The engine folder's changes take turns, since each
  reads the disk before it writes and two presses must land in the order
  they were made.
- **A project's own folder** is judged against the home in force and
  against the folder waiting for a restart, where there is one: without
  the second, a project could be given a folder inside an engine folder
  chosen a minute before, and after the restart be a record nothing reads.
  The folder waiting is what Settings answers as `pending`, and the rule
  is handed a function for it, asked each time a folder is judged and
  never kept, because a person can choose an engine folder or take one
  back while the app runs. The exporter asks the same refusal again before
  every export, so a folder stored before the engine folder was chosen is
  refused at the next export. The sentence does not call the folder
  waiting the engine data folder, which it is not yet: "Choose another
  folder: that folder is inside the folder the engine data moves to at the
  next start, which “Reset engine data” removes from then on.

So whichever of the two folders is chosen second is the one refused.

Every refusal over exported files says, in this order, what is in the way,
what would happen, and what to do first - and what to do is two things,
the files before the folder: "move them out of the engine data folder and
change where the project exports first". Changing a folder moves nothing,
so a sentence that asked only for that would be followed to the letter by
somebody whose exports were still under the home when the reset then ran.
The two refusals over the app's own export folder say the same. A
sentence names the project, or the first two and how many more, and shows
no path; a name is shown whole up to the 120 characters a name may be, and
past that as its beginning and an ellipsis, since a record edited by hand
can carry a name of any length.

**What a reset that goes ahead removes.** The rule is over where a project
exports now, not over what it has exported. Files already exported into
one of the four folders are removed by a reset that goes ahead, and
changing where a project exports moves nothing: a person who changes the
folder and leaves the files loses the files. That is decided, and a test
says so by name; it is why the sentence asks for the files first.

**A project this version cannot change.** A project made by a newer
version of the app is read-only here, and its export folder still counts,
because its exports are as much a person's as any other's. But this
version cannot change where it exports, so that half of the advice cannot
be followed for it. A person moves the files out and then either deletes
the project, which this version can do, or opens it in the version that
made it and changes its folder there.

The project store hands Settings the list - `destinations()`, each record
under its own `projects` folder that has a folder of its own, a read-only
project's included - as it hands the feeds' guard the projects' feeds, so
the settings service never holds the store; it is read once at each press.

**Which failure of that read refuses, and which does not.** Two things
can go wrong, and they end differently on purpose.

- **The projects folder cannot be listed**, for any reason but its not
  being there - no permission, a disk error, too many files open, a file
  where the folder should be. `destinations()` rejects, by the failure's
  code, and the choice or the reset is **refused**: "The projects folder
  could not be read, so the app cannot tell where the projects export, and
  nothing was changed or removed; look in the engine data folder, which
  Settings shows, at “projects”, which is what cannot be read." It ends on
  what a person can do, because on such a home they can neither reset it
  nor move off it in Settings. The sentence is the service's own,
  because a filesystem message names the path. `list()` reads the same
  folder leniently and answers no projects, as it always has, because the
  front door must still open on a folder that has gone wrong.
- **One record cannot be read or parsed** - it cannot be opened, is not
  JSON, fails the parser, carries another folder's identity, or sits in a
  link or under a name that is no identifier. It is **skipped**, as the
  project list skips it, and named in the log by its folder and the reason
  or the failure's code, never a path; the choice or the reset goes ahead
  on the rest.

The difference is what each hides. A folder that cannot be listed hides
every project, so nothing at all is known and "none" would be a guess in
front of a removal. One bad record hides one project, and the reset is the
remedy for bad records: refusing would let a single corrupt file block the
tool a person reaches for when things are broken. A projects folder that
is not there is a home with no projects, and refuses nothing. That has a
consequence worth knowing: an engine data folder on a volume that is not
mounted reads as having no projects, since a folder that is not there
answers `ENOENT` like any other, so neither door sees the projects on it.

**A deadline over the folders.** Resolving a folder through its links asks
the disk, and a folder on a network share or an automounted volume can
stall rather than fail. So each door puts one deadline, `FOLDERS_TIMEOUT_MS`
(five seconds), over its whole check, as the diagnostics copy bounds its
lookup of the home folder. When it lapses the choice or the reset is
refused, the reset's flag comes down, and the engine folder's queue moves
on. Without it a stalled folder would keep the flag up until the app was
quit, with every engine request, export and record write refused
meanwhile. With it the flag is up for as long as a refusal takes to
decide, which is up to the five seconds, and for that long "The engine
data is being reset; wait for it to finish." is said of a reset that may
end refused. A check that lapsed is abandoned, not stopped, since nothing
can take back a question already put to the disk: so the checks only
read, and what acts on their answer - the removal, the write of the
engine's folder to the settings - is made after them and only on an
answer that came in time. The timer is cleared whichever way a check ends.

**The sentence says which folder did not answer.** "The folders could not
be checked" is nothing a person can act on, so each check keeps note of
what it is asking the disk about, and the door reads the note when the
deadline lapses. Where it was a project's folder the project is named,
its name bounded as in every other sentence: "The folder the project “Los
Angeles” exports to did not answer in time, so nothing was changed or
removed; change where the project exports, or try again when it can be
reached." Where it was another folder the sentence says which: the engine
data folder, the folder chosen or the default one, the export folder, the
home folder, the folder the app keeps its settings in, or the reading of
the projects itself. No path in any. `destinationRefusal` is bounded the
same way and says which of its folders it was - the folder being judged,
the app itself, the engine data folder or the one waiting - in a sentence
the chooser shows and the exporter says before "That is the folder this
project exports to, so the export did not start."; "The export" above
says what that leaves.

**One question to the disk per folder.** A check that lapses leaves its
question unanswered, and each holds one of the four threads the runtime
reads files with until the kernel answers, which on a mount that has
stalled may be never. Without a deadline the reset's flag and an export's
own state would keep a second attempt from being made; with one, "try
again" four times, in any mix of doors, would use up every thread, after
which every read and write the app makes would wait behind them, a
project's record included. So both of Settings' doors and
`destinationRefusal` ask through one resolver, `oneAtATime` in
`src/main/settings.ts`: while a folder has not answered, asking again
waits on the same answer and puts nothing more to the disk; once it has
answered, either way, the next asking asks afresh. It is by the folder as
written, so two spellings of one folder are two questions.

That bounds one folder asked again, which is what "try again" does. It
does not bound different folders on one mount that has stalled - four
projects each exporting to a folder of its own there, each exported - and
a check abandoned on a mount that is slow rather than dead goes on to its
next folder when the late one answers, to nobody. Either can hold the
four threads until the mount answers. Time is lost and nothing else: no
check writes, and nothing acts on an answer that came late. It is
accepted for now.

**The gate is asked again at a destination's write.** The bridge asks
whether a reset is running before it opens a project's folder chooser.
The dialog then stays open as long as a person likes and the folder is
judged after it, for up to the deadline, so the chooser is handed the
same gate and asks it again with nothing awaited between the asking and
the write: a reset confirmed in that time refuses the write, in the words
the first asking uses, and the record is not written into a `projects`
folder being removed.

**What no door sees.** A record left behind in a home the app used before:
it is not under the home in force, so nothing reads it, and a reset of the
home its project exports into is not refused. That, and any one record the
store could not read, are all that is out of reach.

`LEGIBLE_USER_DATA` moves Electron's user-data folder. It is not a setting:
it is how the end-to-end suite keeps its settings file out of a person's
own profile, and the app reads it before it is ready or not at all.
Contract: `specs/019-settings/contracts/bridge.md`.

### Licences

The Licences section (issue 108, ADR-042) names the app's licence and every
component the installers carry, from `src/shared/licences.ts`, which a unit
test holds to `THIRD_PARTY_NOTICES.md`'s table in both directions. Its three
buttons open the notices, the runtime's licence texts and Chromium's
licences through `api.licences`, whose methods take nothing: the main
process holds the paths under `process.resourcesPath`
(`src/main/licences-ipc.ts`) and opens them with `shell.openPath`, showing
the notices in the file browser where no viewer takes a Markdown file. In a
development run there is nothing to open, and each button says so.

## The log files

Every line the main process logs goes through `log` in `src/main/log.ts`,
and its sink is two files in the platform's log folder (A6-03)
(`app.getPath('logs')`, which "Open logs folder" opens): lines under the
`engine` tag - the engine's stderr as the supervisor reads it, and the
supervisor's own lines about the engine - go to `engine.log`, everything
else to `main.log`, each stamped with an ISO 8601 time. In development
every line still reaches standard error as well. `src/main/log-file.ts`
writes each file from one queue, so a burst of engine output is a handful
of writes and never holds up the supervisor. A write that would take a
file past 5 MB first renames it to `<name>.old.log`, replacing the one
before; nothing else is ever removed, and the reset does not touch the
logs, which are not under the engine's home. A rename the platform refuses
(Windows, while another program holds the file) does not stop the log: the
file is reopened and appended to, standard error is told once, and the
rename is tried again when another 5 MB has been written. While a reader
holds the file and the rename is refused, the log grows past 5 MB until
that retry succeeds. On POSIX the file is opened with `O_NOFOLLOW`, for
writing and for the copy's reading, so a link planted in its place is not
followed.

Every line has its web addresses redacted before it is written, to either
file and to standard error, in development and when the log folder cannot
be used - and before it is sent to the window, which is a third
destination (A5.5-13): `src/main/engine-ipc.ts` redacts `job/log`'s line and
`job/progress`'s message as it hands them on, so the jobs inspector's copy
and the log cell 02 draws carry the same bytes the log file does. An
error is the fourth: `src/main/ipc-shape.ts` redacts the `message`, `hint`
and `detail` of every error shape that crosses to the page, the engine's
and the app's own refusals alike, since until engine v0.10.1 a failed
download's error named the whole URL in all three (issue 207). The same
door takes the paths out of them, as the next paragraph says. What
redacts is one function (`src/main/redact.ts`): a URL can carry a key, and
whatever prints one on the engine's stderr or into an error is redacted
here, whoever wrote it. The engine redacts a person's feed at source by
the same rule and marker (engine v0.10.1, its issue 32), which makes this
the second guard for the engine's own sentences and leaves it the only
one for anything else. **The `.json` the engine writes beside an export
is guarded by the engine alone**: the app never rewrites that file, and
its `source` is the feed's address as the engine names it. For an `http` or `https`
address - slashes plain or JSON-escaped, host a name or an IPv6 literal -
the scheme, the host, the path and the query's parameter names stay; the
user information, every query value (after `?`, `&` or `;`), a nameless
query part and the fragment become `<redacted>`. A percent-encoded address
is decoded leniently and redacted up to a raw `&`. A path with a query and
no scheme, or an `http(s)` one, which is how urllib3 and `requests` word a
failed connection (`Max retries exceeded with url: /gtfs.zip?api_key=…`),
keeps each `name=` and loses its value; another scheme's query, like the
app's own `app://local/…?theme=dark`, is kept. An address runs to the next
whitespace, quotes and parentheses included, since the engine prints a URL
as given; only closing punctuation at its end is set aside. Not covered: a
token carried as a path segment, because nothing says which segment is
one; a secret in a parameter's name position, where a value holds an
unencoded `&` before it (`?key=a&SECRET=1`); a query on a run with no `/`
before its `?`; and a URL with whitespace inside it. Each run of text is
looked at once, and percent-encoded addresses are walked with a cursor, so
a long line costs linear time. `tests/unit/redact-generated.test.ts` puts
600 seeded URLs through the engine's message shapes.

The error door also takes paths out of the same three fields (issue 419).
The rule before it, `withoutPaths` (`src/shared/engine.ts`) on the engine's
hint in the JSON-RPC client and on the export's own errors, stopped at the
first space and did not see a path behind a quote: on the default macOS
install the engine's home is under "Application Support", so an I/O
failure showed the rest of the engine's data path, and Python's `OSError`,
which quotes its file, showed all of it. The client hands the hint on as the
engine wrote it, and the door does the work. The main process knows every
folder such a path starts with - the engine's home, the user-data folder,
the resources folder, the home folder and the export folder in force,
which Settings can change and is therefore asked at each error - and
`src/main/paths-in-text.ts` matches each whole, whatever its names hold, in
every form the diagnostics copy matches the home in (either separator,
separators doubled as `repr` and JSON print them, percent-encoded, any case
on Windows and macOS, and on Windows the 8.3 short name). Each folder's
real path, and the home's short form from the diagnostics copy's own
lookup, are added once their lookups answer, bounded at
`HOMES_TIMEOUT_MS`. The folders are first looked up at the first error,
not at launch, because the export folder is on the desktop by default,
which macOS keeps behind a privacy prompt; the door never waits, so until
then, and for good if a lookup lapses, the folder as named is what is
matched. From the folder the path runs to the quote that closes it where a
quote opened it (the quote with a space, punctuation or the end after it,
since Node does not escape a quote inside a path). Bare, it runs to a
space, unless a later word in the same clause carries it on (has a
separator in it and starts no path of its own); a double quote ends it,
and a comma, a semicolon, a colon, an apostrophe or a closing parenthesis
ends it only before a space, punctuation, a quote or the end of the line.
The whole path becomes "a file", the words the engine's sentences already
used. `withoutPaths` then runs as the backstop for a path under no known
folder, by the same rules, and leaves a slash with a space after it alone.
The app's own refusals (`badCall`) get the known folders and not the
backstop, because they can quote a person's project name, which a guess
would rewrite. Before any of this each field is cut to 4,096 characters,
ending "[cut to fit]", after its URLs are redacted and before its paths are
looked for; a field the scrub fails on is replaced by a fixed sentence, so
a request is always answered. Every caller names the folders, which is a
type error to forget; a shape made with `URLS_ONLY` has its URLs redacted
and its paths left, which is the exporter's preview shaping its own refusal
before the export bridge puts it through the door. The error a shape is
made from is not changed, and the engine logs its own failures, paths
included, to `engine.log`; an export's own failure is the exception,
because `normalise` takes the path out of the error itself and nothing logs
that failure. Not covered: a path under no known folder whose last name has
a space in it shows the rest of that name after the space, and so does a
name with a space at the end of a path under a known folder; a project's
own export folder (A5.5-19) is not among the known folders, so a path in it
gets the backstop alone; prose after a path is eaten when a later word in
its clause has a slash in it (`/x/y.zip has 114/114 stops` becomes `a file
stops`), which is accepted because it fails toward removing too much; the
export plan's notes, in the progress sentence and in the preview's `ok`
answer, get the backstop alone (`notesOf` in `src/main/export.ts`); the
progress message, the log lines cell 02 draws and the engine state's reason
are redacted for URLs only; an error thrown from any other handler (the
projects', Settings', a destination's) does not pass this door and relies
on its own sentence carrying no path; and the renderer
still runs `withoutPaths` itself where it did before, except for a failure
a person reads from a run or a panel (issues 519 and 593). The three runs, a
layout run, an export and a feed add, make their failure's sentence through
`runFailureSentence` (`src/shared/jobs.ts`), which runs it over the engine's
hint or message, or a thrown error's message, once, where the sentence is
made, except the app's own refusals (the code `badCall`, which `refusal` in
`src/main/ipc-shape.ts` gives them), which are left as the door made them
for the reason above: they can quote a project's name. The snapshot's
`error` is then already fit for a screen, and cell 01's download line, cell
02's status line, cell 06's run and the New project sheet show it as it is.
The four panels that read the engine without a run say a refusal by the
same rule (issue 593): cell 01's inspection and its stage drawing, and cell
05's colours and order, each through `runFailureSentence` with its own
fallback (the three inspections through `inspectionFailure` in
`src/renderer/src/engine/inspections.ts`), so an app refusal quoting a
slashed project name is shown whole there too. The engine's `detail` is kept
as sent beside it for the copied log, which main redacts on its own.

Lines logged before the app is ready are held in memory, two thousand at
most, and written first once the files open, which is the first thing the
app does when it is ready and before the engine starts. A folder that
cannot be opened or written costs the file and never the app: from the first
failure the lines go to standard error, which is told once why. A held line
keeps the time it was logged.

The files close on `will-quit`, which comes after the supervisor's stop has
resolved. That stop waits for the engine's stdio to close as well as for
its exit, at most a second after the exit, so what the engine printed on
the way out is normally in `engine.log`; a helper process that holds the
pipe longer than that loses its last lines. The close is bounded too, at
two seconds (`LOG_WAIT_MS`), and so is the flush "Copy diagnostics" makes
before reading the tails, which waits only for the lines queued when it
was asked, so a steady stream from the engine cannot hold it. Under
`LEGIBLE_USER_DATA` the logs move to `<userData>/logs`, and under
`LEGIBLE_LOGS` to the folder it names, with `app.setAppLogsPath`, because
on macOS they would otherwise stay in a person's own log folder.

The log may contain paths - the configuration lines by contract, and
Electron's own report of a failed bridge call, which prints the underlying
error. It stays on the machine. "Copy diagnostics" in Settings
(`src/main/diagnostics-text.ts`) composes the copy in the main process and
writes the home folder, and its real path when that differs, as `~`: in
either separator, doubled backslashes included, percent-encoded as in a
file URL, in any case on Windows and macOS, and on Windows in its 8.3 short
form, which the temporary folder is usually written in (`RUNNER~1`) and
which would otherwise leak the start of the user name. The short home is
derived from the temporary folder's raw and real paths, and matched by
shape as well. A match is a whole folder name; a full stop ends one unless
a name carries on after it. The composed text is checked for the home
folder afterwards, percent-decoded as well, and a copy that still names it
is refused.
A path outside the home folder, such as an export folder on another
volume, is left as it is. The copy redacts web addresses again, since a
log written before the redaction existed still holds them whole. Neither
is a scrubber for anything else; the person reads the text before they
paste it. The home folders are found when the copy is made, asynchronously,
and a temporary folder on a network share is not asked. The home's own
real path is bounded at two seconds (`HOMES_TIMEOUT_MS`) and fails closed:
if it does not answer, the copy is refused, since a home reached through a
link could otherwise survive in the text. The short forms are bounded the
same way, separately, and whichever answered are used.

`LEGIBLE_LOGS` moves the log folder on the terms `LEGIBLE_USER_DATA` moves
the user-data folder ("Settings and the reset"): development only,
an absolute path, read before the app is ready, and a bad value costs the
switch and not the launch. A moved user-data folder wins over it, its logs
following it. The end-to-end suite moves the profile for every launch
that names none of its own: `tests/e2e/global-setup.ts` sets
`LEGIBLE_USER_DATA` to one temporary folder for the whole run, and
`LEGIBLE_LOGS` to the `logs` folder inside it, where those launches' logs
go, and `global-teardown.ts` removes it. Otherwise most launches would use
the default development profile, a person's own: write its settings file -
the window's place at every close (issue 549) - read what that person chose
there, and write and rotate their log. A spec that resizes or moves the
window launches with a profile of its own, so its window never reaches
another spec's launch.

## Packaging

A packaged app carries everything the engine needs, under its resources and
outside the asar, in the same shape on every target
(`electron-builder.yml`):

| Path under the resources | What | Found by |
|---|---|---|
| `python/` | the python-build-standalone runtime with the engine installed, its bytecode compiled | `src/main/interpreter.ts` |
| `python/licenses/`, `python/PYTHON.json` | the licence texts of the libraries linked into the runtime and CPython's `Doc/license.rst`, with the build metadata they are checked against (ADR-042) | a person, through Settings › Licences |
| `loom/` | `gtfs2graph`, `topo`, `loom`, `octi` | `src/main/config.ts`, as `SCHEMATIC_LOOM_BIN` |
| `ffmpeg/` | `ffmpeg` and `ffprobe`, built by the vendor workflow from pinned FFmpeg and x264 sources with only what the export uses (ADR-040) | `src/main/config.ts`, as `SCHEMATIC_FFMPEG` |
| `vendor-manifest.json` | the pins' sha256 and every component's exact version, the runtime's Python packages included | a person, and the release job, which checks each installer's against the run drafting the Release |
| `first-run-gtfs/` | a GTFS folder of three stops and one subway trip, 588 bytes | `src/main/first-run.ts`, the first-run check |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | the app's licence and the notices | a person, and Settings › Licences |
| `LICENSE.electron.txt`, `LICENSES.chromium.html` | Electron's and Chromium's licences: in the resources on a Mac, where `electron-builder.yml` puts them back after electron-builder deletes them, and one folder up, beside the executable, on Windows | a person, and Settings › Licences |

The vendor workflow's ffmpeg jobs cache the three source archives (FFmpeg's
release tarball, x264's tar and zlib's release tarball) under a key made of
their names and pinned sha256s, and `scripts/vendor-ffmpeg.sh --fetch`
re-checks each against its sha256 on every hit, refusing and fetching again
one that differs; an entry is saved only on a miss, after all three have
verified. FFmpeg's and zlib's signatures are still checked on every run,
with the signature and the key fetched each time, since a cached key would
hide a revocation, and every fetch is tried four times with a growing wait.
`determinism.yml` keys its built ffmpeg on the `ffmpeg` block of the pins
and the scripts that build it, so another pin moving leaves it alone
(issue 630).

`.github/workflows/build.yml` builds the installers - a dmg on each Mac
runner and an nsis installer on Windows - from the vendor artefacts of its
own run: it calls `vendor.yml` as a reusable workflow, and each packaging
job downloads its target's three artefacts, restores the executable bits
the artefact zip dropped, and runs `scripts/check-vendored.mjs <target>`
(`npm run dist:check`). The check refuses, naming the component and the
target, anything missing, stale against `vendor/pins.json` (the runtime's
version, the engine's, and the version string and configure line inside
ffmpeg and ffprobe) or built for another architecture, which it reads from
each executable's Mach-O or PE header, and a runtime whose licence texts,
build metadata and the pins' reviewed lists disagree (ADR-042); then it
writes the manifest. The job
compiles the runtime's bytecode with `compileall -f --invalidation-mode
unchecked-hash`, because a timestamped file stops matching the moment the
packager copies its source and the first start rewrites it inside the
bundle, breaking a Mac bundle's signature (ADR-035). The same script is
electron-builder's `afterPack` hook: it checks the components again where
they landed, every module's bytecode, and the manifest's hash against the
pins being built, and Electron's and Chromium's licences where the app
looks for them, and with `LEGIBLE_VENDOR_TARGET` set a missing component
fails the package, where electron-builder alone would skip it with a
warning. Last, `scripts/launch-packaged.mjs` launches the unpacked app once
with a temporary `--user-data-dir` and the bundle as its working directory,
waits for the engine to be ready, asks it `engine.info` (which, at the
pinned engine, reports configuration rather than proving execution), waits
for the first-run check to pass for both tools, quits, and reads the log for
the bundled origins, the check's passing line and the engine's clean end.
It then runs each bundled LOOM tool with `--help` and ffmpeg and ffprobe with
`-version` from inside the bundle, and compares every file and folder in the
bundle with the list taken before the launch. It runs no layout or export;
ADR-035 says what that would take. On macOS the job then verifies the app's
signature with `codesign --verify --deep --strict`.

The Windows installer keeps no copy of itself (issue 128).
electron-builder's NSIS template copies the running installer, about
160 MB, to `%LOCALAPPDATA%\<package name>-updater\installer.exe` for
electron-updater's differential updates, and its uninstaller never removes
it. This app has no updater (ADR-037, ADR-054), and electron-builder has no option
to skip the copy, so `build/installer.nsh` (named by `nsis.include`; the
only other nsis options set are the three brand icons) removes the folder
in `customInstall`, which the
template runs straight after the copy, and again in `customUnInstall`, for
an install an older installer made. The folder is the template's own
`APP_INSTALLER_STORE_FILE` without its file name, and the build fails if
that stops being one folder name ending in `-updater`, so the removal
cannot reach another folder. Keeping the copy and documenting it was the
alternative; it bought nothing. When an updater arrives it will need the
copy back, and both removals revisited then: `customInstall`'s, which
deletes the copy, and `customUnInstall`'s, which already stands aside when
an installer runs the old uninstaller to replace it (`--updated`), since
the installer running then could be the one in that folder. A removal
straight after the copy is tried three times a second apart, in case a
virus scanner still holds the file. On
Windows the packaging job then installs the installer silently, checks the
folder is absent while installed, puts a stand-in copy there, uninstalls
silently and checks both the install folder and the updater folder are
gone. `acceptance.yml`, which derives the install folder from the
per-user one-click defaults, lets an nsis section through only when it
holds `include` and the three installer icons, which draw the installer
and say nothing about where it installs; a unit test holds
`electron-builder.yml` to that list, because the gate runs by hand against
a published tag and would otherwise fail after the release.

The Mac app is signed ad hoc, and nothing is signed with an identity
(ADR-037, ADR-054); `forceCodeSigning` is set but only takes effect once a real identity
replaces the ad-hoc one, so the `codesign --verify` step is what checks the
signature. A local `npm run dist` builds an unpacked app with whatever is
vendored: with nothing, the hook lets it through and says it is not an
installer; with anything, it holds the build to the same check.

### The first-run check

The engine's handshake proves the runtime and the engine start; nothing
else proves LOOM or ffmpeg will run on a person's machine until a layout or
an export fails half way through. So on every start of a packaged app, once
the engine's first start has settled (ready, unavailable, mismatched or
stopped), the main process runs the tools itself (A6-02,
specs/026-first-run-check): `gtfs2graph -m subway` over `first-run-gtfs/`,
which passes only when its standard output parses as a feature collection
with a `LineString` in it - a zero exit is not enough, since a mode with
nothing in it prints an empty collection and exits 0, and a LOOM tool's
`--version` says `-128-NOTFOUND` whatever it is - and `ffmpeg -version` and
`ffprobe -version`, which must exit 0 and introduce themselves, ffprobe
found beside ffmpeg as the engine finds it. No engine method is involved:
the paths are the configuration's. A package judges its own `loom/` and
`ffmpeg/` whether or not they are there, because `resolveConfig` falls back
to the development defaults for a package without them
(`firstRunTargets` in `src/main/config.ts`); a development run checks only
what `SCHEMATIC_LOOM_BIN` or `SCHEMATIC_FFMPEG` names, and never Docker or
PATH. Each spawn is an argument array with `windowsHide`, a 15-second
deadline, its standard output capped and its standard error in `main.log`
under `first-run`, run in a fresh folder under the temporary folder that is
removed after, and ended at quit; a killed child is given two seconds to
close first, because on Windows a terminating process still holds its
working folder, and a quit during the file checks spawns nothing. The
outcomes are published together, once the folder is gone and the summary
line is in the log, so the launch check - which quits the moment the result
says finished - always finds the line. The result crosses the bridge as one
read and one change (`api.firstRun`): per tool running, passed, failed with
a sentence and a detail with no path in it (the check's own paths and the
app's folder as their names, the home as `~` as "Copy diagnostics" writes
it, any other drive- or share-rooted path cut to the end of its line), or
skipped with a reason. A failure opens one modal dialog per start, never
over another dialog - the mismatch dialog, or one a person has open - and
opens when that one closes, with "Copy diagnostics" (whose text now carries the check) and "How
to install", which opens the install document at an address the main
process holds, in the platform's browser; that press is the check's only
reach to the network. Settings shows the result for as long as the app
runs. Measured on an Apple-silicon Mac with the vendored binaries: under
10 ms for `gtfs2graph`, about 10 ms each for ffmpeg and ffprobe.

### The release

A pushed tag `v<version>` or `v<version>-rc.<N>` runs the same build, path
filters or not (GitHub does not evaluate them for a tag), and after the
vendor jobs and all three packaging jobs succeed a last job, the only one
with `contents: write`, drafts a GitHub Release (A6-01,
specs/025-release-on-a-tag, ADR-041). `scripts/release.mjs` decides and
the workflow does: it refuses a tag that is not for `package.json`'s
version, that no longer names the run's commit on `origin` (moved or
deleted since the push), or whose commit is not reachable from `main`,
before anything is downloaded; renames the three installers for their machine
(`Legible-Cities-<version>-mac-arm64.dmg`, `-mac-x64.dmg`,
`-windows-x64-setup.exe`) after checking each artefact's manifest was
written from this run's pins, for this version, in this run; archives the
vendor workflow's three Corresponding Source artefacts, `ffmpeg-source`,
`loom-source` (LOOM at its commit with its submodules, the Windows port,
the patch script, and zlib's and bzip2's upstream tarballs, with the
`loom-windows` job's MSYS2 source packages for the exact revisions it
linked, and its record of those packages, put inside) and `engine-source` (the engine at its pinned commit, with the hashed manifest its runtime's packages are installed from), one tar each, owners
and times fixed; writes `SHA256SUMS.txt` over them; and fills the notes from
`.github/release-notes.md` and the pins. Then one step holding the token
lists the Releases, creates a draft for the tag or updates the one draft
there is (its title, prerelease flag and assets, never its notes, which
the maintainer may have edited; removing any asset this run does not
attach), refuses a
published Release for the tag untouched, uploads with replacement, and
reads the draft back to compare every asset's name, size and GitHub's
sha256 digest with the files. An `-rc.N` draft is a prerelease. Before
the draft is written, the same folder is uploaded as the `release-assets`
artefact, and a last job, `attest`, the only one with `id-token: write`
and with nothing else that writes, holds each file to its line in
`SHA256SUMS.txt` and attests the installers and `SHA256SUMS.txt` with
Sigstore through `actions/attest-build-provenance` (issue 434, ADR-057).
Nothing is published: the maintainer reads the draft and publishes it by
hand, only after the attest job is green. If `vendor / electron ffmpeg
(source)` fails on a tag's run, re-run the failed jobs before anything
else (`gh run rerun <id> --failed`): its fetch from Chromium's mirror can
stall on every attempt, and the packaging jobs, and so the release job,
refuse to go on without it (issue 585). Its cache makes that rare, but a
tag's run reads only entries saved on `main` or under the tag, and an
entry unread for 7 days is evicted, so a tag cut long after the last run
on `main` that touched these paths finds none. Shortly before tagging,
dispatch the vendor workflow on `main` (`gh workflow run vendor.yml --ref
main`), so the tag finds a warm entry.
`docs/install.md` is what a person follows with the assets, and the
first-run dialog's "How to install" opens it on `main`.

A published Release is accepted by `.github/workflows/acceptance.yml`, on
request with its tag (A6-04): on `macos-15` and `windows-latest` it
downloads the Release's installer and `SHA256SUMS.txt` with a read-only
token and checks the one against the other, installs (the dmg mounted
read-only and the app copied out; the NSIS installer run silently into
`%LOCALAPPDATA%\Programs\<package name>`), drives the installed app through
`docs/acceptance.md`'s steps 3 to 20 with
`tests/acceptance/acceptance.spec.ts` - a real layout, real exports probed
with the bundled ffprobe - and uninstalls, recording what is left; the
record, in the checklist's results template, is the job summary.

The installers also carry a library nothing here builds: Electron's own
FFmpeg (`libffmpeg.dylib`, `ffmpeg.dll`), Chromium's media decoder, which the
app never calls, LGPL-2.1-or-later with libopus inside (issue 109, ADR-043).
Its source is attached as it was packed, as
`electron-ffmpeg-<electron version>-source.tar.xz`, by the vendor workflow's
`electron-ffmpeg-source` job (`scripts/electron-ffmpeg-source.sh`): Chromium's
FFmpeg at the commit Chromium's DEPS pins, and everything its `BUILD.gn`
names outside itself - Chromium's `build`, `third_party/opus`,
`third_party/nasm` and `tools/generate_stubs` - with `media/ffmpeg`, and
Electron's FFmpeg patch, gn args and patches to Chromium's `build/`, each
verified by its git object id against `electron_ffmpeg` in
`vendor/pins.json` - by tree id for the directories, both as the pinned
commit records them and as their exported files make them, everything
fetched with git (Chromium's own repository from the GitHub mirror the pins
name, since an object id names the same bytes wherever they come from) -
and packed reproducibly. The job
refuses a `package-lock.json` for another Electron, so every Electron bump
moves that block. It caches the archive, keyed on the repository (which its
`BUILD.txt` names), the Electron version and
the three files the archive carries copies of (the pins, the script and
`vendor.yml`) and the versions of the tar and xz that pack it, and checks
a hit before using it: `--verify`, with no network, refuses any entry but
a file or a folder, unpacks it, holds every tree and blob id, the copies
and `BUILD.txt` to the pins and the checkout, and packs what it checked
again, which must be the cached file's own bytes; a hit that fails is
fetched again, and a fetched archive passes `--verify` too before it is
cached (issue 585). That defends against a corrupted entry, drift and a
bad entry, not against someone who can already write a cache entry in
`main`'s scope, such as a compromised action in a workflow running on
`main`: the entry is unpacked into the workspace before `--verify` runs,
and the verifier and the three files it compares against come from that
same workspace. No workflow here has a `pull_request_target`,
`issue_comment` or `workflow_run` trigger, so only trusted runs on `main`
write such entries, as with `determinism.yml`'s caches. Each packaging
job refuses, before `npm ci`, to go on without the artefact, so no
installer is made in a run whose Electron library's source did not
verify, and `release.mjs` refuses one for another Electron than the pins
name.

## Design tokens

The stylesheets are loaded from `src/renderer/src/main.tsx` in the order its
imports give, each building on the one before; the first three, which carry the
tokens, are described here and the rest are the screens' own rules; the design system they implement is
[`docs/DESIGN.md`](DESIGN.md), and every interface issue cites it.

| File | Holds |
|---|---|
| `styles/theme.css` | the interface's own ground and ink per theme, the four brand lines and the station pair, the twelve-step ramp solved between ground and ink, and the semantic tokens on top of it (surfaces, borders, muted text, the accent, success, warning, error, selection), declared once per theme |
| `styles/scale.css` | everything that is not a colour: the two type tracks, the 4px spacing grid, control heights, radii, layers, motion |
| `styles/figui-adapter.css` | the mapping from the app's tokens onto the control kit's own variables, so a kit control is drawn in the app's colours and at the app's sizes without a rule of its own |

There is one more, `styles/tokens.css`, which nothing loads. It is a
verbatim copy of the two theme blocks in the engine's animation page, kept
so a retheme on the engine's side is still caught: `tests/unit/tokens.test.ts`
is its only reader, and it fails when the copy drifts from the checkout
named by `LEGIBLE_ENGINE_CHECKOUT`, skipping with a message where no
checkout is configured. The interface stopped drawing its chrome from
those six in ADR-044; the map still wears them, from the engine's own page
inside a frame no stylesheet of ours reaches.

The theme attribute is the engine's: `data-theme="sepia"` for light, no
attribute for the dark theme, whose names for a person are Parchment and
Night. It follows the operating system's preference
unless a person chose one of the two by name in Settings, which is applied
as soon as the settings are read (A1-04, `src/renderer/src/theme.ts`); a
project's own theme, which its page wears, is a different field ("The
theme"). Two unit tests keep the system honest: one
recomputes the WCAG contrast of every text and control pair named in the
design document in both themes and fails under the thresholds; the other
scans the renderer's sources and fails on a colour, size or duration
literal outside the four token files, so a component can only be drawn in
tokens.

The control kit is the MIT core of FigUI3 (`@rogieking/figui3`, pinned
exactly; ADR-026), imported from `kit/index.ts` and nowhere else: its
stylesheet and the script that registers the custom elements. The
package's editor and lab bundles are PolyForm Shield licensed, and a Vite
plugin (`scripts/figui-guard.ts`) refuses any import of them at build time
with the decision's sentence, so the wrong half cannot ship by accident.
The kit injects its styles into each element's shadow root, which is why
the renderer's Content Security Policy allows inline styles and nothing
else inline (`specs/001-electron-skeleton/contracts/origin.md`). The
renderer reaches the kit through thin wrappers in `src/renderer/src/kit/`
(`Button.tsx`, `TextInput.tsx`, `Select.tsx`) that own the custom element's
attributes and listeners, because React sets an unknown attribute as a
property and the kit reads attributes; the select is the native element,
styled with the tokens (ADR-026). Two more files in the folder are not FigUI3's: `Combobox.tsx` and `Disclosure.tsx`, each saying why in its own header.

Icons are Phosphor (ADR-026), vendored as plain SVG files under
`icons/phosphor/` with their licence: the light weight at 16px and the
regular weight at 24px, plus the filled play and pause. `icons/Icon.tsx`
inlines them as markup so they take `currentColor`, hidden from assistive
technology unless given a label. The mark, `icons/mark.svg`, is the brand
icon, its five colours drawn from the theme's own tokens so one file
follows both themes (ADR-044). The packaged app's icon is the brand art
itself rather than a rendering of the mark: `electron-builder.yml` names
`assets/brand/macos/icon.icns` and `assets/brand/windows/icon.ico`, each
carrying every size the platform asks for, the small ones without
stations. The progress line
(`ProgressLine.tsx`) is the first of the document's Beck motifs on screen:
one line with a round station per pipeline stage, filled for a stage that
has run and ringed in the accent for the one running, the line reaching as
far as the run has got and turning onto it on a quarter-circle bend, drawn
from the tokens and described to assistive technology as one sentence.

## Checks

`.github/workflows/ci.yml` has two layers, both required
(`docs/repository-settings.md` lists the required checks, and
`specs/038-test-pyramid/contracts/ci-layers.md` is their contract). `ci (<os>)` is the
fast one, on Ubuntu, macOS and Windows for every pull request and every push
to `main`: lint, typecheck, unit tests and a build. The tests of the mutation
job that start a real Vitest and send signals
(`tests/unit/mutations-runner.live.test.ts`) are `npm run test:live`, a step of
their own after the unit tests on the runners that are not Windows, so that
`npm test` stays quick. `e2e (<os>)` is the
Playwright Electron suite over the built app, on macOS and Windows only; it
always reports, and a pull request whose every changed path is documentation
passes it without running the suite (`scripts/ci-decide.mjs`), while a push
to `main` always runs it. Of that suite, the smoke test launches the app,
asserts the title, reads the empty Library, probes the origin's refusals from inside
the page, and quits; the lifecycle test creates a project from the Library,
relaunches on the same engine home, opens, renames and deletes it, and
fetches a file placed in its output folder before and after the delete; the
engine test runs the app against the stand-in engine and checks the status
line, a request and an error from the page, a restart after the engine is
killed, that nothing survives the quit, the mismatch state, and the app
with no interpreter at all; `tests/e2e/` holds the rest of the suite, a
spec per feature. The suite's global setup starts the stand-in engine once
and stops it before any worker launches the app (`tests/support/warm-engine.ts`),
so the run's first launch is as warm as the rest: a cold first start twice
missed the supervisor's 10 s handshake and the first test's wait ended
inside the restart (issue 529). The supervisor logs every handshake's time
(`handshake: answered in N ms`, or `no answer after N ms`) in `engine.log`,
which is how a cold first launch is told from a warm one, and the helpers'
wait for "ready" is `READY_DEADLINE_MS` (`tests/support/ready.ts`), a
handshake, the failed engine's ending (`shutdownMs`), the first restart
delay and a second handshake from the supervisor's own bounds. With
`LEGIBLE_KEEP_LOGS` set, which only the loop workflow does, the teardown
copies the run's logs into `test-results/logs/` so the artefact has them.

The unit suite is two Vitest projects, and `npm test` runs both (ADR-059).
`unit` runs in Node; a test that renders a component starts with
`// @vitest-environment jsdom` and draws it through `tests/support/render.tsx`
(`renderCell` for a notebook cell, with the screen's state completed from
one default, `renderPanel` for anything else), presses it with a real click
or a real `change`, and reads the document. `tests/support/dom-setup.ts`
stubs the one thing jsdom lacks that the app reaches, `ResizeObserver`, and
a test that would need a second stub belongs in the other project.
`browser` runs the files named `*.browser.test.tsx` in Playwright's headless
Chromium - not Electron - for what jsdom cannot show of the kit: focus
delegated into a `<fig-button>`'s shadow root, the popover, anchor
positioning, `checkVisibility`. It is kept small, the kit's tests and not
every cell's, and it fails, never skips, where the browser is not installed;
`ci (<os>)` installs it, cached by Playwright's version and the platform.
The focus ring's width and the kit's geometry stay end to end, since
neither layer lays anything out as Electron does. Unit tests cover, among
much else (`tests/unit/` is the list), the traversal matrix,
configuration parsing, the tokens, the record's validators and versioning,
the store against a temporary directory, the JSON-RPC framing, the
interpreter resolution and the environment allowlist, the supervisor
against the stand-in as a real child process, the engine bridge's main
side, the protocol's fingerprint and the reproducibility of its generated
types, the typed client against a stub bridge, the layout identifier and the
paths it refuses, the layout run's state machine against a stub, and the
viewer's method list and frame discipline. One Playwright
suite drives a layout against the stand-in: the stages on screen,
what a completed run writes, that a cancelled one writes nothing and can be
repeated, that a redraw whose cancel came too late is written and loaded as
any finished one, and that no path reaches the screen. Another loads a
hostile page in the viewer's frame and asserts it cannot read or call the
bridge, reach the interface's document, navigate the window or open one,
and that the frame's sandbox is exactly the one flag. The `*-real` unit
suites hold the app to the real engine - the protocol, the supervisor, the
registry, the layout (the stages the app declares in `src/shared/layout.ts`,
reported in that order), the opening and the generated page - on the BART
layout the determinism fixture commits, in a home seeded from it, and skip,
saying so, where no engine is named; `determinism.yml` runs them against the
engine it installs beside the determinism test ("The capture"), where a
suite that would skip fails instead. That workflow is not a required check.
The design system's own tests recompute the WCAG contrast of every
token pair the design document names, in both themes, and check the
document's stated ratios against the arithmetic; refuse a colour, size or
duration literal in a component file; prove the build guard refuses the
kit's PolyForm half and that the kit is a build-time dependency; check
every vendored icon; and render the progress line's four states. The
design end-to-end test reads the computed sizes and the focus ring of the
kit's controls in both themes, tabs through a dialog and closes it with
Escape. The hygiene checks (`gitleaks`, `bin/preflight`) run beside them.

## Deliberately absent

| Not here | Why, or what would bring it |
|---|---|
| The real-engine suites and the determinism test as required checks; they run in `determinism.yml` on a pull request that touches what an export is made of and on a weekly schedule ("Checks") | Not required until it has earned it, which the maintainer decides (`determinism.yml`'s header; `specs/038-test-pyramid/contracts/ci-layers.md`) |
| The project's fields and diagnostics in the inspector; it holds only the jobs, and the fields, the diagnostics and the project's own rail stay on the project screen | ADR-036: the jobs span projects, a project's fields do not |
| Tabs on the project screen; the kit's `Tabs` control went with the tab strip (A5.5-23) | ADR-045: the screen is a notebook whose cells all stay in the document |
| The map pinned as a band above the cells | ADR-046: a pinned band hides what it covers; it is not kept as an option |
| Crop and rotate | ADR-050: the frame is padded, never cropped, and rotation is deferred |
| Run all running the export | `runAll.ts`: an export writes a named file and can take minutes, so a button that promises everything must not do that as a side effect |
| A Revert in cells 04 and 05 | `specs/028-the-notebook/contracts/run-graph.md`, "Revert": their choices are written with `drawn` once the map carries them, so there is nothing to go back to |
| A trip in the record | ADR-048, spec 030: a trip is view state, and kept it would be an input to exports that never asked for it |
| The build's diagnostics in the record | A3-03, `specs/017-diagnostics`: the figures go stale when another project re-lays out the set ("What the build had to fudge") |
| `topo` and `octi` offered in the geographic view; they are drawn only while a run solves | Issue 282 |
| Counts on the sample cities' cards, or any feed fetched to draw one | ADR-047: a card asks the engine for the list and nothing else |
| LOOM's optional solvers | ADR-019: the layout passes no optimisation flags, so the binaries are built without them |
| Installers signed with an identity, and notarised; automatic update | Not in 1.0; ADR-054 says what would reopen it |
