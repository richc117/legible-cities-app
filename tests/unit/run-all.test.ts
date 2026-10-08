import { describe, expect, it } from 'vitest'
import {
  failureSentence,
  notebookSentence,
  runAllOffered,
  runAllPlan,
} from '../../src/renderer/src/runAll'
import { runGraph, type RunFacts } from '../../src/renderer/src/runGraph'
import { drawnFrom, type ProjectRecord } from '../../src/shared/project'

// Run all and the header's sentence (A5.5-22). A table of records, as the
// run graph's own test is: the plan is the thing being tested, not a screen.

const LAYOUT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const MADE = '2026-09-10T12:00:00+00:00'

const base: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  opened: null,
  layout: LAYOUT,
  made: MADE,
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}
/** Drawn from everything it holds. */
const current: ProjectRecord = { ...base, drawn: drawnFrom(base) }
const unlaid: ProjectRecord = { ...base, layout: null, made: null, date: null, built: null }

const run = (state: RunFacts['state'], patch: Partial<RunFacts> = {}): RunFacts => ({
  state,
  download: null,
  feedMissing: false,
  rebuilt: false,
  recoloured: false,
  reordered: false,
  restyled: false,
  replaced: false,
  ...patch,
})

const sentence = (record: ProjectRecord, facts: RunFacts | null = null): string =>
  notebookSentence(record, runGraph({ record, run: facts, exportRun: null }))

describe('what Run all starts', () => {
  it('lays out a project that has never been laid out', () => {
    expect(runAllPlan(unlaid, null)).toEqual({ kind: 'layout' })
  })

  it('does nothing when the map is drawn from every cell above the export', () => {
    expect(runAllPlan(current, null)).toEqual({ kind: 'none' })
    expect(runAllPlan(current, run('done'))).toEqual({ kind: 'none' })
  })

  it('does nothing over a record that cannot say what its map shows', () => {
    // From before `drawn` existed: unknown is not behind (run-graph contract).
    expect(runAllPlan(base, null)).toEqual({ kind: 'none' })
  })

  it("lays out when cell 01's inputs have moved since the layout", () => {
    expect(runAllPlan({ ...current, mode: 'subway' }, null)).toEqual({ kind: 'layout' })
    expect(runAllPlan({ ...current, agency: 'LACMTA' }, null)).toEqual({ kind: 'layout' })
  })

  it("lays out when cell 02's layout is not the one the map was drawn from", () => {
    expect(runAllPlan({ ...current, layout: OTHER }, null)).toEqual({ kind: 'layout' })
    expect(runAllPlan(current, run('cancelled', { replaced: true }))).toEqual({ kind: 'layout' })
  })

  it('lays out again after a layout run failed, and only one', () => {
    expect(runAllPlan(current, run('failed'))).toEqual({ kind: 'layout' })
  })

  it('draws the chosen day from the stored layout when only the day is behind', () => {
    expect(runAllPlan({ ...current, date: '2026-09-20' }, null)).toEqual({
      kind: 'rebuild',
      date: '2026-09-20',
    })
  })

  it('draws again after a rebuild, a redraw for sizes, a recolour or a reorder failed', () => {
    for (const flag of ['rebuilt', 'restyled', 'recoloured', 'reordered'] as const)
      expect(runAllPlan(current, run('failed', { [flag]: true }))).toEqual({
        kind: 'rebuild',
        date: '2026-09-12',
      })
  })

  it('prefers the layout when both a layout and the day are behind, since a layout draws the day', () => {
    expect(runAllPlan({ ...current, mode: 'subway', date: '2026-09-20' }, null)).toEqual({
      kind: 'layout',
    })
  })

  it('treats a cancelled run as nothing to do again', () => {
    // Stop returns a cell to what it was; it is not an error (run-graph contract).
    expect(runAllPlan(current, run('cancelled', { rebuilt: true }))).toEqual({ kind: 'none' })
  })
})

describe('when Run all is offered', () => {
  const free = { readOnly: false, running: false, settling: false, exporting: false }
  it('is offered when there is something to run and nothing running', () => {
    expect(runAllOffered({ kind: 'layout' }, free)).toBe(true)
    expect(runAllOffered({ kind: 'rebuild', date: '2026-09-20' }, free)).toBe(true)
  })

  it('is not, when there is nothing to run or something in the way', () => {
    expect(runAllOffered({ kind: 'none' }, free)).toBe(false)
    for (const busy of ['running', 'exporting', 'readOnly'] as const)
      expect(runAllOffered({ kind: 'layout' }, { ...free, [busy]: true })).toBe(false)
  })

  it("is not while a finished run's record is being read back", () => {
    // The plan would be made from the record as it was before the run, and
    // a second press would start the same run again.
    expect(runAllOffered({ kind: 'layout' }, { ...free, settling: true })).toBe(false)
  })
})

describe("the header's alert", () => {
  const graph = (facts: RunFacts | null) =>
    runGraph({ record: current, run: facts, exportRun: null })

  it('is the notebook sentence word for word while a cell has failed', () => {
    const states = graph(run('failed'))
    expect(failureSentence(states)).toBe('02 Process failed.')
    expect(failureSentence(states)).toBe(notebookSentence(current, states))
  })

  it('names every failed cell, so a second failure is a change to the text', () => {
    const states = runGraph({
      record: current,
      run: run('failed'),
      exportRun: { state: 'failed' } as never,
    })
    expect(failureSentence(states)).toBe('02 Process failed. 06 Export failed.')
  })

  it('has nothing to say while nothing has failed or while a run is going', () => {
    expect(failureSentence(graph(null))).toBeNull()
    expect(failureSentence(graph(run('running')))).toBeNull()
  })
})

describe("the header's sentence", () => {
  it('is one sentence, whatever the state', () => {
    for (const said of [
      sentence(unlaid),
      sentence(current),
      sentence({ ...current, date: '2026-09-20' }),
      sentence(current, run('running')),
      sentence(current, run('failed', { rebuilt: true })),
    ])
      expect(said.match(/[.!?](\s|$)/g)).toHaveLength(1)
  })

  it('says nothing has been laid out on a new project', () => {
    expect(sentence(unlaid)).toBe('Nothing has been laid out yet.')
  })

  it('says the map is current when it is', () => {
    expect(sentence(current)).toBe('The map is drawn from every cell.')
  })

  it('names the running cell', () => {
    expect(sentence(current, run('running'))).toBe('02 Process is running.')
    expect(sentence(current, run('running', { rebuilt: true }))).toBe(
      '03 Frame and service day is running.',
    )
  })

  it('names the failed cell', () => {
    expect(sentence(current, run('failed', { recoloured: true }))).toBe('05 Lines failed.')
  })

  it('does not claim a map it cannot prove is current', () => {
    // A record from before `drawn`: ready, which is not the same as drawn.
    expect(sentence(base)).toBe('Every cell is ready.')
  })

  it('names the cells not drawn yet as a range', () => {
    expect(sentence({ ...current, date: '2026-09-20' })).toBe(
      '04 Style to 06 Export are not drawn yet.',
    )
    expect(sentence({ ...current, mode: 'subway' })).toBe(
      '02 Process to 06 Export are not drawn yet.',
    )
  })
})

describe('after a download that failed (issue 178)', () => {
  it('lays out, since nothing was laid out', () => {
    const failed = run('failed', {
      download: { message: 'downloaded 65,536 bytes', fraction: 0.2 },
    })
    expect(runAllPlan(unlaid, failed)).toEqual({ kind: 'layout' })
    expect(runAllPlan(current, failed)).toEqual({ kind: 'layout' })
  })
})
