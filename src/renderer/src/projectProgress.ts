import {
  CELL_LIST,
  cellLabel,
  runGraph,
  type CellId,
  type GraphRecord,
  type RunFacts,
} from './runGraph'

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
//
// A project with every one of cells 01 to 05 ready says so in the project
// header's own words (issue 559): every finished card read "finished up to
// 05 Lines", which told nine cards apart in nothing and read as not
// finished. "Ready to export" would be untrue of a read-only project, and
// says something about cell 06, which is not counted. A record from before
// `drawn` existed reads ready without proving its map current, and the
// header tells it "Every cell is ready." rather than that its map is drawn
// from every cell; so does its card.

const MAP_CELLS: readonly CellId[] = ['data', 'process', 'frame', 'style', 'lines']

/** A project whose map is drawn from every cell it has, as `runAll.ts` says it. */
export const EVERY_CELL = 'map drawn from every cell'

/** The same for a record from before `drawn`, which cannot prove its map current. */
export const EVERY_CELL_READY = 'every cell ready'

const named = (id: CellId): string => {
  const cell = CELL_LIST.find((c) => c.id === id) as (typeof CELL_LIST)[number]
  return cellLabel(cell.number, cell.name)
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
  if (behind === -1) return record.drawn === null ? EVERY_CELL_READY : EVERY_CELL
  // The cell before the first one behind; cell 01 is never stale itself,
  // since a source marks only the cells below its own.
  return `finished up to ${named(MAP_CELLS[Math.max(behind - 1, 0)])}`
}
