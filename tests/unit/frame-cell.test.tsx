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
import { ProjectProviders, type ProjectState } from '../../src/renderer/src/notebook/context'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project/types'
import {
  NO_TRIP_ON_IT,
  ON_SCREEN_AS_IT_WAS,
  OPENING_REDRAW_FAILED,
  THEME_BY_RELOAD,
} from '../../src/renderer/src/notebook/olderPage'
import { engineBefore } from '../../src/renderer/src/record'
import { PAGE_SEAM_NAMES, PAGE_SEAM_SINCE } from '../../src/shared/protocol'
import { defaultProjectState } from '../support/project-state'

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
  {
    readOnly = false,
    run = idle,
    redrawAsked = null,
    openedSeams = null,
  }: {
    readOnly?: boolean
    run?: LayoutRun
    redrawAsked?: string | null
    openedSeams?: readonly string[] | null
  } = {},
): { above: string; strip: string } {
  const state: ProjectState = {
    ...defaultProjectState(),
    project: { ...project, readOnly },
    engine: null,
    run,
    runSnapshot: run.snapshot,
    redrawAsked,
    openedSeams,
  }
  const html = renderToStaticMarkup(
    <ProjectProviders state={state}>
      <FrameCell cell={CELL} state="ready" open={true} onToggle={() => {}} />
    </ProjectProviders>,
  )
  const [above, strip = ''] = html.split('<div class="cell-footer">')
  return { above, strip }
}

const count = (html: string, needle: string): number => html.split(needle).length - 1

/**
 * The day said in a sentence, as it is drawn: what a read-only project is
 * told where it has a day and no strip to say it.
 */
const THE_DAY = '<p class="prose">The service day is 2026-09-12.</p>'

/** What a read-only project is told instead of being offered the control, as it is drawn. */
const READ_ONLY =
  '<p class="prose">This project was made by a newer version of the app, so its service day cannot be changed here.</p>'

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
    expect(count(above, READ_ONLY)).toBe(1)
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
    // Its day is the strip's to say, as any project's is.
    expect(strip).toContain('<dt>Service day</dt><dd>2026-09-12</dd>')
    expect(count(above + strip, '<dt>Service day</dt>')).toBe(1)
  })
})

describe('cell 03, open, for a read-only project with a day and no strip', () => {
  // A record with a day and no window draws no strip (`frameFacts` needs
  // both), and a read-only project is not drawn `ServiceDay`, whose sentence
  // says the day for a writable one. With the field gone the open cell
  // stated the day nowhere. No record this version writes is in that state,
  // but this branch is for a record a later version wrote, and a window
  // kept in a shape this version cannot read is the record that lands here.
  const noWindow: ProjectRecord = { ...record, service: null }

  it('says the day once, in a sentence, before it says the day cannot be changed', () => {
    const { above, strip } = draw(noWindow, { readOnly: true })
    expect(strip, 'no window, so no strip').toBe('')
    expect(count(above, THE_DAY)).toBe(1)
    expect(count(above, READ_ONLY)).toBe(1)
    // What the project is, then what cannot be done to it: the cell's
    // first two children, in that order.
    expect(above).toContain(`<div class="cell-body">${THE_DAY}${READ_ONLY}`)
    // A sentence and not a field.
    expect(above).not.toContain('<dl')
    expect(above).not.toContain('<dt>')
  })

  it('leaves the day to the strip where there is one', () => {
    // The same record with its window: the strip's first row says the day,
    // and a fact the strip states is not stated again above it.
    const { above, strip } = draw(record, { readOnly: true })
    expect(strip).toContain('<dt>Service day</dt><dd>2026-09-12</dd>')
    expect(above).not.toContain('The service day is 2026-09-12')
    expect(count(above, READ_ONLY)).toBe(1)
  })

  it('says nothing of a day the record does not hold', () => {
    // Never laid out: no day, no window, no strip, and nothing to say but
    // that the day cannot be changed here. Not "The service day is ."
    const { above, strip } = draw(fresh, { readOnly: true })
    expect(strip).toBe('')
    expect(above).not.toContain('The service day is')
    expect(above).toContain(`<div class="cell-body">${READ_ONLY}`)
  })

  it('is never said to a project this version can write', () => {
    // A writable project is drawn the control, whose own sentence says the
    // day, or the sentence that says the engine will choose one. Each of
    // these has no strip, which is the state the sentence is drawn in for a
    // read-only one; the last has a strip as well.
    const writable: [string, ProjectRecord][] = [
      ['a day and a layout, no window', noWindow],
      ['a day, no layout, no window', { ...noWindow, layout: null, made: null, built: null }],
      ['never laid out', fresh],
      ['laid out, with its window', record],
    ]
    for (const [name, project] of writable) {
      const { above, strip } = draw(project)
      expect(above + strip, name).not.toContain('The service day is 2026-09-12')
      expect(above + strip, name).not.toContain('made by a newer version')
    }
    // And the first of them does say its day, in the control's own words.
    expect(draw(noWindow).above).toContain('Drawn for 2026-09-12. Lay the project out again')
  })
})

// Issue 517: a rebuild of cell 03's own failed. For the redraw a project's
// opening asked for, cell 03 says so first, as an error, in words for a
// person who pressed nothing, and then what still holds of the map on screen
// for the seams its page lacks; any other says so plainly. Neither is a live
// region: the header's alert is the one announcement (FR-017).
describe('cell 03, open, after a rebuild of its own failed', () => {
  const HINT = 'la-metro-rail has no stored layout cccccccc'
  const REASON = 'la-metro-rail has no stored layout cccccccc.'
  /** The seam of a page drawn before `version`, by the schema's `since`. */
  const seamBefore = (version: string): string[] =>
    PAGE_SEAM_NAMES.filter((name) => engineBefore(PAGE_SEAM_SINCE[name], version))
  /** A page from before `setTheme`: none of the seams added since. */
  const OLDEST = seamBefore(PAGE_SEAM_SINCE.setTheme)
  /** A page from after `setTrip` and before the opening: everything but the opening's two. */
  const NO_OPENING = seamBefore(PAGE_SEAM_SINCE.setCard)
  /** The opening's rebuild, failed, as job `job-1`. */
  const failed = {
    job: () => ({ id: 'job-1' }),
    subscribe: () => () => undefined,
    snapshot: {
      ...idle.snapshot,
      state: 'failed',
      error: HINT,
      rebuilt: true,
      day: '2026-09-12',
      unkept: false,
      download: null,
      feedMissing: false,
    },
  } as unknown as LayoutRun
  const ERROR = `<p class="message error">${OPENING_REDRAW_FAILED} ${REASON}</p>`
  const prose = (text: string) => `<p class="prose">${text}</p>`

  it('says what was tried and why first, then what still holds of the oldest page', () => {
    // Mutation: the block removed from `FrameCell` - the cell reads failed
    // and says nothing of why.
    const { above } = draw(record, { run: failed, redrawAsked: 'job-1', openedSeams: OLDEST })
    expect(above).toContain(
      `<div class="cell-body">${ERROR}${prose(`${ON_SCREEN_AS_IT_WAS} ${THEME_BY_RELOAD} ${NO_TRIP_ON_IT}`)}`,
    )
    expect(count(above, OPENING_REDRAW_FAILED), 'said once').toBe(1)
  })

  it('tells a page lacking only the opening’s seams nothing of a theme or a trip', () => {
    // Mutation: `openedSeams` not read from the screen's state - the
    // fallback is built from no seams at all, or from "older".
    const { above } = draw(record, { run: failed, redrawAsked: 'job-1', openedSeams: NO_OPENING })
    expect(above).toContain(`<div class="cell-body">${ERROR}${prose(ON_SCREEN_AS_IT_WAS)}`)
    expect(above).not.toContain(THEME_BY_RELOAD)
    expect(above).not.toContain(NO_TRIP_ON_IT)
  })

  it('is not a live region beside the header’s alert', () => {
    // Mutation: `role="alert"` on the error - the failure is announced twice.
    const { above } = draw(record, { run: failed, redrawAsked: 'job-1', openedSeams: OLDEST })
    const at = above.indexOf(OPENING_REDRAW_FAILED)
    const tag = above.slice(above.lastIndexOf('<p', at), at)
    expect(tag).toBe('<p class="message error">')
  })

  it('says a failed rebuild the opening did not start plainly, with its reason', () => {
    // Mutation: `redrawAsked` not read from the screen's state - every
    // failure is told it was the opening's.
    for (const redrawAsked of [null, 'job-0']) {
      const { above } = draw(record, { run: failed, redrawAsked, openedSeams: OLDEST })
      expect(above, String(redrawAsked)).toContain(
        `<div class="cell-body"><p class="message error">The rebuild for 2026-09-12 did not finish. ${REASON}</p>`,
      )
      expect(above, String(redrawAsked)).not.toContain(OPENING_REDRAW_FAILED)
      expect(above, String(redrawAsked)).not.toContain(ON_SCREEN_AS_IT_WAS)
      // The control is there, so the half checked is the cell's own.
      expect(above).toContain('Draw for another day')
    }
  })

  it('says nothing of a failure on a run that has not failed', () => {
    const { above } = draw(record, { redrawAsked: 'job-1', openedSeams: OLDEST })
    expect(above).not.toContain('message error">The')
    expect(above).not.toContain(OPENING_REDRAW_FAILED)
  })
})
