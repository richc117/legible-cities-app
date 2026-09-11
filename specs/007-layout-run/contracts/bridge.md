# Contract: the bridge gains one method

## Why one, and why this one

The renderer drives the run: it makes the engine calls, it draws the
stages, it cancels. What it cannot do is write the project's record, which
the main process alone does. Since ADR-033 the layout's id is the engine's
own, so nothing is read from disk on the way; the day and the id cross the
bridge and the record comes back.

So the run's last step crosses the bridge once, carrying what the engine
said, and comes back with what was written.

## `api.projects.completeLayout(id, done)`

```ts
interface LayoutDone {
  /** The service day the map was built for, YYYY-MM-DD. */
  date: string
  /** The layout's id, as graph.build answered it. */
  layout: string
  /** Since A3-04: the feed's window and the engine's day, as feeds.service answered them. */
  service: ServiceWindow
  /** Since A3-06: when the engine made the layout, graph.build's meta.made. */
  made: string
}
```

Since A3-04 (`specs/012-service-date/contracts/bridge.md`) the run makes
three engine calls, the window crosses with the day and the id, and a
second method, `completeRebuild`, writes a day a person chose.

```ts

interface LayoutResult {
  record: ProjectRecord
  /** True when the project had a different layout stored before this run. */
  changed: boolean
  /** Since A3-06: the same id, made again since the project last drew from it. */
  relaid: boolean
}
```

Called once, after both engine calls have succeeded. It:

1. refuses a caller that is not the window's top frame, as every handler does;
2. refuses an identifier or a date that is not the shape the record's own validators require;
3. refuses an id that is not 64 hex digits;
4. writes `layout`, `date` and `modified` into the record in one atomic replacement;
5. answers with the record it wrote and whether the id differs from the one that was there.

A refusal is a rejected promise whose message is a sentence, never a path.

## What it does not do

- It does not talk to the engine. The renderer made those calls and holds their answers.
- It does not decide the service day. The renderer asks the engine once, at the first run, and passes the answer; the store keeps the day a project already has.
- It does not write anything when the run did not finish. There is no partial call.
- It does not return a path, and none crosses it either way: the id, the date and the record are all there is (before ADR-033 the four stage paths crossed inward and were hashed; they no longer do).
