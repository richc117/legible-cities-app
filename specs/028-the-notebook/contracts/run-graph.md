# Contract: the run graph

The six cells of the notebook, what state each one is in, and where that
state comes from. ADR-045 decided the notebook; this says what the cells
may rely on, so the cell issues cite it rather than each restating the same
transitions and disagreeing by a word.

The derivation is `src/renderer/src/runGraph.ts`, and it is pure: no React,
no Electron, no filesystem, no clock. Its whole model is a table of records
in `tests/unit/run-graph.test.ts`.

## The six cells

| # | id | Name | Holds |
| --- | --- | --- | --- |
| 01 | `data` | Data | the feed, the mode and the operator (A5.5-09) |
| 02 | `process` | Process | the layout run and its stages (A5.5-10) |
| 03 | `frame` | Frame and service day | the service day (A5.5-15) |
| 04 | `style` | Style | the project's map theme (A5.5-17) |
| 05 | `lines` | Lines | the line colours and the line order (A5.5-18) |
| 06 | `export` | Export | the presets, the options and the export (A5.5-19) |

The order is the order the work runs in, and the numbering is fixed
(ADR-045): a cell that is thin stays a cell rather than being renumbered
away. `CELLS` is that order and `CELL_LIST` carries the numbers and the
names.

## The four states

`ready`, `running`, `stale`, `error`, said on screen as an icon and a word
and never as a colour alone (`docs/DESIGN.md` 8.2).

`stale` is not a warning about the app. It says the map on screen was drawn
before a change above it; the map and every control stay exactly where they
are until a person re-runs.

## Which cell a run belongs to

A run says so itself, through the flags already on its snapshot - nothing
has to be told, and nothing is registered:

| Snapshot | Cell |
| --- | --- |
| `rebuilt` | 03 `frame` |
| `recoloured` or `reordered` | 05 `lines` |
| anything else, including a re-layout | 02 `process` |
| the export run (`ExportSnapshot`) | 06 `export` |

`cellOfRun` is that table and nothing else. It is one function rather than
a condition in each view because getting it wrong shows `running` on the
wrong cell for minutes at a time.

An idle run belongs to no cell. A finished run keeps the cell its flags
name, which is how a failure lands where it happened.

## What the page was drawn from

Staleness needs one fact the record did not hold: what the map now on disk
was actually drawn from. That is `drawn` on `ProjectRecord`:

```ts
interface DrawnFrom {
  layout: string
  made: string | null
  date: string | null
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  theme: Theme
}
```

It is written by the four handlers that already write the record at the end
of a draw - `completeLayout`, `completeRebuild`, `completeColors`,
`completeOrder` - from the values of the record they are about to write, so
there is **no new bridge method and no new engine call**. Staleness is then
a comparison of the record against itself, with no events and no dirty
flags.

It carries `made` and not only `layout` because two projects can draw from
one layout set and either can re-lay it out under the other, which is the
case A3-06 added `made` for: the same id under a later `made` is the same
inputs laid out again since this project drew from them, and without it a
re-laid set reads current over a page drawn from the geometry it replaced.

An edit that draws nothing - a rename, the inputs, the theme, the export
choice - leaves `drawn` exactly as it was. That is the whole mechanism.

`drawn: null` means **we cannot prove this map is current**, which reads as
`ready` and never as `stale`: an old project's map is not wrong. It is read
whole or not at all, as the service window is; a block missing a field
would answer a question about a field it does not hold.

## Adding a field to `ProjectRecord` without moving `RECORD_VERSION`

This is the general rule, not a licence granted once to `drawn`. A5.5-19
adds an export destination and A5.6-04 a last-opened time, and neither issue
says a word about the version; this is where they read it.

A field may be added at the current version when all three hold:

1. **It is optional on read.** A record that lacks it parses, and the field
   takes a stated default rather than making the record invalid.
2. **Its absence means unknown, not wrong.** The default has to be the
   reading that leaves an older project alone. `drawn: null` is "we cannot
   prove this map is current", which renders as ready; it is not "nothing
   has been drawn" and not "everything is stale".
3. **An older build that writes the record loses nothing a person would
   notice.** Every writer reads the record and writes it whole, so an older
   build drops a field it does not know. That is acceptable for a field the
   app can recompute or re-observe - `drawn` is rewritten by the next draw -
   and is not acceptable for anything a person typed.

`RECORD_VERSION` moves only when a record written by this build would be
*misread* by an older one - a field whose meaning changed, or one whose
absence an older build would fill wrongly. A bump is not free: it makes
every existing project read-only in any older build, which is a real cost
paid by people who have both installed, for no gain when the field is
additive.

Whatever is added, `specs/003-project/contracts/record.md` gains its
paragraph in the same change, saying what it is, what a missing or
malformed value reads as, and which issue added it at which version.

## When a cell is stale

A **source** is a value that has moved since the map was drawn. Each source
belongs to the cell that holds it, and it marks the cells **below** that
one stale - never its own, because the cell holding a change is showing the
change; what is behind is everything drawn from it.

| Source | Cell it belongs to | Marks stale | Reason |
| --- | --- | --- | --- |
| `built` differs from the record's `mode` or `agency` | 01 | 02-06 | `inputs` |
| `drawn.layout` differs from `layout` | 02 | 03-06 | `layout` |
| the same layout under a different `made` | 02 | 03-06 | `relaid` |
| the run's `replaced`, once the run has stopped | 02 | 03-06 | `replaced` |
| `drawn.date` differs from `date` | 03 | 04-06 | `day` |
| a cell's own run failed | that cell | below it | `upstream` |

**A cell names the nearest source above it**, not the topmost. The sentence
is read by someone who has just changed something, and the answer they want
is what they did - "the day you chose has not been drawn" - rather than the
root of it three cells further up, which they may have changed last week.
Where a cell both failed and holds a change, the cells below it are told
about the failure, which is the more particular of the two. Every source is
still on the record, so the rail and the header can say how many.

Cell 06 is nobody's upstream: an export that failed leaves cell 06 in error
and nothing else changes.

`built` is the one source that does not need `drawn`: it has been on the
record since A2-02 and is what the engine made the stored layout with, so a
record from before `drawn` existed still reports moved inputs, exactly as
the sentence in A2-02's panel already did.

`replaced` is the one source that is not on the record at all. A re-layout
that answered and was then stopped left the engine's stored set replaced
with the record untouched, so the page is of geometry that is gone (A3-05);
only the run knows.

It is read **only once the run has stopped**. The run raises `replaced` the
moment `graph.build` answers, which is minutes before the map is drawn, and
a re-layout that is still drawing has not left anything behind yet: reading
it while the run goes would take cells 03 to 06 to stale for the whole
drawing half of every re-layout and back again, which is the opposite of
"running makes nothing below it stale".

### The cheap edits are exempt

The colours, the default colour, the order and the theme raise **no
source**. They redraw themselves as A4-01, A4-02 and A4-03 built them, so
their cell reads `running` while they do and `ready` after - never `stale`.
ADR-045 says why: a control that disables itself under a person's hands
takes the focus with it, and a refused change is a lost one. Stale is for
the edits that cost a re-layout.

Their values are still kept in `drawn`, because Revert reads them
(A5.5-12). `drawnMatchesEdits` answers whether the record's colours and
order are the ones the map carries, for a summary or a Revert, without
being a state. Two things a caller has to know about that answer:

- **The theme is not in it**, although `drawn` carries one. See below.
- **The order is compared as a value.** An empty order and one naming every
  line in the engine's own alphabetical order draw the same map, and this
  says they differ, because the lines a layout carries are not in the
  record and a pure module cannot tell. A5.5-18 and A5.5-12 have the line
  list and can: `isAlphabetical` in `src/renderer/src/order.ts` is the same
  question asked where the answer exists. Without it, cell 05 would offer a
  Revert that changes nothing a person can see.

## Each cell's state

Per cell, in this order:

1. a run of its own that is `running` → **running**;
2. a run of its own that is `failed` → **error**;
3. a source above it → **stale**;
4. otherwise → **ready**.

Consequences worth stating, because a cell issue will otherwise rediscover
them:

- **A cancelled run is not an error.** Stop returns a cell to what it was
  (A5.5-10). Only `failed` is an error.
- **Running does not propagate.** A cell running makes nothing below it
  stale: running is not a change to anything yet.
- **A cell's own failure wins over what is above it.** The specific thing
  that happened is more use than the general one.
- **An error is a source for the cells below it**, exactly as a change is:
  the map below a failed run is of what came before it.

## What this contract does not settle

**A choice a person has made but the record has not been told about is
invisible here.** The derivation reads the record, and the record is the
only thing that survives a relaunch. The mode and the operator are written
the moment they are chosen (`setInputs`, A2-02), so cell 01's edits derive.
The service day is not: A3-04 writes it only after the rebuild has drawn.
A cell 03 that changes the day and *starts nothing* (A5.5-15) therefore has
to write the chosen day to the record when it is chosen, as the theme is
written when it is pressed - otherwise the day never reaches `date`, the
comparison against `drawn.date` never fires, and the staleness that issue
promises cannot exist. That is A5.5-15's to do; this contract says which
comparison it will light up.

**`drawn.theme` describes the last draw, not what is on screen.** A theme
is taken on the page's address and the page restyles itself within a frame
of the press (A4-03), with no draw at all, so the map on screen always
carries `record.theme` while `drawn.theme` holds the theme of the last
draw. It is exempt from staleness either way, and it is deliberately not in
`drawnMatchesEdits`, which would otherwise answer "the map does not show
it" about the one field of which that is never true. A5.5-12's Revert for
cell 04 puts the record back, not the pixels, and its issue's phrase "what
the map shows" should be read that way.

**Neither `made` nor `layout` has a live path to divergence yet, and
`replaced` does not survive.** All three are worth stating together,
because a reader will otherwise assume one of them is live:

- `drawn.layout` and `drawn.made` are written by `drew`, which is called
  only by the four handlers, and `layout` and `made` are written only by
  `completeLayout` - which calls `drew` in the same breath, after the map
  has been drawn. So nothing in the app as it stands can move one without
  the other. The comparisons are implemented and tested from a record, and
  they are what makes the two fields worth storing; the case that will
  exercise `made` is an engine or an app that can ask what a stored set's
  `made` is now without drawing from it. A set re-laid out under this
  project is discovered today only by `graph.build`, inside a run that then
  redraws. A3-06's spec records an open edge of the same family.
- `replaced` lives in the renderer's memory and nowhere else. `#begin`
  clears it at the start of every run, and a relaunch starts without it. So
  a cancelled re-layout followed by any other run - or by a quit - loses
  the one reachable cell-02 source, and the notebook goes back to reading
  ready over a page drawn from geometry the engine has replaced. Putting it
  on the record is a change to the record, not to this derivation; until
  something does, cell 02's provenance is honest only within the session
  that made it.
