# Contract: the bridge gains one method, and one grows

## `api.projects.completeLayout(id, done)` carries the window

```ts
interface ServiceWindow {
  /** The first and last day the feed's calendar covers, YYYY-MM-DD. */
  start: string
  end: string
  /** The busiest weekday the engine chose, scanning from the anchor. */
  busiest: string
  /** The day the choice was made from: the machine's date at the run. */
  anchor: string
}

interface LayoutDone {
  date: string
  layout: string
  service: ServiceWindow
  /** Since A3-06: when the engine made the layout. */
  made: string
}
```

The store writes `layout`, `service`, `date` and `modified` together. The
day a project already has is kept (ADR-031); `service` is replaced every
run, because a fresh feed may carry a fresh calendar.

## `api.projects.completeRebuild(id, done)`

```ts
interface RebuildDone {
  /** The day the map was just drawn for, YYYY-MM-DD. */
  date: string
}
```

Called once, after a `map.build` from the stored layout has succeeded.
It refuses a caller that is not the top frame; a malformed id or day; a
project without a layout ("lay the project out first"); a project without
a stored window ("lay the project out again to learn which days the feed
covers"); and a day outside the window, naming the window's two days.
It writes `date` and `modified`, and answers with the record.

Nothing here talks to the engine, decides a day, or carries a path.
