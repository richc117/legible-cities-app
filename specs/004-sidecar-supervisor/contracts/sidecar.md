# Contract: the supervisor

`src/main/sidecar.ts`, class `Sidecar`. Constructed with the command, the
environment, the pin, the bounds and a log; started once; exposes `state`,
`request`, `cancel`, `onState`, `onNotification`, `stop`.

## The command

`[interpreter, '-m', 'schematic.serve']`, spawned with `stdio: 'pipe'`,
`windowsHide: true`, `detached: true` on POSIX (a process group of its
own), never `shell`. The interpreter is `resolveInterpreter()`'s answer
(research.md section 2); the environment is `engineEnvironment()`'s
(section 3). Both are logged at start.

## States and transitions

| From | Event | To | Also |
|---|---|---|---|
| — | `start()` with no interpreter | `unavailable(reason)` | logged; terminal for the run |
| — | `start()` | `starting(1)` | spawn; handshake begins |
| `starting(n)` | `engine.info` good | `ready` | nothing queued (there is no queue); the failure count resets once a request is answered or `stableMs` passes in `ready` |
| `starting(n)` | `engine.info` wrong version or protocol | `mismatched` | the dialog callback is called once with expected and found; the process is shut down like a quit; terminal for the run |
| `starting(n)` | process ends, framing error, or handshake bound | `restarting(n+1, reason)` if n < 4, else `stopped(reason)` | |
| `ready` | process ends or framing error | `restarting(2, reason)` | every request in flight rejects with `-32002` |
| `restarting(n)` | wait elapsed (1 s, 2 s, 4 s for n = 2, 3, 4) | `starting(n)` | |
| any but `unavailable`/`stopped` | `stop()` (quit) | `stopped('quitting')` | the shutdown sequence; nothing restarts |

`onState` listeners are called after each transition with the new state.
Every transition is logged with the reason.

## Requests

- `request(method, params)` when not `ready` rejects at once with `-32001`
  carrying the state's sentence; nothing is sent.
- Otherwise the client sends the request with the next numeric id and
  returns `{ id, result }`; `result` settles with the engine's response.
- Every request has a bound: the handshake 10 s (fixed); every other request
  an inactivity bound of 10 min measured from the request's send and reset
  by each `job/progress` or `job/log` for its id. On expiry the supervisor
  sends `$/cancelRequest`, and the request settles with `-32003` even if the
  engine then answers (its answer is logged and dropped).
- `cancel(id)` sends `$/cancelRequest` for an id in flight; the request
  settles with whatever the engine answers (its `-32800`).
- Notifications with a known id go to `onNotification` listeners; unknown
  ids are logged and dropped.

## Shutdown (`stop()`)

1. Set the state to `stopped('quitting')`; reject every request in flight
   with `-32002`; cancel their timers.
2. Send `engine.shutdown`; wait up to 3 s for the process to exit.
3. If still running: terminate (SIGTERM to the group on POSIX; `taskkill /PID
   <pid> /T /F` on Windows, which is already forceful); wait up to 3 s.
4. If still running: kill (SIGKILL to the group on POSIX; nothing more on
   Windows, where step 3 was already the end).
5. Resolve when the process has exited or the bounds are spent; log what it
   took.

`stop()` is idempotent and safe in every state.

## stderr

Every line the process writes to stderr is logged as it arrives under the
tag `engine`, prefixed `stderr:`; the last 20 lines are kept, and when the
process ends unexpectedly the last three of them that carry no path
separator become part of the reason (the reason is shown on screen; the
lines with paths are in the log). The reason is composed when the process
has closed its pipes, or one second after it exited, whichever is first.

## Bounds (constructor options, so tests shorten them)

| Name | Default |
|---|---|
| `handshakeMs` | 10 000 |
| `inactivityMs` | 600 000 |
| `shutdownMs` | 3 000 |
| `terminateMs` | 3 000 |
| `restartDelaysMs` | `[1000, 2000, 4000]` |
| `stableMs` | 30 000 |
