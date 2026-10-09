import type { LayoutPenalties, LayoutTuning } from '../../shared/protocol'
import {
  DEFAULT_TUNING,
  GRIDS,
  inTuningRange,
  PENALTY_KEYS,
  sameTuning,
  settledTuning,
  TUNING_KEYS,
  TUNING_RANGES,
  tuningIsSet,
  tuningRangeSentence,
  type Grid,
  type ProjectRecord,
  type ProjectTuning,
  type TuningKey,
} from '../../shared/project'
import { parseFigure } from './styleRules'

// The layout's tuning (issue 385, spec 033): what `graph.build` is sent for
// it, and what cell 02's Layout tuning section does with what is typed. The
// logic of `LayoutTuning.tsx`, as `styleRules.ts` is of `StyleFields.tsx`:
// pure, so that what a field refuses and what a run sends can be held to a
// unit test without rendering, and with no component import, so an
// end-to-end spec may read its sentences. Named as `styleRules.ts` is and
// not `layoutTuning.ts`: beside `LayoutTuning.tsx` that name would differ
// from the component's only in case, which the file systems of macOS and
// Windows do not tell apart.
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

// ---- Cell 02's section

/** What the section is called: its row's name and the name of what it discloses. */
export const TUNING_NAME = 'Layout tuning'

/** What the row says while the record holds no tuning (spec 033, FR-001). */
export const LOOM_DEFAULTS = 'LOOM’s defaults'

/** What the row says while it holds one. */
export const TUNED = 'tuned'

/**
 * The word the section's row says beside its name, so a closed section still
 * tells whether the layout is tuned: from the tuning the section shows,
 * which is the record's but for a write on its way. A field at LOOM's own
 * number is no choice, and the record never holds one anyway.
 */
export const tuningWord = (tuning: ProjectTuning | undefined): string =>
  tuningIsSet(tuning) ? TUNED : LOOM_DEFAULTS

/** The section's first sentence: what the tuning is, and that nothing moves until a layout run. */
export const TUNING_SENTENCE =
  'LOOM’s own settings for laying this project out. A tuned layout is a layout of its own: the map keeps the layout it has until you lay out again.'

/** The penalties' group, whose fields' names say nothing on their own. */
export const PENALTY_LEGEND = 'Bend penalties'

/** What a penalty is, said once at the head of the group. */
export const PENALTY_SENTENCE =
  'What octi pays where a line bends by each angle, and for running on a diagonal: the higher the cost, the more it avoids them. A cost has no unit.'

/** The button that puts every field and the grid back. */
export const RESET_LABEL = 'Reset to LOOM’s defaults'

/** The grid select's name. */
export const GRID_LABEL = 'Grid'

/**
 * The four grids as the select offers them: the engine's word, then a gloss
 * saying what the lattice looks like (DESIGN.md 11), LOOM's own marked as
 * such. The engine's words because they are what LOOM and the engine call
 * them, and what a person reading LOOM's own documentation will find.
 */
export const GRID_GLOSSES: Readonly<Record<Grid, string>> = {
  octilinear: 'eight directions; LOOM’s own',
  ortholinear: 'four directions',
  orthoradial: 'rings and spokes',
  hexalinear: 'six directions',
}

/** One option of the grid select: its value and what it says. */
export const gridOptions = (): { grid: Grid; label: string }[] =>
  GRIDS.map((grid) => ({ grid, label: `${grid} (${GRID_GLOSSES[grid]})` }))

/** Each number's name on the screen, in the order the section draws them. */
export const TUNING_LABELS: Readonly<Record<TuningKey, string>> = {
  mergeDistance: 'Merge distance',
  gridSize: 'Grid size',
  deg45: '45°',
  deg90: '90°',
  deg135: '135°',
  deg180: '180°',
  diagonal: 'Diagonal',
}

/** The two numbers that are not penalties, drawn before the group of them. */
export const OWN_KEYS = TUNING_KEYS.filter(
  (key) => !(PENALTY_KEYS as readonly string[]).includes(key),
) as TuningKey[]

/**
 * What a field takes, said under it: the engine's range with its unit, and
 * LOOM's own number for a field left alone (spec 033, US2 scenario 1).
 */
export function describeTuningField(key: TuningKey): string {
  const { low, high } = TUNING_RANGES[key]
  const range =
    key === 'mergeDistance'
      ? `${low} to ${high} metres`
      : key === 'gridSize'
        ? `${low} to ${high} percent of the distance between adjacent stations`
        : `${low} to ${high}`
  return `${range}. LOOM’s own is ${DEFAULT_TUNING[key]}.`
}

/** What a field shows: the number the tuning holds, else LOOM's own. */
export const tuningFieldText = (tuning: ProjectTuning, key: TuningKey): string =>
  String(tuning[key] ?? DEFAULT_TUNING[key])

/** What the fields have been typed to say, one string each. */
export type TuningDrafts = Record<TuningKey, string>

/** The sentences beside the fields that were refused, by field. */
export type TuningProblems = Partial<Record<TuningKey, string>>

/** What the section shows: the tuning it holds, the fields as typed, and what was refused. */
export interface TuningView {
  tuning: ProjectTuning
  drafts: TuningDrafts
  problems: TuningProblems
}

/** The fields showing what a tuning holds. */
export function tuningDraftsOf(tuning: ProjectTuning): TuningDrafts {
  return Object.fromEntries(
    TUNING_KEYS.map((key) => [key, tuningFieldText(tuning, key)]),
  ) as TuningDrafts
}

/** Has a field been typed to say something other than what the tuning holds? */
export const isTuningPending = (
  tuning: ProjectTuning,
  drafts: TuningDrafts,
  key: TuningKey,
): boolean => drafts[key] !== tuningFieldText(tuning, key)

/**
 * The section showing a record's tuning. A number still waiting where it was
 * typed - refused, with its sentence, or not committed yet - is kept through
 * it: a record arriving for another reason - a rename, another field's
 * write landing, a run that ended - must not take a person's number away
 * while they are typing or mending it. A field whose draft says what the
 * record now holds is the record's, which is how a committed number settles.
 */
export function tuningViewOf(tuning: ProjectTuning | undefined, previous?: TuningView): TuningView {
  const held = settledTuning(tuning ?? {})
  const view: TuningView = { tuning: held, drafts: tuningDraftsOf(held), problems: {} }
  if (previous !== undefined) {
    for (const key of TUNING_KEYS) {
      if (!isTuningPending(held, previous.drafts, key)) continue
      view.drafts[key] = previous.drafts[key]
      const problem = previous.problems[key]
      if (problem !== undefined) view.problems[key] = problem
    }
  }
  return view
}

/**
 * Commit one field (Enter on it, or focus leaving it), before anything is
 * written: an empty field goes back to LOOM's own; a figure inside the
 * engine's range is taken, and one at LOOM's own number is no choice and
 * leaves the field unheld; anything else - a number outside the range, or
 * text that is not a number - is refused beside the field in the engine's
 * own sentence and left as typed, and the tuning does not move.
 *
 * Only the field committed is read: no field's answer depends on another's,
 * and leaving a field commits it, so no other is ever waiting unread.
 */
export function commitTuningField(view: TuningView, key: TuningKey): TuningView {
  const { tuning, drafts } = view
  const problems = { ...view.problems }
  delete problems[key]
  const text = drafts[key].trim()
  if (!isTuningPending(tuning, drafts, key))
    return { tuning, drafts: { ...drafts, [key]: tuningFieldText(tuning, key) }, problems }
  if (text === '') {
    const next = settledTuning({ ...tuning, [key]: undefined })
    return { tuning: next, drafts: { ...drafts, [key]: tuningFieldText(next, key) }, problems }
  }
  const figure = parseFigure(text)
  if (figure === null || !inTuningRange(key, figure)) {
    return { tuning, drafts, problems: { ...problems, [key]: tuningRangeSentence(key) } }
  }
  const next = settledTuning({ ...tuning, [key]: figure })
  return { tuning: next, drafts: { ...drafts, [key]: tuningFieldText(next, key) }, problems }
}

/** The section with a grid chosen: the rest as it is, a choice of LOOM's own unheld. */
export function chooseGrid(view: TuningView, grid: Grid): TuningView {
  return { ...view, tuning: settledTuning({ ...view.tuning, grid }) }
}

/** Is there anything for Reset to clear: a choice, or a refused number waiting in a field? */
export const resettable = (view: TuningView): boolean =>
  tuningIsSet(view.tuning) ||
  TUNING_KEYS.some((key) => isTuningPending(view.tuning, view.drafts, key))

/**
 * What the section says when a write was refused, the store's own reason
 * after it, so the person knows the fields have gone back to the record.
 */
export function notSaved(reason: unknown): string {
  const said = reason instanceof Error ? reason.message : String(reason)
  const sentence = said.endsWith('.') ? said : `${said}.`
  return `The tuning was not saved: ${sentence}`
}

/**
 * What cell 02 says under its run while the record's tuning would not send
 * what its layout was asked with (spec 033, FR-009), or null while it would,
 * and before there is a layout: the run graph's `tuning` source, said in
 * the cell that holds it, what to do first and then why.
 */
export function tuningNotice(
  record: Pick<ProjectRecord, 'layout' | 'tuning' | 'laidOutWith'>,
): string | null {
  if (record.layout === null || sameTuning(record.tuning, record.laidOutWith)) return null
  const wanted = tuningIsSet(record.tuning) ? 'this tuning' : LOOM_DEFAULTS
  const had = tuningIsSet(record.laidOutWith) ? 'another tuning' : LOOM_DEFAULTS
  return `Lay out again to use ${wanted}: the map on screen was laid out with ${had}.`
}

/**
 * The screen's project once `projects.setTuning` has answered: the record
 * it wrote laid over it, the two tunings included where the record holds
 * neither, so the screen keeps only what it adds of its own (whether the
 * project is read-only).
 *
 * Not the spread the other writers merge their answer with
 * (`{ ...project, ...record }`): this is the one writer that removes a key.
 * A reset, or a last field put back to LOOM's own, leaves the record with no
 * `tuning` at all, and a spread would keep the tuning the screen had - so
 * the cell would go on saying the layout is of another tuning, and the next
 * layout run, started from the screen's record, would send the tuning a
 * person had just cleared.
 */
export function tunedProject<P extends ProjectRecord>(project: P, record: ProjectRecord): P {
  const next = { ...project, ...record }
  if (record.tuning === undefined) delete next.tuning
  if (record.laidOutWith === undefined) delete next.laidOutWith
  return next
}
