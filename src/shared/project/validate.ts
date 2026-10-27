// The record's validators that both processes run (spec 037, User Story 5):
// a field checked in a form or a panel before it is sent and again in main
// after the bridge, the limits they hold to, and the predicates both sides
// read a value by. A validator only main runs - the whole objects a setter
// is handed, the facts a run reports - is `src/main/record/validate.ts`.
// Pure, as `./types` is.

import { radiiSentence, styleChoiceSentence, styleRangeSentence } from './sentences'
import {
  CHOICE_KEYS,
  type ChoiceKey,
  DEFAULT_STYLE,
  FIGURE_KEYS,
  type FigureKey,
  type Grid,
  GRIDS,
  isTrainKey,
  LINE_DASHES,
  LINE_NAME_MAX,
  type LineDash,
  type ProjectStyle,
  STYLE_CHOICES,
  STYLE_RANGES,
  type Theme,
  THEMES,
  TRAIN_RANGES,
  TUNING_RANGES,
  type TuningKey,
} from './types'

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}

/**
 * The engine's version as `engine.info` answers it and `vendor/pins.json`
 * names it: three whole numbers with no leading zero, each of at most nine
 * digits. The supervisor refuses any engine whose version is not the pin's
 * exactly, and every pin has been of this form; anything else - a
 * pre-release, a local build's suffix - is not read as a version here, and
 * is never ordered by a guess at how the suffix orders: a running version
 * of that kind leaves the judgement to the page's seam, and a recorded one
 * is dropped as the record is read, as if none had been written.
 */
const ENGINE_VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/

/** Whether a value is an engine's version this build can compare (`ENGINE_VERSION`). */
export function isEngineVersion(value: unknown): value is string {
  return typeof value === 'string' && ENGINE_VERSION.test(value)
}

export const FEED_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// The engine's own rules for the two it validates: a mode is what LOOM's -m
// takes, names or route_type numbers, comma-joined; an agency_id is at most
// 64 characters. Held to the engine's schema by tests/unit/project.test.ts.
export const MODE_PATTERN = /^[a-z0-9-]+(,[a-z0-9-]+)*$/
export const NAME_MAX = 120
// Exported for tests/unit/project.test.ts alone, which holds it to the form's own limit.
export const AGENCY_MAX = 64

/**
 * The two refusals of a project's name, said as sentences that lead with
 * what to do (DESIGN.md section 11, issue 548): they reach the screen as
 * written, under the name field of the New project sheet and the rename.
 */
export const NAME_REQUIRED = 'Give the project a name.'
export const NAME_TOO_LONG = `Shorten the name to ${NAME_MAX} characters or fewer.`

export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return NAME_REQUIRED
  if (trimmed.length > NAME_MAX) return NAME_TOO_LONG
  return null
}

export function validateFeedKey(feed: string): string | null {
  if (!FEED_PATTERN.test(feed)) {
    return 'feed key must be lowercase letters, digits and hyphens'
  }
  return null
}

export function validateMode(mode: string): string | null {
  if (mode.length > 64 || !MODE_PATTERN.test(mode))
    return 'mode must be one or more of the modes LOOM knows, such as tram or subway, comma-joined'
  return null
}

export function validateAgency(agency: string | null): string | null {
  if (agency === null) return null
  if (agency.trim().length > AGENCY_MAX)
    return `agency is too long (${AGENCY_MAX} characters at most)`
  return null
}

/**
 * A line label is the engine's own: `route_short_name`, or the long name
 * through the feed's label pattern and strip. The protocol puts no rule on
 * it beyond being a string, so the rule here is the app's own and is about
 * what a record and a screen can hold, not about what a feed may publish.
 */
export const LABEL_MAX = 64
/**
 * More overrides than any feed could draw lines. A cap so a call from
 * another process cannot make the record grow without bound; no real feed
 * comes near it.
 */
export const COLORS_MAX = 512

/** A colour a person or a feed chose, written `#rrggbb`. */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export function validateLineLabel(label: string): string | null {
  if (label === '') return 'a line needs a label'
  // Assigning this key on a plain object writes the prototype rather than a
  // property, so a record could store it and never read it back. Refusing
  // it here is what keeps the write and the read agreeing.
  if (label === '__proto__') return 'a line cannot be called __proto__'
  if (label.length > LABEL_MAX) return `a line label is too long (${LABEL_MAX} characters at most)`
  for (const character of label) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return 'a line label cannot carry a control character'
  }
  return null
}

/**
 * The order a person arranged (A4-02): line labels the record can hold,
 * each once. Checked in the panel so no move is made that the store would
 * reject, in the main-side handler because it arrived from another process,
 * and in the store because the store is the trusted layer.
 *
 * A label twice would draw one line over itself and leave another line's
 * place ambiguous, so it is refused rather than quietly deduplicated: the
 * app only ever sends an arrangement it has just shown someone.
 */
export function validateLineOrder(order: unknown): string | null {
  if (!Array.isArray(order)) return 'the order must be a list of lines'
  if (order.length > COLORS_MAX) return `that is more than ${COLORS_MAX} lines`
  const seen = new Set<string>()
  for (const label of order) {
    if (typeof label !== 'string') return 'the order must be a list of lines'
    const problem = validateLineLabel(label)
    if (problem !== null) return problem
    if (seen.has(label)) return `${label} is in the order twice`
    seen.add(label)
  }
  return null
}

/** A service day, YYYY-MM-DD, that names a real calendar day. */
export function validateServiceDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'the service day must be written YYYY-MM-DD'
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return 'that is not a day in the calendar'
  }
  return null
}

// ---- The map's sizes (issue 350, ADR-049, ADR-050), and since issue 391 its
// markers, its label face and its trains (spec 034)

/** A finite number, which is the only thing a field can hold. */
const isFigure = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The closed range a number field accepts, a size's or a train's. */
function rangeOf(key: FigureKey): { low: number; high: number } {
  return isTrainKey(key) ? TRAIN_RANGES[key] : STYLE_RANGES[key]
}

/**
 * Whether a value is one the engine accepts for a field: a finite number
 * inside its closed range. Not-a-number, an infinity and a string are all
 * refused with the range sentence, as the engine refuses them.
 */
export function inStyleRange(key: FigureKey, value: unknown): boolean {
  const { low, high } = rangeOf(key)
  return isFigure(value) && value >= low && value <= high
}

/** Whether a value is one the engine offers for a marker or the face. */
export function isStyleChoice(key: ChoiceKey, value: unknown): boolean {
  return typeof value === 'string' && STYLE_CHOICES[key].options.includes(value)
}

/**
 * The engine's refusal of the pair of radii, or null: the interchange radius
 * may not be below the station radius, judged on the values the map would be
 * drawn with, a field left out counting as the engine's default. So a
 * station radius above 6 with the interchange radius unset is refused too.
 *
 * Null as well when either number is outside its own range: the engine
 * judges the ranges first and the pair only after them, and a number that is
 * not one has no pair to be judged in.
 */
export function radiiRefusal(style: ProjectStyle): string | null {
  const station = style.stationRadius ?? DEFAULT_STYLE.stationRadius
  const interchange = style.interchangeRadius ?? DEFAULT_STYLE.interchangeRadius
  if (!inStyleRange('stationRadius', station) || !inStyleRange('interchangeRadius', interchange))
    return null
  return interchange < station ? radiiSentence(interchange, station) : null
}

/** Why the engine would refuse a style, by field. */
export type StyleRefusals = Partial<Record<FigureKey | ChoiceKey, string>>

/**
 * Why the engine would refuse this style, field by field, in its own
 * sentences, before anything is sent; empty when it would take it.
 *
 * A number outside its range is that field's, a train number's included. The
 * two radii are judged together (`radiiRefusal`), and the sentence is the
 * interchange radius's, as the engine's names it first. A marker or a face
 * the engine does not offer is that field's too, though no control can choose
 * one and a record that holds one reads it as not held (`readStyle`).
 */
export function styleRefusals(style: ProjectStyle): StyleRefusals {
  const refused: StyleRefusals = {}
  for (const key of FIGURE_KEYS) {
    if (style[key] !== undefined && !inStyleRange(key, style[key]))
      refused[key] = styleRangeSentence(key)
  }
  for (const key of CHOICE_KEYS) {
    if (style[key] !== undefined && !isStyleChoice(key, style[key]))
      refused[key] = styleChoiceSentence(key)
  }
  const radii = radiiRefusal(style)
  if (radii !== null) refused.interchangeRadius = radii
  return refused
}

export function isGrid(value: unknown): value is Grid {
  return GRIDS.some((grid) => grid === value)
}

/** A finite number inside the field's closed range, as the engine judges one. */
export function inTuningRange(key: TuningKey, value: unknown): boolean {
  const { low, high } = TUNING_RANGES[key]
  return isFigure(value) && value >= low && value <= high
}

/** No line break of any kind, as the engine's `LINE_NAME_PATTERN` says it. */
const LINE_BREAK = /[\r\n\u2028\u2029]/

/** A name the engine takes: 1 to 40 code points, with no line break. */
export function isLineName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  // Bounded before it is spread: a code point is at most two UTF-16 units, so a
  // string past twice the limit is past the limit, and spreading a very long
  // one from the renderer would allocate an array of it first.
  if (value.length > LINE_NAME_MAX * 2) return false
  const length = [...value].length
  return length >= 1 && length <= LINE_NAME_MAX && !LINE_BREAK.test(value)
}

export function isLineDash(value: unknown): value is LineDash {
  return LINE_DASHES.some((dash) => dash === value)
}
