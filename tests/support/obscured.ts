// The verdict the backwards walk gives a focus stop (issue 536, WCAG 2.2 SC
// 2.4.11, Focus Not Obscured (Minimum)): no control that holds focus is
// wholly covered by a box that stays where it is while the page scrolls
// under it - the sticky header, a fixed region.
//
// Tabbing forwards never showed the defect the walk exists for. Moving down
// the page, the browser scrolls a control that is below the window to the
// window's foot; moving up, it scrolls one that is above the window to the
// window's top, which is under the header. Every sweep walked forwards.
//
// The probe in `a11y.ts` runs in the page and reports, at each stop, the
// control's box and the box of every sticky or fixed element that holds the
// topmost paint at the control's centre. This file is the verdict on those
// readings, kept apart so that it runs in Node, under a unit test that can
// be watched going red (`tests/unit/obscured.test.ts`).

/** A box in the window's coordinates, as `getBoundingClientRect` reports it. */
export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** A sticky or fixed element, by a name a reader of a failure can find. */
export interface Pinned {
  name: string
  rect: Rect
}

/** One focus stop of the backwards walk, as the page measured it. */
export interface StopCover {
  /** What the control is called, as the forward walk names it. */
  control: string
  rect: Rect
  /**
   * The pinned boxes that paint over the control's centre and are not
   * ancestors of it: a control inside the fixed rail is not covered by it.
   */
  over: Pinned[]
}

/** Half a pixel: a box laid out on a fraction of one still covers what it is laid over. */
const SLACK = 0.5

/** Whether `outer` holds every edge of `inner`. */
export function encloses(outer: Rect, inner: Rect): boolean {
  return (
    outer.left <= inner.left + SLACK &&
    outer.top <= inner.top + SLACK &&
    outer.right >= inner.right - SLACK &&
    outer.bottom >= inner.bottom - SLACK
  )
}

const figure = (n: number): number => Math.round(n)

/** A box as one phrase, for a message. */
export function boxWords(r: Rect): string {
  return `${figure(r.left)},${figure(r.top)} to ${figure(r.right)},${figure(r.bottom)}`
}

/**
 * The stops whose control is wholly under one pinned box, each as one line
 * naming the stop, where it was, and the box. A control with no area is not
 * judged: it has nothing to cover.
 */
export function coveredStops(stops: readonly StopCover[]): string[] {
  const found: string[] = []
  for (const stop of stops) {
    const { rect } = stop
    if (rect.right <= rect.left || rect.bottom <= rect.top) continue
    const over = stop.over.find((box) => encloses(box.rect, rect))
    if (over !== undefined)
      found.push(
        `${stop.control} at ${boxWords(rect)} is wholly under ${over.name} at ${boxWords(over.rect)}`,
      )
  }
  return found
}
