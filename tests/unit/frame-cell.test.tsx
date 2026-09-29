// Cell 03, Frame and service day (issue 209): what the open cell states
// about the day, and where it states it.
//
// The rule is cell 02's and has no exception (DESIGN.md 8.2): a fact the
// footer strip states is not stated again above it in the open cell. This
// cell drew "Service day: 2026-09-12" as a field over a strip whose first
// row is "Service day: 2026-09-12". The field is gone.
//
// Rendered to static markup and drawn **open**, as `process-cell.test.tsx`
// is. `ServiceDay`'s own sentence, "Drawn for 2026-09-12. The feed covers
// ...", names the day above the strip and stays: the strip carries the
// facts and the panel carries the sentences. So what is asserted above the
// strip is that no term and value are drawn, not that the day is absent.
// The collapsed row is `tests/unit/notebook.test.ts`'s, and did not move.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { freshStages, type LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import FrameCell from '../../src/renderer/src/notebook/cells/FrameCell'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const CELL = CELL_LIST.find((cell) => cell.id === 'frame') as Cell

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-15', anchor: '2026-09-08' },
  style: { ...DEFAULT_STYLE },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: null,
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
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
    engine: null,
    run: idle,
    setDate: async () => {},
    exporting: false,
    layingOut: false,
    preview: null,
    drawn: 0,
  } as unknown as ProjectState
  const html = renderToStaticMarkup(
    <ProjectProvider value={state}>
      <FrameCell cell={CELL} state="ready" open={true} onToggle={() => {}} />
    </ProjectProvider>,
  )
  const [above, strip = ''] = html.split('<div class="cell-footer">')
  return { above, strip }
}

const count = (html: string, needle: string): number => html.split(needle).length - 1

describe('cell 03, Frame and service day, open', () => {
  it('states the service day once as a field, in the strip and not above it', () => {
    const { above, strip } = draw(record)
    expect(strip).toContain('<dt>Service day</dt><dd>2026-09-12</dd>')
    // The halves are checked to be what they are called, so that an empty
    // `above` cannot pass for a clean one: the day's own form is in it.
    expect(above).toContain('<div class="cell-body">')
    expect(above).toContain('Draw for another day')
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    expect(count(above + strip, '<dt>Service day</dt>')).toBe(1)
    // The panel's sentence is the panel's, and stays where it was.
    expect(above).toContain('Drawn for 2026-09-12. The feed covers 2026-01-01 to 2026-12-31')
  })

  it('draws no field and no strip before a layout, and says whose choice the day is', () => {
    const { above, strip } = draw(fresh)
    expect(strip, 'no window yet, so no strip').toBe('')
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    // "not yet chosen" was the field's value, and went with the field. The
    // sentence the cell already said covers a project with no day.
    expect(above).not.toContain('not yet chosen')
    expect(above).toContain(
      '<p class="prose">The service day is the engine’s own choice, made at the first layout from the days the feed covers. Lay the project out, and it is here to change.</p>',
    )
  })

  it('leaves a layout from before the window was kept to the panel’s own sentence', () => {
    // No window, so no strip; the day is still said, by `ServiceDay`.
    const { above, strip } = draw({ ...record, service: null })
    expect(strip).toBe('')
    expect(above).not.toContain('<dl')
    expect(above).toContain('Drawn for 2026-09-12. Lay the project out again')
  })

  it('draws no field for a project this version may not write', () => {
    const { above, strip } = draw(record, { readOnly: true })
    expect(above).toContain('its service day cannot be changed here')
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    // Its day is the strip's to say, as any project's is.
    expect(strip).toContain('<dt>Service day</dt><dd>2026-09-12</dd>')
    expect(count(above + strip, '<dt>Service day</dt>')).toBe(1)
  })
})
