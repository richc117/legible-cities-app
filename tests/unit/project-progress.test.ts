import { describe, expect, it } from 'vitest'
import { EVERY_CELL, EVERY_CELL_READY, progressWords } from '../../src/renderer/src/projectProgress'
import type { RunFacts } from '../../src/renderer/src/runGraph'
import { type ProjectRecord } from '../../src/shared/project/types'
import { drawnOf } from '../support/sent'

// A project's row on the front door says how far it has got (A5.6-04), from
// the notebook's own run graph over the fields the list's summary carries.

const LAYOUT = 'a'.repeat(64)

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
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}
const current: ProjectRecord = { ...base, drawn: drawnOf(base) }
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

describe('how far a project has got, in words', () => {
  it('is its data alone before it has been laid out', () => {
    const fresh = { ...base, layout: null, made: null, built: null, date: null }
    expect(progressWords(fresh, null)).toBe('finished up to 01 Data; not laid out yet')
  })

  it('says the map is drawn from every cell once it is, in the header’s words', () => {
    // Mutation: the old return, "finished up to 05 Lines", which every
    // finished card said alike and which read as not finished (issue 559).
    expect(progressWords(current, null)).toBe('map drawn from every cell')
    expect(EVERY_CELL).toBe('map drawn from every cell')
    expect(progressWords(current, null)).not.toMatch(/finished up to/)
  })

  it('says every cell is ready, and no more, of a record that cannot prove its map current', () => {
    // A record from before `drawn` existed reads ready in the run graph;
    // the header tells it "Every cell is ready.", and so does its card.
    expect(progressWords(base, null)).toBe(EVERY_CELL_READY)
    expect(EVERY_CELL_READY).toBe('every cell ready')
  })

  it('stops at the cell holding a change the map does not show yet', () => {
    // A day chosen and not drawn: 03 holds it, 04 and 05 are behind.
    expect(progressWords({ ...current, date: '2026-09-20' }, null)).toBe(
      'finished up to 03 Frame and service day',
    )
    // The mode moved since the layout: everything from 02 down is behind.
    expect(progressWords({ ...current, mode: 'subway' }, null)).toBe('finished up to 01 Data')
  })

  it('names a cell that is running or failed rather than counting past it', () => {
    expect(progressWords(current, run('running'))).toBe('02 Process running')
    expect(progressWords(current, run('failed', { rebuilt: true }))).toBe(
      '03 Frame and service day failed',
    )
  })

  it('never counts the export, whose outcome is not in the record', () => {
    expect(progressWords(current, null)).not.toMatch(/06|Export/)
  })
})
