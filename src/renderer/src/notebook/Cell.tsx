import type { JSX, ReactNode } from 'react'
import Icon, { type IconName } from '../icons/Icon'
import Disclosure from '../kit/Disclosure'
import type { CellState } from '../runGraph'

// One cell of the notebook (ADR-045, docs/DESIGN.md 8.2, "The cell").
//
// It knows nothing about a project: a number, a name, a state, a sentence
// to show while it is collapsed, its controls, and an optional footer. The
// six adapters that fill it own everything project-shaped, so a branch
// adding a control to cell 03 edits its adapter and not this file.
//
// The heading row is the toggle. Its accessible name carries the number,
// the name and the state as one sentence, because a screen reader reaching
// the row should learn what a person sees in it without moving on; the
// state's word is in the row for everyone else, never its colour alone.
//
// Collapsed, the controls stay in the document. `LineColours` holds a
// debounced edit in flight and `ExportTab` a half-typed filename tag; a
// cell that unmounted them would lose a person's work for the sake of a
// closed disclosure. Which cells are open is where a person is looking,
// not a setting, and is not stored - the same rule the tab strip follows.

/** What each state says and how it is drawn. */
const STATES: Record<CellState, { word: string; icon: IconName }> = {
  ready: { word: 'ready', icon: 'check' },
  running: { word: 'running', icon: 'spinner' },
  stale: { word: 'not drawn yet', icon: 'info' },
  error: { word: 'failed', icon: 'warning' },
}

/** The state as a person reads it, for the row and for the row's name. */
export const stateWord = (state: CellState): string => STATES[state].word

/** `01` to `06`, as the rail and every screenshot write it. */
export const cellNumber = (number: number): string => String(number).padStart(2, '0')

/**
 * What assistive technology hears when it reaches the row: the number, the
 * name, the state, and the summary if there is one. One sentence, in the
 * order the row draws them.
 */
export function cellLabel(
  number: number,
  name: string,
  state: CellState,
  summary: string | null,
): string {
  const head = `${cellNumber(number)} ${name}, ${stateWord(state)}`
  return summary === null || summary === '' ? head : `${head}. ${summary}`
}

export interface CellProps {
  number: number
  name: string
  state: CellState
  /**
   * One sentence saying what the cell holds, shown while it is collapsed.
   * Null until the cell that owns it writes one: a cell with nothing true
   * to say says nothing rather than something empty.
   */
  summary?: string | null
  open: boolean
  onToggle: (open: boolean) => void
  /** Provenance, for the three cells that have any (A5.5-11). */
  footer?: ReactNode
  headingRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}

export default function Cell({
  number,
  name,
  state,
  summary = null,
  open,
  onToggle,
  footer,
  headingRef,
  children,
}: CellProps): JSX.Element {
  const { word, icon } = STATES[state]
  return (
    <section className="cell" data-state={state} data-cell={cellNumber(number)}>
      <Disclosure
        className="cell-head"
        open={open}
        onToggle={onToggle}
        label={cellLabel(number, name, state, summary)}
        regionLabel={`${cellNumber(number)} ${name}`}
        headingRef={headingRef}
        summary={
          <>
            <span className="cell-number">{cellNumber(number)}</span>
            <span className="cell-name">{name}</span>
            <span className="cell-state">
              <Icon name={icon} size={16} />
              {word}
            </span>
            {!open && summary !== null && summary !== '' && (
              <span className="cell-summary">{summary}</span>
            )}
          </>
        }
      >
        <div className="cell-body">{children}</div>
        {footer !== undefined && <div className="cell-footer">{footer}</div>}
      </Disclosure>
    </section>
  )
}
