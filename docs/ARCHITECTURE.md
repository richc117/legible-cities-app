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
import. Six methods under `api.projects`, three under `api.viewer`, and the
engine under `api.engine`:

| Method | Does |
|---|---|
| `list()` | the Library's entries, newest modified first; an unreadable record is skipped and logged, never shown broken |
| `get(id)` | one record, with `readOnly` set when a newer version of the app wrote it |
| `create({ name, feed, mode?, agency? })` | a new record, every other field at its default |
| `rename(id, name)` | changes `name` and `modified` and nothing else |
| `delete(id)` | removes the project and its output, and reports what could not be removed by folder role |
| `completeLayout(id, done)` | records the layout identifier and the service day a finished run produced; the main process reads the stage files the engine named and derives the identifier itself (A3-01, ADR-027) |

| `viewer.attach(projectId)` | holds the project page's frame by identity once it has loaded, and answers whether it did (ADR-028) |
| `viewer.release()` | lets the frame go |
| `viewer.call(method, ...args)` | one of the page's `__present` methods by name, run in the frame from the main process; a name outside the shared list is refused |

| `engine.state()` | the engine's state: starting, ready, restarting, unavailable, mismatched or stopped, with a reason where there is one |
| `engine.request(method, params?)` | a request to the engine, as `{ id, result }`: the id is a token the preload mints, the result settles with the engine's answer or its error (`code`, `message`, `data: { kind, detail, hint }`) unchanged |
| `engine.cancel(id)` | `$/cancelRequest` for that request |
| `engine.onState`, `onProgress`, `onLog` | subscriptions; each returns its unsubscribe |

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
`specs/007-layout-run/contracts/bridge.md` and
`specs/008-viewer/contracts/viewer.md`.

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
(A3-04). The layout is the stored layout's identifier, produced by that
same first layout: the app's digest of the four stage graphs until the
engine addresses layouts itself (ADR-027). Until
the engine's registry is reachable (A2-01), the feed key is typed into the
create dialog and validated for form only.

The Library has no record of its own: it is the set of readable records
under `projects/`, sorted by modified time, newest first.

## Configuration and the startup log

Three locations and one development pointer, from the process environment,
then `.env.local` (development only, gitignored; `.env.example` documents
it), then defaults:

| Key | Default |
|---|---|
| `SCHEMATIC_HOME` | `<userData>/engine` (ADR-016) |
| `SCHEMATIC_LOOM_BIN` | unset |
| `SCHEMATIC_FFMPEG` | unset |
| `LEGIBLE_ENGINE_CHECKOUT` | unset; the tokens test reads the engine page from it, and the engine runs from its `.venv` |
| `LEGIBLE_ENGINE_PYTHON` | unset; an interpreter named explicitly (a path, or a bare command for PATH), which wins over the checkout |

At startup the main process logs every value with its source, and what is
unset, before the window opens, so a misconfigured run is diagnosable from
the terminal. Contract: `specs/001-electron-skeleton/contracts/config.md`.
The app writes to the engine home only under `projects/`, and removes only
a project's `out/<id>/` on delete; `feeds/` is the engine's and untouched.

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
attribute for warm-dark, following the operating system's preference until
a switch arrives with A4-03. Two unit tests keep the system honest: one
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
four stage graphs' paths and their summaries; the map call writes the page
into `<SCHEMATIC_HOME>/out/<project id>/`, which is exactly where the
project origin already serves from, so the viewer (A3-02) needs no copying.
The map call runs the layout stages itself and therefore repeats the first
four reports; a repeat for a stage already finished is ignored.

The engine reports a stage when that stage **finishes**, and the sentence
describes the stage that finished. So a report marks its own stage done and
sets the next one running, and the sentence on screen always describes the
last completed stage rather than the one being waited for. The last of
those sentences is the folder the engine wrote into, which is a path and
therefore not for a screen; the run replaces that one with what the stage
did, and leaves every other sentence alone, because a slash is not evidence
of a path (the schedule stage says "matched 114/114 stops").

When both calls have returned, one bridge call writes the record: the
service day, the layout's identifier and the modification time, together or
not at all. A cancelled or failed run writes nothing, and can be run again.

A run belongs to its project rather than to the screen showing it, so a
person can start a layout, go back to the Library and come back to one still
running; the renderer keeps one client for all of them.

### What identifies a layout, and why the app derives it

Protocol 1 answers with paths and no identity, and the engine's cache is
keyed by the feed alone, so every project on a feed shares one layout. The
app derives an identifier from the four stage graphs' contents: each file's
stage name, length and bytes, in the engine's stage order, hashed together.
Two projects drawn from the same layout record the same value, a changed
layout records a different one, and the value carries no path.

The reading happens in the main process, because the renderer holds no Node
APIs, and every path is checked to lie under the engine's home before it is
opened, exactly as the project origin checks. The paths cross the bridge
inward only, and every failure on the way becomes a sentence, because the
rejection is shown to a person.

### Where this falls short of principle III, and why

The constitution says renders and exports read the stored layout and never
re-run the layout stages. The engine at the pinned version rebuilds any
missing stage during a map build without being asked, so the app cannot
enforce that; it records what it drew from and reports a difference
instead. Engine issue E04, which addresses a layout by the hash of its
inputs, is what closes the gap. ADR-027 records the decision and its cost.

For the same reason there is no forced re-layout. Forcing a rebuild
rewrites the first three stage files before the fourth runs, so a cancelled
one leaves a mixed set that a later build reads as a valid cache; that was
reproduced rather than inferred. "Lay out again" re-runs without forcing,
which reuses the cache and is safe.

### The service day

The engine never chooses a service day, because its choice would depend on
the day it was asked (ADR-031). The app resolves one at a project's first
layout, from the machine's own today, stores it at once, and uses the
stored day for every later build. Choosing a *good* day, rather than merely
a fixed one, needs the feed's service window, which arrives with the engine
issues behind A3-04.

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

## Deliberately absent

| Not here | Arrives with |
|---|---|
| The contract tests running in continuous integration; they exist and are gated on an engine checkout | A0-06 |
| A screen for long jobs across projects; the layout run draws its own progress on the project screen | A1-03 |
| Settings: the data folder, the export folder, the versions shown | A1-04 |
| A feed chooser over the engine's registry; the feed key is typed and checked for form | A2-01 |
| Editing the style, the colours, the line order and the theme; the record holds the engine's defaults | A4-01 to A4-03 |
| Capture and export | A5-02a (the capture, on ADR-024's path) and A5-02b (one preset, over the engine's `export.plan` and `export.encode`) |
| Vendored Python, LOOM and ffmpeg; installers | A0-10 (`specs/002`) |
| A log file and "copy diagnostics" | A6-03 |
| Signing and auto-update | A6-05 |
