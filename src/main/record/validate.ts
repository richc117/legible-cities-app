// The record's validators that only the main process runs (spec 037, User
// Story 5): the whole objects a setter is handed over the bridge, the facts a
// run reports, the folder and the theme, each checked in the handler because
// it arrived from another process and in the store because the store is the
// trusted layer. The validators the interface runs as well are
// `src/shared/project/validate.ts`. Pure: no Electron, no filesystem.

import { isLayoutId } from '../../shared/layout'
import {
  either,
  GRID_SENTENCE,
  lineNameSentence,
  linePath,
  lineWidthSentence,
  styleChoiceSentence,
  styleRangeSentence,
  tuningRangeSentence,
} from '../../shared/project/sentences'
import {
  CASING_WIDTH_RANGE,
  CHOICE_KEYS,
  LINE_DASHES,
  LINE_FIELDS,
  LINE_WIDTH_RANGE,
  type ProjectStyle,
  STYLE_GROUP,
  STYLE_KEYS,
  TRAIN_KEYS,
  TUNING_KEYS,
} from '../../shared/project/types'
import {
  COLORS_MAX,
  inStyleRange,
  inTuningRange,
  isGrid,
  isHexColor,
  isLineDash,
  isLineName,
  isStyleChoice,
  isTheme,
  radiiRefusal,
  validateLineLabel,
  validateLineOrder,
  validateServiceDate,
} from '../../shared/project/validate'
import { isStorableFolder } from '../../shared/settings'
import { isObject } from '../../shared/errors'

/**
 * A theme a person chose (A4-03). Checked in the main-side handler because
 * it arrived from another process, and in the store because the store is
 * the trusted layer; the switch itself can only send one of the two.
 */
export function validateTheme(theme: unknown): string | null {
  return isTheme(theme) ? null : 'the theme must be warm-dark or sepia'
}

/**
 * Where a project's exports go, or null for the app's own folder
 * (A5.5-19). Checked in the store because the store is the trusted layer,
 * and again on the way in - though nothing on the bridge can send a folder
 * of its own choosing: the main process opens the chooser and applies the
 * answer itself, and a path that no dialog of ours answered is refused
 * before this is reached.
 *
 * The rule itself is `isStorableFolder`, the one Settings stores a folder
 * by: absolute, of a sane length, and free of the control characters a
 * filesystem call would carry into a surprise. Whether a particular folder
 * may be written to - inside the app's own bundle, inside the engine's
 * home - is the main process's to say, because only it knows where those
 * are.
 */
export function validateDestination(folder: unknown): string | null {
  if (folder === null) return null
  return isStorableFolder(folder) ? null : "a folder is chosen in the app's own dialog"
}

export const ID_PATTERN = /^[a-z][a-z0-9]{11}$/

export function validateId(id: string): string | null {
  return ID_PATTERN.test(id) ? null : 'invalid id'
}

/**
 * The palette a person chose (A4-01): overrides by line label and the
 * colour a line the feed leaves uncoloured takes. Checked in the
 * main-side handler because it arrived from another process, and in the
 * store because the store is the trusted layer. The form checks each
 * colour itself (`isHexColor`, `validateLineLabel`), and never imports
 * this.
 */
export function validatePalette(palette: unknown): string | null {
  if (typeof palette !== 'object' || palette === null || Array.isArray(palette))
    return 'the colours must be a line for each colour'
  const { colors, defaultColor } = palette as Record<string, unknown>
  if (!isHexColor(defaultColor))
    return 'the default colour must be written #rrggbb, six hexadecimal digits'
  if (typeof colors !== 'object' || colors === null || Array.isArray(colors))
    return 'the colours must be a line for each colour'
  const entries = Object.entries(colors as Record<string, unknown>)
  if (entries.length > COLORS_MAX) return `that is more than ${COLORS_MAX} lines`
  for (const [label, colour] of entries) {
    const problem = validateLineLabel(label)
    if (problem !== null) return problem
    if (!isHexColor(colour))
      return `the colour for ${label} must be written #rrggbb, six hexadecimal digits`
  }
  return null
}

/**
 * A window as the engine answered it: four calendar days, the first no
 * later than the last. The days are ISO, so they order as strings.
 */
export function validateServiceWindow(service: unknown): string | null {
  if (typeof service !== 'object' || service === null || Array.isArray(service))
    return 'the service window must be the four days the engine answered'
  const days = service as Record<string, unknown>
  for (const field of ['start', 'end', 'busiest', 'anchor'] as const) {
    const value = days[field]
    if (typeof value !== 'string') return `the service window is missing its ${field}`
    const problem = validateServiceDate(value)
    if (problem !== null) return `the service window's ${field}: ${problem}`
  }
  if ((days.start as string) > (days.end as string))
    return 'the service window ends before it starts'
  return null
}

// Exported, with `MADE_PATTERN`, for tests/unit/compatibility.test.ts alone.
export const MADE_MAX = 64
// ISO 8601 with a time and an offset, as the engine writes it beside a
// stored layout (isoformat with seconds, in UTC). Compared as a string, so
// the shape is pinned before the value is trusted, as a day's is.
export const MADE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** The engine's `made`: an ISO timestamp a clock could have written. */
export function validateMade(made: unknown): string | null {
  if (typeof made !== 'string' || made === '')
    return 'the layout run did not say when the layout was made'
  if (made.length > MADE_MAX || !MADE_PATTERN.test(made) || Number.isNaN(Date.parse(made)))
    return 'the layout run gave a time that is not one'
  return null
}

/**
 * A style a store may be asked to write: an object of the group's fields,
 * each a number the engine accepts or a marker or face it offers, the pair of
 * radii in order. Null when it is. The store is the trusted layer and checks
 * it again after the bridge, as it does every other thing a person chose.
 *
 * In the engine's order where it has one: the eight sizes, the markers and
 * the face, the pair of radii, and then the two train numbers, which the
 * engine judges after the style as the parameters they are.
 */
export function validateStyle(style: unknown): string | null {
  if (!isObject(style)) return 'the style must be an object'
  for (const key of Object.keys(style)) {
    if (!(STYLE_GROUP as readonly string[]).includes(key)) return `the style does not take ${key}`
  }
  const fields: ProjectStyle = {}
  for (const key of STYLE_KEYS) {
    const value = style[key]
    if (value === undefined) continue
    if (!inStyleRange(key, value)) return styleRangeSentence(key)
    fields[key] = value as number
  }
  for (const key of CHOICE_KEYS) {
    const value = style[key]
    if (value !== undefined && !isStyleChoice(key, value)) return styleChoiceSentence(key)
  }
  const radii = radiiRefusal(fields)
  if (radii !== null) return radii
  for (const key of TRAIN_KEYS) {
    const value = style[key]
    if (value !== undefined && !inStyleRange(key, value)) return styleRangeSentence(key)
  }
  return null
}

/**
 * A tuning a store may be asked to write: an object of the eight fields, the
 * grid one of the four, each number inside its range. Null when it is. Any
 * other field is refused, and so is a value of the wrong kind, `null`
 * included, as the engine refuses them. Checked in the main-side handler
 * because it arrived from another process, and in the store because the
 * store is the trusted layer.
 */
export function validateTuning(tuning: unknown): string | null {
  if (!isObject(tuning)) return 'the tuning must be an object'
  for (const key of Object.keys(tuning)) {
    if (key !== 'grid' && !(TUNING_KEYS as readonly string[]).includes(key))
      return `the tuning does not take ${key}`
  }
  if (tuning.grid !== undefined && !isGrid(tuning.grid)) return GRID_SENTENCE
  for (const key of TUNING_KEYS) {
    const value = tuning[key]
    if (value !== undefined && !inTuningRange(key, value)) return tuningRangeSentence(key)
  }
  return null
}

/** A finite number, and not a boolean: what the engine's `_number` takes. */
const isLineNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A width the engine takes: a multiple of the line width inside its closed range. */
export function isLineWidth(value: unknown): value is number {
  return isLineNumber(value) && value >= LINE_WIDTH_RANGE.low && value <= LINE_WIDTH_RANGE.high
}

/** A casing's width the engine takes, 0 included (which draws none). */
export function isCasingWidth(value: unknown): value is number {
  return isLineNumber(value) && value >= CASING_WIDTH_RANGE.low && value <= CASING_WIDTH_RANGE.high
}

/**
 * Why the engine would refuse one line's options, in its own sentence and
 * order (`serve._lines` at v0.16.0), or null: the name, hidden, the width, the
 * casing, the dash, and then any key it does not take.
 */
// Exported for tests/unit/line-options-record.test.ts alone; `validateLines` is its one caller.
export function validateLineChoice(label: string, choice: unknown): string | null {
  const at = linePath(label)
  if (!isObject(choice)) return `${at} must be an object of name, hidden, width, casing and dash`
  // A field that is undefined is a field not given, as the style's validator
  // reads one: JSON never carries one, and a call over the bridge can.
  if (choice.name !== undefined && !isLineName(choice.name)) return lineNameSentence(label)
  if (choice.hidden !== undefined && typeof choice.hidden !== 'boolean')
    return `${at}.hidden must be true or false`
  if (choice.width !== undefined && !isLineWidth(choice.width)) return lineWidthSentence(label)
  if (choice.casing !== undefined) {
    const casing = choice.casing
    if (!isObject(casing) || Object.keys(casing).some((key) => key !== 'width' && key !== 'color'))
      return `${at}.casing must be an object of width and color`
    if (casing.width === undefined || casing.color === undefined)
      return `${at}.casing must have both width and color`
    if (!isCasingWidth(casing.width)) {
      const { low, high } = CASING_WIDTH_RANGE
      return `${at}.casing.width must be from ${low} to ${high}, as a multiple of line_width on each side`
    }
    if (!isHexColor(casing.color)) return `${at}.casing.color must be a colour written #rrggbb`
  }
  if (choice.dash !== undefined && !isLineDash(choice.dash))
    return `${at}.dash must be ${either(LINE_DASHES)}`
  const rest = Object.keys(choice)
    .filter((key) => !(LINE_FIELDS as readonly string[]).includes(key))
    .sort()
  if (rest.length > 0) return `${at} does not take ${rest.join(', ')}`
  return null
}

/**
 * The options a store may be asked to write: an object of line label to one
 * line's options, each label one the record can hold, no more lines than a
 * record holds colours, and each line's options as the engine takes them, in
 * its sentences. Null when they are. Checked in the main-side handler because
 * they arrived from another process, and in the store because the store is
 * the trusted layer.
 */
export function validateLines(lines: unknown): string | null {
  if (!isObject(lines))
    return "lines must be an object of line label to the line's name, hidden, width, casing and dash"
  const entries = Object.entries(lines)
  if (entries.length > COLORS_MAX) return `that is more than ${COLORS_MAX} lines`
  for (const [label, choice] of entries) {
    const problem = validateLineLabel(label) ?? validateLineChoice(label, choice)
    if (problem !== null) return problem
  }
  return null
}

/**
 * Why a sent set is not one this record could hold, or null. It arrives from
 * the renderer, the less trusted process, so every field is held to the rule
 * the record's own field is, with that field's sentence, as a setter's
 * argument is: the layout's id and its time, the day, the palette, the
 * order, the style and the line options.
 */
export function validateSent(sent: unknown): string | null {
  if (typeof sent !== 'object' || sent === null || Array.isArray(sent))
    return 'the run did not say what its map was drawn from'
  const given = sent as Record<string, unknown>
  if (!isLayoutId(given.layout)) return 'the layout run did not say which layout it drew from'
  if (given.made !== null) {
    const problem = validateMade(given.made)
    if (problem !== null) return problem
  }
  const day = validateServiceDate(typeof given.date === 'string' ? given.date : '')
  if (day !== null) return day
  return (
    validatePalette({ colors: given.colors, defaultColor: given.defaultColor }) ??
    validateLineOrder(given.lineOrder) ??
    validateStyle(given.style) ??
    (given.lines === undefined ? null : validateLines(given.lines))
  )
}
