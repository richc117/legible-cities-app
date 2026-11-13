# Contract: the supervisor

`src/main/sidecar.ts`, class `Sidecar`. Constructed with the command, the
environment, the pin, the bounds, a log and the reset's question
(`resetting`, "The reset of the engine's data" below); started once; exposes
`state`, `request`, `cancel`, `inFlight`, `abandoned`, `stillEnding`,
`onState`, `onNotification`, `retry`, `stop`.

## The command

`[interpreter, '-m', 'schematic.serve']`, spawned with `stdio: 'pipe'`,
`windowsHide: true`, `detached: true` on POSIX (a process group of its
own), never `shell`. The interpreter is `resolveInterpreter()`'s answer
(research.md section 2); the environment is `engineEnvironment()`'s
(section 3). Both are logged at start.

## States and transitions

| From | Event | To | Also |
|---|---|---|---|
| — | `start()` with no interpreter | `unavailable(reason)` | logged; terminal for the run (`retryable: false`) |
| — | `start()` | `starting(1)` | spawn; handshake begins |
| `starting(n)` | `engine.info` good | `ready` | nothing queued (there is no queue); the failure count resets once a request is answered or `stableMs` passes in `ready` |
| `starting(n)` | `engine.info` wrong version or protocol | `mismatched` | the dialog callback is called once with expected and found; the process is shut down like a quit; terminal for the run |
| `starting(n)` | process ends, framing error, or handshake bound | `restarting(n+1, reason)` if n < 4, else `stopped(reason)` | |
| `ready` | process ends or framing error | `restarting(2, reason)` | every request in flight rejects with `-32002` |
| `restarting(n)` | wait elapsed (1 s, 2 s, 4 s for n = 2, 3, 4) | `starting(n)` | the wait begins once the old engine has gone and, on POSIX, what it left in its process group has been ended ("After an exit", issue 640): up to 1 s and 2 × `terminateMs` after its exit, where something left ignores SIGTERM. Where the old engine has not gone, no wait begins (the next row) |
| `restarting(n, reason)` | the engine the failure ended (a framing error, or the handshake bound) outlived the kill: still there after the shutdown request, the terminate, the kill and a last `terminateMs` (issue 673) | `stopped(reason + " The engine was still stopping, so it was not started again.")`, `retryable` | no wait begins and nothing is spawned beside it: the restart asks `stillEnding`, as `retry()` and the reset do. `retry()` is the way back, refused as still stopping until that engine's exit is seen, and until what it left in its group has been ended; its exit starts nothing by itself. An exit nobody asked for never takes this row, since that engine has gone |
| `restarting(n, reason)` | wait elapsed while the engine's data is being reset (issue 637) | `restarting(n, "The engine data is being reset; the engine starts again once the reset has finished. " + reason)` | nothing is spawned; the reset is asked again every `resetPollMs` (250 ms), and the first look that finds it over goes on to `starting(n)` ("The reset of the engine's data") |
| any but `unavailable`/`stopped` | `stop()` (quit) | `stopped('quitting')` | the shutdown sequence; nothing restarts |
| `stopped(reason)` after giving up or beside an engine that outlived the kill (the row above), or `unavailable(reason)` because the interpreter could not be spawned (all `retryable`) | `retry()` (a person's Try again, issue 562) | `starting(1)` | the failure count back to 0, so the full restart budget again; refused with a sentence while quitting, with no interpreter, for `mismatched` and in every other state, with the reset's own sentence while the engine's data is being reset (issue 637; the bridge asks first, as it did before), and as still stopping while the engine, or what an exited engine left in its process group, is still being ended (`stillEnding`, which the reset asks too): the engine given up on, or a mismatched one, while it is being ended (the state says `stopped` before that ends), an engine that outlived the kill while it is still there, and an exited engine's group ("After an exit", issue 640) |

`onState` listeners are called after each transition with the new state.
Every transition is logged with the reason.

## Requests

- `request(method, params, options?)` when not `ready` rejects at once with
  `-32001` carrying the state's sentence; nothing is sent.
- Otherwise the client sends the request with the next numeric id and
  returns `{ id, result }`; `result` settles with the engine's response.
- Every request has a bound: the handshake 10 s (fixed); every other request
  an inactivity bound of 10 min measured from the request's send and reset
  by each `job/progress` or `job/log` for its id. On expiry the supervisor
  sends `$/cancelRequest`, and the request settles with `-32003` even if the
  engine then answers (its answer is logged and dropped).
- `options.deadlineMs` (`RequestOptions`, added by issue 107) gives a request
  a deadline of its own, measured from the send and extended by nothing: not
  by progress, and not by a cancel. A value that is not a finite, positive
  number of milliseconds a timer can hold (2 147 483 647 at most) throws a
  `RangeError` and nothing is sent; the engine bridge answers the page with
  a `-32600` bad call and frees its token. On expiry the supervisor sends
  `$/cancelRequest` unless `cancel(id)` already sent one, and the request
  settles with `-32003` (kind `inactive`, "No answer within N seconds; the
  engine was asked to cancel the request."). No request is sent with one
  now: `feeds.remove` was (30 s, issue 107), until engine v0.11.0 made it a
  job that can be cancelled (issue 351). The option stays for a request
  whose work is short and known.
- A request a bound ended stays counted by `inFlight`, and by `abandoned`,
  until its late answer arrives (the client reports the dropped response's
  id) or its process has exited - not when the process begins to be ended,
  which can take the shutdown bounds - because the engine may still be
  doing its work. A timeout is not a failure and restarts nothing, so an
  engine that never answers keeps `abandoned` above zero until a quit. The
  reset of the engine's data refuses while `inFlight` is above zero, and
  while `abandoned` is, says "The engine has not finished a request it
  stopped answering. If it does not, quit and reopen Legible Cities."
  (`engineWorkRefusal`; what else it refuses for is under "The reset of the
  engine's data").
- `cancel(id)` sends `$/cancelRequest` for an id in flight; the request
  settles with whatever the engine answers (its `-32800`), or with its
  deadline, whichever comes first.
- Notifications with a known id go to `onNotification` listeners; unknown
  ids are logged and dropped.

## Shutdown (`stop()`)

1. Set the state to `stopped('quitting')`; reject every request in flight
   with `-32002`; cancel their timers, deadlines included. The requests a
   bound ended are forgotten when the process has exited.
2. Send `engine.shutdown`; wait up to 3 s for the process to exit.
3. If still running: terminate (SIGTERM to the group on POSIX; `taskkill /PID
   <pid> /T /F` on Windows, which is already forceful); wait up to 3 s.
4. If still running: kill (SIGKILL to the group on POSIX; nothing more on
   Windows, where step 3 was already the end).
5. Resolve when the process has exited or the bounds are spent, its pipes
   have closed (up to 1 s after its exit, so its last stderr lines are in
   the log), and, on POSIX, what any engine left in its process group as it
   exited has been ended ("After an exit"): up to 2 × `terminateMs` more,
   where something left ignores SIGTERM. Log what it took.

`stop()` is idempotent and safe in every state.

## stderr

Every line the process writes to stderr is logged as it arrives under the
tag `engine`, prefixed `stderr:`; the last 20 lines are kept, and when the
process ends unexpectedly the last three of them that carry no path
separator become part of the reason (the reason is shown on screen; the
lines with paths are in the log). The reason is composed when the process
has closed its pipes, or one second after it exited, whichever is first:
that is when the exit is reported.

## After an exit (issue 640)

What the engine starts - `loom`, `topo`, `ffmpeg` - is in its process
group on POSIX and does not end with it, and steps 3 and 4 of the shutdown
reach it only while the engine itself is running. So after every exit,
however it came (a crash, or an exit the app asked for: a framing error, a
failed handshake, a mismatch, a quit), on POSIX:

1. As the exit is seen, just after the process is reaped, the group is
   looked at (signal 0). Nothing left: done, and nothing waits on it.
2. Otherwise the group is looked at every 25 ms until the exit is reported,
   so a child holding a pipe writes its last line first; done if it empties.
3. Then SIGTERM to the group; SIGKILL once `terminateMs` has passed with
   anything left; then one more `terminateMs` to see it go, after which the
   supervisor stops waiting and logs that the group is still there. Each
   step is logged; a group that has emptied (ESRCH) is not an error.

A restart's wait begins only once this is done, `retry()` is refused while
it runs, and `stop()` waits for it. An engine that outlived the kill has no
group to look at until it exits, and nothing is started beside it meanwhile
(issue 673, "States and transitions"), so there is one engine at a time and
one group at most being ended; when that engine exits at last, its group is
seen to as any other's, with `retry()` refused until it has been, and
`stop()` waiting for it where the exit came before the quit's own waits
were over (a quit does not wait for the engine itself). The group's id
is the engine's pid, which no other process takes while the group has a
member, and each signal is sent straight after a look that found the group
there. The id could still pass to another process unseen in the moments
the app does not see the group: from the reap to the first look, when the
exits of other children reaped with it may be handled first; between two
looks, 25 ms or more while the main process is busy; and between a look
and the signal after it. Node cannot close these without native code.

On Windows nothing is done: there is no group, and the engine's pid has
gone by the time its exit is seen, so `taskkill /T` has no tree to walk.
What an engine that exited by itself started runs to its own end there;
reaching it would take the engine running its children in a job object,
which is a change to the engine.

## The reset of the engine's data (issue 637)

The reset removes `projects`, `out`, `data` and `frames` under the engine's
home, and an engine started while it runs would write into them and be
asked for `feeds.list` as it settles. The two are kept apart from both
sides, each asking the other in the same turn as it acts:

- **The reset asks the supervisor** (`engineWorkRefusal`, in its `busy`
  check, before its flag goes up) and refuses, in this order: while a
  request a bound ended is unanswered (`abandoned`); while the state is
  `starting` or `restarting`, "The engine is still starting. Try again in
  a moment.", what the screen says for a start elsewhere (before the
  requests in flight, since a start's handshake is one); while a request is
  in flight (`inFlight`); and while the engine, or what an exited engine
  left in its process group (on POSIX; on Windows nothing tracks it, "After
  an exit"), is still being ended (`stillEnding`, the question `retry()`
  asks too), "The engine is still stopping. Try again in a moment.", the
  retry's own sentence: the
  engine given up on, or a mismatched one, while it is being ended (the
  state already says `stopped` or `mismatched`, and the client is gone, so
  nothing is in flight), an engine that outlived the kill, and an exited
  engine's group, any of which may still be writing into the home.
- **The supervisor asks the reset** (`resetting`, the question the
  engine bridge's guard asks: a sentence while the reset's flag is up,
  else null). A restart whose wait elapses while it answers a sentence
  spawns nothing: the state stays `restarting(n)`, its reason now "The
  engine data is being reset; the engine starts again once the reset has
  finished." followed by the failure's own reason, so why the engine
  stopped is still said (the wait first, since the status line is one line
  cut where it runs long); this is said once and logged, and the reset is
  asked again every
  `resetPollMs`; the first look that finds it over logs that and starts the
  engine as the restart would have. `retry()` is refused with the reset's
  sentence.

Since the reset refuses while the engine is `starting` or `restarting`, a
restart meets a reset only when the engine was `ready` as the reset began -
perhaps already exited, its exit not yet reported, which takes up to a
second - and its failure was reported during it: its data removed under
it, say. The supervisor asks rather than being told, so a reset that ends
any way at all - removed, refused after its flag went up, thrown - lets
the engine start within `resetPollMs`, and no word from the reset's owner
has to arrive. The wait's timer is the restart's own, one at
a time, and `stop()` clears it before anything it awaits, so a quit during
the wait starts nothing.

## Bounds (constructor options, so tests shorten them)

| Name | Default |
|---|---|
| `handshakeMs` | 10 000 |
| `inactivityMs` | 600 000 |
| `shutdownMs` | 3 000 |
| `terminateMs` | 3 000 |
| `restartDelaysMs` | `[1000, 2000, 4000]` |
| `stableMs` | 30 000 |
| `resetPollMs` | 250 |
