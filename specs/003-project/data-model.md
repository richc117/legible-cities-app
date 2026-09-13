# Data model: Project

## ProjectRecord (`projects/<id>/project.json`)

| Field | Type | Default on create | Owner |
|---|---|---|---|
| `version` | `1` | `1` | this feature |
| `id` | string, `^[a-z][a-z0-9]{11}$` | generated | this feature |
| `name` | string, 1–120 characters after trimming | from the form | this feature |
| `feed` | string, `^[a-z0-9][a-z0-9-]{0,63}$` | from the form (`la-metro-rail`) | this feature; A2-01 validates against the registry |
| `mode` | string, `^[a-z]{1,16}$` | `all` | A2-02 |
| `agency` | string or `null`, ≤ 120 | `null` | A2-02 |
| `date` | ISO date `YYYY-MM-DD` or `null` | `null` (resolved at first layout, A3-01) | A3-01, A3-04 |
| `service` | `{ start, end, busiest, anchor }` ISO dates or `null` | `null` (stored at a layout run, A3-04) | A3-04 |
| `style` | `{ lineWidth, stationRadius, interchangeRadius, labelSize }` numbers | the engine's `Style` defaults | A4-02 (backlog) |
| `colors` | `Record<string, string>` of line label → `#rrggbb` | `{}` | A4-01 |
| `defaultColor` | `#rrggbb` | `#888888` (the engine's) | A4-01 |
| `lineOrder` | `string[]` | `[]` (the engine's own order) | A4-02 |
| `theme` | `'warm-dark' \| 'sepia'` | `'warm-dark'` | A4-03 |
| `layout` | string or `null` | `null` (the stored layout's hash, A3-01) | A3-01 |
| `made` | ISO 8601 or `null` | `null` (when the engine made the layout, A3-06) | A3-06 |
| `built` | `{ mode, agency }` or `null` | `null` (what the engine made the layout with, A2-02) | A2-02 |
| `created` | ISO 8601 UTC | now | this feature |
| `modified` | ISO 8601 UTC | now | every write |

Rules:

- `id` is never derived from `name`; renaming changes `name` and `modified`
  only.
- A record with `version` greater than the reader's is `readOnly` in the
  interface and never written back.
- A record missing an optional field is read with the default; it is written
  in the current form only when something else changes.
- A folder under `projects/` without a readable, valid record is skipped and
  logged; it is not a project.

## ProjectSummary (what the Library lists)

`{ id, name, feed, date, modified, readOnly }` — derived from the record;
sorted by `modified`, newest first.

## The Library

No record of its own: the set of readable records under `projects/`.

## Folders

```text
<engine home>/
  projects/<id>/project.json        created by create, removed by delete
  projects/<id>/project.json.tmp    transient during a write; ignored by readers
  out/<id>/…                        produced by later features; removed by delete
  feeds/…                           never touched by this feature
```

## State

A project has no state machine in this feature. `layout: null` and
`date: null` read as "not laid out yet" and "not yet chosen"; A3-01 sets both.
