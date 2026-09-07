# Architecture

What exists, in the present tense; what is planned, with the issue that
adds it. The decision records under `docs/adr/` say why; this page says
what.

## Three processes, one origin, one bridge

```
┌──────────────────────── Electron app ────────────────────────┐
│  Renderer (React)            Main (Node)                      │
│  ┌───────────────────┐       ┌──────────────────────────┐     │
│  │ Library (empty)   │◄─IPC─►│ window, single instance  │     │
│  │                   │       │ app:// protocol handler  │     │
│  │ window.api ───────┼───────┤ library:list → []        │     │
│  └───────────────────┘       │ config + startup log     │     │
│   origin: app://local        └──────────────────────────┘     │
└───────────────────────────────────────────────────────────────┘
        userData/engine = SCHEMATIC_HOME (read only, for now)
```

- **Main** (`src/main/`): the app lifecycle, the one window, the
  single-instance lock, the `app://` protocol handler, configuration and
  the log. It spawns nothing yet.
- **Preload** (`src/preload/`): a `contextBridge` exposing `window.api` and
  nothing else. `contextIsolation` on, `nodeIntegration` off, `sandbox` on.
- **Renderer** (`src/renderer/`): React. It draws a heading and a sentence.
  It will never draw a map: the engine's animation page is the viewer
  (constitution, principle I).

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
import. One method today, `api.library.list()`, always empty. Each addition
is a reviewed change to the type, the preload and the main-side handler
together. Contract: `specs/001-electron-skeleton/contracts/bridge.md`.

## Configuration and the startup log

Three locations and one development pointer, from the process environment,
then `.env.local` (development only, gitignored; `.env.example` documents
it), then defaults:

| Key | Default |
|---|---|
| `SCHEMATIC_HOME` | `<userData>/engine` (ADR-016) |
| `SCHEMATIC_LOOM_BIN` | unset |
| `SCHEMATIC_FFMPEG` | unset |
| `LEGIBLE_ENGINE_CHECKOUT` | unset; the tokens test reads the engine page from it |

At startup the main process logs every value with its source, and what is
unset, before the window opens, so a misconfigured run is diagnosable from
the terminal. Contract: `specs/001-electron-skeleton/contracts/config.md`.
The app writes nothing to the engine home yet.

## Design tokens

`src/renderer/src/styles/tokens.css` is a verbatim copy of the two theme
blocks in the engine's animation page, warm-dark and sepia. The page is the
source of truth (principle II); a unit test fails when the copy drifts from
the checkout named by `LEGIBLE_ENGINE_CHECKOUT`, and skips with a message
where no checkout is configured. The theme follows the operating system's
light or dark preference; a switch arrives with A4-03.

## Checks

`.github/workflows/ci.yml` runs on Ubuntu, macOS and Windows for every push
and pull request: lint, typecheck, unit tests, a build, and one Playwright
Electron smoke test that launches the built app, asserts the title,
reads the Library, probes the origin's refusals from inside the page, and
quits. Unit tests cover the traversal matrix, configuration parsing and the
tokens. The hygiene checks (`gitleaks`, `bin/preflight`) run beside them.

## Deliberately absent

| Not here | Arrives with |
|---|---|
| The engine, the sidecar protocol, any child process | A1-01, A1-02 (E09a on the engine side) |
| The project object and a non-empty Library | A1-05 |
| The viewer iframe | A3-02 |
| Capture and export | A5-02, after ADR-024 |
| Vendored Python, LOOM and ffmpeg; installers | A0-10 (`specs/002`) |
| A log file and "copy diagnostics" | A6-03 |
| Signing and auto-update | A6-05 |
