# Architecture

What exists, in the present tense; what is planned, with the issue that
adds it. The decision records under `docs/adr/` say why; this page says
what.

## Three processes, one origin, one bridge

```
┌──────────────────────── Electron app ─────────────────────────┐      ┌─────────────────────┐
│  Renderer (React)            Main (Node)                      │      │ Engine (Python)     │
│  ┌───────────────────┐       ┌──────────────────────────┐     │      │ python -m           │
│  │ Library           │◄─IPC─►│ window, single instance  │     │      │   schematic.serve   │
│  │ project run+viewer│       │ app:// protocol handler  │     │ stdio│                     │
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
  viewer's driver (the project page's frame, held by identity and injected
  into from here), and the engine's supervisor: the one child process the
  app starts.
- **Preload** (`src/preload/`): a `contextBridge` exposing `window.api` and
  nothing else. `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- **Renderer** (`src/renderer/`): React. It draws the Library, the create
  dialog, and a project view with rename, delete, the layout run's progress
  line and the viewer's sandboxed frame; it knows projects by identifier
  and never sees a path. It never draws a map: the engine's animation page
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
import. Nine methods under `api.projects`, three under `api.viewer`, the
engine under `api.engine`, the export under `api.export`, one clipboard
write under `api.clipboard`, and the app's own settings under
`api.settings`:

| Method | Does |
|---|---|
| `list()` | the Library's entries, newest modified first; an unreadable record is skipped and logged, never shown broken |
| `get(id)` | one record, with `readOnly` set when a newer version of the app wrote it |
| `create({ name, feed, mode?, agency? })` | a new record, every other field at its default |
| `rename(id, name)` | changes `name` and `modified` and nothing else |
| `delete(id)` | removes the project and its output, and reports what could not be removed by folder role |
| `completeLayout(id, done)` | records the layout's id, the feed's window and the service day a finished run produced; the id is the engine's own, as `graph.build` answered it (A3-01, ADR-033), the window is `feeds.service`'s answer (A3-04, ADR-031) |
| `completeRebuild(id, done)` | records the day a finished rebuild drew the map for, inside the stored window or not at all (A3-04) |
| `setInputs(id, { mode, agency })` | stores the mode and agency a person chose with the feed in view; the next layout passes them to the engine, which names a layout for them (A2-02) |
| `completeColors(id, palette)` | records the line colours a person chose, once the map has been drawn with them; every label and every colour is checked on the main side first (A4-01) |
| `completeOrder(id, order)` | records the order a person arranged the lines in, once the map has been drawn in it; every label is checked on the main side first, and the same line twice is refused (A4-02) |
| `setTheme(id, theme)` | records the theme the project's map is drawn in, at once rather than after a build: a theme is neither a layout nor a render, and the page restyles itself from its own address (A4-03) |
| `setExport(id, choice)` | records what the project is set to export - a preset, a storyboard, the options - at once; every field is held to the engine's own rules on the main side first (A5-01) |
| `feeds.pickZip()` | opens the platform's file chooser for a GTFS zip and remembers the answer; the one native dialog, since a page cannot choose a file (A2-01) |

| `viewer.attach(projectId)` | holds the project page's frame by identity once it has loaded, and answers whether it did (ADR-028) |
| `viewer.release()` | lets the frame go |
| `viewer.call(method, ...args)` | one of the page's `__present` methods by name, run in the frame from the main process; a name outside the shared list is refused |

| `engine.state()` | the engine's state: starting, ready, restarting, unavailable, mismatched or stopped, with a reason where there is one |
| `engine.request(method, params?)` | a request to the engine, as `{ id, result }`: the id is a token the preload mints, the result settles with the engine's answer or its error (`code`, `message`, `data: { kind, detail, hint }`) unchanged |
| `engine.cancel(id)` | `$/cancelRequest` for that request |
| `engine.onState`, `onProgress`, `onLog` | subscriptions; each returns its unsubscribe |

| `export.run(projectId, choice)` | an export of one preset with its storyboard and options, as `{ id, result }`: the main process asks the engine for the plan, takes the page's frames itself and asks the engine to encode them; the result is the file's name and size, never its path (A5-02b, A5-01) |
| `export.preview(projectId, choice)` | the address the map's frame shows while the export tab is open: the engine's plan for the choice with the safe zones asked for exactly where the preset has them; `{ ok, url, width, height, notes }` or the engine's refusal as data; nothing is captured or written (A5-01) |
| `export.cancel(id)` | stops it wherever it is: the plan or encode request is cancelled, the capture aborted |
| `export.reveal(id)` | shows a finished export's file in the platform's file browser; the page names the export, the main process knows the file |
| `export.onProgress` | a subscription; each report names the stage (plan, capture, encode), how far it is, and a sentence |

| `settings.read()` | the two folders in force, where each came from, whether the environment names it, any folder waiting for a restart, and the theme (A1-04) |
| `settings.setTheme(theme)` | one of system, warm-dark and sepia; anything else is refused |
| `settings.chooseEngineFolder()`, `chooseExportFolder()` | opens the platform's folder chooser and applies its own answer; no path crosses the bridge inward |
| `settings.useDefaultEngineFolder()`, `useDefaultExportFolder()` | forgets the stored folder and takes the default again |
| `settings.engineSize()` | walks the engine's home, bounded and never through a symbolic link |
| `settings.openLogsFolder()` | makes the platform's log folder for this app if it is missing, and opens it |
| `settings.resetEngineData()` | removes `projects`, `out`, `data` and `frames` beneath the engine's home, never the home itself; answers what went and what would not; refused while anything is writing under it |

The engine bridge is deliberately untyped beyond a method name and an
object of parameters: A1-02 generates the methods from the engine's schema
and wraps it. An engine error crosses as a plain object rather than an
`Error`, because Electron keeps only an error's message and the engine's
`data.hint` is what the interface shows. A request's answer arrives as an
event on the same ordered channel as its progress and log lines, after
them, because Electron does not order an invoke's reply against events.

Every argument is validated on the main side, with the validators in
`src/shared/project.ts` that the form also uses; a refusal is a rejected
promise whose message is the sentence a person reads, never a path. Every
handler checks that `event.senderFrame` is the window's top frame and
refuses any other caller, which is another web contents: a second window,
a webview. It could not distinguish a same-origin iframe calling
`parent.api`, because the bridge's functions run in the top frame that
exposed them; that is why the viewer's frame is sandboxed to an opaque
origin and never shares the interface's (ADR-028). Nothing that crosses the
bridge, in either direction, is a filesystem path the renderer did not ask
the engine for; the renderer addresses a project by its identifier only.
Each addition is a reviewed change to the type, the preload and the
main-side handler together. Contracts: `specs/003-project/contracts/bridge.md`,
`specs/004-sidecar-supervisor/contracts/bridge.md`,
`specs/007-layout-run/contracts/bridge.md`,
`specs/008-viewer/contracts/viewer.md` and
`specs/017-diagnostics/contracts/bridge.md` and
`specs/019-settings/contracts/bridge.md`.

## The engine process

The engine is `python -m schematic.serve` from the pinned engine
(`vendor/pins.json`, `engine` block: tag, version, protocol), run by the
first interpreter of these that exists and by nothing else: the one
`LEGIBLE_ENGINE_PYTHON` names; in development, the engine checkout's own
`.venv`; in a packaged app, the bundled runtime under the app's resources.
With none, the state is *unavailable* with a sentence that names the key to
set, and the app is otherwise usable.

`src/main/sidecar.ts` spawns it with an argument array, `windowsHide`, a
process group of its own on POSIX, and an environment built from an
allowlist (the path, the home, the temporary directory, the locale, proxy
and certificate variables, `DOCKER_*` for the development backend, the
engine's four `SCHEMATIC_*` keys, and `PYTHONPATH` in development only, which
is how the tests substitute a stand-in engine). Every stderr line goes to the
log as it arrives under the `engine` tag. `src/main/jsonrpc.ts` speaks
JSON-RPC 2.0 with `Content-Length` framing over the child's stdio, our own
client rather than a library because the engine keys its notifications by
the request id, which the client must therefore assign and know.

The handshake is `engine.info`, bounded at 10 s: the version and the
protocol must equal the pin, or the page's own dialog names both and the
state is *mismatched* for the rest of the run. Every other request has an
inactivity bound (10 min without a `job/progress` or `job/log` line for it),
after which the app cancels it and says so. An exit nobody asked for
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
engine. The tests against the real engine run where `.env.local` names a
checkout with an environment, and skip, saying so, elsewhere.

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
description uses a closed set of sixteen JSON Schema keywords, ten that
shape a type and six that constrain values and are ignored. An unrecognised
seventeenth stops the build naming the keyword and its path rather than
emitting a plausible wrong type. A library was measured and rejected,
because running the output through a formatter would make the committed
file depend on that formatter's version
(`specs/006-typed-engine-client/research.md`, section 2).

Three checks keep the copy honest. Two need no engine and so run on every
machine that builds the app: the fingerprint must match the committed
description, and regenerating the module from that description must
reproduce the committed file byte for byte. The third asks the engine in
the checkout for its description and fails on any difference, naming the
first differing line and the command that fixes it; with no checkout it
reports itself skipped rather than passed.

The renderer reaches the engine through
`src/renderer/src/engine/client.ts`; the layout run (A3-01) is its caller,
and the status line still reads the bridge directly for the one thing the
client does not carry, the engine's own state.
The bridge underneath stays untyped on purpose, because transport should not
know the engine's methods; the client is the layer that does. It takes the
bridge in its constructor, so its tests need no Electron, and it neither
tightens nor relaxes the description anywhere. A request hands back a
handle: the engine's result, that one request's progress and log lines, and
cancellation by the token the preload minted. Two shapes the bridge carries
are the engine's with one named difference each: a notification's id is the
token rather than the engine's numbering, and an error's kind may be one of
the app's three as well as the engine's seven, for a failure the engine
never saw. Both are derived from the generated types rather than copied, so
neither can drift. Contracts:
`specs/006-typed-engine-client/contracts/client.md` and `generation.md`.

## Projects

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
feature changes a value, not the shape. The defaults mirror the engine's
own and are stored as data, not interpreted. Contract:
`specs/003-project/contracts/record.md`.

**Versioning.** Every record carries `version: 1`. A record from an earlier
version is read with its missing fields at their defaults and written back
in the current form only when something else changes. A record from a
later version - a higher number - is read-only: the Library lists it, the
project view says so, rename and delete are disabled, and the file is never
rewritten. A folder under `projects/` without a readable, valid record is
not a project: the Library skips it and the log names the folder.

**Writes are atomic.** The store writes `project.json.tmp` beside the
record and renames it over `project.json`, so a crash mid-write leaves the
previous record rather than a truncated one; readers ignore a stray
`.tmp`. Rename changes exactly `name` and `modified`.

**Delete removes two folders**: `projects/<id>/` and the project's
generated output under `out/<id>/`, whether or not the latter exists.
Nothing else is touched - not `feeds/`, not another project - and whatever
could not be removed is reported by role, project or output, never by
path.

**Until the first layout**, `date` and `layout` are `null`, and the
interface says "not yet chosen" and "not laid out yet". The service day is
resolved once, at the project's first layout, and stored then; it is never
re-resolved silently (ADR-031, which amends ADR-023 on the moment). Today
it is the machine's date; once the engine can report a feed's window it
becomes the engine's choice, and changing it is an explicit action
(A3-04). The layout is the stored layout's id, produced by that same
first layout: the engine's own, the hash of everything that went into the
layout (ADR-033; a record from before carries the app's digest of the stage
graphs, which the next run replaces). Until the engine's registry is
reachable (A2-01), the feed key is typed into the create dialog and
validated for form only.

The Library has no record of its own: it is the set of readable records
under `projects/`, sorted by modified time, newest first.

## Configuration and the startup log

Four locations, one pin and one development pointer, from the process
environment, then `.env.local` (development only, gitignored; `.env.example`
documents it), then the two folders a person chose in Settings, then
defaults:

| Key | Default |
|---|---|
| `SCHEMATIC_HOME` | the folder chosen in Settings, else `<userData>/engine` (ADR-016) |
| `SCHEMATIC_LOOM_BIN` | unset; a directory of native LOOM binaries, which the engine runs instead of its Docker image |
| `SCHEMATIC_LOOM_COMMIT` | passed when set, or with a LOOM directory, where the default is the app's pin (`loom.commit` in `vendor/pins.json`); the binaries cannot say which LOOM they are, so the engine reports what it is told as `engine.info.loom.commit` |
| `SCHEMATIC_FFMPEG` | unset |
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

## Settings

The app's own settings are one file, `settings.json`, directly under the
user-data folder: the two folders a person chose and the interface's theme.
It is written the way a project record is - a fresh temporary name, then a
rename over the old file - and read the way a record is read, so a file
that is half written, hand edited or from a newer app starts the app with
the defaults it cannot use rather than stopping it. It is read before the
configuration resolves, because a stored folder is one of the things the
configuration decides.

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

`LEGIBLE_USER_DATA` moves Electron's user-data folder. It is not a setting:
it is how the end-to-end suite keeps its settings file out of a person's
own profile, and the app reads it before it is ready or not at all.
Contract: `specs/019-settings/contracts/bridge.md`.

The main-process log is stderr for now and may contain paths - the
configuration lines by contract, and Electron's own report of a failed
bridge call, which prints the underlying error. The log file A6-03 writes
shortens paths under the user's data folder before anything is copied for a
bug report.

## Design tokens

Four stylesheets, loaded from `src/renderer/src/main.tsx` in this order,
each building on the one before; the design system they implement is
[`docs/DESIGN.md`](DESIGN.md), and every interface issue cites it.

| File | Holds |
|---|---|
| `styles/tokens.css` | a verbatim copy of the two theme blocks in the engine's animation page, warm-dark and sepia: six colours per theme, the brand's. The page is the source of truth (principle II); a unit test fails when the copy drifts from the checkout named by `LEGIBLE_ENGINE_CHECKOUT`, and skips with a message where no checkout is configured |
| `styles/theme.css` | the twelve-step warm ramp derived from those six, and the semantic tokens on top of it (surfaces, borders, muted text, the accent, success, warning, error, selection), declared once per theme |
| `styles/scale.css` | everything that is not a colour: the two type tracks, the 4px spacing grid, control heights, radii, layers, motion |
| `styles/figui-adapter.css` | the mapping from the app's tokens onto the control kit's own variables, so a kit control is drawn in the app's colours and at the app's sizes without a rule of its own |

The theme attribute is the engine's: `data-theme="sepia"` for light, no
attribute for warm-dark. It follows the operating system's preference
unless a person chose one of the two by name in Settings, which is applied
as soon as the settings are read (A1-04, `src/renderer/src/theme.ts`); a
project's own theme, which its page wears, is a different field and is
A4-03's. Two unit tests keep the system honest: one
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
renderer reaches the kit through three thin wrappers (`kit/Button.tsx`,
`TextInput.tsx`, `Select.tsx`) that own the custom element's attributes
and listeners, because React sets an unknown attribute as a property and
the kit reads attributes; the select is the native element, styled with
the tokens (ADR-026).

Icons are Phosphor (ADR-026), vendored as plain SVG files under
`icons/phosphor/` with their licence: the light weight at 16px and the
regular weight at 24px, plus the filled play and pause. `icons/Icon.tsx`
inlines them as markup so they take `currentColor`, hidden from assistive
technology unless given a label. The mark, `icons/mark.svg`, is the
design document's 45-degree join with a hollow interchange diamond, drawn
by hand; `scripts/render-icon.sh` renders it on the sepia ground into
`build/icon.png`, the committed application icon. The progress line
(`ProgressLine.tsx`) is the first of the document's Beck motifs on screen:
one line with a tick per pipeline stage, a filled mark for a stage that
has run, a hollow diamond for the one running, drawn from the tokens and
described to assistive technology as one sentence.

## The layout run

One action on a project's screen produces a map. The app asks the engine
for the project's layout, then for its map, and reports each stage as the
engine finishes it.

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
id, the feed's window and the modification time, together or not at all.
A cancelled or failed run writes nothing, and can be run again.

"Re-layout" runs the layout call with `force`, behind a warning that the
layout engine is heuristic and a new layout may place stations differently.
The engine keeps the stored layout until the new set is whole, so a cancel
or a failure leaves the project exactly as it was; the record is written
only when the run finishes, and says the map came from a fresh layout.
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
again from another project, and the screen says so; the project's fields
show the time beside the id (A3-06).

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

Changing the day is a person's explicit action, on the project screen: a
native date control bounded by the stored window, with the engine's day
one press away. A chosen day is a rebuild, `map.build` from the stored
layout's id, never `graph.build`, so the stations do not move; the day is
written only when the map has been drawn, through a bridge call of its own
that refuses a day outside the window again in the main process. A
cancelled or failed rebuild keeps the day, and says the page on screen may
be the old map until the next build. The app parses and shows no time of
day: a trip past midnight keeps its `25:44`-style time in the page, which
is the engine's (`specs/012-service-date`).

### What the build had to fudge

`map.build` answers three things beside its files, and A3-03 keeps them:
`diagnostics`, the build's numbers as data; `caveats`, the same numbers as
sentences; and `issues`, one weighted proportion where 0 is clean. All
three are built once in the engine's `schematic/diagnostics.py`, so the
terminal, the site and this app say the same thing.

They live on the run's snapshot and nowhere else, set with the sentence
that says the run finished: never while it is still running, so the
figures cannot reach the screen before the map they describe, and never
for a run whose record could not be written. The panel describes the build
that just ran, which is why a failed, cancelled or never-run project has
none, and why a rebuild for another day replaces the figures with that
day's. The block is read rather than assumed, to the depth the panel
reaches into it: the renderer has no error boundary, so a block that is
not whole would take the window blank after the map had been drawn, and is
simply not shown instead. They are deliberately not written to the record: `parseRecord`
drops what it does not know and `RECORD_VERSION` is 1, so a new field
would make a record read-only to an older app, for numbers that go stale
the moment another project re-lays out the set this one draws from.

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
### Line colours

A line is drawn in the colour its feed publishes as `route_color`, and a
line whose feed publishes none is drawn in one default. Since engine
v0.8.0 both are the caller's to set: `map.build` takes `colors`, a colour
per line label over the feed's own, and `default_color`, and the engine
resolves each line once (`render.line_colors`, E06) so the map, the chips
over it and the time chart all draw from one table.

The project record has carried `colors` and `defaultColor` since A1-05 and
the Colours panel is what writes them. It lists one row per line label the
feed offers under the layout's own mode and agency, read from
`feeds.inspect` - the labels and the feed's colours are the engine's, and
the panel draws a swatch beside a name and nothing else. A change is
debounced into one `map.build` from the stored layout's id and the stored
day: a colour is a render, never a layout, so the stations do not move
(ADR-023). The palette is written only when the map has been drawn,
through `completeColors`, as a chosen day is; a cancelled or failed build
leaves the record alone and the panel goes back to it. Every draw the run
makes carries the record's palette, so a layout, a re-layout and a chosen
day all draw the colours the project chose (`specs/018-colours`).

The engine ignores a colour for a label its stored layout does not carry,
which is why the panel can list the feed's labels rather than the layout's
and why an override outlives a narrower mode.

### Line order

One list decides two things on the engine's page: where two lines share
track the later of them is drawn over the earlier, and the page lists the
lines in rows in that same order. `map.build` takes it as `line_order`,
and without one the engine draws the lines alphabetically by label.

The record has carried `lineOrder` since A1-05 and the Line order panel is
what writes it. It lists the same lines the Colours panel does, arranged by
the record's order first and the rest as they came, with Move up and Move
down on each: two named buttons rather than a drag, so the feature is
reachable from the keyboard. A move is debounced into one `map.build` from
the stored layout and the stored day, and the arrangement is written
through `completeOrder` only once the map has been drawn in it. Every draw
the run makes carries the record's order, as it carries the palette, so a
layout, a re-layout, a chosen day and a colour change all keep the
arrangement (`specs/020-line-order`).

The order the app sends is the whole arrangement a person was looking at,
and the engine treats it as a preference rather than a list of what to
draw: the lines it names come first and every other line the layout carries
follows, while a label the layout does not carry is ignored. That was a
defect until engine issue 28 - `line_order` drew the labels it named and no
others, so an order naming two lines of six drew two - which is why the app
pins the release that fixed it.

### The theme

The engine's page draws itself in one of two themes, warm-dark and sepia,
and reads which from `theme=` on its own address before its first paint, so
a frame never shows one and then the other. The record has carried `theme`
since A1-05 and the theme switch on the project screen is what writes it
(A4-03).

It is the project's theme, not the interface's. The map followed the
interface until this landed, which the viewer's own comment called a
placeholder: a theme belongs to the map, which is exported and published,
rather than to the room the person making it is sitting in. The interface
keeps its own theme in Settings and the two move independently.

A theme press is not free, though it is cheap: the theme rides on the
address, so the frame navigates rather than restyles. The page starts again
- its clock back at the hour it opens on, its chosen view, its scrub
position and its line toggles gone - and a large network's data is parsed
again. The app cannot do better today: it drives the page through
`window.__present` from the main process (ADR-028) and that seam has no
theme method, which is an engine issue rather than an app one.

Nothing is rebuilt for a theme, and no engine request is made at all: the
SVG carries its furniture's colours as CSS variables with literal
fallbacks, so the page restyles itself and the line colours do not move.
The record is written the moment the switch is pressed, through
`setTheme`, and the viewer reloads the page at the new address. An export
passes the same choice in the engine's own vocabulary - `themeFor` maps the
record's two onto `dark` and `light` in `export.plan`'s options, and the
engine turns anything that is not `dark` into `theme=sepia` on the page it
drives (`specs/021-theme`).

## The feeds

The Library lists the feeds the engine knows (`feeds.list`, engine
v0.7.0): the presets curated in the engine, then the ones a person added,
each with whether its zip is downloaded, which is the engine's `cached`
and never the app's guess. A feed is added from a zip on disk or from a
URL through `feeds.add`, run from the page through the typed client with
the download's bytes and then the check on a progress line; a cancel
lands between the download's chunks and the engine keeps nothing; a
refusal is the engine's own sentence, which names the missing table. A
feed a person added is removed through `feeds.remove` behind a
confirmation; a preset has no Remove, and the engine refuses one anyway.

Two things only the main process can do sit in front of this. The file
chooser is the platform's, opened by the main process and parented to the
window, the one native dialog the rules keep; the path it answers is
remembered, and a `feeds.add` that names any other path is refused before
the engine sees it. And a `feeds.remove` of a feed any project still
names is refused, naming how many, because the engine would take the
zip and the layouts those projects draw from. Both refusals are answered
as bad calls with a sentence, from a guard every engine request passes
(`src/main/feeds-ipc.ts`, `specs/014-feeds/contracts/bridge.md`).

The create dialog offers the listed feeds as a native select, and falls
back to a typed key when the engine cannot be asked, so a project can
still be made without it.

## The Inspect view

Opening a project reads its feed through `feeds.inspect` (engine v0.7.1),
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
project created from the Library's list starts with its feed's registry
entry's mode and agency, so a preset draws as the engine's site draws
it; a record from before holds the app's old defaults, and the view says
what the feed's own entry draws and offers it in one press.

## The geographic view

A project with a layout shows two of its stages drawn where they run: as
the feed draws its routes (`gtfs2graph`) and after LOOM has sorted the
lines onto shared track (`loom`), before anything is straightened. The
drawing is the engine's, asked for by the layout's id through
`render.stage` (engine v0.7.0) and kept per layout, set, stage and width
for the session; the counts beside it are the engine's, shown as sent,
and never a number the app worked out (ADR-023: `topo` is not
reproducible, so a literal count is the wrong instrument). The SVG goes
into an iframe with an empty `sandbox`, no permission at all, through
`srcdoc`: nothing in it runs, it has no origin, and it is never inline
in the interface's document. Pan and zoom are the interface's transforms
on the frame, from the wheel, a drag, and the keys on a focusable pane
named for a screen reader. A narrower mode chosen in the Inspect view and
a new layout draw fewer lines here, from the new layout's set.

## The viewer

A project that has a layout shows the page the engine wrote for it, in a
frame, filling the region it is given. The app draws no part of the map
(principle I) and puts no chrome over the page: its own controls are the
controls.

The frame carries `sandbox="allow-scripts"` and nothing else, so the page
runs at an opaque origin. **`allow-same-origin` must never be added beside
it**: one word restores the page's origin, and a page with both can read the
bridge, call it and remove its own sandbox attribute. That is not a
hypothetical. Before this feature a page in a plain frame read `parent.api`
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
rather than a property access. That is fine for a control and wrong for a
live clock, which would need polling. Contracts:
`specs/008-viewer/contracts/viewer.md`; the decision and what it corrects:
ADR-028.

## Checks

`.github/workflows/ci.yml` runs on Ubuntu, macOS and Windows for every push
and pull request: lint, typecheck, unit tests, a build, and the Playwright
Electron tests over the built app. The smoke test launches it, asserts the
title, reads the empty Library, probes the origin's refusals from inside
the page, and quits; the lifecycle test creates a project from the Library,
relaunches on the same engine home, opens, renames and deletes it, and
fetches a file placed in its output folder before and after the delete; the
engine test runs the app against the stand-in engine and checks the status
line, a request and an error from the page, a restart after the engine is
killed, that nothing survives the quit, the mismatch state, and the app
with no interpreter at all. Unit tests cover the traversal matrix,
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
repeated, and that no path reaches the screen. Another loads a hostile page
in the viewer's frame and asserts it cannot read or call the bridge, reach
the interface's document, navigate the window or open one, and that the
frame's sandbox is exactly the one flag. One further test lays a
project out against the real engine and asserts the eight stage names in
order; it needs a checkout with a warm layout cache and skips, saying so,
without one, so it never runs in continuous integration. The design system's own tests recompute the WCAG contrast of every
token pair the design document names, in both themes, and check the
document's stated ratios against the arithmetic; refuse a colour, size or
duration literal in a component file; prove the build guard refuses the
kit's PolyForm half and that the kit is a build-time dependency; check
every vendored icon; and render the progress line's four states. The
design end-to-end test reads the computed sizes and the focus ring of the
kit's controls in both themes, tabs through a dialog and closes it with
Escape. The hygiene checks (`gitleaks`, `bin/preflight`) run beside them.

## The capture

The export path's middle, built before its ends (A5-02a; ADR-024). A
project page is loaded as the top-level document of a hidden offscreen
`BrowserWindow` with no preload, no node integration, the sandbox on, and a
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
recorder's sentence; the stage's rect in CSS pixels; `settle()`; then per
frame `advance(1/fps)` or a `seek` along a sweep, two animation frames, and
`Page.captureScreenshot` at that clip with `scale: 1` - never
`capturePage()`, which ignores the emulation and follows the window.

`src/main/capture.ts` is the order, behind a `CapturePage` interface, so
`tests/unit/capture.test.ts` asserts every step against a fake page;
`src/main/capture-window.ts` is the Electron half, and a second build
entry, so `tests/e2e/capture-harness.cjs` can load it into a bare Electron
and `tests/e2e/capture.spec.ts` can prove in a real window that two
captures of one job are byte-identical, that a zoom level seeded in the
default session changes nothing, and that a cancel leaves no window and no
frames. The job's shape is the engine's recorder's (`src/shared/capture.ts`),
so `export.plan`'s answer will map onto it. A quit destroys any capture
window before the engine is stopped.

## The export

The first reel (A5-02b) was one preset, `instagram-reel`, from one button on
the project screen; since A5-01 it is any of the thirteen social presets,
chosen on the project panel's Export tab with a storyboard and options, over
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
project's stored service day (ADR-031) and the record's theme, and answers
with the recorder's job and what the encode needs back. The capture half of
that plan goes through the capture's own validator - a page off the origin,
a scale the capture does not do, a first beat that pins no clock - and is
refused before a window exists. The frames go to
`<SCHEMATIC_HOME>/frames/<token>/`, a folder that exists only while the
export runs; `export.encode` gets the plan back unchanged, that folder, the
file to write and the project's service day as provenance, and writes the
file with its sidecar beside it. The frames are removed when the export
ends, whichever way, and a start of the app removes the whole folder, so a
crash mid-export leaves nothing a later run reads.

The file goes under the export folder - `LEGIBLE_EXPORT_FOLDER`, or a
`Legible Cities` folder on the desktop - in a folder named after the
project, under the engine's own file name; nothing is written inside the
user-data folder or the bundle (ADR-016). The page is told the file's name
and never its path; "Reveal" names the export by its token and the main
process opens the folder it remembers writing to. A second export of the
same project replaces the first, as the engine's own command line does: the
pipeline is deterministic, so it is the same file.

Progress is three stages on the progress line - plan, capture, encode -
with a sentence each: the plan's frame count and rate, then frames captured
of the total, then frames encoded from the fraction ffmpeg reports through
the engine. A cancel reaches the export wherever it is: the plan or encode
request is cancelled, the capture aborted; the engine removes a partial
file and its sidecar, the app removes the frames. A layout run and an
export of one project cannot overlap, because the export reads the page a
layout would rewrite: each button is disabled while the other runs, and so
is delete.

### The export tab

The project panel has two tabs (A5-01, `specs/022-export-tab`), a
`Tabs` control in the kit on the WAI-ARIA pattern: Map holds the
diagnostics, the service day, the line colours, the line order, the theme
and the geographic view, as the screen held them before; Export holds the
export. A panel not chosen stays mounted, so a debounced colour waiting to
be drawn is not thrown away by a look at the other tab.

Every list is the engine's. `export.presets` and `export.storyboards` are
asked once while the engine stays up, and the presets are narrowed to
`OFFERED_PRESETS` - the thirteen social ones, each checked against the
generated `PresetName`; the three `portfolio-*` presets are the published
site's. The choice - `{ preset, storyboard?, options }`, where the options
are the engine's `ExportOptions` without the theme (the project's), the
safe zones (the app's, for a preview only), the storyboard (beside them) and
the fade (not offered) - is written to the record the moment it is made,
a typed field when it is committed, through `setExport`. An option set back
to what the engine does without it is removed rather than sent. What is
sent is also narrowed by the preset, from `export.presets`, in the main
process before every plan (`sentChoice`): a view and a start time are a
still's only, since a storyboard's first beat names its own and the capture
applies it; a still the table says is JPEG is made at standard quality only,
because the capture writes PNG and the engine keeps a capture unchanged at
draft and high. The record keeps what a person chose. Writes to one record
take turns through a per-project chain in the store, so a choice made during
a re-layout cannot write back the old layout. A saved
preset or storyboard the engine no longer lists falls back to the reel,
and the tab says which name was dropped.

While the tab is open the map's own frame is the preview: not a second
frame, because the viewer's bridge holds one per project. The tab asks
`export.preview` 250 ms after the last change, drops an answer to anything
but the newest question, and hands the answer's address to the viewer,
which sends the same sandboxed frame there at the plan's aspect ratio. The
address is the project's page with the engine's query, so the frame is
attached from the main process by the project's prefix as the plain map is
(ADR-028), and the main side refuses a planned address that names any other
page. The frame, the title, the clock and the safe zones are the page's own
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
progress, a file, a sidecar, a cancel that removes both; and
`tests/e2e/reel.spec.ts`, opt-in with an engine checkout and ffmpeg,
exports the real Los Angeles reel twice and compares the two files frame by
frame in RGB with the tolerance of 8.

## Deliberately absent

| Not here | Arrives with |
|---|---|
| The contract tests running in continuous integration; they exist and are gated on an engine checkout. The vendor job's schema check is not them: it proves only that the runtime it builds starts `schematic.serve --schema` and that the output hashes to `engine.schema_sha256` | Open; no issue yet |
| A screen for long jobs across projects; the layout run and the export draw their own progress on the project screen | A1-03 |
| Editing the numeric style fields; the record holds the engine's defaults, and the colours, the order and the theme are a person's since A4-01, A4-02 and A4-03 | post-MVP |
| Vendored Python, LOOM and ffmpeg; installers | A0-10 (`specs/002`) |
| A log file and "copy diagnostics" | A6-03 |
| Signing and auto-update | A6-05 |
