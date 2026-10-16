# Contract: the run

## The sequence

1. **Refuse early.** If the engine is not ready, the run does not start; the state's own sentence says why. If a run for this project is already in flight, the second is refused, not queued.
1a. **Wait for the writes on their way** (issue 388, spec 033 FR-007). A field committed by leaving it for the press that starts the run (the tuning, the mode and operator, the day) is a write through the bridge still on its way. The screen hands each such write to the run as it sends it; a start or a rebuild made while one is on its way is `running` from the press, waits for the writes that were on their way at the press, and reads the store's answer to the last it took, or, where it took none, the record it was handed. With nothing on its way it reads the record handed in the same turn, or, where the store has answered a write the screen has not drawn yet and stamped it later than the record handed, that answer (issue 407). A refused write is shown where it always was and does not stop the run. A write sent after the press is not waited for, except through an operator still waiting at the press, which is sent once every write sent before it has landed and carries what they left, a field committed after the press among them (issue 407, spec 015 FR-003). Run all (issue 407) chooses its run, a layout or a rebuild for the day, from the record this step reads and not from the one the screen held: with nothing on its way in the press's own turn, and with a write on its way once it has landed, going from the press meanwhile as the press's plan would go; where the writes leave nothing to run, the run goes back to the snapshot and the job it had before the press, or to idle where that was a stopped redraw for colours, line options, the order or the sizes, whose panel would read it as a second stop.
2. **The service day.** A project that has one uses it. A project that has none gets today, on the machine, resolved once; it is stored with the rest when the run completes, and never resolved again.
3. **Ask for the layout.** `graph.build` with the project's feed key, and `force` for a re-layout; since issue 385, with the record's `tuning` in the engine's names where it holds one, and no `tuning` at all where it does not (spec 033). Four stages report as they finish. The answer carries the layout's id and meta, the stage summaries and the four paths.
4. **Ask for the map.** `map.build` with the feed key, the layout's id, the service day, and the project's identifier as the output folder, which is where the app already serves a project's output from. Eight stages report; the first four are already finished and their repeats are ignored. The engine never lays out on the way to a map (ADR-033).
5. **Write.** One bridge call with the day and the id. The record comes back written, with whether the id differs from the one recorded.

Steps 3 and 4 are separate because only the layout call names the layout,
and only the map call produces a page.

## Cancelling

`cancel()` ends the wait for the writes on their way (step 1a) when the run is still in it, and nothing is asked when those writes answer later; otherwise it acts on whichever request is in flight. The engine ends the
layout-tool process it is waiting on and answers with its cancelled error.
The run's state becomes `cancelled`, nothing is written, and the project
keeps whatever it had.

*As of 15 Oct 2026* (issue 423, engine v0.18.0): that holds where the
engine answers the cancelled error, which since v0.18.0 means it wrote
nothing a client sees, and where the cancel lands between two calls,
before the next is asked. A call the cancel reached after its point of no
return answers its result with `cancel_too_late`, and a result is what it
did: `map.build`'s is a map on disk, so the run goes on to step 5, writes
the record, ends `done` and says "The map was already drawn when you
cancelled; it is kept."; `graph.build`'s is a stored layout, so the run
stops there, before step 4, `cancelled` and saying "The layout was already
made when you cancelled; the next run draws from it.", with `replaced`
raised for a re-layout. The field is read from the result, never inferred
from when the cancel was pressed.

Cancelling after the run has finished does nothing, as the client's handle
already guarantees.

## Failing

The engine's error reaches the run with its code, kind, hint and detail. The
stage that was running is marked failed. The screen shows `data.hint`, the
sentence the engine wrote for a person; `data.detail` keeps everything but
the paths.
Nothing is written.

The main process takes every path out of the hint, the message and the
detail at the error door as the error crosses (issue 419;
`docs/ARCHITECTURE.md`, "The log files"); the error itself, in the main
process, and `engine.log` keep it.

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
