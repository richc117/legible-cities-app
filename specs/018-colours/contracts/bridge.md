# Contract: the bridge gains one method

## `api.projects.completeColors(id, palette)`

```ts
interface Palette {
  /** A line label to a colour, written `#rrggbb`; the person's overrides only. */
  colors: Record<string, string>
  /** What a line the feed leaves uncoloured is drawn in, `#rrggbb`. */
  defaultColor: string
}
```

Called once, after a `map.build` from the stored layout has drawn the map
with that palette - never before it, so the record and the page on screen
always agree. It answers with the record.

It refuses:

- a caller that is not the interface's top frame (`forbidden`);
- a malformed id;
- a palette that is not an object, or whose `colors` is not an object;
- a colour that is not six hex digits behind a `#`, naming the line;
- a line label that is empty, longer than the engine's own limit, or
  carries a control character;
- more lines than a feed could plausibly draw (the cap is the engine's own
  order of magnitude, not a guess about one feed);
- a project with no stored layout ("lay the project out first").

It writes `colors`, `defaultColor` and `modified`, and nothing else. The
same validator (`validatePalette` in `src/shared/project.ts`) runs in the
form, in the main-side handler and in the store: the form for a sentence,
the handler because the argument came from another process, the store
because it is the trusted layer and has callers of its own.

Nothing here talks to the engine, resolves a colour, or carries a path.

## What `map.build` is given

Every draw the run makes - a first layout, a re-layout, a chosen day, a
colour change - passes the palette straight through:

```ts
client.request('map.build', {
  key,
  layout,
  date,
  out,
  colors: palette.colors,
  default_color: palette.defaultColor,
})
```

The engine resolves override over the feed's `route_color` over
`default_color`, once, and the resolved table reaches the page's
`data.lines`, which is why the map, the chips and the time chart agree
(engine E06). A colour for a label the stored layout does not carry is
ignored by the engine, so an override outlives a narrower mode.
