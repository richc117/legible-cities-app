// The engine's own sentences for what it refuses (spec 037, User Story 5),
// word for word, so a person is told what the engine would have said and a
// pin that changes one is a change to this file. They are kept together
// rather than split by who says them: the cells say them beside a field, main
// in the refusal of a write, and most are said by both. The one only the
// interface says, and main refuses nothing with, is the renderer's
// (`EVERY_LINE_HIDDEN`, `src/renderer/src/record.ts`). Pure, as `./types` is.

import {
  type ChoiceKey,
  type FigureKey,
  GRIDS,
  isTrainKey,
  LINE_NAME_MAX,
  LINE_WIDTH_RANGE,
  STYLE_CHOICES,
  STYLE_RANGES,
  TRAIN_RANGES,
  TUNING_RANGES,
  type TuningKey,
} from './types'

/** `a, b or c`: the names a refusal offers, in the table's order, as the engine writes them. */
export const either = (names: readonly string[]): string =>
  names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`

/**
 * The engine's sentence for a number outside what a field accepts, word for
 * word `serve._style`'s at v0.12.0, so a person is told what the engine
 * would have said and the screen and the engine do not disagree about a
 * word. It names the field the way the engine does (`style.line_width`).
 *
 * A train number is a parameter of `map.build` itself, and the engine's
 * sentence for it (`serve._animation_number` at v0.15.0) names it bare:
 * "dot_radius must be from 2 to 12, in SVG user units at the map's width".
 */
export function styleRangeSentence(key: FigureKey): string {
  if (isTrainKey(key)) {
    const { wire, low, high, unit } = TRAIN_RANGES[key]
    return `${wire} must be from ${low} to ${high}, in ${unit}`
  }
  const { wire, low, high, ratio } = STYLE_RANGES[key]
  return (
    `style.${wire} must be from ${low} to ${high}, ` +
    (ratio ? 'as a multiple of line_width' : "in SVG user units at the map's width")
  )
}

/**
 * The engine's sentence for a marker or a face it does not offer, word for
 * word `serve._style`'s at v0.15.0: "style.station_shape must be circle,
 * tick or square".
 */
export function styleChoiceSentence(key: ChoiceKey): string {
  const { wire, options } = STYLE_CHOICES[key]
  return `style.${wire} must be ${either(options)}`
}

/**
 * The engine's sentence for an interchange radius below the station radius,
 * judged on the values the map would be drawn with. `serve._style`'s, word
 * for word.
 */
export function radiiSentence(interchange: number, station: number): string {
  return (
    `style.interchange_radius (${interchange}) must not be below ` +
    `style.station_radius (${station}); a field left out counts as its default, ` +
    `so send both`
  )
}

/**
 * The engine's sentence for a number outside what a field accepts, word for
 * word `serve._tuned`'s at v0.14.0 (its `:g` prints these ranges as
 * written), naming the field by the path a client writes it at.
 */
export function tuningRangeSentence(key: TuningKey): string {
  const { wire, low, high, unit } = TUNING_RANGES[key]
  return `tuning.${wire} must be from ${low} to ${high}, ${unit}`
}

/** The engine's sentence for a grid it does not offer, word for word `serve._tuning`'s. */
export const GRID_SENTENCE = `tuning.grid must be one of ${GRIDS.join(', ')}`

/**
 * A label as Python's `repr` writes it, which is how the engine names a line
 * in a refusal (`lines['A'].width ...`): in single quotes, or in double quotes
 * where the label holds a single quote and no double one; a backslash and the
 * quote escaped, and a character Python does not print as itself written as
 * its code. A label the record can hold carries no control character, so the
 * last rule is for the rare space or format character.
 */
// Exported for tests/unit/line-options-record.test.ts alone; `linePath` is its one caller.
export function pythonRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  let out = quote
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (character === '\\' || character === quote) out += `\\${character}`
    else if (character === '\n') out += '\\n'
    else if (character === '\r') out += '\\r'
    else if (character === '\t') out += '\\t'
    else if (character !== ' ' && /[\p{C}\p{Z}]/u.test(character)) {
      const hex = code.toString(16)
      out +=
        code < 0x100
          ? `\\x${hex.padStart(2, '0')}`
          : code < 0x10000
            ? `\\u${hex.padStart(4, '0')}`
            : `\\U${hex.padStart(8, '0')}`
    } else out += character
  }
  return out + quote
}

/** Where a refusal names a line's field, as the engine writes the path. */
export const linePath = (label: string): string => `lines[${pythonRepr(label)}]`

/** The engine's sentence for a name it does not take, word for word `serve._lines`'s. */
export function lineNameSentence(label: string): string {
  return `${linePath(label)}.name must be from 1 to ${LINE_NAME_MAX} characters with no line break`
}

/** The engine's sentence for a width outside its range. */
export function lineWidthSentence(label: string): string {
  const { low, high } = LINE_WIDTH_RANGE
  return `${linePath(label)}.width must be from ${low} to ${high}, as a multiple of line_width`
}
