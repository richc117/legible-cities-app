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
// The header is the only thing a cell can land behind (ADR-046). From
// A5.5-20 until then the map was pinned under the header as a band half the
// window tall, and this measured the band's foot as well, because a cell
// scrolled clear of the header alone landed behind it; the obvious
// `scroll-margin-top` remedy for the scrolls the browser performs was
// measured and withdrawn (issue 213). The map is a block in the column now
// and scrolls away with everything else, so the clearance is the header's
// foot and nothing more, and issues 213 and 240 are not reachable.
//
// It is still measured at the moment of the press rather than read from
// `--header-height`: how the header's height and its one-pixel rule divide
// between its box and its border is not something a stylesheet can say.

/**
 * What a scroll has to clear: the foot of the window's header, read in
 * viewport coordinates at the moment of the press. Nothing else is pinned.
 */
export function clearance(header: { bottom: number } | null): number {
  return header?.bottom ?? 0
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
 * header, which is the first one a person can actually read.
 *
 * It follows the scroll and never moves focus (DESIGN.md 8.2): it is what
 * `aria-current="step"` says, and a person reading down the notebook has
 * not asked to be moved anywhere.
 *
 * Falling back to the last cell, rather than to nothing, is what makes this
 * total: a function that answered nothing would take the mark off the rail
 * entirely. Whether the screen's own geometry ever reaches the fallback
 * depends on how much is below cell 06 against the window's height, which
 * is the footer and the panel's padding; while the map was a pinned band
 * it could not be reached (A5.5-21 measured that), and an end-to-end test
 * that asserts it as behaviour has to measure first.
 */
export function currentStepOf(cells: readonly CellBox[], clearTo: number): CellId | null {
  if (cells.length === 0) return null
  for (const cell of cells) if (cell.bottom > clearTo) return cell.id
  return cells[cells.length - 1].id
}
