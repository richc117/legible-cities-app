// What only the main process derives from a record (spec 037, User Story
// 5): a record with a tuning or a line's options set as the store's writers
// set them, and a project's summary and its place in the front door's list.
// Pure: no Electron, no filesystem.

import { linesSent, settledTuning, tuningIsSet } from '../../shared/project/helpers'
import type {
  DrawnFrom,
  ProjectLines,
  ProjectRecord,
  ProjectSummary,
  ProjectTuning,
} from '../../shared/project/types'

/**
 * A record with one of its two tunings set to what was asked: the fields a
 * person chose, settled, or no key at all where none is left, so a reset and
 * a layout asked with LOOM's defaults leave nothing behind in the file. The
 * one place either field is written, for the store's two writers.
 */
export function withTuning(
  record: ProjectRecord,
  field: 'tuning' | 'laidOutWith',
  tuning: ProjectTuning,
): ProjectRecord {
  const next: ProjectRecord = { ...record }
  const kept = settledTuning(tuning)
  if (tuningIsSet(kept)) next[field] = kept
  else delete next[field]
  return next
}

/**
 * A record with its options set to what was asked, settled, or no key at all
 * where nothing is left, so a reset leaves nothing behind in the file. The
 * one place the field is written, for the store.
 */
export function withLines(record: ProjectRecord, lines: ProjectLines): ProjectRecord {
  const next: ProjectRecord = { ...record }
  const kept = linesSent(lines)
  if (Object.keys(kept).length > 0) next.lines = kept
  else delete next.lines
  return next
}

export function summarise(record: ProjectRecord, readOnly: boolean): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    feed: record.feed,
    date: record.date,
    mode: record.mode,
    agency: record.agency,
    layout: record.layout,
    made: record.made,
    built: record.built,
    // Without its stations (issue 272): the front door reads `drawn` to say
    // how far a project has got, and a list of hundreds of stations a
    // project, for every project, is weight on every listing for nothing.
    drawn: withoutStations(record.drawn),
    opened: record.opened,
    created: record.created,
    modified: record.modified,
    // The two tunings, where the record holds them (issue 385). They are
    // read: a project's card on the front door says how far it has got
    // through the notebook's own run graph, from this summary
    // (`projectFacts` -> `progressWords` -> `runGraph`), and the run graph
    // compares these two to say a layout is of another tuning - without
    // them the card would say "finished up to 05 Lines" of a project whose
    // cells 03 to 06 read not drawn yet.
    ...(record.tuning === undefined ? {} : { tuning: { ...record.tuning } }),
    ...(record.laidOutWith === undefined ? {} : { laidOutWith: { ...record.laidOutWith } }),
    readOnly,
  }
}

/** A draw's block without its stations, for a summary; the same block where it has none. */
function withoutStations(drawn: DrawnFrom | null): DrawnFrom | null {
  if (drawn === null || drawn.stations === undefined) return drawn
  const rest = { ...drawn }
  delete rest.stations
  return rest
}

/**
 * When a project was last opened, for ordering: its `opened`, or its
 * `created` for one not opened since that was kept - so a project made a
 * moment ago comes first rather than last.
 */
export function openedOrder(summary: Pick<ProjectSummary, 'opened' | 'created'>): string {
  return summary.opened ?? summary.created
}
