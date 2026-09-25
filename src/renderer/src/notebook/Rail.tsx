import { useCallback, useEffect, useLayoutEffect, useState, type JSX } from 'react'
import Icon from '../icons/Icon'
import { CELL_LIST, type Cell, type CellId, type CellStatus } from '../runGraph'
import { cellNumber, stateIcon, stateWord } from './Cell'
import Outputs from './Outputs'
import { clearance, currentStepOf, scrollTargetFor, type CellBox } from './railScroll'

// The project's own left rail (ADR-045, docs/DESIGN.md 8.2, "The rail and
// its stepper" and "Outputs"): the six cells as a numbered stepper, and
// below them what the project has made.
//
// It is the project's and the inspector is the window's, and they are not
// one thing (ADR-036): the inspector lists jobs, which span projects, so
// merging the two would put another project's run inside this project's
// screen. It is inside the main region, which is what makes it `inert`
// while the inspector covers that region on a narrow window - the same
// attribute, already set by `App.tsx`, and not a second rule that could
// disagree with it.
//
// A `<nav>` with a name, not a tablist. The six cells stay in the document,
// every one of them, and a tablist would promise that they do not: a screen
// reader told "tab 3 of 6" expects the other five panels to be hidden, and
// a press here scrolls rather than swaps. It is an `<ol>` of buttons
// because the six are numbered and the numbers are fixed.
//
// `aria-current="step"` follows the scroll and never takes focus: a person
// reading down the notebook has not asked to be moved anywhere. Focus moves
// on a press only, and then to the cell's heading rather than to its
// toggle, because a reflexive Space or Enter after the press would
// otherwise collapse the cell it has just opened (`kit/Disclosure.tsx`).
//
// Where a press lands is `railScroll.ts`, and its comment is the one to
// read before touching this: the pinned band covers half the window, and
// the obvious `scroll-margin-top` remedy was measured and withdrawn.

interface Props {
  /** Each cell's state, derived once by the notebook and never twice. */
  states: Record<CellId, CellStatus>
  /** Which cells are open, so a press on an open step does not close it. */
  open: Record<CellId, boolean>
  onOpen: (cell: CellId) => void
}

/** The stepper's own accessible name. */
export const RAIL_LABEL = 'Steps'

/** A step's accessible name: its number, its name and its state, as one. */
export const stepName = (cell: Cell, state: CellStatus['state']): string =>
  `${cellNumber(cell.number)} ${cell.name}, ${stateWord(state)}`

/** A cell's own section in the notebook, by the number it carries. */
function cellElement(cell: Cell): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.cell[data-cell="${cellNumber(cell.number)}"]`)
}

/**
 * What a scroll has to clear, measured now: the pinned band's foot, or the
 * header's where the project has no map to pin.
 *
 * Measured and not declared. How the header's height and its rule divide
 * between its box and its border is not something a stylesheet can read
 * (`preview.css` says what that cost), and the band's own depth is half a
 * window whose size changes.
 */
function clearTo(): number {
  const band = document.querySelector('.preview')
  const header = document.querySelector('.app-header')
  return clearance(band?.getBoundingClientRect() ?? null, header?.getBoundingClientRect() ?? null)
}

/** Where the six cells are now, in the order they are read. */
function boxes(): CellBox[] {
  const found: CellBox[] = []
  for (const cell of CELL_LIST) {
    const element = cellElement(cell)
    if (element === null) continue
    const box = element.getBoundingClientRect()
    found.push({ id: cell.id, top: box.top, bottom: box.bottom })
  }
  return found
}

export default function Rail({ states, open, onOpen }: Props): JSX.Element {
  const [current, setCurrent] = useState<CellId | null>(null)
  // The step a press is waiting on. Its scroll is measured after the open
  // has been laid out and never before: an open cell is its own room to
  // scroll into, and a cell measured while it is still closed would be
  // scrolled against a box that is about to grow.
  const [pending, setPending] = useState<CellId | null>(null)

  const follow = useCallback((): void => setCurrent(currentStepOf(boxes(), clearTo())), [])

  // The current step follows the scroll, and the window's size, and nothing
  // else. Once a frame at most: a scroll event fires far more often than a
  // frame is painted, and six boxes are measured each time.
  useEffect(() => {
    let frame = 0
    const later = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        follow()
      })
    }
    follow()
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
    }
  }, [follow])

  // A layout effect, so it runs once the open has reached the DOM and
  // before the frame is painted. The press sets two pieces of state in one
  // React pass, so there is nothing to flush by hand.
  useLayoutEffect(() => {
    if (pending === null) return
    setPending(null)
    const cell = CELL_LIST.find((c) => c.id === pending)
    const element = cell === undefined ? null : cellElement(cell)
    if (element === null) return
    // Focus first, and with no scroll of its own, so the browser's idea of
    // where a focused element belongs does not fight the one below.
    element.querySelector<HTMLElement>('.disclosure-heading')?.focus({ preventScroll: true })
    window.scrollTo({
      top: scrollTargetFor(element.getBoundingClientRect(), clearTo(), window.scrollY),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
    follow()
  }, [pending, follow])

  return (
    <div className="rail">
      <nav className="rail-steps" aria-label={RAIL_LABEL}>
        <ol>
          {CELL_LIST.map((cell) => {
            const state = states[cell.id].state
            return (
              <li key={cell.id}>
                <button
                  type="button"
                  className="rail-step"
                  data-state={state}
                  // The three spans are the name a person reads; this is
                  // the same three with the punctuation a screen reader
                  // needs, and it holds at the narrow width, where two of
                  // them are hidden from the eye and not from the tree.
                  aria-label={stepName(cell, state)}
                  aria-current={current === cell.id ? 'step' : undefined}
                  onClick={() => {
                    if (!open[cell.id]) onOpen(cell.id)
                    setPending(cell.id)
                  }}
                >
                  <span className="rail-number">{cellNumber(cell.number)}</span>
                  <span className="rail-name">{cell.name}</span>
                  <span className="rail-state">
                    <Icon name={stateIcon(state)} />
                    {stateWord(state)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>
      <Outputs />
    </div>
  )
}
