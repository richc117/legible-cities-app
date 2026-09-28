import { CELL_LIST, runGraph, type CellId, type GraphRecord, type RunFacts } from './runGraph'

// How far a project has got, in words, for its row on the front door
// (A5.6-04). Derived by the notebook's own run graph (A5.5-04) from the
// fields the list's summary carries, so the row and the notebook cannot
// disagree about a project's state; this file only puts the answer into
// words.
//
// "Furthest finished" is the last of cells 01 to 05 that is ready with
// every cell above it ready too: a stale cell and everything below it is
// not finished, whatever state it is in. Cell 06 is left out. Its "ready"
// means only that no export has failed, and whether a file was ever written
// is on disk rather than in the record, so a row that counted it would say
// "finished" about a project nobody has exported.
//
// A project that has not been laid out is finished up to its data and no
// further: the run graph reads cell 02 as ready there, because nothing is
// stale before anything has been made, but nothing has been made either.

const MAP_CELLS: readonly CellId[] = ['data', 'process', 'frame', 'style', 'lines']

const named = (id: CellId): string => {
  const cell = CELL_LIST.find((c) => c.id === id) as (typeof CELL_LIST)[number]
  return `${String(cell.number).padStart(2, '0')} ${cell.name}`
}

/** One sentence fragment saying how far the project has got. */
export function progressWords(record: GraphRecord, run: RunFacts | null): string {
  const states = runGraph({ record, run, exportRun: null })
  const running = MAP_CELLS.find((id) => states[id].state === 'running')
  if (running !== undefined) return `${named(running)} running`
  const failed = MAP_CELLS.find((id) => states[id].state === 'error')
  if (failed !== undefined) return `${named(failed)} failed`
  if (record.layout === null) return `finished up to ${named('data')}; not laid out yet`
  const behind = MAP_CELLS.findIndex((id) => states[id].state !== 'ready')
  if (behind === -1) return `finished up to ${named('lines')}`
  // The cell before the first one behind; cell 01 is never stale itself,
  // since a source marks only the cells below its own.
  return `finished up to ${named(MAP_CELLS[Math.max(behind - 1, 0)])}`
}
