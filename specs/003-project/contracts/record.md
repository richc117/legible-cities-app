# Contract: `project.json`

The on-disk form of `ProjectRecord` (`data-model.md`), version 1:

```json
{
  "version": 1,
  "id": "kq7x2mzp4dna",
  "name": "Los Angeles",
  "feed": "la-metro-rail",
  "mode": "all",
  "agency": null,
  "date": null,
  "service": null,
  "style": { "lineWidth": 10, "stationRadius": 8, "interchangeRadius": 11, "labelSize": 26 },
  "colors": {},
  "defaultColor": "#888888",
  "lineOrder": [],
  "theme": "warm-dark",
  "export": { "preset": "instagram-reel", "options": {} },
  "layout": null,
  "made": null,
  "built": null,
  "created": "2026-09-07T20:00:00.000Z",
  "modified": "2026-09-07T20:00:00.000Z"
}
```

- Pretty-printed, two-space indent, trailing newline, UTF-8: the file is
  meant to be read by a person too.
- Written atomically (`research.md` section 1).
- The `style` defaults are the engine's `Style` values at the pinned engine
  and are copied here as data; the numbers are re-checked against the engine
  when A4-02 exposes them.
- Readers accept a missing optional field and refuse a `version` above 1.
- `made` (added by A3-06, still version 1) is when the engine made the
  stored layout, its `meta.made` as answered by `graph.build`, or `null`;
  a value that does not parse as a time reads as `null`.
- `built` (added by A2-02, still version 1) is the mode and agency the
  engine made the stored layout with, `{ mode, agency }` from
  `graph.build`'s meta, or `null`; an empty agency reads as none, and a
  block that is not that shape reads as `null`.
- `service` (added by A3-04, still version 1) is the engine's answer at
  the last layout run, `{ start, end, busiest, anchor }`, four days
  `YYYY-MM-DD` with `start <= end`, or `null`; a block that is not that
  reads as `null`.
- `colors` and `defaultColor` (defined by A1-05, first written by A4-01,
  still version 1) are the line colours a person chose: a line label to a
  `#rrggbb` colour, and what a line the feed leaves uncoloured is drawn in.
  They are what `map.build` takes as `colors` and `default_color`; the app
  resolves nothing and stores no feed colour. An entry whose colour is not
  six hex digits, or whose label is empty, over 64 characters or carrying a
  control character, is dropped on read and refused on write; so is the
  label `__proto__`, which a plain object cannot hold as a property and
  which the record could therefore store and never read back.
- `lineOrder` (defined by A1-05, first written by A4-02, still version 1)
  is the order the lines are drawn in, the later over the earlier where
  they share track and the same order the page lists them in. It is what
  `map.build` takes as `line_order`, and it is left out of the request
  entirely when it is empty, which is the engine's own alphabetical order.
  Its labels are held to the same rules `colors`' are, and a label in it
  twice is dropped on read and refused on write: one line would be drawn
  over itself and another's place would be ambiguous. A label the layout
  does not carry is harmless, because the engine ignores it and draws every
  line an order leaves out (engine issue 28).
- `theme` (defined by A1-05, first written by A4-03, still version 1) is
  the theme the project's map is drawn in: `warm-dark` or `sepia`, the
  engine page's own names, which reach it as `theme=` on its address and
  the export as `dark` or `light`. Anything else reads as `warm-dark` and
  is refused on write. It is the project's theme and not the interface's,
  which is a setting of its own (A1-04).
- `export` (added by A5-01, still version 1) is what the project was last
  set to export from the export tab: `{ preset, storyboard?, options }`,
  where `preset` is one of the thirteen social presets the app offers,
  `storyboard` is absent for the preset's own, and `options` holds only
  what a person changed from the engine's defaults among `view`, `labels`,
  `title`, `clock`, `at` (the engine's `Clock`), `lines` (labels under the
  `colors` rules), `quality` and `tag` (the engine's `Token`). The theme,
  the safe zones and the fade are never in it. A block that is not that
  shape reads as the reel with no options, which is what the one button
  exported before, and is refused on write
  (specs/022-export-tab).
- A write stores the record as the reader normalised it, stamped with the
  current `version`: unknown keys are dropped, an invalid colour, theme or
  date falls back to its default, and a missing timestamp becomes the epoch.
