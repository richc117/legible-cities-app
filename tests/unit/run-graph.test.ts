import { describe, expect, it } from 'vitest'
import {
  CELLS,
  CELL_LIST,
  cellOfRun,
  drawnMatchesEdits,
  runGraph,
  stalenessOf,
  type CellId,
  type CellState,
  type ExportFacts,
  type RunFacts,
} from '../../src/renderer/src/runGraph'
import { drawnFrom, type ProjectRecord } from '../../src/shared/project'

// The run graph (A5.5-04, ADR-045, specs/028-the-notebook/contracts/run-graph.md).
// A table of records, because the model is the thing being tested and not
// any screen: no React, no Electron, no filesystem, no clock.

const LAYOUT = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const MADE = '2026-09-10T12:00:00+00:00'
const LATER = '2026-09-11T08:30:00+00:00'

/**
 * A record from before `drawn` existed: exactly what v0.1.0-rc.4 wrote,
 * laid out and never edited since. Nothing in it is stale.
 */
const rc4: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
  colors: { A: '#0072bc' },
  defaultColor: '#888888',
  lineOrder: ['A', 'K'],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  layout: LAYOUT,
  made: MADE,
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/** The same project after one draw under this issue: its map is current. */
const current: ProjectRecord = { ...rc4, drawn: drawnFrom(rc4) }

const idle: RunFacts = {
  state: 'idle',
  rebuilt: false,
  recoloured: false,
  reordered: false,
  replaced: false,
}
const layoutRun = (state: RunFacts['state'], patch: Partial<RunFacts> = {}): RunFacts => ({
  ...idle,
  state,
  ...patch,
})

const states = (
  record: ProjectRecord,
  run: RunFacts | null = null,
  exportRun: ExportFacts | null = null,
): Record<CellId, CellState> => {
  const graph = runGraph({ record, run, exportRun })
  const out = {} as Record<CellId, CellState>
  for (const cell of CELLS) out[cell] = graph[cell].state
  return out
}

const all = (state: CellState): Record<CellId, CellState> =>
  Object.fromEntries(CELLS.map((cell) => [cell, state])) as Record<CellId, CellState>

/** The six cells with the named ones overridden, written the way a table reads. */
const cells = (patch: Partial<Record<CellId, CellState>>): Record<CellId, CellState> => ({
  ...all('ready'),
  ...patch,
})

describe('the six cells', () => {
  it('are numbered 01 to 06 in the order they run', () => {
    expect(CELL_LIST.map((cell) => cell.id)).toEqual([...CELLS])
    expect(CELL_LIST.map((cell) => cell.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(CELL_LIST.map((cell) => cell.name)).toEqual([
      'Data',
      'Process',
      'Frame and service day',
      'Style',
      'Lines',
      'Export',
    ])
  })
})

describe('cellOfRun', () => {
  it('reads a rebuild as cell 03, a colour or an order as 05, anything else as 02', () => {
    expect(cellOfRun(layoutRun('running'))).toBe('process')
    expect(cellOfRun(layoutRun('running', { rebuilt: true }))).toBe('frame')
    expect(cellOfRun(layoutRun('running', { recoloured: true }))).toBe('lines')
    expect(cellOfRun(layoutRun('running', { reordered: true }))).toBe('lines')
  })

  it('belongs to no cell when there is no run, or none has started', () => {
    expect(cellOfRun(null)).toBeNull()
    expect(cellOfRun(idle)).toBeNull()
  })

  it('keeps a finished run with its own cell, so the failure lands there', () => {
    expect(cellOfRun(layoutRun('failed', { rebuilt: true }))).toBe('frame')
    expect(cellOfRun(layoutRun('done', { reordered: true }))).toBe('lines')
  })
})

describe('a record that has never been drawn under this issue', () => {
  it('reads as nothing stale, not as everything stale', () => {
    expect(states(rc4)).toEqual(all('ready'))
    expect(stalenessOf(rc4, null)).toEqual([])
  })

  it('reads the same before it has ever been laid out', () => {
    const fresh: ProjectRecord = {
      ...rc4,
      layout: null,
      made: null,
      built: null,
      date: null,
      service: null,
      drawn: null,
    }
    expect(states(fresh)).toEqual(all('ready'))
  })

  it('still says the inputs have moved, which the record could always see', () => {
    // `built` is A2-02's, not this issue's: a rc.4 record whose mode was
    // changed and never re-run was already reporting it on screen.
    const moved = { ...rc4, mode: 'subway' }
    expect(states(moved)).toEqual(
      cells({ process: 'stale', frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
  })
})

describe('a drawn record', () => {
  it('is ready throughout while nothing has moved', () => {
    expect(states(current)).toEqual(all('ready'))
  })

  it('marks 02 to 06 stale when the mode moves, and starts nothing', () => {
    const moved = { ...current, mode: 'tram,subway' }
    expect(states(moved)).toEqual(
      cells({ process: 'stale', frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
    expect(stalenessOf(moved, null)).toEqual([{ cell: 'data', reason: 'inputs' }])
    expect(runGraph({ record: moved, run: null, exportRun: null }).process.because).toBe('inputs')
  })

  it('marks 02 to 06 stale when the operator moves', () => {
    const moved = { ...current, agency: 'LACMTA' }
    expect(states(moved).process).toBe('stale')
    expect(states(moved).export).toBe('stale')
    expect(states(moved).data).toBe('ready')
  })

  it('marks 03 to 06 stale for a layout the map was not drawn from', () => {
    const moved = { ...current, layout: OTHER }
    expect(states(moved)).toEqual(
      cells({ frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
    expect(stalenessOf(moved, null)).toEqual([{ cell: 'process', reason: 'layout' }])
  })

  it('marks 03 to 06 stale for a set laid out again under it, by `made` and not the id', () => {
    const relaid = { ...current, made: LATER }
    expect(relaid.layout).toBe(current.drawn?.layout)
    expect(stalenessOf(relaid, null)).toEqual([{ cell: 'process', reason: 'relaid' }])
    expect(states(relaid)).toEqual(
      cells({ frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
  })

  it('marks 04 to 06 stale when the service day moves', () => {
    const moved = { ...current, date: '2026-09-19' }
    expect(states(moved)).toEqual(cells({ style: 'stale', lines: 'stale', export: 'stale' }))
    expect(stalenessOf(moved, null)).toEqual([{ cell: 'frame', reason: 'day' }])
  })

  it('reports every source it has, in cell order', () => {
    const moved = { ...current, mode: 'subway', layout: OTHER, date: '2026-09-19' }
    expect(stalenessOf(moved, null)).toEqual([
      { cell: 'data', reason: 'inputs' },
      { cell: 'process', reason: 'layout' },
      { cell: 'frame', reason: 'day' },
    ])
  })

  it('names the nearest source above it, not the first', () => {
    // Three changes, one under the other. Cell 05 is told about the day,
    // which is the last thing that happened to the map, rather than about a
    // mode someone may have changed last week.
    const moved = { ...current, mode: 'subway', layout: OTHER, date: '2026-09-19' }
    const graph = runGraph({ record: moved, run: null, exportRun: null })
    expect(graph.lines.because).toBe('day')
    expect(graph.frame.because).toBe('layout')
    expect(graph.process.because).toBe('inputs')
    expect(graph.data).toEqual({ state: 'ready', because: null })
  })
})

describe('the cheap edits ADR-045 exempts', () => {
  const colours = { ...current, colors: { A: '#ff0000', K: '#00ff00' } }
  const defaults = { ...current, defaultColor: '#123456' }
  const order = { ...current, lineOrder: ['K', 'A'] }
  const theme: ProjectRecord = { ...current, theme: 'sepia' }

  it('raise no staleness, because they redraw themselves', () => {
    for (const record of [colours, defaults, order, theme]) {
      expect(stalenessOf(record, null)).toEqual([])
      expect(states(record)).toEqual(all('ready'))
    }
  })

  it('read as running on cell 05 while the redraw goes', () => {
    expect(states(colours, layoutRun('running', { recoloured: true }))).toEqual(
      cells({ lines: 'running' }),
    )
    expect(states(order, layoutRun('running', { reordered: true }))).toEqual(
      cells({ lines: 'running' }),
    )
  })

  it('are still visible to Revert through `drawn`', () => {
    expect(drawnMatchesEdits(current)).toBe(true)
    for (const record of [colours, defaults, order]) {
      expect(drawnMatchesEdits(record)).toBe(false)
    }
    // A record from before `drawn` has nothing to put back, and says so
    // rather than claiming a difference it cannot see.
    expect(drawnMatchesEdits(rc4)).toBe(true)
  })

  it('leaves the theme out of that answer, since the page restyles at once', () => {
    // A theme reaches the page on its address and the page restyles itself
    // within a frame of the press (A4-03), so the map on screen carries the
    // record's theme however long ago it was last drawn. `drawn.theme` is
    // still kept, because Revert puts the record back and not the pixels.
    expect(drawnMatchesEdits(theme)).toBe(true)
    expect(theme.drawn?.theme, 'and the last draw is still on the record').toBe('warm-dark')
  })

  it('sees an override removed as well as one added', () => {
    expect(drawnMatchesEdits({ ...current, colors: {} })).toBe(false)
  })
})

describe('a run in flight', () => {
  it('reads running on the cell its own flags name', () => {
    expect(states(current, layoutRun('running'))).toEqual(cells({ process: 'running' }))
    expect(states(current, layoutRun('running', { rebuilt: true }))).toEqual(
      cells({ frame: 'running' }),
    )
    expect(states(current, null, { state: 'running' })).toEqual(cells({ export: 'running' }))
  })

  it('makes nothing below it stale: running is not a change yet', () => {
    const graph = states(current, layoutRun('running'))
    expect(graph.frame).toBe('ready')
    expect(graph.export).toBe('ready')
  })

  it('wins over a staleness above it, because it is what the cell is doing now', () => {
    const moved = { ...current, mode: 'subway' }
    expect(states(moved, layoutRun('running'))).toEqual(
      cells({
        process: 'running',
        frame: 'stale',
        style: 'stale',
        lines: 'stale',
        export: 'stale',
      }),
    )
  })
})

describe('a run that ended', () => {
  it('leaves its own cell in error and those below it stale', () => {
    expect(states(current, layoutRun('failed'))).toEqual(
      cells({ process: 'error', frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
    expect(states(current, layoutRun('failed', { rebuilt: true }))).toEqual(
      cells({ frame: 'error', style: 'stale', lines: 'stale', export: 'stale' }),
    )
    expect(states(current, layoutRun('failed', { recoloured: true }))).toEqual(
      cells({ lines: 'error', export: 'stale' }),
    )
    expect(states(current, null, { state: 'failed' })).toEqual(cells({ export: 'error' }))
  })

  it('says its own failure rather than what is above it', () => {
    const moved = { ...current, mode: 'subway' }
    const graph = runGraph({ record: moved, run: layoutRun('failed'), exportRun: null })
    expect(graph.process).toEqual({ state: 'error', because: 'failed' })
    // And the cells below it are told about the run that failed, which is
    // nearer to them than the mode that moved and more particular than it.
    expect(graph.frame).toEqual({ state: 'stale', because: 'upstream' })
    expect(graph.export.because).toBe('upstream')
    expect(graph.data, 'nothing above cell 01').toEqual({ state: 'ready', because: null })
  })

  it('tells the cells below a failed rebuild about the run, not about a day', () => {
    // Cell 03 both holds a change and failed: the failure is what 04 to 06
    // are told, because it is the more particular of the two.
    const moved = { ...current, date: '2026-09-19' }
    const graph = runGraph({
      record: moved,
      run: layoutRun('failed', { rebuilt: true }),
      exportRun: null,
    })
    expect(graph.frame).toEqual({ state: 'error', because: 'failed' })
    expect(graph.style).toEqual({ state: 'stale', because: 'upstream' })
  })

  it('does not make a failed export anybody’s upstream: cell 06 is last', () => {
    const graph = runGraph({ record: current, run: null, exportRun: { state: 'failed' } })
    expect(graph.export).toEqual({ state: 'error', because: 'failed' })
    expect(graph.lines).toEqual({ state: 'ready', because: null })
  })

  it('returns its cell to what it was when it was stopped, never to error', () => {
    expect(states(current, layoutRun('cancelled'))).toEqual(all('ready'))
    expect(states(current, layoutRun('cancelled', { rebuilt: true }))).toEqual(all('ready'))
  })

  it('leaves nothing behind when it finished', () => {
    expect(states(current, layoutRun('done'))).toEqual(all('ready'))
  })
})

describe('a re-layout that replaced the stored set and drew no map', () => {
  // The engine answered, so the set on disk is new; the run then stopped,
  // so the record was never written and the page is of geometry that is
  // gone. Nothing on the record can see it (A3-05).
  const stopped = layoutRun('cancelled', { replaced: true })

  it('marks 03 to 06 stale from the run, with the record untouched', () => {
    expect(stalenessOf(current, stopped)).toEqual([{ cell: 'process', reason: 'replaced' }])
    expect(states(current, stopped)).toEqual(
      cells({ frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
  })

  it('says nothing at all while the re-layout is still drawing', () => {
    // `replaced` goes up the moment `graph.build` answers, minutes before
    // the map is drawn. Reading it then would flap cells 03 to 06 to stale
    // for the whole drawing half of every re-layout and back again, which
    // is exactly what "running makes nothing below it stale" forbids.
    const drawing = layoutRun('running', { replaced: true })
    expect(stalenessOf(current, drawing)).toEqual([])
    expect(states(current, drawing)).toEqual(cells({ process: 'running' }))
  })

  it('says nothing once the map has been drawn from the new set', () => {
    // The run clears `replaced` when it finishes, so this is belt and
    // braces: a finished run leaves nothing behind either way.
    expect(states(current, layoutRun('done', { replaced: false }))).toEqual(all('ready'))
  })

  it('is an error on cell 02 when the run failed rather than stopping', () => {
    expect(states(current, layoutRun('failed', { replaced: true }))).toEqual(
      cells({ process: 'error', frame: 'stale', style: 'stale', lines: 'stale', export: 'stale' }),
    )
  })
})
