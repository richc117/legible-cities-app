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
  "style": { "lineWidth": 10, "stationRadius": 8, "interchangeRadius": 11, "labelSize": 26 },
  "colors": {},
  "defaultColor": "#888888",
  "lineOrder": [],
  "theme": "warm-dark",
  "layout": null,
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
- A write stores the record as the reader normalised it, stamped with the
  current `version`: unknown keys are dropped, an invalid colour, theme or
  date falls back to its default, and a missing timestamp becomes the epoch.
