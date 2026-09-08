# Contract: the run

## The sequence

1. **Refuse early.** If the engine is not ready, the run does not start; the state's own sentence says why. If a run for this project is already in flight, the second is refused, not queued.
2. **The service day.** A project that has one uses it. A project that has none gets today, on the machine, resolved once; it is stored with the rest when the run completes, and never resolved again.
3. **Ask for the layout.** `graph.build` with the project's feed key. Four stages report as they finish. The answer carries the stage summaries and the four paths.
4. **Ask for the map.** `map.build` with the feed key, the service day, and the project's identifier as the output folder, which is where the app already serves a project's output from. Eight stages report; the first four are already finished and their repeats are ignored.
5. **Write.** One bridge call with the day and the paths. The record comes back written, with whether the layout changed.

Steps 3 and 4 are separate because only the layout call returns the paths
that identify the layout, and only the map call produces a page. The map
call would rebuild a missing stage on its own, which is the behaviour this
feature detects rather than prevents.

## Cancelling

`cancel()` on whichever request is in flight. The engine ends the
layout-tool process it is waiting on and answers with its cancelled error.
The run's state becomes `cancelled`, nothing is written, and the project
keeps whatever it had.

Cancelling after the run has finished does nothing, as the client's handle
already guarantees.

## Failing

The engine's error reaches the run with its code, kind, hint and detail. The
stage that was running is marked failed. The screen shows `data.hint`, the
sentence the engine wrote for a person; `data.detail` keeps everything.
Nothing is written.

One thing is not passed through untouched: the engine writes a filename into
the hint for an input or output failure, and a path is not for a screen. The
main process takes it out of the hint as the error crosses, once, for every
consumer, and the detail still carries it.

## What the screen shows

| State                    | Shows                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| A project with no layout | "Lay out"                                                                                         |
| A project with a layout  | the identifier, shortened, the service day, and "Lay out again"                                   |
| Running                  | the progress line, the last completed stage's sentence, and a cancel button beside it             |
| Cancelled                | the line as it stood, and one sentence saying the run was cancelled                               |
| Failed                   | the line with the failed stage marked, and the engine's sentence                                  |
| Done                     | the identifier and the day, and a sentence saying whether the layout differed from the one stored |

Every one of those is drawn from the design system's tokens and the
progress component, is reachable by keyboard, and is announced once through
the polite live region the status line already uses.
