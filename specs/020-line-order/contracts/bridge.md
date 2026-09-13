# Contract: the bridge gains one method

## `api.projects.completeOrder(id, order)`

```ts
/** Line labels in the order they are drawn, the later over the earlier. */
type LineOrder = string[]
```

Called once, after a `map.build` from the stored layout has drawn the map
with that order - never before it, so the record and the page on screen
always agree. It answers with the record.

It refuses:

- a caller that is not the interface's top frame (`forbidden`);
- a malformed id;
- an order that is not an array of text;
- a line label that is empty, longer than the engine's own limit, or
  carries a control character;
- the same label twice, which would draw a line over itself and leave
  another's place ambiguous;
- more lines than a feed could plausibly draw (the same cap the palette
  has, for the same reason);
- a project with no stored layout ("lay the project out first").

It writes `lineOrder` and `modified`, and nothing else. The same validator
(`validateLineOrder` in `src/shared/project.ts`) runs in the panel, in the
main-side handler and in the store: the panel so a move is never made that
the store would reject, the handler because the argument came from another
process, the store because it is the trusted layer and has callers of its
own. The cap is the one the panel needs most: a feed with more lines than a
record may hold would otherwise draw the map and then fail on the way to
disk, once for every move.

Nothing here talks to the engine, arranges anything, or carries a path.

## What `map.build` is given

Every draw the run makes - a first layout, a re-layout, a chosen day, a
colour change, a move - passes the arrangement straight through:

```ts
client.request('map.build', {
  key,
  layout,
  date,
  out,
  colors: palette.colors,
  default_color: palette.defaultColor,
  // Omitted entirely when the project has no arrangement, so its requests
  // are the ones it made before this feature.
  line_order: order,
})
```

The engine draws the named lines first, in the order given, then every
other line the layout carries in the order it would have had anyway; a
label the layout does not carry is ignored. That is engine issue 28's fix,
without which the field was a whitelist and an order naming two lines of
six drew two.
