// The rail (A5.5-21, docs/DESIGN.md 8.2): the stepper's markup, and the
// two pieces of arithmetic a press and a scroll depend on.
//
// Rendered to static markup, as the cell's own test is: what is asserted is
// what the component draws, not what a browser then does with it. The parts
// only a running window shows - the press, the scroll it performs, the
// current step following it, and the collapse below 900px - are
// `tests/e2e/rail.spec.ts`.
//
// The arithmetic is here rather than there because it is where the feature
// can go wrong quietly. A step that scrolls a cell behind the pinned band
// looks like a step that did nothing, and the remedy that suggests itself
// is the one issue 213 measured and withdrew.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { iconMarkup } from '../../src/renderer/src/icons/Icon'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import { stateIcon } from '../../src/renderer/src/notebook/Cell'
import Rail, { RAIL_LABEL, stepName } from '../../src/renderer/src/notebook/Rail'
import {
  clearance,
  currentStepOf,
  scrollTargetFor,
  type CellBox,
} from '../../src/renderer/src/notebook/railScroll'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import {
  CELLS,
  CELL_LIST,
  type CellId,
  type CellState,
  type CellStatus,
} from '../../src/renderer/src/runGraph'

const READY: CellStatus = { state: 'ready', because: null }

const allReady = (): Record<CellId, CellStatus> =>
  Object.fromEntries(CELLS.map((id) => [id, READY])) as Record<CellId, CellStatus>

const allOpen = (): Record<CellId, boolean> =>
  Object.fromEntries(CELLS.map((id) => [id, true])) as Record<CellId, boolean>

/**
 * The rail reads two things from the screen's state - the project's id, for
 * the outputs it asks for, and the export run's state, which is when it
 * asks again - so the rest of the context is not built.
 */
function draw(states: Record<CellId, CellStatus> = allReady()): string {
  const state = {
    project: { id: 'kq7x2mzp4dna' },
    exportSnapshot: { state: 'idle' },
  } as unknown as ProjectState
  return renderToStaticMarkup(
    <ProjectProvider value={state}>
      <Rail states={states} open={allOpen()} onOpen={() => {}} />
    </ProjectProvider>,
  )
}

describe('the rail’s stepper', () => {
  it('is a named nav holding an ordered list of buttons, and never a tablist', () => {
    const drawn = draw()
    expect(drawn).toContain(`<nav class="rail-steps" aria-label="${RAIL_LABEL}">`)
    expect(drawn).toContain('<ol>')
    // The promise a tablist makes is that the other five panels are hidden.
    // Every cell stays in the document, so it is not one.
    expect(drawn).not.toContain('role="tablist"')
    expect(drawn).not.toContain('role="tab"')
    expect(drawn).not.toContain('role="tabpanel"')
    expect([...drawn.matchAll(/<button[^>]*class="rail-step"/g)]).toHaveLength(CELL_LIST.length)
  })

  it('says a step’s number, name and state as one accessible name', () => {
    const drawn = draw()
    for (const cell of CELL_LIST) expect(drawn).toContain(`aria-label="${stepName(cell, 'ready')}"`)
    // And the three parts are drawn as well as named, so the eye and the
    // accessibility tree read the same row (WCAG 2.5.3).
    expect(drawn).toContain('<span class="rail-number">01</span>')
    expect(drawn).toContain('<span class="rail-name">Data</span>')
    expect(drawn).toMatch(/<span class="rail-state">.*?ready<\/span>/)
  })

  it('carries each cell’s own state, in the state’s own word', () => {
    const states: CellState[] = ['ready', 'running', 'stale', 'error']
    for (const state of states) {
      const drawn = draw({ ...allReady(), process: { state, because: null } })
      expect(drawn).toContain(`data-state="${state}"`)
      expect(drawn).toContain(stepName(CELL_LIST[1], state))
    }
  })

  it('marks no step current until a scroll has been measured', () => {
    // The current step follows the scroll position, which a render knows
    // nothing about: it is read from the window, so the first markup has
    // none rather than guessing the first cell.
    expect(draw()).not.toContain('aria-current')
  })

  it('gives the Outputs heading somewhere for focus to land', () => {
    // Reveal is a control that goes with the press that used it: the file
    // turns out to be gone, the row becomes a sentence, and the button
    // leaves the document under a person's finger (A6-07). The handback
    // needs an element to hand to, and a heading only takes focus if it is
    // told to.
    expect(draw()).toContain('<h2 id="outputs-heading" tabindex="-1">')
  })

  it('draws the Outputs heading, and no list until the folder has answered', () => {
    const drawn = draw()
    expect(drawn).toContain('id="outputs-heading"')
    expect(drawn).toContain('Outputs')
    expect(drawn).not.toContain('<ul class="outputs">')
    // Not the empty sentence either: "nothing yet" and "not read yet" are
    // different things, and a folder with ten files in it must never flash
    // the first on its way to the second.
    expect(drawn).not.toContain('class="rail-empty"')
  })
})

describe('a status is an icon and a word, never a hue alone', () => {
  // Principle 1, and section 3's scoping table, which is not one rule for
  // all three tokens. Written down in DESIGN.md 8.2 as well; this is what
  // stops it being narrowed back by omission, which is how it went wrong
  // the first time - the first version of this rail left the word grey on
  // an unmeasured claim that there was no room for the icon.
  const css = readFileSync(
    resolve(__dirname, '../../src/renderer/src/styles/rail.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  /** Every rule's selector and body, comments already stripped. */
  const rules = (): { selector: string; body: string }[] =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selector: m[1].trim(),
      body: m[2],
    }))

  it('draws the cell’s own glyph beside the word, in every state', () => {
    // The same table the cell reads, so the two cannot come to disagree
    // about which icon a state has.
    for (const state of ['ready', 'running', 'stale', 'error'] as const) {
      const drawn = draw({ ...allReady(), process: { state, because: null } })
      expect(drawn).toContain(iconMarkup(stateIcon(state), 16))
    }
  })

  it('puts every status colour on something that holds an icon and a word', () => {
    // There are exactly two of those in the rail: a step's state and the
    // gone row, each drawn as a glyph beside its text. A rule that coloured
    // the step itself, its number or its name would be a status somewhere
    // the word is not - a stroke a person has to already know to read.
    const CARRIERS = ['.rail-state', '.output-gone']
    for (const { selector, body } of rules()) {
      if (!/--error|--warning|--accent-text/.test(body)) continue
      expect(
        CARRIERS.some((carrier) => selector.includes(carrier)),
        `${selector} draws a status colour on nothing that carries an icon`,
      ).toBe(true)
    }
  })

  it('takes --warning and --error off the two grounds section 3 forbids', () => {
    // --accent-text clears every ground, so running keeps its colour there;
    // the other two do not, and fall back to --text-muted with the icon and
    // the word still carrying the state.
    for (const ground of [':hover', "[aria-current='step']"]) {
      for (const state of ['stale', 'error']) {
        const rule = rules().find(
          (r) => r.selector.includes(ground) && r.selector.includes(`data-state='${state}'`),
        )
        expect(rule, `${state} on ${ground}`).toBeDefined()
        expect(rule!.body).toContain('--text-muted')
      }
    }
    expect(
      rules().some((r) => r.selector.includes(':hover') && r.body.includes('--accent-text')),
      'running is not taken off a ground it is allowed on',
    ).toBe(false)
  })

  it('draws the one status in Outputs beside an icon too', () => {
    const gone = rules().filter((r) => r.selector.includes('output-gone'))
    expect(gone.some((r) => r.body.includes('--warning'))).toBe(true)
    expect(gone.some((r) => r.selector.includes('.icon'))).toBe(true)
    const outputs = readFileSync(
      resolve(__dirname, '../../src/renderer/src/notebook/Outputs.tsx'),
      'utf8',
    )
    expect(outputs).toContain('<Icon name="warning" />')
  })
})

describe('the rail’s width and the space kept for it are one value', () => {
  // The invariant that is actually load-bearing here, and it was a comment
  // alone. The rail is fixed, so it takes no width from the `100vw` the map
  // breaks out to; the only thing keeping an opaque band off a region's
  // presses is that `.rail`'s width and the main region's padding are the
  // same variable. A `z-index` does not do it - the rail and the band
  // compute to the same layer, and on a tie the band wins on document
  // order, because the rail is rendered before the notebook's column.
  const read = (file: string): string =>
    readFileSync(resolve(__dirname, '../../src/renderer/src/styles', file), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    )

  it('gives .rail no width of its own', () => {
    const rail = /\.rail\s*\{([^{}]*)\}/.exec(read('rail.css'))
    expect(rail, '.rail has no rule at all').not.toBeNull()
    expect(rail![1]).toContain('width: var(--rail-space)')
  })

  it('declares --rail-space in project.css and nowhere else', () => {
    for (const file of ['rail.css', 'panels.css', 'notebook.css', 'preview.css', 'app.css'])
      expect(read(file), `${file} declares --rail-space`).not.toMatch(/--rail-space\s*:/)
    expect(read('project.css')).toMatch(/--rail-space\s*:/)
  })

  it('spends the same variable on the space the region is given', () => {
    const project = read('project.css')
    expect(project).toMatch(/padding-left:\s*var\(--rail-space\)/)
    // And the map subtracts it, or it is drawn over the rail.
    expect(read('panels.css')).toContain('var(--rail-space, 0px)')
  })
})

// The band as A5.5-20 pins it, in an 800-tall window: the header's 40, half
// what is left, and the wrapper's own bottom padding. The exact figures do
// not matter - what matters is that the band's foot is far below the
// header's, which is the whole reason this arithmetic exists.
const HEADER = { bottom: 40 }
const BAND = { bottom: 436 }

describe('what a step’s scroll has to clear', () => {
  it('is the band’s foot, not the header’s', () => {
    expect(clearance(BAND, HEADER)).toBe(BAND.bottom)
  })

  it('is the header’s where a project has no map to pin', () => {
    // A project that has never been laid out draws no preview at all.
    expect(clearance(null, HEADER)).toBe(HEADER.bottom)
  })

  it('lands a cell’s top at the band’s foot and never behind it', () => {
    // A cell 300 below the viewport's top, with the page already scrolled
    // 1200 down: the window has to move so that the cell's top sits exactly
    // where the band ends.
    const target = scrollTargetFor({ top: 300 }, clearance(BAND, HEADER), 1200)
    // Where the cell's top ends up, in viewport coordinates, after the
    // window has moved to `target`.
    const landed = 1200 + 300 - target
    expect(landed).toBe(BAND.bottom)
    expect(landed).toBeGreaterThanOrEqual(clearance(BAND, HEADER))
  })

  it('never scrolls above the top of the document', () => {
    // Cell 01 with the page at the top: there is nowhere above 0 to go, and
    // asking for it would be a negative scroll the browser clamps anyway.
    expect(scrollTargetFor({ top: 120 }, clearance(BAND, HEADER), 0)).toBe(0)
  })
})

describe('which step the scroll is on', () => {
  /** Six cells stacked down the page, each `height` tall, from `first`. */
  const stack = (first: number, height: number): CellBox[] =>
    CELLS.map((id, i) => ({ id, top: first + i * height, bottom: first + (i + 1) * height }))

  it('is the first cell with any of itself below the band', () => {
    // The band ends at 436; cells 01 and 02 are entirely behind it.
    expect(currentStepOf(stack(0, 200), BAND.bottom)).toBe('frame')
  })

  it('is the first cell at the top of the document', () => {
    expect(currentStepOf(stack(500, 200), BAND.bottom)).toBe('data')
  })

  it('stays on the last cell past the end of the notebook', () => {
    // Scrolled to the foot of a short document, every cell is above the
    // band's foot. Going blank there would say the rail had lost its place.
    expect(currentStepOf(stack(-2000, 200), BAND.bottom)).toBe('export')
  })

  it('is nothing at all when there are no cells to be on', () => {
    expect(currentStepOf([], BAND.bottom)).toBeNull()
  })
})
