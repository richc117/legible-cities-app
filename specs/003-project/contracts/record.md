# Contract: `project.json`

The on-disk form of `ProjectRecord` (`data-model.md`), version 2:

```json
{
  "version": 2,
  "id": "kq7x2mzp4dna",
  "name": "Los Angeles",
  "feed": "la-metro-rail",
  "mode": "all",
  "agency": null,
  "date": null,
  "service": null,
  "style": {},
  "colors": {},
  "defaultColor": "#888888",
  "lineOrder": [],
  "theme": "warm-dark",
  "export": { "preset": "instagram-reel", "options": {} },
  "destination": null,
  "layout": null,
  "made": null,
  "drawn": null,
  "built": null,
  "opened": null,
  "created": "2026-09-07T20:00:00.000Z",
  "modified": "2026-09-07T20:00:00.000Z"
}
```

- Pretty-printed, two-space indent, trailing newline, UTF-8: the file is
  meant to be read by a person too.
- Written atomically (`research.md` section 1).
- `style` (the sizes of the map; version 2, issue 350, ADR-049) holds up
  to eight numbers in the engine's own names in camel case - `lineWidth`,
  `lineGap`, `stationRadius`, `interchangeRadius`, `stationStroke`,
  `labelSize`, `labelOffset`, `padding` - each present only when a person
  set it, so a new record holds `{}`. A missing field is the engine's own
  number (`DEFAULT_STYLE`, copied here as data and held to the committed
  protocol schema by a test), and a field written at that number is no
  choice and is not sent. A value that is not a finite number reads as
  missing; a number outside the engine's range is **kept**, shown refused
  beside its field in cell 04, and nothing is sent until it is fixed.
  **The version moved from 1 to 2 for this field** and for no other: a
  version-1 record held four numbers, `10, 8, 11, 26`, which the app wrote
  at creation, never sent and called the engine's when they were not, and
  sending them would have redrawn every existing project. So a version-1
  record is read field by field: a number equal to its old default is
  unset, and any other number in one of the four is kept as set, so one
  number written by hand never sends the other three old defaults as
  choices; a version-2 record is read as written, those numbers included. A build that does not know version 2 reads the record
  as read-only. The colours the engine also accepts are not here and are
  never sent (ADR-049).
- Readers accept a missing optional field and refuse a `version` above 2.
- `made` (added by A3-06, still version 1) is when the engine made the
  stored layout, its `meta.made` as answered by `graph.build`, or `null`;
  a value that does not parse as a time reads as `null`.
- `drawn` (added by A5.5-04, still version 1) is what the map now in the
  project's output folder was drawn from:
  `{ layout, made, date, colors, defaultColor, lineOrder, theme, style }`,
  the record's own values as they were at the end of the draw that produced
  it (`style` is what `map.build` was sent, in the app's names, empty for a
  map drawn without one, and a block from before the field reads as empty),
  or `null`. It is written by the four handlers that write the record at
  the end of a draw - `completeLayout`, `completeRebuild`, `completeColors`
  and `completeOrder` - and by nothing else, so an edit that draws nothing
  leaves it behind, which is how the notebook knows a cell is stale
  (ADR-045). A block that is not whole reads as `null`, as the window does.
  `null` means only that the map cannot be proved current, never that it is
  stale. The rule that let it be added without moving the version is in
  `specs/028-the-notebook/contracts/run-graph.md`.
- `drawn.stations` (added by issue 272, still version 2) is the list of
  stations the map now on disk draws, `[{ id, name }]`, as `map.build`
  answered it (engine v0.13.0): the node id the page's `setTrip` takes and
  the name the map writes, the empty string where the feed gives none, in
  the engine's order. Cell 03's Trip section offers it and nothing the app
  derives, and it is in the record because a project opened again shows its
  map from the stored files without a build. Every draw writes the list
  its build answered - `completeLayout` and `completeRebuild` in their
  `done`, `completeColors`, `completeOrder` and `completeStyle` as an
  optional last argument - because a redraw draws the stored set as it is
  now, which another project may have laid out again (A3-06). A draw whose
  build answered no list the bridge would take keeps the one the record had
  while the layout and its `made` are unchanged, and nothing from another
  layout or from the same id laid out again since. It is optional and read on its
  own: missing, or a list that is not whole (an entry without a string id
  and name, an empty or repeated id, more than 20,000 entries, more than
  1,000,000 characters of ids and names together), reads as no
  list and leaves the rest of `drawn` as it was, and the section then asks
  for the map to be drawn again. The store reads the list again, as
  it reads every field the handler read, and keeps an entry's id and name
  and nothing else. An older build that writes the record
  drops it, which the next draw puts back. The front door's summaries carry
  `drawn` without it. A trip is never in the record.
- `tuning` (added by issue 385, still version 2; spec 033) is LOOM's own
  settings a person chose for the project's layout, in the engine's names
  in camel case with the bend penalties flat: `mergeDistance` (5 to 500
  metres), `grid` (`octilinear`, `ortholinear`, `orthoradial` or
  `hexalinear`), `gridSize` (25 to 400 percent of the distance between
  adjacent stations) and `deg45`, `deg90`, `deg135`, `deg180`, `diagonal`
  (each 0 to 10). Every field is optional, and the key itself is absent
  until a person chooses something: a field at LOOM's own number (50,
  `octilinear`, 100, 2, 1.5, 1, 0, 0.5) is no choice and is not kept, so a
  project that never touched the tuning has no `tuning` and a reset
  removes it. It is written the moment it is chosen
  (`projects.setTuning`) and sent to `graph.build` by the next layout run.
  On read it is taken field by field, and a field the store would refuse
  on write - a number out of range or of the wrong kind, a grid the engine
  does not offer, a field not on the list - reads as not held, so a value
  written by hand never reaches the engine. It is admitted at version 2
  under the rule below: optional on read, absent meaning LOOM's defaults,
  which is what every earlier layout was made with, and the one released
  build, v0.1.0, holds version 1 and reads this record as read-only, so it
  cannot drop the field.
- `laidOutWith` (added by issue 385, still version 2) is the tuning the
  stored layout was asked with: what the layout run that wrote `layout`
  sent `graph.build`, in `tuning`'s shape and under its rules, written by
  `completeLayout` from the run's `done.tuning` in the same write as the
  layout's id, and by nothing else. Absent means LOOM's defaults, which is
  what every layout before the field was asked with. Where `tuning` would
  send something else, the notebook reports the layout as of another
  tuning (`specs/028-the-notebook/contracts/run-graph.md`). It is `built`'s
  counterpart for the tuning, kept by the app because reading it back from
  the engine's `LayoutMeta.stages` would mean computing LOOM's flags. The
  front door's summaries carry both fields.
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
- `opened` (added by A5.6-04, still version 1) is when the project's
  screen was last opened, an ISO timestamp, written by `projects.markOpened`
  as the screen loads and by nothing else: it does not move `modified`,
  which says when a person last changed something, and a read-only project
  is not written at all. The front door lists projects newest opened first,
  and a project with `null` - never opened since the field was kept - by
  its `created`. Anything that is not a moment reads as `null`. It meets
  all three criteria of the rule below: optional on read, its absence means
  "not known" and sorts by `created`, and an older build that drops it
  loses only an order the next opening puts back.
- `destination` (added by A5.5-19, still version 1) is the folder this
  project's exports are written to, over the app's own export folder:
  an absolute path, or `null` for the app's. The file goes to
  `<destination>/<project name as a folder>/<the engine's filename>`,
  exactly as it goes under the app's folder, and `export.encode` has always
  taken an absolute destination, so nothing about the plan or the capture
  changes with it. Anything that is not a folder the app would store -
  relative, empty, over 4,096 characters, or carrying a control character -
  reads as `null` and is refused on write; whether a particular folder may
  be written into - the app's own bundle, the engine's home, anything
  inside either, and anything that holds either, since the file lands one
  folder deeper and that folder is named after the project - is the main
  process's judgement, made on resolved paths when it is chosen and again
  at each export, because the home can move between two starts. `null` means "not
  told otherwise", which is what every record meant before this field
  existed, so an older project is unaffected and an older build that drops
  the field sends the next export to the app's folder rather than misreading
  anything. That last point is where this field sits least comfortably
  under criterion 3 of the rule below, which allows a dropped field only
  where the app can recompute or re-observe it: a destination is neither,
  and a person whose record has been through an older build chooses it
  again. It is admitted here because what is lost is one press of a button
  the cell still offers, said plainly on screen, while a version bump would
  make every existing project read-only in every older build - and **it is
  not a precedent for a field a person typed**, which cannot be chosen
  again from a control that is showing what it holds. The rule that let it
  be added without moving the version is in
  `specs/028-the-notebook/contracts/run-graph.md`, "Adding a field to
  `ProjectRecord` without moving `RECORD_VERSION`". The folder never
  crosses the bridge inward: it is chosen in the platform's own dialog,
  which the main process opens, and applied there (A1-04's shape).
- A write stores the record as the reader normalised it, stamped with the
  current `version`: unknown keys are dropped, an invalid colour, theme or
  date falls back to its default, and a missing timestamp becomes the epoch.
