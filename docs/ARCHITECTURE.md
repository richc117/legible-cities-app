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
│  │ project view      │       │ app:// protocol handler  │     │ stdio│                     │
│  │ engine status     │       │ projects:* → the store   │     │◄────►│ JSON-RPC 2.0,       │
│  │ window.api ───────┼───────┤ engine:*   → the sidecar ├─────┼──────┤ Content-Length      │
│  └───────────────────┘       │ config + startup log     │     │stderr│ frames; LOOM as its │
│   origin: app://local        └──────────────────────────┘     │→ log │ own child processes │
└───────────────────────────────────────────────────────────────┘      └─────────────────────┘
        userData/engine = SCHEMATIC_HOME
          projects/<id>/project.json   written by the store
          out/<id>/                    served read-only; removed on delete
          feeds/, data/graphs/, out/   the engine's, under the same home
```

- **Main** (`src/main/`): the app lifecycle, the one window, the
  single-instance lock, the `app://` protocol handler, the project store
  and the handlers behind the bridge, configuration and the log, and the
  engine's supervisor: the one child process the app starts.
- **Preload** (`src/preload/`): a `contextBridge` exposing `window.api` and
  nothing else. `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- **Renderer** (`src/renderer/`): React. It draws the Library, the create
  dialog, and a project view with rename and delete; it knows projects by
  identifier and never sees a path. It will never draw a map: the engine's
  animation page is the viewer (constitution, principle I).

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

The reason for one origin is the viewer (planned, A3-02): the engine's page
is embedded in an iframe and driven through `iframe.contentWindow.__present`,
which a cross-origin frame hides (ADR-013).

## The bridge: `window.api`

Typed in `src/shared/api.ts`, which the preload and the renderer both
import. Five methods under `api.projects`, and the engine under
`api.engine`:

| Method | Does |
|---|---|
| `list()` | the Library's entries, newest modified first; an unreadable record is skipped and logged, never shown broken |
| `get(id)` | one record, with `readOnly` set when a newer version of the app wrote it |
| `create({ name, feed, mode?, agency? })` | a new record, every other field at its default |
| `rename(id, name)` | changes `name` and `modified` and nothing else |
| `delete(id)` | removes the project and its output, and reports what could not be removed by folder role |

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
a webview. It does not distinguish a same-origin iframe calling
`parent.api`, because the bridge's functions run in the top frame that
exposed them; the viewer iframe (A3-02) needs its own answer, most likely
its own web contents. Nothing that crosses the
bridge, in either direction, is a filesystem path the renderer did not ask
the engine for; the renderer addresses a project by its identifier only.
Each addition is a reviewed change to the type, the preload and the
main-side handler together. Contracts: `specs/003-project/contracts/bridge.md`
and `specs/004-sidecar-supervisor/contracts/bridge.md`.

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

**Before A3-01**, `date` and `layout` are `null`, and the interface says
"not yet chosen" and "not laid out yet". The service day is resolved once,
at the project's first layout, when the engine is first asked about the
feed; it is stored then and never re-resolved silently, because the
engine's busiest-weekday rule reads today's date. The layout is the stored
layout's identifier, produced by that same first layout (ADR-023). Until
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

`src/renderer/src/styles/tokens.css` is a verbatim copy of the two theme
blocks in the engine's animation page, warm-dark and sepia. The page is the
source of truth (principle II); a unit test fails when the copy drifts from
the checkout named by `LEGIBLE_ENGINE_CHECKOUT`, and skips with a message
where no checkout is configured. The theme follows the operating system's
light or dark preference; a switch arrives with A4-03.

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
against the stand-in as a real child process, and the engine bridge's main
side. The hygiene checks (`gitleaks`, `bin/preflight`) run beside them.

## Deliberately absent

| Not here | Arrives with |
|---|---|
| Typed engine methods generated from the engine's schema; contract tests against the real engine in CI | A1-02 (the engine must be vendored first, A0-06) |
| A screen for long jobs: progress, cancellation, the engine's log | A1-03 |
| Settings: the data folder, the export folder, the versions shown | A1-04 |
| A feed chooser over the engine's registry; the feed key is typed and checked for form | A2-01 |
| The service day and the stored layout: `date` and `layout` are `null` until the first layout sets both | A3-01 |
| The viewer iframe | A3-02 |
| Editing the style, the colours, the line order and the theme; the record holds the engine's defaults | A4-01 to A4-03 |
| Capture and export | A5-02, after ADR-024 |
| Vendored Python, LOOM and ffmpeg; installers | A0-10 (`specs/002`) |
| A log file and "copy diagnostics" | A6-03 |
| Signing and auto-update | A6-05 |
