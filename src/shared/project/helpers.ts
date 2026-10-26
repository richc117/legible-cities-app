// What both processes derive from a record (spec 037, User Story 5): what a
// style, a tuning and a line's options are kept and sent as, which day the
// map on disk was drawn for, and whether a day may be chosen. A helper only
// one process calls lives with that process (`src/main/record/helpers.ts`,
// `src/renderer/src/record.ts`). Pure, as `./types` is.

import {
  DEFAULT_LINE,
  DEFAULT_STYLE,
  DEFAULT_TUNING,
  type LineChoice,
  type ProjectLines,
  type ProjectRecord,
  type ProjectStyle,
  type ProjectTuning,
  type ServiceWindow,
  STYLE_GROUP,
  type StyleGroupKey,
  TUNING_FIELDS,
} from './types'
import { styleRefusals, validateServiceDate } from './validate'

/** Is a field a choice? Unset, or at the engine's own value, it is not. */
export const chosen = (style: ProjectStyle, key: StyleGroupKey): boolean =>
  style[key] !== undefined && style[key] !== DEFAULT_STYLE[key]

/**
 * The style as it is kept: the fields a person chose, and none at the
 * engine's own value or unset. Out-of-range values are kept - they are
 * refused where they are shown, and `styleSent` sends nothing until they
 * are fixed.
 */
export function settledStyle(style: ProjectStyle): ProjectStyle {
  const kept: Record<string, unknown> = {}
  for (const key of STYLE_GROUP) if (chosen(style, key)) kept[key] = style[key]
  return kept as ProjectStyle
}

/**
 * Exactly what `map.build` is sent for a style, in the app's names: empty
 * when nothing is chosen, so no `style`, no `dot_radius` and no `trail` go
 * at all and the engine draws what it drew before the parameters existed;
 * otherwise the chosen fields only (one at the engine's own value is not
 * sent), with both radii whenever either is, the one not chosen as the
 * engine's default, because the engine judges them together (ADR-049).
 * Which of them go inside `style` and which beside it is `styleParams`'s
 * (`styleRules.ts`), the one place this is put on the wire.
 *
 * A style the engine would refuse sends nothing: a record that holds one
 * (a number written by hand, out of range) draws the map without it until
 * the cell's refusal is dealt with, rather than failing every draw of the
 * project, a colour change among them.
 *
 * The four colours the engine accepts are not in `ProjectStyle` and so can
 * never be here: the page's theme owns the furniture (ADR-049). Nor is a
 * look's name: a look is written as its fields (spec 034, FR-001).
 */
export function styleSent(style: ProjectStyle): ProjectStyle {
  if (Object.keys(styleRefusals(style)).length > 0) return {}
  const sent = settledStyle(style)
  if (sent.stationRadius !== undefined || sent.interchangeRadius !== undefined) {
    sent.stationRadius = style.stationRadius ?? DEFAULT_STYLE.stationRadius
    sent.interchangeRadius = style.interchangeRadius ?? DEFAULT_STYLE.interchangeRadius
  }
  return sent
}

/** Is a field a choice? Not held, or at LOOM's own, it is not. */
const tunedField = (tuning: ProjectTuning, key: keyof ProjectTuning): boolean =>
  tuning[key] !== undefined && tuning[key] !== DEFAULT_TUNING[key]

/**
 * The tuning as it is kept: the fields a person chose, in the engine's order,
 * and none at LOOM's own or not held. A field at LOOM's own number is no
 * choice - the engine would write no flag for it - so it is not kept, and a
 * tuning of nothing but defaults is `{}`.
 */
export function settledTuning(tuning: ProjectTuning): ProjectTuning {
  const kept: Record<string, unknown> = {}
  for (const key of TUNING_FIELDS) if (tunedField(tuning, key)) kept[key] = tuning[key]
  return kept as ProjectTuning
}

/** Has a person chosen any of the tuning? A field at LOOM's own is no choice. */
export function tuningIsSet(tuning: ProjectTuning | undefined): boolean {
  return tuning !== undefined && TUNING_FIELDS.some((key) => tunedField(tuning, key))
}

/**
 * Two tunings the engine would lay out the same: every field compared as it
 * would be sent, a field not held counting as LOOM's own. So `undefined`,
 * `{}` and a tuning of only defaults are the same, which is what the engine's
 * ids say of them too.
 */
export function sameTuning(a: ProjectTuning | undefined, b: ProjectTuning | undefined): boolean {
  return TUNING_FIELDS.every(
    (key) => (a?.[key] ?? DEFAULT_TUNING[key]) === (b?.[key] ?? DEFAULT_TUNING[key]),
  )
}

/**
 * One line's options as they are kept and sent: only the fields that are not
 * the engine's own, in the engine's order. A name equal to the line's own
 * label is no name (it would draw what is drawn without it), `hidden` is kept
 * only as true, a width of 1, a casing of width 0 and a solid dash are no
 * choice. Empty when nothing is left.
 */
export function settledLine(label: string, choice: LineChoice): LineChoice {
  const kept: LineChoice = {}
  if (choice.name !== undefined && choice.name !== label) kept.name = choice.name
  if (choice.hidden === true) kept.hidden = true
  if (choice.width !== undefined && choice.width !== DEFAULT_LINE.width) kept.width = choice.width
  if (choice.casing !== undefined && choice.casing.width !== DEFAULT_LINE.casingWidth)
    kept.casing = { width: choice.casing.width, color: choice.casing.color }
  if (choice.dash !== undefined && choice.dash !== DEFAULT_LINE.dash) kept.dash = choice.dash
  return kept
}

/**
 * Every line's options as they are kept, and exactly what `map.build` is sent
 * as `lines`: each line settled (`settledLine`), and a line with nothing left
 * not there at all, so a project that chose nothing has `{}` and sends no
 * `lines` key. `hidden` is never sent false.
 */
export function linesSent(lines: ProjectLines | undefined): ProjectLines {
  const kept: ProjectLines = {}
  for (const [label, choice] of Object.entries(lines ?? {})) {
    const line = settledLine(label, choice)
    if (Object.keys(line).length > 0) kept[label] = line
  }
  return kept
}

/** Has any line an option of its own? */
// Exported for tests/unit/line-options-record.test.ts alone: no process calls it.
export function linesAreSet(lines: ProjectLines | undefined): boolean {
  return Object.keys(linesSent(lines)).length > 0
}

/**
 * The service day the map now on disk was drawn for.
 *
 * Since A5.5-15 this is **not** `record.date`: a day chosen and not yet
 * drawn moves `date` and leaves the page in the project's output folder
 * exactly where it was. Anything that reads or describes that page - the
 * export's plan, the provenance beside the file, the export preview, the
 * sentence saying what was drawn, and a redraw for new colours or a new
 * order - must ask this rather than the record's day, or it will describe
 * the picture with a day the picture does not show.
 *
 * A record from before `drawn` existed cannot say, and its stored day is
 * then the best and only answer - which is exactly what those callers used
 * before, so an old project is unaffected.
 */
export function drawnDate(record: Pick<ProjectRecord, 'date' | 'drawn'>): string | null {
  return record.drawn?.date ?? record.date
}

/** Is a day inside the window, inclusive? Both ISO, so strings compare. */
export function withinWindow(date: string, service: ServiceWindow): boolean {
  return date >= service.start && date <= service.end
}

/**
 * Why this project may not be set to this service day, or null.
 *
 * One function because the store has two writers of the day now - the day a
 * person chooses (A5.5-15) and the day a rebuild drew for (A3-04) - and a
 * day one of them would refuse must be refused by the other, in the same
 * sentence. A day that could be chosen but not drawn, or drawn but not
 * chosen, is a record that disagrees with the map beside it.
 *
 * The window is the engine's answer at a layout run (ADR-031), so a project
 * with no layout has no window and nothing for a day to be inside.
 */
export function serviceDayRefusal(
  record: Pick<ProjectRecord, 'layout' | 'service'>,
  date: string,
): string | null {
  const invalid = validateServiceDate(date)
  if (invalid !== null) return invalid
  if (record.layout === null) return 'lay the project out first'
  if (record.service === null)
    return 'lay the project out again to learn which days the feed covers'
  if (!withinWindow(date, record.service))
    return `the feed covers ${record.service.start} to ${record.service.end}`
  return null
}
