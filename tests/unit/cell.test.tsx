// The cell's chrome (A5.5-05, DESIGN.md 8.2): its heading row is the
// toggle, its state is an icon and a word, its controls stay in the
// document when it is collapsed, and its footer is absent unless a cell
// has provenance to show.
//
// Rendered to static markup, as the progress line's test is: what is
// asserted is what the component draws, not what a browser then does with
// it. The keyboard path is `tests/e2e/notebook.spec.ts`, which walks the
// sample page in the real app.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Cell, { cellLabel, cellNumber, stateWord } from '../../src/renderer/src/notebook/Cell'
import { CELL_LIST, type CellState } from '../../src/renderer/src/runGraph'

const STATES: CellState[] = ['ready', 'running', 'stale', 'error']

const draw = (props: Partial<Parameters<typeof Cell>[0]> = {}): string =>
  renderToStaticMarkup(
    <Cell
      number={3}
      name="Frame and service day"
      state="ready"
      open={false}
      onToggle={() => {}}
      {...props}
    >
      <p>the controls</p>
    </Cell>,
  )

describe('a cell', () => {
  it('is a button carrying aria-expanded over a region, not a details element', () => {
    const closed = draw()
    expect(closed).toContain('aria-expanded="false"')
    expect(closed).toContain('role="region"')
    expect(closed).not.toContain('<details')
    expect(closed).not.toContain('<summary')
    expect(draw({ open: true })).toContain('aria-expanded="true"')
  })

  it('keeps its controls in the document when it is collapsed', () => {
    // The rule that is not cosmetic: a half-typed value and a running
    // Cancel both live inside a cell, and unmounting loses them silently.
    expect(draw()).toContain('the controls')
    expect(draw()).toContain('hidden=""')
    expect(draw({ open: true })).toContain('the controls')
    expect(draw({ open: true })).not.toContain('hidden=""')
  })

  it('writes its number as two figures, as the rail and the stepper do', () => {
    expect(cellNumber(1)).toBe('01')
    expect(cellNumber(6)).toBe('06')
    for (const cell of CELL_LIST) expect(cellNumber(cell.number)).toMatch(/^0[1-6]$/)
  })

  it('says every state as a word, and draws an icon beside it', () => {
    const words = new Set<string>()
    for (const state of STATES) {
      const html = draw({ state })
      const word = stateWord(state)
      words.add(word)
      expect(html, `${state}: the word is in the row`).toContain(word)
      // The icon is a <span class="icon"> with the file's SVG inside it,
      // hidden from assistive technology: the word beside it is what is
      // read, and the icon is what is seen.
      expect(html, `${state}: an icon beside it`).toMatch(/<span class="icon"[^>]*aria-hidden/)
      expect(html, `${state}: the icon is not the only sign`).toContain('</svg>')
      expect(html, `${state}: the state is on the cell`).toContain(`data-state="${state}"`)
    }
    // Four states, four words: none is told apart by its colour alone.
    expect(words.size).toBe(STATES.length)
  })

  it('carries the number, the name and the state in the row’s accessible name', () => {
    for (const state of STATES) {
      const name = cellLabel(3, 'Frame and service day', state, null)
      expect(name).toBe(`03 Frame and service day, ${stateWord(state)}`)
      expect(draw({ state })).toContain(`aria-label="${name}"`)
    }
  })

  it('adds the summary to the name, and shows it only while collapsed', () => {
    const summary = 'Tuesday 17 March, the engine’s choice'
    expect(cellLabel(3, 'Frame and service day', 'ready', summary)).toBe(
      '03 Frame and service day, ready. ' + summary,
    )
    const closed = draw({ summary })
    expect(closed).toContain('cell-summary')
    // Open, the sentence would say what the controls below it already say.
    expect(draw({ summary, open: true })).not.toContain('cell-summary')
  })

  it('says nothing where a cell has no summary', () => {
    expect(draw({ summary: null })).not.toContain('cell-summary')
    expect(draw({ summary: '' })).not.toContain('cell-summary')
    expect(cellLabel(6, 'Export', 'ready', '')).toBe('06 Export, ready')
  })

  it('has no footer unless one is given', () => {
    expect(draw({ open: true })).not.toContain('cell-footer')
    expect(draw({ open: true, footer: <span>made 13 September</span> })).toContain('cell-footer')
  })

  it('draws every cell of the notebook in every state', () => {
    for (const cell of CELL_LIST) {
      for (const state of STATES) {
        const html = draw({ number: cell.number, name: cell.name, state })
        expect(html).toContain(cell.name)
        expect(html).toContain(stateWord(state))
      }
    }
  })
})
