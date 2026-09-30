import type { LineOrder } from '../../shared/project'
import type { Line } from './colours'

// The line order, with no React in it: which lines a project draws in which
// order, what a move does to that arrangement, and whether an arrangement
// is a change at all. The rule that logic lives in something callable
// without rendering is what makes these testable
// (.claude/rules/renderer.md), and the panel above them (LineOrder.tsx) is
// then only a screen.
//
// Nothing here draws anything. The engine stacks the lines on shared track
// and lists them in the page's rows, both from the one list the app sends
// as `line_order`; this arranges that list and says what it will look like.
//
// `arrange` is the app's copy of the engine's own `ordered_labels`: the
// named lines first, then everything else in the order it would have had
// anyway. Holding the same rule on both sides is what lets the panel show
// what the engine is about to draw, and what makes a partial or stale
// order safe (engine issue 28).

/**
 * The order the engine draws a project's lines in when it is told nothing:
 * the labels sorted, and sorted as Python's `sorted` sorts them rather than
 * as a person would write them. JavaScript compares UTF-16 code units where
 * Python compares code points, which differ only when one label starts
 * above the basic plane and another in the private-use range; no feed is
 * expected to do both, and the cost if one did is a row out of place in a
 * line the order does not name.
 *
 * `linesOf` sorts for a person instead, numerically, so it reads `2, 4, 10`
 * where the engine draws `10, 2, 4`. That is right for the Colours panel,
 * whose order is only a list, and wrong here, where the list is a claim
 * about what the map does.
 */
export function drawnFirst(lines: Line[]): Line[] {
  return [...lines].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/**
 * The lines in the order they are drawn: the ones the order names, in that
 * order, then the rest in the engine's own order. A label the order names
 * that the feed no longer offers is passed over, so an arrangement made
 * under a wider mode still reads.
 */
export function arrange(lines: Line[], order: LineOrder): Line[] {
  const byLabel = new Map(lines.map((line) => [line.label, line]))
  const named: Line[] = []
  const taken = new Set<string>()
  for (const label of order) {
    const line = byLabel.get(label)
    if (line === undefined || taken.has(label)) continue
    taken.add(label)
    named.push(line)
  }
  return [...named, ...drawnFirst(lines).filter((line) => !taken.has(line.label))]
}

/**
 * The whole arrangement after one line has moved one place, or the one
 * given back when it cannot move that way. It answers every label on
 * screen, not a change to the order stored, so the record always holds the
 * list a person was looking at.
 */
export function move(lines: Line[], order: LineOrder, label: string, by: -1 | 1): LineOrder {
  const arranged = arrange(lines, order).map((line) => line.label)
  const at = arranged.indexOf(label)
  const to = at + by
  if (at === -1 || to < 0 || to >= arranged.length) return order
  const moved = [...arranged]
  moved[at] = arranged[to]
  moved[to] = arranged[at]
  return moved
}

/**
 * The whole arrangement after one line has been put down at a place in the
 * list, as a drag puts it (issue 283): taken out from where it stood and
 * put in at `to`, every line between moving one place to close the gap.
 * `to` is a place in the list as it will read afterwards, and one past
 * either end is the end. An arrangement that comes out the engine's own is
 * no order at all, as a move undone by another press is; and a line put
 * down where it stood, or one the feed does not offer, gives the order
 * back, so a drop that went nowhere draws nothing.
 */
export function moveTo(lines: Line[], order: LineOrder, label: string, to: number): LineOrder {
  const arranged = arrange(lines, order).map((line) => line.label)
  const at = arranged.indexOf(label)
  const place = Math.min(Math.max(to, 0), arranged.length - 1)
  if (at === -1 || place === at) return order
  const moved = [...arranged]
  moved.splice(at, 1)
  moved.splice(place, 0, label)
  return isAlphabetical(lines, moved) ? alphabetical() : moved
}

/**
 * Where a row being dragged would be put down: the number of the other rows
 * that would stand above it. `middles` are every row's middle as the list
 * stood when the drag began, top to bottom and in any one unit; `from` is
 * the dragged row's place and `by` how far it has been moved since, down
 * being positive. A row has to be carried as far as the middle of its
 * neighbour before the two change places, so a hand that trembles on the
 * way does not flick the list back and forth; reaching a middle exactly
 * counts as passing it, whichever way the row is going, so a row carried
 * to the last row's middle is put down last.
 */
export function dropPlace(middles: readonly number[], from: number, by: number): number {
  const middle = middles[from] + by
  let place = 0
  middles.forEach((each, i) => {
    if (i < from ? each < middle : i > from && each <= middle) place += 1
  })
  return place
}

/**
 * Which way a row that is not being dragged stands aside while another is
 * carried from `from` to `to`: up one row's height (-1) when the dragged
 * row has passed it going down, down one (1) when it has passed it going
 * up, and not at all otherwise. What the list shows is then what a drop
 * would leave.
 */
export function standAside(index: number, from: number, to: number): -1 | 0 | 1 {
  if (index === from) return 0
  if (from < to && index > from && index <= to) return -1
  if (to < from && index >= to && index < from) return 1
  return 0
}

/** Two arrangements that draw the same map; nothing is redrawn for a move that is not one. */
export function sameOrder(a: LineOrder, b: LineOrder): boolean {
  return a.length === b.length && a.every((label, i) => label === b[i])
}

/**
 * Is this arrangement the one the engine would draw without being told? An
 * empty order is, and so is one that names the lines in the order they
 * already came: both would stack the map the same way, so there is nothing
 * to put back.
 */
export function isAlphabetical(lines: Line[], order: LineOrder): boolean {
  if (order.length === 0) return true
  const arranged = arrange(lines, order)
  const engine = drawnFirst(lines)
  return arranged.every((line, i) => line.label === engine[i]?.label)
}

/** Nothing arranged: the engine's own order, and no `line_order` in the request. */
export function alphabetical(): LineOrder {
  return []
}

/** Where a line stands, for a person and for a screen reader. */
export function positionWords(index: number, total: number): string {
  return `${index + 1} of ${total}`
}

/**
 * What a move should do at this moment: draw it, wait for the way to
 * clear, or nothing at all because it is not a change. `colours.ts` has the
 * same three answers for the same reason - a layout, a rebuild or an export
 * is reading the page a draw would rewrite, so a move made during one waits
 * rather than being refused (FR-009).
 */
export function nextStep(
  next: LineOrder,
  stored: LineOrder,
  busy: boolean,
): 'build' | 'wait' | 'none' {
  if (sameOrder(next, stored)) return 'none'
  return busy ? 'wait' : 'build'
}
