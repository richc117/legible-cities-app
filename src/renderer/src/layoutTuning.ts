import type { LayoutPenalties, LayoutTuning } from '../../shared/protocol'
import { PENALTY_KEYS, settledTuning, tuningIsSet, type ProjectTuning } from '../../shared/project'

// The layout's tuning (issue 385, spec 033): what `graph.build` is sent for
// it, and what cell 02's Layout tuning section does with what is typed. The
// logic of `LayoutTuning.tsx`, as `styleRules.ts` is of `StyleFields.tsx`:
// pure, so that what a field refuses and what a run sends can be held to a
// unit test without rendering, and with no component import, so an
// end-to-end spec may read its sentences.
//
// What a tuning *is* - the ranges, LOOM's own numbers, the four grids, what
// the record keeps - is decided in `shared/project.ts`, beside the record,
// because the main process judges the same things. This module only puts it
// in the engine's names and on the screen.

/**
 * The `tuning` object `graph.build` is sent for a project's tuning, in the
 * engine's names (`LayoutTuning`, the penalties inside their own object), or
 * null when there is none to send.
 *
 * Only the fields the record holds, and never one at LOOM's own number,
 * which the record never holds either. Null, never `{}`: an omitted
 * `tuning` is the request every untuned project has always sent, and the
 * engine names the same layout for it.
 */
export function layoutTuning(tuning: ProjectTuning | undefined): LayoutTuning | null {
  if (tuning === undefined) return null
  const kept = settledTuning(tuning)
  const wire: LayoutTuning = {}
  if (kept.mergeDistance !== undefined) wire.merge_distance = kept.mergeDistance
  if (kept.grid !== undefined) wire.grid = kept.grid
  if (kept.gridSize !== undefined) wire.grid_size = kept.gridSize
  const penalties: LayoutPenalties = {}
  for (const key of PENALTY_KEYS) {
    const value = kept[key]
    if (value !== undefined) penalties[key] = value
  }
  if (Object.keys(penalties).length > 0) wire.penalties = penalties
  return Object.keys(wire).length === 0 ? null : wire
}

/**
 * The part of `graph.build`'s params a tuning adds: `{ tuning }` when the
 * record holds one, and nothing at all - not a key with nothing in it -
 * when it does not.
 */
export function tuningParams(tuning: ProjectTuning | undefined): { tuning?: LayoutTuning } {
  const wire = layoutTuning(tuning)
  return wire === null ? {} : { tuning: wire }
}

/**
 * What a finished layout run tells the store it asked the engine with
 * (spec 033, FR-008): the same tuning `tuningParams` sent, in the record's
 * names, or nothing for a run that sent none.
 */
export function askedWith(tuning: ProjectTuning | undefined): { tuning?: ProjectTuning } {
  return tuning !== undefined && tuningIsSet(tuning) ? { tuning: settledTuning(tuning) } : {}
}
