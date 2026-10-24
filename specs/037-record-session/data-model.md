# Data model: The record session

## `revision` (record, part 1)

| | |
|---|---|
| Type | whole number, 0 or more |
| Absent | reads as 0 |
| Written by | the store, on every write, as `previous + 1`; never by the renderer |
| In `RECORD_FACTS` | yes, so a newer build's record keeps it (ADR-056) |
| Version bump | none (ADR-056's additive rule) |

## The sent set (completion payloads, part 1)

`SentSet` is what one `map.build` was built from:

| Field | Type | From |
|---|---|---|
| `layout` | layout id | the record read at the run's start |
| `made` | ISO time or null | the same |
| `date` | service day | the run's day |
| `colors` | `Record<label, #rrggbb>` | the palette sent |
| `defaultColor` | `#rrggbb` | the same |
| `lineOrder` | `string[]` | the order sent |
| `style` | `ProjectStyle` as sent (`styleSent`) | the same |
| `lines` | `ProjectLines` as sent (`linesSent`), or absent | the same |

- Carried by `LayoutDone.sent`, `RebuildDone.sent` and each redraw's payload. The stations travel beside it, as today.
- Validated in main field by field with the record's own validators. One refused field refuses the write with that field's sentence.

## `drawn` (record)

Built by `drawnFromSent(sent, stations, theme)`:
- every field above is copied from `sent`;
- `theme` comes from the record at the write;
- stations carry over only while `layout` and `made` match the previous `drawn`, as today.

Nothing in `drawn` is read from the record's own choice fields.

## Run inputs (renderer, part 1)

At a run's start: `beforeStart` flushes the debounced controls, then `await api.projects.get(id)`, queued in main. That record is the run's only input. The renderer's copy is not consulted for planning.
