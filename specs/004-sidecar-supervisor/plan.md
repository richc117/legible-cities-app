# Implementation Plan: Sidecar supervisor

**Branch**: `A1-01-sidecar-supervisor` | **Date**: 2026-09-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-sidecar-supervisor/spec.md`.

## Summary

The main process gains a supervisor for the engine: it resolves an
interpreter (an explicit key, else the engine checkout's virtual environment
in development, else the bundled runtime), spawns `python -m schematic.serve`
with an argument array and a minimal environment, speaks JSON-RPC 2.0 over
the child's stdio with `Content-Length` framing through a small client of
our own, checks `engine.info` against the `engine` block in `vendor/pins.json`,
forwards requests, results, errors, progress and log lines to the renderer
through a narrow untyped bridge, cancels on request and on inactivity,
restarts on unexpected exit with 1, 2 and 4 second waits and stops after
three consecutive failures, and shuts the engine down on quit (shutdown
request, terminate, kill, with the process group on POSIX and the tree on
Windows). The interface shows one labelled, polite status line. A stand-in
engine written in Python, driven by a control file under the test's home,
gives the unit and end-to-end tests an engine on machines and runners that
have none; the tests against the real engine run where a checkout exists.

## Technical Context

**Language/Version**: TypeScript 5.9, Node 22, Electron 44; the stand-in in
Python 3 (standard library only), because the app spawns `<interpreter> -m
schematic.serve` and the stand-in is what that finds when `PYTHONPATH` names
it.

**Primary Dependencies**: none added. The JSON-RPC client is ~150 lines of
our own over `node:child_process` streams (research.md section 1 says why not
`vscode-jsonrpc`). `node:crypto` for request tokens in the preload.

**Storage**: none by the supervisor. The pin is data in `vendor/pins.json`,
compiled into the main bundle by a JSON import.

**Testing**: Vitest over the framing and the client with in-memory streams;
over the interpreter resolution and the environment as pure functions; over
the supervisor with the stand-in as a real child process (start, handshake,
mismatch, pass-through, notifications, cancel, inactivity, restart, backoff,
shutdown, kill); over the IPC layer with a fake `ipcMain`; a gated test
against the real engine; a Playwright test launching the built app against
the stand-in (status line, restart after an external kill, request from the
page, no process after quit, unavailable when the interpreter does not
exist).

**Target Platform**: as the skeleton: macOS and Windows targets, Linux
verification. Process-tree ending differs per platform and is tested on all
three runners.

**Project Type**: desktop app; all three processes.

**Performance Goals**: handshake under a second on the developer's machine
(SC-001 allows five); notifications reach the page within a frame of
arriving; the status line changes within a second of the state.

**Constraints**: argument arrays only; `windowsHide`; every request bounded;
stderr to the log; nothing outlives quit; the renderer never gets
`ipcRenderer`; only the top frame; no network; no write by the supervisor.
The bridge is untyped beyond method-and-object: A1-02 types it. No dependency
is added without a notice.

**Scale/Scope**: one engine process, at most a handful of requests in flight,
notifications at the rate the layout tool logs (tens per second at worst).
Five main-process modules (`jsonrpc.ts`, `interpreter.ts`, `sidecar.ts`,
`engine-ipc.ts`, changes to `index.ts` and `config.ts`), one shared types
module, the preload's engine bridge, one React component and a header, one
stand-in package, six test files, one e2e file.

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 design below.*

| Principle or constraint | How this plan complies |
|---|---|
| I. One renderer | Nothing is drawn. The status line is text. |
| II. The engine is the source of truth | The supervisor adds no method and changes no answer; results, errors and notifications pass through unchanged (contracts/bridge.md). The pin holds the engine version and protocol the app was built against, and the handshake refuses any other. The one thing the app decides for itself is the interpreter, which is not the engine's to know. |
| III. Determinism is a feature | Untouched: no layout is run by this feature. The supervisor never retries a request on its own, so nothing runs twice without being asked. |
| IV. No network, no telemetry | Nothing reaches the network. The environment passed to the engine is built from an allowlist, so no proxy or token variable leaks in by accident. |
| V. Hygiene by tools | The stand-in and the tests write only under a temporary home; the pin names a public repository and a tag; no machine path in the tree. |
| VI. Accessible by default | The status line is a `role="status"` region with `aria-live="polite"`, labelled, no animation; the mismatch dialog is the page's own `<dialog>` (modal, focus trapped and returned by the browser, Escape closes), as the project dialogs are. SC-007 is a manual check recorded in the pull request. |
| VII. Decisions recorded | Own JSON-RPC client rather than `vscode-jsonrpc`: research.md section 1, reversible, no ADR. Process-group ending: research.md section 4. ADR-010 (JSON-RPC over stdio) is the record this builds on and is still private; nothing here is hard to reverse. |
| Never write inside the bundle | The supervisor writes nothing. The engine's home is the configuration's, as before. |
| `app://local` is one origin | Unchanged. |
| The renderer holds no Node APIs | The bridge grows by `state`, `request`, `cancel` and three subscriptions; the renderer sees a state, results, errors and notifications, never a process, a path it did not ask the engine for, or `ipcRenderer`. |
| Child processes | Argument array, `windowsHide: true`, stderr to the log line by line, the handshake bound and the inactivity bound, shutdown then terminate then kill on quit, the process group on POSIX and the tree on Windows. |
| GPL-3.0-or-later, third parties listed | No new dependency; nothing to add to the notices. |

**Post-design re-check**: the contracts add one judgement call, the request
token: the preload mints an opaque id so the page can subscribe to progress
before the round trip returns, and the main process maps it to the engine's
numeric id. The engine's id is never shown to the page and never needs to
be; the contract says so.

## Project Structure

### Documentation (this feature)

```text
specs/004-sidecar-supervisor/
├── plan.md              # This file
├── research.md          # Phase 0: the client, the interpreter, the environment, ending a tree, the quit sequence, the stand-in
├── data-model.md        # Phase 1: the state, the pin, the request, the notifications, the bridge error
├── quickstart.md        # Phase 1: how to run it against the real engine and the stand-in, and what to look at
├── contracts/
│   ├── bridge.md        # window.api.engine, the channels, the error shape
│   └── sidecar.md       # the supervisor's behaviour: states, transitions, bounds, the environment, the command
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── main/
│   ├── index.ts         # starts the supervisor at ready; the quit sequence; the mismatch dialog
│   ├── config.ts        # + LEGIBLE_ENGINE_PYTHON
│   ├── interpreter.ts   # resolveInterpreter(), engineCommand(), engineEnvironment(): pure
│   ├── jsonrpc.ts       # Content-Length framing, a JSON-RPC 2.0 client with ids, notifications and cancel
│   ├── sidecar.ts       # the supervisor: states, spawn, handshake, requests, bounds, restart, shutdown
│   └── engine-ipc.ts    # engine:* handlers over the supervisor; events to the window
├── preload/index.ts     # + window.api.engine
├── shared/
│   ├── api.ts           # + engine in Api; + channels
│   └── engine.ts        # EngineState, EnginePin, EngineError, JobProgress, JobLog
└── renderer/src/
    ├── App.tsx          # a header with the status line on both screens
    ├── EngineStatus.tsx # the status region
    └── styles/app.css   # the header and the status line

vendor/pins.json         # + engine block (repo, tag v0.2.0, version 0.2.0, protocol 1)
.env.example             # + LEGIBLE_ENGINE_PYTHON

tests/
├── fake-engine/schematic/{__init__.py, serve.py}   # the stand-in: PYTHONPATH=tests/fake-engine
├── unit/
│   ├── jsonrpc.test.ts          # framing and the client over in-memory streams
│   ├── interpreter.test.ts      # resolution order, the command, the environment allowlist
│   ├── sidecar.test.ts          # the supervisor against the stand-in (needs a python3 on PATH; skips otherwise)
│   ├── sidecar-real.test.ts     # against the engine checkout's venv (skips without it)
│   └── engine-ipc.test.ts       # the handlers with a fake ipcMain and a fake supervisor
└── e2e/engine.spec.ts           # the built app against the stand-in
```

**Structure Decision**: the supervisor is three main-process modules with one
responsibility each so the pure parts (framing, resolution, environment) are
tested without a process and the process part is tested against one real
child. The stand-in is a Python package because the app's command is fixed
(`<interpreter> -m schematic.serve`) and the honest way to substitute an
engine is to put a different `schematic` on the module path.

## Complexity Tracking

No violations. The one place the plan departs from the architecture note
(`vscode-jsonrpc/node`) is explained in research.md section 1 and costs
about 150 lines that the tests cover directly.
