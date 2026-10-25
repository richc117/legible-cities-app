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
| 04 | `style` | Style | the project's map theme (A5.5-17) and the map's sizes (issue 350) |
| 05 | `lines` | Lines | the line colours and the line order (A5.5-18) |
| 06 | `export` | Export | the presets, the options, where the file goes, and the export (A5.5-19) |

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
| running, with `download` short of its last byte; or ended with `feedMissing` (issue 178) | 01 `data` |
| `rebuilt` | 03 `frame` |
| `restyled` (issue 350) | 04 `style` |
| `recoloured` or `reordered` | 05 `lines` |
| anything else, including a re-layout | 02 `process` |
| the export run (`ExportSnapshot`) | 06 `export` |

`cellOfRun` is that table and nothing else. It is one function rather than
a condition in each view because getting it wrong shows `running` on the
wrong cell for minutes at a time.

An idle run belongs to no cell. A finished run keeps the cell its flags
name, which is how a failure lands where it happened.

The first row is the one that is not a flag. Since engine v0.10.0 a
layout whose feed is not on disk downloads it first and reports the bytes
as stage `download` (E36); the run keeps that as `download`, apart from its
stages, until the layout's own first stage reports, and while the bytes
come the run is cell 01's. Whether an *ending* is the feed's is not read
from the bytes: the engine refuses a page that is not a zip after its last
byte, a download can fail before its first, and one of unknown size
reports a fraction of 0 to its end. So a layout that ends before its first
stage asks the engine's registry, afresh, whether the zip is on disk, and
the run ends with `feedMissing` set from the answer, in the same change as
its state. An ending with the feed missing is cell 01's - in error with the
engine's sentence, cell 02 not begun; any other is cell 02's as before.

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
  style: ProjectStyle // issue 350: what `map.build` was sent; {} for none
  lines?: ProjectLines // issue 394: the line options as sent; absent for none
}
```

It is written by the handlers that already write the record at the end
of a draw - `completeLayout`, `completeRebuild`, `completeColors`,
`completeOrder` and, since issue 350, `completeStyle` - from the values of
the record they are about to write, so `drawn` itself needed **no new
bridge method and no new engine call** (`completeStyle` is the writer of the
style that the others had no counterpart for). Staleness is then
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
3. **An older build that writes the record loses nothing.** *As of 16 Oct
   2026* (issue 425, ADR-056): every writer reads the record, changes its
   own fields, and writes back the fields it knows as it read them **with
   every key it does not know put back where it was found** - at the top
   level and inside every object the parser rebuilds from the keys it knows
   (the style, the export choice and its options, the tuning, each line's
   options and casing, and the four blocks below). The parser hands those
   keys to the store beside the record, never in it, so they reach neither
   the renderer nor the engine. The one key never carried is one named
   `__proto__`, which a plain object cannot be given by assignment, so no
   field may take that name. A newer build therefore finds a field it
   added exactly as it left it, whatever an older one wrote in between,
   with two exceptions a new field is placed to avoid:
   - **Inside a fact a writer renews.** `drawn`, `service`, `built` and
     `laidOutWith` record a draw or the engine's answer at a layout run. A
     writer that records a new one - a draw for `drawn`, a layout run for
     all four - writes its block whole, and nothing from the old block is
     carried into it, because this build's draw or layout did not send what
     an unknown key there says it did. A field that describes a fact goes
     inside that fact's block, where it is renewed with it. One put beside
     the block is carried past the renewal and goes on describing the old
     fact.
   - **A known field's value the older build cannot read.** A key with a
     known field's name is that field's. A value the older build refuses
     reads as that field's default and is written so. A change of what a
     known field may hold is the misreading below, and moves the version.

   The wording changed with ADR-056. Until then every writer but
   `markOpened` wrote only the fields it knew, so an older build dropped a
   field it did not know. This criterion then allowed a new field only
   where the app could recompute or re-observe it (`drawn` is rewritten by
   the next draw), never for anything a person typed. That held while the
   one released build read a version-2 record as read-only. It did not hold
   between two version-2 builds, which would each have dropped the other's
   fields (the codebase review's R6-01).

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
| `tuning` would send other than `laidOutWith` (issue 385) | 02 | 03-06 | `tuning` |
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

*As of 9 Oct 2026* (issue 385, spec 033): a changed tuning is the second
expensive edge after the inputs. The record keeps beside the layout the
tuning its run was asked with (`laidOutWith`), so, like `built`, it needs no
`drawn`; the two are compared as the engine would be sent them, a field at
LOOM's own number being no difference, and only once there is a layout. As
every source does, it marks the cells below cell 02 and not cell 02, which
says it in a sentence of its own, and Run all answers it with a layout run.

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

The colours, the default colour, the order, the theme and the map's sizes
raise **no source**. They redraw themselves as A4-01, A4-02, A4-03 and issue
350 built them, so their cell reads `running` while they do and `ready`
after - never `stale`. A size is a render of the stored layout like a colour:
`restyle` is the map call alone, for the day the map already showed, and the
style is written only once the map carries it.
ADR-045 says why: a control that disables itself under a person's hands
takes the focus with it, and a refused change is a lost one. Stale is for
the edits that cost a re-layout.

*As of 10 Oct 2026* (issue 391, spec 034): the looks, the two marker shapes, the
label typeface and the trains' dot size and trail are cheap edits of the same
kind as the map's sizes: they raise no source, redraw through `restyle` from the
stored layout, and are written only once the map carries them. The dot size and
the trail go to `map.build` beside `style` and not inside it.

*As of 10 Oct 2026* (issue 394, spec 036): a line's options - its name, hidden,
its width, a casing and a dash - are cheap edits of the colours' kind: they
raise no source, redraw through `redrawLines` from the stored layout as the
colours' kind of run (`recoloured`, so `cellOfRun` answers `lines`), and are
written only once the map carries them, with `drawn.lines` the options as
sent.

Their values are still kept in `drawn`, because a draw copies the record
whole; Revert reads only the day (A5.5-12, below). `drawnMatchesEdits`
answers whether the record's colours and order are the ones the map
carries, for a summary, without being a state. For a record this build
wrote the answer is always yes - the store writes the two together with
`drawn` - so a no means the file was changed by something else. Two things
a caller has to know about that answer:

- **The theme is not in it**, although `drawn` carries one. See below.
- **The order is compared as a value.** An empty order and one naming every
  line in the engine's own alphabetical order draw the same map, and this
  says they differ, because the lines a layout carries are not in the
  record and a pure module cannot tell. A5.5-18 has the line list and can:
  `isAlphabetical` in `src/renderer/src/order.ts` is the same question
  asked where the answer exists.

## Revert

A5.5-12 asked for a Revert on three cells - the day for 03, the theme for
04, the colours and the order for 05 - each writing back what `drawn` holds.
Only cell 03's exists, because only cell 03's has anything to go back to:

- **Cell 03, the day.** `setDate` writes a chosen day at once and draws
  nothing (A5.5-15), so `date` and `drawn.date` differ for as long as a
  person leaves them apart. While they do, and `drawn.date` is a day the
  stored window still covers, the service day's form offers "Revert to
  `<drawn.date>`". The window matters because a later layout keeps the
  day and replaces the window without comparing them, so a map can be
  drawn for a day `setDate` would refuse; a Revert to it would fail on
  every press, so none is offered. A refused Revert puts the control
  back to the record's day. It is
  `projects.setDate` with that day: one write, no engine request, no job,
  and the cells below read `ready` again because the two days agree, not
  because anything ran. Focus goes to the date control, which now holds
  the day, before the write takes the button away.
- **Cell 05, the colours and the order: none.** They are written by
  `completeColors` and `completeOrder` only once the map carries them, and
  `drawn` takes them from what the redraw sent in the same write, which the
  store refuses unless it is the choice being written (spec 037), so a
  record this build wrote never holds colours or an order the map does
  not. A redraw
  that stops puts the panel's own swatches and rows back to the record's
  already (A4-01, A4-02). A Revert here could only ever appear over a file
  edited by hand.
- **Cell 04, the theme: none.** The map always carries `record.theme`
  (below); `drawn.theme` is the theme of the last draw, not of the screen.
  Going back to it would be the theme switch's other button under a second
  name, and would say the map had been showing something it had not.

The issue said Revert "appears only on a stale cell". The cell holding a
change is never the stale one - its source marks the cells below it - so
Revert sits on the cell that holds the undrawn day, which reads `ready`
with "not drawn yet" in its summary.

A record with `drawn: null` offers no Revert, rather than one to nothing.

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
- **A draw whose cancel came too late is not cancelled.** *As of 15 Oct
  2026* (issue 423, engine v0.18.0): a map call that answers a result has
  drawn the map, whoever cancelled, and one the cancel reached after its
  files were in place says so with `cancel_too_late`. The run takes it as
  the finished draw it is - `done`, the record and `drawn` written, the
  page loaded again, and, where the result carries `cancel_too_late`, the
  map said to be kept - so the cell reads **ready**
  over what was drawn rather than going back to what it was. Only the
  engine's cancelled error, which means nothing was written, stops a draw.
  A layout call that answers a result after a cancel has stored its
  layout; the run stops there, `cancelled`, and a re-layout's `replaced` is
  raised as before.
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
The service day was not: A3-04 wrote it only after the rebuild had drawn,
in the same write that set `drawn.date`, so `drawn.date` could never differ
from `date` and the `day` comparison above was unreachable by construction.

A5.5-15 settled it, the way this paragraph asked for: `projects.setDate`
writes the chosen day the moment it is chosen, as the theme is written when
it is pressed. It is a writer and not a draw - it does **not** call `drew`,
because `drawn` describes the map now on disk and only a draw may move it -
and it starts nothing. The gap it opens between `date` and `drawn.date` is
exactly the `day` source, and "Draw for this day" in cell 03 is the one
press that closes it. `completeRebuild` still writes the day as well, so a
rebuild whose choice never landed still ends with the two agreeing.

Both writers refuse the same days for the same reasons, in the same
sentence (`serviceDayRefusal` in `src/shared/project.ts`): a real calendar
day, a project that has been laid out, and the day inside the window the
engine answered. A day that could be chosen but never drawn would be a
project stuck stale.

**Everything that describes the map now on disk must read `drawnDate`, not
`date`.** This is the cost of the gap, and it is not optional: `date` is a
choice and `drawn.date` is the picture, and anything that confuses them
describes the picture with a day the picture does not have in it. Four
callers were changed with A5.5-15 and a fifth would be a defect:

- the export's plan, its `service_date` provenance and the export preview
  (`src/main/export.ts`, `ExportTab.tsx`). The capture navigates to the page
  the last draw wrote, and **stale never blocks an export**, so a person can
  choose a day and export without drawing it. Read `date` there and the
  frames are of one day while the beats, the clock and the sidecar beside
  the file are another's.
- cell 02's "Drawn from layout … for `<day>`" (`LayoutRun.tsx`), which would
  otherwise contradict cell 03's own sentence one cell below it.
- a recolour and a reorder (`layoutRun.ts`), which draw the map that is
  there and must not quietly draw a day nobody asked for.

And the completion of a cheap edit must **not** move `drawn.date`. Since
spec 037 every draw's `drawn` is made from what it sent, and a redraw sends
the day the map already shows (`drawnDate`), which the store refuses it
unless it is: dragging a colour would otherwise close cell 03's gap with
nobody pressing "Draw for this day", or - with a `setDate` landing between
the press and the write - stamp the newly chosen day on a picture drawn for
the old one, which is the one direction of error that matters, since
`drawn` is what everything else trusts. A layout run's `drawn.date` is the
run's own day for the same reason, never a day written while it went.

**`drawn.theme` describes the last draw, not what is on screen.** A theme
is taken through the page's seam, which restyles it in place at the press
(A4-03, issue 349; a page from before engine v0.11.0 is loaded again at an
address carrying it, which since issue 465 is the fallback - see below),
with no draw at all, so the map on screen always
carries `record.theme` while `drawn.theme` holds the theme of the last
draw. It is exempt from staleness either way, and it is deliberately not in
`drawnMatchesEdits`, which would otherwise answer "the map does not show
it" about the one field of which that is never true. It is also why cell 04
has no Revert (above).

*As of 24 Oct 2026* (issue 465): **opening a project whose page lacks a
seam the pinned engine's page has starts cell 03's rebuild with no press.**
It is the rebuild for the day the record holds and the map already shows,
from the stored layout, so it raises no source: cell 03 reads `running`
while it goes and `ready` after, and where it fails it is cell 03's own
failure, `error` in cell 03 and `upstream` below it, like any rebuild that
failed. It is started through Run all (`notebook/olderPage.ts`), so its day
is the record's once the writes on their way have landed, and where that
record asks for nothing it withdraws: no job ends, and nothing is drawn or
written, though for the round trip of the write it waited on cell 03 reads
`running` and the job is listed. It is not started
where the record has no `drawn`, holds a day not yet drawn, names a layout
or a `made` the map was not drawn from, or is read-only. Where it does not
run - the engine away, for one - the reload with the theme in the address,
above, is the fallback, and so is the trip's old-page sentence.

*As of 25 Oct 2026* (issue 517): **where that redraw fails, cell 03 says so
in words of its own**, since the person pressed nothing: first in the cell,
as an error, "This map was drawn by an older version of the engine and could
not be redrawn as the project opened." with the engine's reason after it, as
the jobs inspector spells it and closed with a full stop, then "The map on
screen stays as it was." and, for what the page lacks and nothing else, "It
cannot change its theme where it stands, so choosing a theme loads the map
again in that theme." (no `setTheme`) and "It cannot show a trip until the
map is drawn again." (no `setTrip`) - the condition and not a remedy, since
what would draw it again is the reason's to say. A page lacking only the
opening's two seams takes a theme and a trip like any other, and is told
neither. Cell 02's run panel says "The map was not redrawn as the project
opened; cell 03 says why." in place of the rebuild's stopped sentence. Every
other failed rebuild of cell 03's own - a Run all after it, "Draw for this
day", the same failure met again once the screen was left - is said in cell
03 too, plainly: "The rebuild for `<day>` did not finish." and the reason. A
rebuild whose map was drawn and whose record then would not keep it
(`unkept`) says nothing in cell 03: neither sentence is true of a map that
was drawn, and cell 02's own sentence for it is. The state is unchanged -
`error` in cell 03, `upstream` below it, the job listed as failed, and the
header's alert "03 Frame and service day failed." the one announcement, so
the cell's words are not a live region. Which failure is the opening's is
derived, not stored: the screen keeps the id of the job its redraw started,
and the opening's words are said only while the run's latest attempt is that
job, failed, as cell 03's run (`frameFailure` in `notebook/olderPage.ts`).
The fallback after a failure is the fallback above, unchanged.

**Neither `made` nor `layout` has a live path to divergence yet, and
`replaced` does not survive.** All three are worth stating together,
because a reader will otherwise assume one of them is live:

- `drawn.layout` and `drawn.made` are written by `drew`, which is called
  only by the six handlers that end a draw, from what the draw sent; and
  `layout` and `made` are written only by `completeLayout`, which calls
  `drew` in the same breath, after the map has been drawn, and refuses a
  sent set of another layout or time than it writes. The other five refuse
  a set that is not of the stored layout and its `made` (spec 037). So
  nothing in the app as it stands can move one without the other. The comparisons are implemented and tested from a record, and
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
  that made it. Since engine v0.18.0 a re-layout whose cancel reached
  `graph.build` after the new set was moved in is one of these as well:
  the call answers its result with `cancel_too_late`, and the run stops
  with `replaced` raised, saying the next run draws from the layout.
