# ADR-046: The map moves into the notebook's flow, and the export gets a preview of its own

- **Status:** Proposed
- **Date:** 2026-10-01
- **Supersedes:** ADR-045, in part (the map pinned under the header, and the
  one frame per project that follows from it)
- **Superseded by:** none

## Context

ADR-045 pinned the map under the header, half the window tall, and let the
six cells scroll behind it. Its reason was that cells 03 to 05 act on the
map - the transport drives its clock, the theme navigates it, colours and
order redraw it - and a person ought to edit them with it in view. It was
pinned from the top of the column rather than at a scroll threshold
because a threshold needs hysteresis and a reduced-motion answer, and
because the frame cannot be reparented: moving an iframe, or changing its
address, reloads the page and loses its clock, view and scrub position.

The pin has a cost that grew with use. A band half the window tall means a
person editing cell 05 with a dozen lines open reads it through the lower
half of the window. And anything the browser scrolls to the top of the
scrollport can land behind the band: a control reached with Shift+Tab
(#213, whose obvious remedy was measured and withdrawn because it moved
the colour picker's square behind the band), and a cell a rail step lands
on, which fails intermittently in CI by a fixed figure (#240). Both are
recorded gaps, not defects with a fix, because the band is what makes
them. WCAG 2.2 names this class of defect: a sticky or floating element that
covers a control that has focus is the typical way "focus not obscured"
fails.

The one-frame rule has a cost too. The main process finds the viewer's
frame by the project's address prefix and holds one (`src/main/viewer.ts`),
so cell 06's export preview is the same frame navigated to the address
the export planned, with the safe zones, and navigated back when the cell
closes. That navigation is what the viewer's restore logic exists to
survive, and a class change on the frame's shape in the same commit as the
navigation is what produced issue 222.

On 30 Sep 2026 the maintainer reviewed the release candidate and said the
preview floats above the notebook and blocks it, and that previews should
be integrated where they make sense: after the data is processed, and
again for the export.

Two facts make a map that is scrolled out of view bearable. Chromium stops
a cross-origin frame's animation while it is out of view, and the engine's
page advances its clock by wall time capped at a quarter second per frame,
so a map scrolled away pauses and resumes without a jump.

## Options

**(a) Keep the band.** Nothing to build, and the two recorded gaps stay.
Cells 03 to 05 are always edited with the map in view, which is what the
pin was for.

**(b) Pin only while cells 03 to 05 are on screen.** The threshold pin
ADR-045 refused. It keeps the map in view where it matters, and it brings
back hysteresis, a reduced-motion answer, a test that depends on scroll
timing, and a band that blocks the same controls while it is there.

**(c) A "keep the map in view" toggle.** It leaves the choice to the
person. It also leaves two layouts to build and test, and the two gaps
reachable in whichever one is pinned.

**(d) Two columns at wide windows**, the map beside the cells. It keeps the
map in view without covering anything. It is the largest change to the
notebook, and the wide column (#277) is only now arriving.

**(e) The map in the column where it is made**, as a block between cell 02,
whose layout it is drawn from, and cell 03, scrolling with everything else,
and a preview of its own inside cell 06.

Within (e) there are two ways to give cell 06 its preview. **One frame,
navigated** to the planned address and back, as today: the cheapest, and
the one that costs a restore and issue 222's class of failure. **Two
frames**: the map's frame never goes to another address, so it keeps its
clock with no restore, and cell 06 mounts a frame of its own while it is
open.

## Decision

**The map is a block in the notebook's flow, after cell 02 and before cell
03, as wide as the column and scrolling with everything else. Nothing is
pinned.** Its height is bounded at a fraction of the viewport, with the
aspect ratio giving way as the band's did, and the fraction is measured and
not declared. The band is not kept as an option.

**Cell 06 holds a preview of its own**, inside the cell, at the address the
export planned and with the safe zones where the preset has them. It is a
second frame, mounted only while cell 06 is open: it is the engine's plan
at a pinned time, has no clock worth keeping, and is disposable. Opening
cell 06 no longer takes the map's frame and closing it no longer gives it
back. Both frames carry `sandbox="allow-scripts"` and nothing else
(ADR-028).

**The main process holds two frames per window, keyed by role** - `map` and
`export` - matched once, at attach, by the project's address prefix and by
the query, never at the moment of use: an address with `safe=1` is the
export's, the app's own `controls=1` is the map's, and a planned address
with neither (a preset without safe zones) reads as the export's. A frame
belongs to the role it was first held in, so a map page that sends itself
to an address without `controls=1` is never adopted as the export's. The
renderer's four callers that drive the page name `map`; the export frame is
asked only the load probe. The capture is untouched: it has its own
offscreen window.

**On a project that has a layout, cells 01 and 02 start collapsed**, so the
map is the first tall thing on screen when it opens; on a project with no
layout they start open. Which cells start open becomes a function of the
record and not a constant.

**"Skip past the map" stays**, because the engine's page still puts about
forty controls in the Tab order, and its target moves from the project's
footer to cell 03's heading, which takes focus by `tabindex="-1"` as the
other cell headings do. It is the heading and not the cell's first control
because the heading exists whether the cell is open or not. Whether the
export frame takes focus is measured with a Tab walk, and cell 06 gets a
"Skip past the preview" of its own only if the frame takes five or more
stops; the threshold is a judgement, recorded so it is not rediscovered.

**Where there is no map yet, the block is still there**, at a reduced
height, holding a sentence and a link to cell 02 inside an always-present
status container, so that the map's arrival inserts nothing above what is on
screen without room reserved for it and is announced politely. There is no
second Run button.

**A read-only project gets the map block and not cell 06's preview.** Viewing
is not editing, and the export preview promises an export that cannot happen.
One plain sentence says why the project is read-only; a control that stays
visible but unavailable is `aria-disabled` with its reason in its accessible
description.

**The block's height is an explicit bound** (48svh, floored at about 240px)
with a definite width, set by the measurement under Consequences, and **cell 06's preview is fit-scaled** into a box of about the
smaller of 60svh and 640px, centred, outlined and captioned with its ratio
and size. **A running cell does not open itself**, move focus or scroll: its
row shows the state and what it is doing, and a failure is said in the row
and the header without opening the cell.

## Consequences

**A person editing cell 05 recolours a map that is above the fold** and
scrolls up to see the result. That is the cost of the decision and it is
accepted: the pause and resume described above make it a scroll and not a
loss. It is to be revisited on a person's complaint rather than on a
forecast. In an 800px window with cells 01 and 02 collapsed the map is
about 400px tall and cell 05's first rows sit near the fold.

**The bound is on the height, with the width definite.** This repository
once shrank the map to 546px wide where it had been 1024 by setting a
`max-height` against an `aspect-ratio` on an element whose width was
automatic. The CSS specification's note says a definite width is unaffected,
which is why the width is definite here, but the claim is tested in the built
app and not trusted. The numbers (70svh, 240px, 60svh, 640px) are judgements
and are replaced by what is measured. Viewport units `vh`, `svh` and `dvh` are
identical in desktop Chromium.

**Two live pages while cell 06 is open: measured, 1 Oct 2026**, at 1280x720
with the engine's real page, CPU over four seconds, two runs. With cell 06
closed and the map in view the renderer used 3.7% CPU and 402 to 415 MB;
with the map scrolled out of view, 0.1 to 0.3% and 382 to 406 MB; with cell
06 open and the map in view, 4.7 to 4.8% and 403 to 409 MB; with its preview
in view and the map away, 4.0 to 4.1% and 404 to 410 MB. Total memory was
about 742 to 754 MB in every state. The two frames share one renderer
process, and Chromium already stops the map while it is out of view, so the
intersection observer described earlier was not added.

**The height was measured, and 70svh was wrong.** The 307px of header and
collapsed rows above the map (331px at 640 wide) is what limits it. With
cells 01 and 02 collapsed, the strip of cell 03 that shows with no scrolling
at 640x480 is 0 (the map is at its 240px floor); 800x600, 0 (288px high);
1024x640, 14px (307px); 1280x720, 55px (346px, 0.48 of the window); 1440x900,
149px (432px); and 700x900, 241px (340px, where the 16:9 ratio binds, not the
cap). At 70svh the 1280x720 strip is 0 (504px high); at 60svh, 0 (432px). With
cell 01 open the map is 1542 to 1798px down at every size, so no strip.
48svh leaves the text line of cell 03's heading in view at 720 tall, though
not its whole 64px row, which 46svh would. 1920x1080 and 2560x1080 could not
be made on the display used, and a very wide and a very tall feed could not be
made with the stand-in, though the block's box does not depend on the feed.

**The export's frame takes no Tab stop**: 0 with the real planned page,
where the map's own page takes 4, so cell 06 gets no "Skip past the preview".

**A failure is not yet said assertively.** The header's status line is a
polite status region, so the row and the line say a failure and the line does
not interrupt; specification 029's FR-017 asks for more and is marked for a
decision.

**What the band hid, recorded as history from the deleted write-up.** With
`scroll-margin-top` the colour picker's square moved 139px up, to 381, where
the band ended at 398. At 1024 wide the map was 546 wide under `max-height`
against `aspect-ratio`, where its box had been 1024. The band's clearance was
204px at 480 tall, 324 at 720 and 364 at 800, against 140px below cell 06.

**Issues 213 and 240 stop being reachable** and close, and their write-up
of what the band hides moves here as history. The band's rules, the
half-window bound, the rail scroll's clearance for the band (the header
alone remains) and the class that gave the map's shape a second form all
go. The wide column's retirement of the map's breakout is #277's.

**One frame per project is no longer true**, and `src/main/viewer.ts`, its
shared types, the preload and its handler change to carry a role. The
frame's identity across scrolls, cell toggles and redraws is still the
rule for the map: it is never reparented and never sent to a planned
address. Engine issue 29, which describes the reload, is unchanged.

**The end-to-end suite changes where it assumed a band.** The preview and
rail specs, the accessibility walk over two frames, the viewer's hostile
page and drive over both, and the unit tests for the viewer's roles move;
each new test is watched failing under a mutation (the band put back; the
export frame attached as the map).

**ADR-045 keeps its status and gains this record's name** against the
decision it replaces. Its other decisions - the six cells, the states, the
rail, the run graph - stand. The export tab's spec has a requirement that
says the map's frame is the export's preview while cell 06 is open; it is
amended by the spec that carries this change.
