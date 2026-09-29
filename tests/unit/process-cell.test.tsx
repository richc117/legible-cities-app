// Cell 02, Process (issue 209): what the open cell states about the layout,
// and where it states it.
//
// The footer strip is where a cell's provenance lives, and a fact the strip
// states is not stated again above it in the open cell (DESIGN.md 8.2). The
// cell drew a field list that was: "Layout: d1deeb11, made 13/09/2026,
// 14:03" five lines above a strip saying "Layout: d1deeb11  Made:
// 13/09/2026, 14:03", both through the same `Time`. The list is gone, and
// what is held here is that it stays gone and that the one case the strip
// cannot speak for - a project with no layout, where it draws nothing - is
// said in one plain line.
//
// Rendered to static markup, as the notebook's other cell tests are: what
// is asserted is what the adapter draws. The cell is drawn **open**, since
// that is the state the rule is about; its collapsed row is
// `tests/unit/stages.test.ts`'s, and did not move for this.
//
// `LayoutRun`'s own sentence, "Drawn from layout aaaaaaaa for 2026-09-12.",
// names the layout above the strip and stays (DESIGN.md 8.2: the strip
// carries the facts and the panel carries the sentences). So nothing here
// asserts that the eight characters are absent above the strip. What is
// asserted is that no term and value are: no list, no term, and no moment,
// which only a field ever drew.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { freshStages, type LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import ProcessCell from '../../src/renderer/src/notebook/cells/ProcessCell'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import type { EngineState } from '../../src/shared/engine'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const CELL = CELL_LIST.find((cell) => cell.id === 'process') as Cell

const READY: EngineState = { state: 'ready', version: '0.10.0', protocol: 1 }

const MADE = '2026-09-10T12:00:00+00:00'

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { ...DEFAULT_STYLE },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: null,
  layout: 'a'.repeat(64),
  made: MADE,
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/** The record as it is before the first layout run has written to it. */
const fresh: ProjectRecord = {
  ...record,
  date: null,
  service: null,
  layout: null,
  made: null,
  built: null,
}

/** A run that has not gone in this session, which is what a project opens on. */
const idle = {
  job: () => null,
  subscribe: () => () => undefined,
  snapshot: {
    state: 'idle',
    stages: freshStages(),
    message: null,
    error: null,
    changed: false,
    relaid: false,
    forced: false,
    replaced: false,
    rebuilt: false,
    recoloured: false,
    reordered: false,
    day: null,
    report: null,
  },
} as unknown as LayoutRun

/**
 * The open cell, in two halves: what is drawn above the strip, and the
 * strip. The second is empty where the cell draws no strip at all.
 */
function draw(
  project: ProjectRecord,
  { readOnly = false }: { readOnly?: boolean } = {},
): { above: string; strip: string } {
  const state = {
    project: { ...project, readOnly },
    engine: READY,
    run: idle,
    exporting: false,
    layingOut: false,
  } as unknown as ProjectState
  const html = renderToStaticMarkup(
    <ProjectProvider value={state}>
      <ProcessCell cell={CELL} state="ready" open={true} onToggle={() => {}} />
    </ProjectProvider>,
  )
  const [above, strip = ''] = html.split('<div class="cell-footer">')
  return { above, strip }
}

/** The one line the cell says for a project with no layout, as it is drawn. */
const NOT_LAID_OUT = '<p class="prose">This project is not laid out yet.</p>'

const count = (html: string, needle: string): number => html.split(needle).length - 1

describe('cell 02, Process, open', () => {
  it('states the layout and when it was made once, in the strip and not above it', () => {
    const { above, strip } = draw(record)
    // The strip states both, as a term and its value.
    expect(strip).toContain('<dt>Layout</dt><dd>aaaaaaaa</dd>')
    expect(strip).toMatch(
      new RegExp(`<dt>Made</dt><dd><time datetime="${MADE.replace('+', '\\+')}"`, 'i'),
    )
    // And nothing above it states either as one: no list, no term, and no
    // moment. The halves are checked to be what they are called first, so
    // that an empty `above` cannot pass for a clean one.
    expect(above).toContain('<div class="cell-body">')
    expect(above).toContain('Lay out again')
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    expect(above).not.toContain('<time')
    expect(count(above + strip, '<time')).toBe(1)
  })

  it('says a project has no layout in one plain line, where the strip draws nothing', () => {
    const { above, strip } = draw(fresh)
    expect(strip, 'no layout, so no provenance and no strip').toBe('')
    expect(count(above, NOT_LAID_OUT)).toBe(1)
    // A sentence and not a field: the list that said "not laid out yet" as
    // the value of a term is not drawn for this case either.
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    // The line opens the cell, above the run's own panel and its button.
    expect(above.indexOf(NOT_LAID_OUT)).toBeGreaterThan(above.indexOf('<div class="cell-body">'))
    expect(above.indexOf(NOT_LAID_OUT)).toBeLessThan(above.indexOf('Lay out'))
  })

  it('says that line only while there is no layout', () => {
    // With a layout the strip speaks, and a cell saying "not laid out yet"
    // over a strip naming the layout would contradict it.
    for (const project of [record, { ...record, made: null }]) {
      const { above, strip } = draw(project)
      expect(above + strip).not.toContain('not laid out yet')
      expect(strip).toContain('<dt>Layout</dt>')
    }
  })

  it('leaves a layout with no moment to the strip, which names it without one', () => {
    // A record from before `made` was stored (A3-06). The list drew the
    // eight characters alone for it; the strip does the same, by leaving
    // the row out.
    const { above, strip } = draw({ ...record, made: null })
    expect(strip).toContain('<dt>Layout</dt><dd>aaaaaaaa</dd>')
    expect(strip).not.toContain('<dt>Made</dt>')
    expect(above + strip).not.toContain('<time')
    expect(above).not.toContain('<dl')
  })

  it('draws no list for a project this version may not write, with or without a layout', () => {
    // A read-only project has no run to offer, so the list was the whole
    // of what its cell drew. With a layout the strip now says it all.
    const laidOut = draw(record, { readOnly: true })
    expect(laidOut.above).not.toContain('<dl')
    expect(laidOut.above).not.toContain('<time')
    expect(laidOut.above).not.toContain('fig-button')
    expect(laidOut.strip).toContain('<dt>Layout</dt><dd>aaaaaaaa</dd>')
    expect(laidOut.strip).toContain('<dt>Made</dt>')
    // Without one the line is true of it too, and promises no button.
    const never = draw(fresh, { readOnly: true })
    expect(never.strip).toBe('')
    expect(count(never.above, NOT_LAID_OUT)).toBe(1)
    expect(never.above).not.toContain('<dl')
    expect(never.above).not.toContain('fig-button')
  })
})
