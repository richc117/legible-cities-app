# Contract: the bridge gains one method

## Why one, and why this one

The renderer drives the run: it makes the engine calls, it draws the
stages, it cancels. What it cannot do is open a file. The layout identifier
is derived from four files' bytes, so it is computed in the main process,
which is also the only place allowed to write the project's record.

So the run's last step crosses the bridge once, carrying what the engine
said, and comes back with what was written.

## `api.projects.completeLayout(id, done)`

```ts
interface LayoutDone {
  /** The service day the map was built for, YYYY-MM-DD. */
  date: string
  /** The stage graphs the engine named, in its own stage order. */
  paths: string[]
}

interface LayoutResult {
  record: ProjectRecord
  /** True when the project had a different layout stored before this run. */
  changed: boolean
}
```

Called once, after both engine calls have succeeded. It:

1. refuses a caller that is not the window's top frame, as every handler does;
2. refuses an identifier or a date that is not the shape the record's own validators require;
3. refuses the paths unless there are exactly four of them, each an absolute path whose real path lies under the engine's home, each an existing regular file;
4. reads the four files, derives the identifier, and writes `layout`, `date` and `modified` into the record in one atomic replacement;
5. answers with the record it wrote and whether the identifier differs from the one that was there.

A refusal is a rejected promise whose message is a sentence, never a path.

## What it does not do

- It does not talk to the engine. The renderer made those calls and holds their answers.
- It does not decide the service day. The renderer resolves it once, at the first run, and passes it; the store keeps the day a project already has.
- It does not write anything when the run did not finish. There is no partial call.
- It does not return a path. The identifier, the date and the record go back; the paths went one way only.

## Why the paths cross the bridge at all

The renderer asked the engine where the stage graphs are and the engine
answered. Passing that answer to the main process is the renderer relaying
what it was told, not the renderer knowing about a filesystem. The main
process trusts none of it: the containment check is the same one the
project origin already applies before it opens anything, and it is the
reason a compromised page cannot use this method to hash a file elsewhere
on the machine.
