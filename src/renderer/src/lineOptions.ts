import type { MapBuildParams } from '../../shared/protocol'
import {
  DEFAULT_CASING_COLOR,
  DEFAULT_LINE,
  isLineName,
  LINE_NAME_MAX,
  lineNameSentence,
  linesSent,
  sameLines,
  settledLine,
  type LineChoice,
  type LineDash,
  type ProjectLines,
} from '../../shared/project'

// Cell 05's line options, with no React in it (issue 394, spec 036): the
// steps each select offers, the sentences the section says, the summary a
// collapsed row carries, what each control does to a line's options, and
// what `map.build` is sent for them. The record's entry is the engine's own
// `LineOptions`, so the wire form is the record's options as they are kept
// (`linesSent`), under the key the engine reads them by. The section itself
// (`LineOptionsDisclosure.tsx`) is then only a screen.

/** What the disclosure is called, on its row and in its group's name. */
export const OPTIONS_NAME = 'Line options'

/** The controls' names, as their labels say them. */
export const NAME_LABEL = 'Name'
export const SHOWN_LABEL = 'Shown'
export const WIDTH_LABEL = 'Width'
export const CASING_LABEL = 'Casing'
export const DASH_LABEL = 'Dash'
export const RESET_LINE_LABEL = 'Reset line'

/** One step a select offers: the number it stands for, its word, and the word a summary says. */
export interface Step {
  value: number
  label: string
  /** The word in a collapsed row's summary; none for the engine's own. */
  word: string | null
}

/**
 * The widths the cell offers (spec 036, FR-004), as multiples of the map's
 * line width, Regular being the engine's own.
 */
export const WIDTH_STEPS: readonly Step[] = [
  { value: 0.75, label: 'Thin', word: 'thin' },
  { value: DEFAULT_LINE.width, label: 'Regular', word: null },
  { value: 1.25, label: 'Bold', word: 'bold' },
  { value: 1.5, label: 'Heavy', word: 'heavy' },
]

/** The casings the cell offers (FR-005), as multiples of the line width on each side. */
export const CASING_STEPS: readonly Step[] = [
  { value: DEFAULT_LINE.casingWidth, label: 'None', word: null },
  { value: 0.25, label: 'Thin', word: 'cased' },
  { value: 0.5, label: 'Regular', word: 'cased' },
  { value: 1, label: 'Wide', word: 'cased' },
]

/** The dashes, in the engine's order and its names, with their words (FR-006). */
export const DASH_OPTIONS: readonly { value: LineDash; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

/** What a name is, and that empty is the label (FR-002). */
export const nameSentence = (label: string): string =>
  `Shown in place of ${label} in the page’s chips, rows and time chart, and on its trains. ` +
  `Up to ${LINE_NAME_MAX} characters; left empty, the line is called ${label}.`

/** What turning the switch off does (FR-003). */
export const SHOWN_SENTENCE =
  'Off takes the line off the map and the page: its track, its trains, its chip and its row. ' +
  'The lines beside it close up over its place, and nothing is laid out again.'

/** What the widths stand for (FR-004). */
export const WIDTH_SENTENCE =
  'A multiple of the map’s line width: thin 0.75, regular 1, bold 1.25, heavy 1.5. ' +
  'A wider line moves the lines beside it out to make room.'

/** What the casings stand for (FR-005). */
export const CASING_SENTENCE =
  'A stroke either side of the line, a multiple of the line width on each side: ' +
  'thin 0.25, regular 0.5, wide 1.'

/** The note beside the casing's colour (FR-005): it is a literal, and the theme does not move it. */
export const CASING_COLOUR_SENTENCE =
  'The casing keeps this colour in both of the map’s themes, so choose one that reads on the map’s ground.'

/** What a dash is (FR-006). */
export const DASH_SENTENCE =
  'Paint only: a dashed or dotted line takes the room a solid one does, and its trains run the whole track.'

/** The disclosure's group, which names its line, as every control in the list does. */
export const optionsName = (label: string): string => `${OPTIONS_NAME} for line ${label}`

/** Reset line's name: the visible words first, then the line (WCAG 2.5.3). */
export const resetLineName = (label: string): string => `Reset line ${label}’s options`

/** The casing chip's name and its panel's. */
export const casingChipName = (label: string): string => `Choose the casing colour of line ${label}`
export const casingPanelName = (label: string): string => `Casing colour for line ${label}`

/**
 * The options a select offers for a number a line holds: its steps, and, for
 * a number that is none of them (a record written by hand, in range), one
 * more at the end that says the number, so the select never shows a step the
 * line does not hold. `unit` is what the number counts.
 */
function stepOptions(
  steps: readonly Step[],
  held: number,
  unit: string,
): { value: string; label: string }[] {
  const options = steps.map(({ value, label }) => ({ value: String(value), label }))
  if (!steps.some((step) => step.value === held))
    options.push({ value: String(held), label: `${held} times ${unit}` })
  return options
}

/** What a line's width is, the engine's own where it holds none. */
export const widthOf = (choice: LineChoice): number => choice.width ?? DEFAULT_LINE.width

/** What a line's casing is on each side, 0 where it holds none. */
export const casingWidthOf = (choice: LineChoice): number =>
  choice.casing?.width ?? DEFAULT_LINE.casingWidth

/** What a line's casing is drawn in, white where it holds none. */
export const casingColourOf = (choice: LineChoice): string =>
  choice.casing?.color ?? DEFAULT_CASING_COLOR

export const widthOptions = (choice: LineChoice): { value: string; label: string }[] =>
  stepOptions(WIDTH_STEPS, widthOf(choice), 'the line width')

export const casingOptions = (choice: LineChoice): { value: string; label: string }[] =>
  stepOptions(CASING_STEPS, casingWidthOf(choice), 'the line width on each side')

/**
 * What a collapsed row says (FR-001): "Default" for a line that holds
 * nothing, or what it holds, in the order hidden, the width, the casing, the
 * dash, the name, the first word capitalised ("Bold, dashed, renamed"). A
 * width that is none of the steps is "thinner" or "wider".
 */
export function optionsSummary(label: string, choice: LineChoice | undefined): string {
  const held = settledLine(label, choice ?? {})
  const words: string[] = []
  if (held.hidden === true) words.push('hidden')
  if (held.width !== undefined) {
    const step = WIDTH_STEPS.find((each) => each.value === held.width)
    words.push(step?.word ?? (held.width < DEFAULT_LINE.width ? 'thinner' : 'wider'))
  }
  if (held.casing !== undefined) words.push('cased')
  if (held.dash !== undefined) words.push(held.dash)
  if (held.name !== undefined) words.push('renamed')
  if (words.length === 0) return 'Default'
  const said = words.join(', ')
  return said.charAt(0).toUpperCase() + said.slice(1)
}

/** What a committed name is: the name to keep, none, or the engine's refusal. */
export type NameRead = { name: string | undefined } | { refused: string }

/**
 * A name as typed and committed (FR-002): trimmed; empty, or the line's own
 * label, is no name; a name the engine would refuse - past 40 characters, or
 * with a line break of any kind - is refused in its own sentence.
 */
export function readName(label: string, text: string): NameRead {
  const name = text.trim()
  if (name === '' || name === label) return { name: undefined }
  return isLineName(name) ? { name } : { refused: lineNameSentence(label) }
}

/** A line's options without a field, so no key is left holding undefined. */
function without(choice: LineChoice, field: keyof LineChoice): LineChoice {
  const next = { ...choice }
  delete next[field]
  return next
}

/** A line given a name, or none. */
export const withName = (choice: LineChoice, name: string | undefined): LineChoice =>
  name === undefined ? without(choice, 'name') : { ...choice, name }

/** A line shown, or hidden. `hidden` is only ever held true. */
export const withShown = (choice: LineChoice, shown: boolean): LineChoice =>
  shown ? without(choice, 'hidden') : { ...choice, hidden: true }

/** A line at a width; the engine's own holds none. */
export const withWidth = (choice: LineChoice, width: number): LineChoice =>
  width === DEFAULT_LINE.width ? without(choice, 'width') : { ...choice, width }

/**
 * A line with a casing of this width on each side, in the colour it had, or
 * white for a casing chosen afresh; none removes the casing and its colour.
 */
export const withCasingWidth = (choice: LineChoice, width: number): LineChoice =>
  width === DEFAULT_LINE.casingWidth
    ? without(choice, 'casing')
    : { ...choice, casing: { width, color: casingColourOf(choice) } }

/** A line's casing in another colour; a line with no casing has none to colour. */
export const withCasingColour = (choice: LineChoice, color: string): LineChoice =>
  choice.casing === undefined ? choice : { ...choice, casing: { ...choice.casing, color } }

/** A line with a dash; solid holds none. */
export const withDash = (choice: LineChoice, dash: LineDash): LineChoice =>
  dash === DEFAULT_LINE.dash ? without(choice, 'dash') : { ...choice, dash }

/**
 * Every line's options with one line's replaced, kept as the store keeps
 * them: the line settled, and gone where it holds nothing, which is what
 * Reset line leaves.
 */
export function linesWith(lines: ProjectLines, label: string, choice: LineChoice): ProjectLines {
  const next = { ...lines }
  const line = settledLine(label, choice)
  if (Object.keys(line).length > 0) next[label] = line
  else delete next[label]
  return next
}

/** One line's options as the section shows them: what is held, or nothing. */
export function choiceOf(lines: ProjectLines, label: string): LineChoice {
  return Object.prototype.hasOwnProperty.call(lines, label) ? lines[label] : {}
}

/** Does a line hold anything? Reset line can be pressed while it does. */
export const lineIsSet = (lines: ProjectLines, label: string): boolean =>
  Object.keys(settledLine(label, choiceOf(lines, label))).length > 0

/** Is a line hidden? Its row is dimmed while it is. */
export const isHidden = (lines: ProjectLines, label: string): boolean =>
  choiceOf(lines, label).hidden === true

/**
 * Would hiding this line hide every line the cell lists (FR-003)? The engine
 * refuses a map with every line hidden, so the switch refuses the last one.
 */
export function hidesEveryLine(
  lines: ProjectLines,
  listed: readonly string[],
  label: string,
): boolean {
  return listed.every((each) => each === label || isHidden(lines, each))
}

/**
 * What a change should do at this moment (FR-010): build it, wait for the
 * way to clear, or nothing because it is not a change from what the record
 * holds. A change made while a run, an export or the reading-back of a
 * finished run holds the page waits rather than being refused.
 *
 * **It waits before it is compared.** While something holds the page the
 * record is about to move - a redraw of these very options may be about to
 * write - so "the same as the record" is a question about a record that is
 * not the one the person will come back to. A switch turned off and on
 * again while the first build runs equals the record still on disk, and
 * comparing then would drop it; the build would write the line hidden and
 * the switch would go back off under the person's hand. Asked again once
 * the way is clear, it is compared with the record that build wrote.
 */
export function nextLinesStep(
  next: ProjectLines,
  stored: ProjectLines | undefined,
  busy: boolean,
): 'build' | 'wait' | 'none' {
  if (busy) return 'wait'
  return sameLines(next, stored) ? 'none' : 'build'
}

/**
 * What `map.build` is sent for a project's line options: `lines`, keyed by
 * line label, each line only the fields that are not the engine's own, and
 * nothing at all for a project that chose none, so its request is the one it
 * always sent (spec 036, FR-009). A line's colour and its place in the stack
 * are not here: they stay `colors`, `default_color` and `line_order`, which
 * `lines` does not carry, so nothing in it competes with them.
 */
export function linesParams(lines: ProjectLines | undefined): Pick<MapBuildParams, 'lines'> {
  const sent = linesSent(lines)
  return Object.keys(sent).length === 0 ? {} : { lines: sent }
}
