# ADR-045: The project screen is a notebook of six cells

- **Status:** Accepted
- **Date:** 2026-09-22
- **Supersedes:** ADR-036, in part (the left rail's deferral)
- **Superseded by:** none

## Context

The project screen grew a panel at a time, in the order the phases ran. It
is one column: the project's fields, then Inspect (A2-02), then the layout
run (A3-01), then a two-tab strip (A5-01) whose Map tab holds diagnostics,
the service day, line colours, line order, the theme switch and the
geographic view, and whose Export tab holds the export, with the viewer's
frame below both and rename and delete at the foot. Every panel arrived
with a reason and none of them is wrong. What is missing is the sentence
the screen ought to say: that a map is made in steps, that each step has a
state, and that changing an early step invalidates the later ones.

A person cannot see that today. Nothing says which panels have run, which
are waiting on something, or which are describing a map that no longer
matches the controls above them. The one case the app does report - the
mode or agency differing from what the stored layout was built with - is a
sentence inside one panel (A2-02), not a property of the screen.

Draft 4 of the wireframes answers it with a notebook: six numbered cells,
read top to bottom, each with a state, a one-line summary when it is
collapsed and, where it has any, its provenance; a rail beside them
carrying the same six numbers and what the project has produced; a header
saying what the notebook as a whole is doing; and the map staying on screen
while the cells below it are edited.

Three things had to be settled before any of it could be built.

**The left rail was deliberately absent.** ADR-036 deferred it and
`docs/DESIGN.md` section 9 records it in a table. That deferral was right
for the jobs inspector, which spans projects and therefore belongs to the
window; it is not an argument against a rail that belongs to one project.

**Nothing in the wireframes needs the engine to change.** An audit at the
pinned v0.8.3 found the eight stages already reported, the engine log
already reaching the renderer, and the scrub, Play day and speed already on
the page's own seam and already driven from the main process. It also found
the opposite in one place: `render.Style` exists with line width, station
and interchange radii and label size, but `serve.py` never constructs one,
which is why the app's `ProjectStyle` has been stored and validated since
A1-05 and never sent anywhere. Everything the wireframes ask for beyond
that - layout tuning, a partial layout while solving, frame crop and
rotate, style presets, per-line width and dashes, authored storyboard
beats - is engine work.

**The app already auto-redraws.** A4-01 and A4-02 debounce a colour or an
order change into a rebuild, and section 8.2 says why: a control that
disables itself under a person's hands takes the focus with it, and a
refused change is a lost one. The wireframes say instead that nothing
recomputes by itself. Taken whole, that reverses a rule that was paid for.

## Options

**(a) Restyle inside the tabs.** Keep the screen's shape, give the panels
the new vocabulary. Cheap, and it leaves the thing the wireframes exist to
fix - that the order of the work is invisible - exactly as it is.

**(b) A notebook of six cells.** The screen says what the pipeline is. Each
panel keeps its behaviour and gains a state, a summary and a place in an
order. It costs a shell, a rail, a state model and a port of a large
end-to-end suite.

**(c) A wizard.** One step on screen at a time. It reads the order most
clearly of all, and it is wrong for this app: a person returns to a
finished project to change one colour, and a wizard makes them walk to it.
It would also hide the map, which is the thing being made.

**(d) Ship v0.1.0 on the current screen and rebuild after.** The release is
close: `v0.1.0-rc.4` is published and passes the automated gate. But the
release's own documents - the acceptance checklist, the stranger's run, the
screen-reader walkthrough - quote the app's sentences and control names, so
shipping first means writing all three against a screen we intend to
replace, then writing them again.

## Decision

**The project screen becomes a notebook of six cells** - 01 Data, 02
Process, 03 Frame and service day, 04 Style, 05 Lines, 06 Export - in one
scrolling column, always in the document, never hidden by the rail or by a
step control. The numbering is fixed: it is in the rail, the stepper, the
issue codes and every screenshot, so a cell that is thin stays a cell
rather than being renumbered away.

**A cell has a state**: ready, running, stale or error, said as an icon and
a word and never as a colour alone, and never in one of the four brand
lines, which are identity rather than status (ADR-044).

**Editing an upstream cell marks the cells below it stale and starts
nothing.** The old result stays on screen with its controls live, because a
stale map is not a wrong map - it is a map of something a person has since
changed their mind about. The exception is the cheap edits: colours, order
and theme keep redrawing themselves as A4-01, A4-02 and A4-03 built them,
and their cell reads running while they do. Stale is for the edits that
cost a re-layout - the mode and the agency now, layout parameters when the
engine can take them.

**The rail is the project's and the inspector is the window's**, and they
coexist. ADR-036's reasoning stands for the inspector and is not an
argument against a rail whose contents - the six steps and what this
project has produced - belong to one project. This supersedes that record's
deferral of the rail and nothing else in it.

**v0.1.0 waits for this work**, and the release documents are written once,
at the end, against the interface that ships.

**The app is built over what the engine answers today.** A control that
needs engine work is not drawn at all - not drawn disabled - and the cell
says in a sentence what it will hold. A control with nowhere to send its
value teaches a person a lie.

**One spec, not twenty-two.** `specs/028-the-notebook` carries this record's
consequences, the design rules and the run graph; the cell issues cite it
rather than each restating the same transitions. This is a deliberate
exception to one issue, one spec, recorded here rather than in a pull
request, and it does not extend to the front door's issues.

## Consequences

**The record gains one field and no version.** `drawn` holds what the page
on screen was drawn from - the layout and when it was made, the day, the
colours, the default colour, the order and the theme - written by the four
handlers that already write the record at the end of a draw. Staleness is
then a comparison of the record against itself, with no events and no dirty
flags. `RECORD_VERSION` does not move: the field is additive, a bump would
make every existing project read-only in any older build, and a record
without `drawn` means only that we cannot prove its map is current, which
reads as ready. It carries `made` and not only the layout id because two
projects can draw from one layout set and either can re-lay it out under
the other, which is what A3-06 added `relaid` for.

**The end-to-end suite is the largest cost, and it is not optional.** It is
7,780 lines across 22 files, nearly all keyed to the tab strip. One helper
module goes in first so that a later branch changes one file rather than
twenty, and each cell's issue carries its own port rather than leaving a
cleanup at the end.

**One branch cannot be split.** The tabs and the scrolling column cannot
both own the page for a commit, so the shell arrives in a single pull
request holding today's panels verbatim, and the six cells are then worked
one branch each, several at once.

**The viewer's frame must never be reparented.** Moving an iframe between
parents reloads it, as does changing its address, and a reload loses the
page's clock, view and scrub position - which the scrub in cell 03 makes
visible for the first time. The preview is pinned with CSS alone, from the
top of the notebook rather than at a scroll threshold, and the frame is
held by identity across scrolls, cell toggles and redraws.

**This displaces the release work rather than cancelling it.** #140 closes,
carving out the progress line, which cell 02 and the rail's stepper both
draw from; #115 to #118, the runs against `v0.1.0-rc.4`, close as
superseded, since the control names they list will not exist; #37 and #40
keep their issues and take their bodies from the rewritten documents; #39
waits for screenshots. #38, the signing gate, is unaffected and can run
alongside, because it has an external clock and touches no interface.

**Ten engine issues are filed and none of them blocks.** The cheapest with
the largest effect is a style object on `map.build`, which would make the
app's own `ProjectStyle` real; then inline storyboard beats, which unlock
per-beat durations, a window and a speed together; then emitting each
finished stage's graph, which is what a layout drawn as it solves needs.

**Two things in the wireframes are deliberately not built.** Sample cities
are fetched when one is first opened rather than shipped inside the
installer: a stored layout is found by the hash of its inputs and its LOOM
build, so a shipped layout would be invalidated by every pin bump and could
not be regenerated identically on macOS (ADR-023). And a shareable project
file waits, because a project's record is meaningless without its layout,
its output folder and its feed.
