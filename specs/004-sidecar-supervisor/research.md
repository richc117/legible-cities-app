# Research: Sidecar supervisor

Six questions the plan had to settle before design. Each ends in a decision,
a reason, and what was rejected.

## 1. The JSON-RPC client: `vscode-jsonrpc` or our own

**Decision**: our own, about 150 lines in `src/main/jsonrpc.ts`: a
`Content-Length` frame reader over a readable stream (header lines, a blank
line, a body of that many bytes; unknown headers ignored; a malformed header
or a body that is not JSON is a protocol error that ends the connection), a
writer, and a client that assigns numeric ids, keeps the pending requests,
resolves or rejects them from responses, delivers notifications to a
handler, and sends `$/cancelRequest` with an id.

**Rationale**: the engine keys its progress and log notifications by the
request's id (`job/progress {id, …}`), so the app must know the id it sent.
`vscode-jsonrpc` assigns ids internally and does not expose them from
`sendRequest`; its progress convention is LSP's (`$/progress` with a token
the caller passes in the params), which the engine does not use. Mirroring
the library's counter from outside would rest on an undocumented internal.
Changing the engine's protocol to suit a client library would let the app
shape the engine, which principle II forbids. The framing is small, fully
specified, and tested in isolation over in-memory streams.

**Alternatives considered**: `vscode-jsonrpc` with a mirrored id counter
(fragile); asking the engine to adopt `$/progress` tokens (the wrong
direction of dependency); `json-rpc-2.0` and similar packages (no framing,
same id problem).

## 2. Where the interpreter comes from

**Decision**: in this order, the first that exists wins and nothing else is
searched:

1. `LEGIBLE_ENGINE_PYTHON`, a new optional configuration key. A value with
   no path separator is a command name resolved through `PATH` by the
   spawn (the person named it); anything else resolves like the other keys.
2. In development (`app.isPackaged === false`): `<LEGIBLE_ENGINE_CHECKOUT>/.venv/bin/python`
   (`.venv/Scripts/python.exe` on Windows), when the checkout key is set.
3. In a packaged app: `<resourcesPath>/python/bin/python3` (`python/python.exe`
   on Windows), the layout `specs/002` gives the bundled runtime.

When none exists the state is `unavailable` and the reason names what was
looked for and where, and the key that fixes it.

**Rationale**: the engine is pinned, so running it under whatever Python
happens to be first on the PATH would be a version the app never checked
and cannot vouch for; a person who wants a particular interpreter says so.
The checkout's own environment is where the engine is already installed
editable for the development loop. The packaged layout is A0-10's and is
defined, not built, here.

**Alternatives considered**: searching `PATH` for `python3` (rejected: the
version is unknown and the engine package would not be there); `uv run`
(a tool dependency the app cannot assume).

## 3. The environment the engine gets

**Decision**: built from an allowlist, never the app's whole environment:
`PATH`, `HOME`, `USERPROFILE`, `TMPDIR`, `TEMP`, `TMP`, `SYSTEMROOT`,
`SystemRoot`, `LANG`, `LC_ALL`, every variable starting `DOCKER_` (the
development backend), plus `SCHEMATIC_HOME`, `SCHEMATIC_LOOM_BIN`,
`SCHEMATIC_FFMPEG` and `SCHEMATIC_LOG` from the configuration, and
`PYTHONUNBUFFERED=1` and `PYTHONIOENCODING=utf-8` so lines arrive as they
are written and survive any locale. In development only, `PYTHONPATH` passes
through: it is how the tests put the stand-in in front of the engine, and
how a developer could too.

**Rationale**: the engine reads four variables; everything else in the app's
environment is either noise or a secret (a proxy password, a token from the
shell) that has no business in a child we did not write. The Docker
variables are the one development concession, since the layout tools run in
Docker until E04.

**Alternatives considered**: `process.env` wholesale (rejected: leaks, and
`ELECTRON_RUN_AS_NODE` and friends change how a child behaves).

## 4. Ending the engine and everything it started

**Decision**: on quit, cancel every request in flight, send
`engine.shutdown` and wait 3 s for the process to exit; if it has not,
terminate it; wait 3 s more; then kill. Terminate and kill act on the
**process group** on POSIX (the child is spawned `detached: true`, which
makes it a group leader, and signals go to `-pid`) and on the **process
tree** on Windows (`taskkill /PID <pid> /T /F`, spawned as an argument
array), so a layout tool the engine was running goes with it even when the
engine itself cannot answer. The app's `before-quit` handler prevents the
default once, runs this sequence, then quits again with a flag set so the
second pass proceeds.

**Rationale**: the engine ends its own children on `engine.shutdown` and on
end-of-input, which covers every ordinary quit; the group and the tree cover
the engine that is wedged. `detached: true` on POSIX changes nothing else the
app relies on (stdio is still piped; the child still exits on end-of-input
if the app dies).

**Alternatives considered**: `child.kill()` alone (leaves the engine's
children on both platforms); `tree-kill` (a dependency for a dozen lines).

## 5. Restart, and when to stop

**Decision**: an exit the app did not ask for ends every request in flight
with an error saying the engine stopped, moves the state to `restarting`
with the attempt number, waits 1 s, then 2 s, then 4 s for successive
failures, and starts again. The count starts afresh once the engine has
answered a request after the handshake or been ready for 30 s. The
fourth consecutive failure moves the state to `stopped` with the reason (the
exit code or signal, and the last lines of stderr). Nothing restarts while
the app is quitting. There is no periodic health ping.

**Rationale**: three attempts with growing waits recover from a crash and
stop within seven seconds when the cause is not going away; an idle engine
does nothing, so a ping would only exercise the pipe; a wedged request is
what the inactivity bound is for.

**Alternatives considered**: unlimited restarts (an app that looks alive and
loops); restart only on the next request (a person reads "stopped" on the
screen with no way to fix it but to try something).

**A trap found on the runners**: the mismatch dialog must be attached to the
window and shown only once the window is visible. A message box with no
parent runs synchronously on macOS and blocks the main process, the quit
included (the first CI run of this feature hung there on macOS and Linux),
and a sheet on a hidden window shows nothing. `before-quit` aborts the
dialog through its `signal` so a quit never waits behind it.

## 6. The stand-in engine

**Decision**: `tests/fake-engine/schematic/serve.py`, a standard-library
Python module the app finds when `PYTHONPATH=tests/fake-engine`, run by any
Python 3 (`python3` or `python` on the PATH; every runner has one; the tests
skip when none does). It speaks the same framing, answers `engine.info`
with a version and protocol from a control file `<SCHEMATIC_HOME>/fake-engine.json`
the test writes, runs `graph.build` as a fake long request that sends four
progress notifications with a configurable delay, honours
`$/cancelRequest`, answers `engine.shutdown` and exits, exits on
end-of-input, and can be told to exit at once, exit after the handshake,
write a line that is not a frame, ignore shutdown, or send no progress. It
writes its own pid into the home so a test can end it from outside. It never
writes anywhere else.

**Rationale**: continuous integration has no engine; the supervisor's
behaviour has to be provable there. Putting a different `schematic` package
on the module path is the only substitution that goes through the app's real
command, real spawn and real pipes; a fake in TypeScript would test a
different process. The control file rides on the one path the app already
hands the engine, so the test needs no extra key.

**Alternatives considered**: a TypeScript fake over in-memory streams (kept
for the framing tests only, where no process is the point); a fake behind a
new environment variable (one more key for tests alone).
