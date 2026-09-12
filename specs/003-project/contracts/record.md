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
- A write stores the record as the reader normalised it, stamped with the
  current `version`: unknown keys are dropped, an invalid colour, theme or
  date falls back to its default, and a missing timestamp becomes the epoch.
