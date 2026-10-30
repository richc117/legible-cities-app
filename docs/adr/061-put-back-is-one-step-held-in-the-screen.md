# ADR-061: Put back is one step, held in the screen

- **Status:** Accepted
- **Date:** 2026-10-29
- **Decided by:** the maintainer, 29 Oct 2026, through the decided approach
  on issue 561
- **Supersedes:** none
- **Superseded by:** none
- **Amends:** issue 164 (A5.5-12, Revert), whose "No undo stack, and no
  history" said that one step back is offered only to a state the map on
  screen agrees with, and only on a stale cell. Put back keeps the first
  half and drops the second: it is one step, to values the map on screen
  was drawn from, on cells that are never stale. That issue's Revert on
  cell 03 stands as written.

## Context

Three resets write at once, with no confirmation:

- **Reset every line**, cell 05's line colours (`LineColours.tsx`).
- **Reset to the engine's sizes**, cell 04's sizes with their looks,
  markers, label face and trains (`StyleFields.tsx`).
- **Reset to LOOM's defaults**, cell 02's layout tuning
  (`LayoutTuning.tsx`).

Issue 164 decided "No undo stack, and no history": Revert writes back what
the record's `drawn` holds, the one state the map on screen is known to
agree with, and appears only while a cell is stale. The colours and the
sizes are cheap edits (ADR-045, spec 037): drawn from the stored layout at
once, written once the map carries them, and never stale. Once a reset is
drawn the record's `drawn` holds the reset values too, so the values before
it are gone from the record and from the screen, and the Revert that exists
never appears for them. A person's twenty line overrides went with one
press.

The tuning differs. It is not a cheap edit: it is written to the record the
moment it is committed and lays nothing out, so the record keeps
`laidOutWith`, the tuning the stored layout was asked with, beside the
layout (spec 033). What a reset of it clears can be read back from the
record for as long as the layout stands.

## Options

- **A one-step Put back beside each reset**, restoring the values from just
  before it until the next edit. Small to medium. For the colours and the
  sizes it needs a slot held somewhere, since nothing on the record keeps
  the values; for the tuning it needs nothing.
- **A confirmation before each reset.** Small, but it puts a dialog in
  front of a routine action, and frequent confirmations teach people to
  answer them without reading (Microsoft, Confirmations; NN/g, Confirmation
  dialogs).
- **Cmd+Z or Ctrl+Z undo over the record's edits.** Large: a history of
  every write, ordered against the record session (spec 037), and a second
  source of truth about what the map shows. Against issue 164 outright.

## Decision

Put back, one step, in two forms.

- **Cells 04 and 05: a slot held in the screen.** At the reset's press, the
  cheap edits' hook (`notebook/useCheapEdit.ts`) keeps the section's values
  as the record's own `drawn` holds them: provably what the map on screen
  was drawn from. Beside the disabled reset, **Put back your colours** or
  **Put back your sizes** restores them through the same cheap edit as any
  change: one redraw, and the record written once, when the map carries
  them. The slot is component memory, as a half-typed field is, and is
  never written to the record. It goes at the section's next edit, at the
  Put back itself, at a stop of the reset's own redraw (which leaves the
  record holding the values, so there is nothing to put back), and when
  the project screen closes. A record with nothing drawn keeps nothing.
- **Cell 02: derived, with nothing stored.** **Put back the tuning this
  layout was made with** writes `laidOutWith`. It is offered while the
  tuning shown differs from a `laidOutWith` that is itself tuned. It
  cannot recover a tuning that was never laid out, and a layout made with
  LOOM's defaults offers none, since Reset is already the way back to
  those.
- **Focus and words.** The reset disables itself, so it hands focus to Put
  back, the control that came (DESIGN.md 8.2's rule for a control that
  goes); Put back goes as it is pressed and hands focus back to the reset.
  A reset with nothing to put back hands focus to its heading, as before.
  Each section says one polite sentence while Put back is offered: "Every
  line is back to its feed's colour. Put back your colours to undo it.",
  "The sizes are back to the engine's own. Put back your sizes to undo
  it." and, while the tuning is LOOM's own, "The tuning is back to LOOM's
  defaults. Put back the tuning this layout was made with to undo it."

Put back is not a stale-cell action and not a Revert: Revert closes a gap
between the record and the map, and Put back reverses a step the map has
already drawn.

## Consequences

- **A reset can be taken back once, and only once.** There is still no
  stack and no history: a second edit, or a second reset, leaves only what
  that step replaced, and the slot never outlives the screen.
- **What is put back is what the map was drawn from**, never a value the
  screen held and the map did not: a change waiting on its delay when the
  reset is pressed is not what Put back restores.
- **The tuning's Put back says nothing about tunings never laid out.** A
  person who tuned, did not lay out, and reset has no way back but typing
  the numbers again. DESIGN.md 8.2 says so.
- **Three more polite lines**, one in each of the three sections, in the
  document before they have anything to say, as a live region must be.
- **To watch.** A fourth reset in a cheap edit takes `drawnOf` and `reset`
  from the hook and the same row of `cheap-edit.test.tsx`; a cheap edit
  that ever became stale would have Revert's question to answer as well,
  and the two must not both be offered for one step.
