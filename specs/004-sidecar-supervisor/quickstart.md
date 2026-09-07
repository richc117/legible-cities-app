# Quickstart: Sidecar supervisor

How to see it work, and what "working" looks like. The contracts say what
must be true; this says how to look.

## Against the real engine (developer's machine)

Prerequisites: the engine checkout beside this repository with its
environment made (`uv venv && uv pip install -e ".[dev]"` there, at tag
`v0.2.0` or later), and `.env.local` here with
`LEGIBLE_ENGINE_CHECKOUT=../<checkout>`. Docker is not needed for the
handshake, only for a layout.

```
npm run dev
```

Expected in the terminal, before the window shows:

```
[engine] interpreter: <checkout>/.venv/bin/python (engine checkout)
[engine] starting, attempt 1
[engine] stderr: ... engine 0.2.0, protocol 1, home <home>
[engine] ready: engine 0.2.0, protocol 1 (expected 0.2.0, 1)
```

Expected in the window: a header line reading "Engine ready (0.2.0)" on
the Library and on a project view. From the developer tools console:

```js
const r = window.api.engine.request('engine.info'); await r.result
// → { engine: '0.2.0', protocol: 1, ... } exactly as the engine answers
const bad = window.api.engine.request('map.build', { key: 'la-metro-rail' }); await bad.result
// → rejects: code -32602, data.hint "date is required: ..."
```

Kill the engine from another terminal (`pkill -f schematic.serve`): the
header reads "The engine stopped; restarting (attempt 2). …" within a
second and "Engine ready (0.2.0)" again within a few. Quit the app: no
`schematic.serve` process remains (`pgrep -f schematic.serve` prints
nothing; Activity Monitor on macOS, Task Manager on Windows for the manual
check in SC-003).

## Against the stand-in (any machine with a Python 3)

```
LEGIBLE_ENGINE_PYTHON=python3 PYTHONPATH=tests/fake-engine SCHEMATIC_HOME=/tmp/lc-home npm run dev
```

with `/tmp/lc-home/fake-engine.json` holding, say,
`{"version": "0.1.0", "protocol": 1}`: the mismatch dialog names 0.2.0 and
0.1.0, and the header reads the mismatch after it is dismissed. Without the
file the stand-in reports 0.2.0 and the header reads ready.

## Without an interpreter

`LEGIBLE_ENGINE_PYTHON=/nowhere/python npm run dev`: the header reads
"Engine unavailable: …" naming the path looked for and the key; the Library
still creates, renames and deletes projects.

## The checks

```
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e
```

`npm test` runs the supervisor against the stand-in (needs a `python3` or
`python` on the PATH; says "skipped" otherwise) and against the real engine
when `.env.local` names a checkout with an environment (skipped otherwise,
saying so). The e2e file launches the built app against the stand-in.

## The manual checks (SC-003, SC-007)

- Quit with a layout running (real engine, Docker): three seconds later,
  no `schematic.serve`, no `docker run … loom` container (`docker ps`), on
  macOS and on Windows.
- VoiceOver (macOS) and Narrator (Windows): the header's status is read on
  request and each change is announced once without interrupting; the
  mismatch dialog is read and closes with the keyboard. Record the result in
  the pull request.
