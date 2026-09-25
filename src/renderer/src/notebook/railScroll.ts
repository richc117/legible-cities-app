import type { CellId } from '../runGraph'

// Where the rail's steps scroll to, and which step the scroll is on
// (A5.5-21, docs/DESIGN.md 8.2, "The rail and its stepper").
//
// Pure arithmetic over boxes the caller measured, so the two decisions that
// matter can be held to a table in a unit test rather than to a running
// window: what a step's scroll has to clear, and which cell a scroll
// position counts as being at.
//
// ## Why this is computed and not declared
//
// The design row was written before A5.5-20 pinned the map. A cell scrolled
// clear of the header alone now lands *behind* the band, which covers half
// the window below the header.
//
// The one-line answer - a `scroll-margin-top` on the column's contents as
// deep as the band, or `scroll-padding-top` on the scrollport - was written
// in A5.5-20 and withdrawn, and the measurements are in `preview.css`
// beside where the rule would go and in issue 213. It moves where *every*
// scroll lands and not only the ones that would have been hidden, and the
// direction is not predictable from the rule: against the colour panel's
// geometry it moved the picker's square 139 pixels *up*, behind the band,
// so the press that begins a colour drag landed on the map and the picker
// was dismissed - issue 87's drag, reintroduced by the remedy.
//
// A scroll this rail performs itself, in answer to a press, needs none of
// that. It knows which box it is moving and it can measure where the band
// ends at that moment, so it computes one destination and moves nothing
// else. That is not a general fix for issue 213, which is about the scrolls
// the browser performs, and this does not close it.

/**
 * What a scroll has to clear: the foot of the pinned band, or the header's
 * where there is no band - a project with no layout draws no map.
 *
 * Both are read in viewport coordinates at the moment of the press. The
 * band is sticky under the header, so once it is stuck its foot does not
 * move as the page scrolls; before it is stuck, at the top of the document,
 * its foot is *lower* than it will be, so a scroll computed against it
 * overshoots rather than undershoots and the cell still lands in the clear.
 */
export function clearance(
  band: { bottom: number } | null,
  header: { bottom: number } | null,
): number {
  return Math.max(header?.bottom ?? 0, band?.bottom ?? 0)
}

/**
 * Where the window is scrolled so that a box's top lands at `clearTo`.
 *
 * Never above the document's own top. Where the document is too short below
 * the box for it to reach the mark, the browser clamps and the box lands as
 * high as it can - which is why a step opens its cell before it measures
 * it: an open cell is its own room to scroll into.
 */
export function scrollTargetFor(box: { top: number }, clearTo: number, scrollY: number): number {
  return Math.max(0, scrollY + box.top - clearTo)
}

/** A cell as the rail measures it: which one, and where its box is now. */
export interface CellBox {
  id: CellId
  top: number
  bottom: number
}

/**
 * Which step the scroll is on: the first cell with any of itself below the
 * band, which is the first one a person can actually read. Past the last
 * cell's foot - the end of a long document - it stays the last, rather than
 * going blank where there is nothing further down to be on.
 *
 * It follows the scroll and never moves focus (DESIGN.md 8.2): it is what
 * `aria-current="step"` says, and a person reading down the notebook has
 * not asked to be moved anywhere.
 */
export function currentStepOf(cells: readonly CellBox[], clearTo: number): CellId | null {
  if (cells.length === 0) return null
  for (const cell of cells) if (cell.bottom > clearTo) return cell.id
  return cells[cells.length - 1].id
}
