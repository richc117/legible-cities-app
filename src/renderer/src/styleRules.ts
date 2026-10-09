import type { MapStyle } from '../../shared/protocol'
import {
  DEFAULT_STYLE,
  inStyleRange,
  radiiRefusal,
  sameStyle,
  settledStyle,
  STYLE_KEYS,
  STYLE_RANGES,
  styleIsSet,
  styleRangeSentence,
  styleRefusals,
  styleSent,
  type ProjectStyle,
  type StyleKey,
} from '../../shared/project'

// The map's sizes (issue 350, ADR-049): what `map.build` is sent for them,
// and what cell 04's fields do with what is typed. The logic of
// `StyleFields.tsx`, as `colours.ts` is of `LineColours.tsx` and `order.ts`
// of `LineOrder.tsx`: pure, so that what a field refuses and what a commit
// sends can be held to a unit test without rendering.
//
// What a style sends is decided in `shared/project.ts`, beside the record,
// because the main process needs the same rule to record what a draw carried
// (`styleSent`): the fields a person chose, none at the engine's own number,
// both radii whenever either, and nothing at all for a style the engine would
// refuse. The first half of this module only puts that in the engine's names.

/**
 * The `style` object `map.build` is sent for a project's sizes, in the
 * engine's snake-case names, or null when there is none to send.
 *
 * Null, never `{}`: an omitted object draws exactly what is drawn without the
 * parameter, which is what keeps every existing project's map where it is,
 * and an empty one would be a request the app has never made. The four
 * colours the engine also takes (`background`, `station_fill`,
 * `station_stroke_color`, `label_color`) are not in `ProjectStyle` and so
 * cannot be here: the page's theme owns the furniture (ADR-049).
 */
export function mapStyle(style: ProjectStyle): MapStyle | null {
  const sent = styleSent(style)
  const wire: Record<string, number> = {}
  for (const key of STYLE_KEYS) {
    const value = sent[key]
    if (value !== undefined) wire[STYLE_RANGES[key].wire] = value
  }
  return Object.keys(wire).length === 0 ? null : (wire as MapStyle)
}

/**
 * The part of `map.build`'s params a style adds: `{ style }` when something
 * is set, and nothing at all - not a key with nothing in it - when not.
 */
export function styleParams(style: ProjectStyle): { style?: MapStyle } {
  const wire = mapStyle(style)
  return wire === null ? {} : { style: wire }
}

// ---- Cell 04's fields

/** The unit, said once above the group rather than on every field (ADR-049). */
export const UNIT_SENTENCE =
  'In the map’s own units: the map is drawn 1,800 wide, so a line width of 7 is seven of 1,800.'

/**
 * Why the margin is the frame’s one freedom, said beside it (ADR-050): the
 * frame is padded and never cropped or rotated.
 */
export const FRAME_SENTENCE =
  'The frame is padded, never cropped or rotated: a station is never cut off, and a tighter frame is a smaller margin.'

/** A field's name on the screen, which is not always the engine's. */
export const STYLE_FIELDS: readonly { key: StyleKey; label: string }[] = [
  { key: 'lineWidth', label: 'Line width' },
  { key: 'lineGap', label: 'Line gap' },
  { key: 'stationRadius', label: 'Station radius' },
  { key: 'interchangeRadius', label: 'Interchange radius' },
  { key: 'stationStroke', label: 'Station outline' },
  { key: 'labelSize', label: 'Label size' },
  { key: 'labelOffset', label: 'Label offset' },
  // The engine's `padding`; the wireframes' margin (ADR-050).
  { key: 'padding', label: 'Margin' },
]

/**
 * What a field takes, said under it: the engine's range, and the engine's
 * own number for a field left alone. The gap is the one field with no unit,
 * a multiple of the line width.
 */
export function describeField(key: StyleKey): string {
  const { low, high, ratio } = STYLE_RANGES[key]
  const range = ratio ? `${low} to ${high}, times the line width` : `${low} to ${high}`
  return `${range}. The engine’s own is ${DEFAULT_STYLE[key]}.`
}

/** What a field shows: the number a person set, else the engine's own. */
export const fieldText = (style: ProjectStyle, key: StyleKey): string =>
  String(style[key] ?? DEFAULT_STYLE[key])

/** What the fields have been typed to say, one string each. */
export type Drafts = Record<StyleKey, string>

/** The fields showing what a style holds. */
export function draftsOf(style: ProjectStyle): Drafts {
  return Object.fromEntries(STYLE_KEYS.map((key) => [key, fieldText(style, key)])) as Drafts
}

/** The sentences beside the fields that were refused, by field. */
export type Problems = Partial<Record<StyleKey, string>>

/**
 * A decimal number as a person writes one, or null: an optional sign, digits
 * and at most one point. Not `Number(text)`, which takes "0x10", "1e3" and
 * " " as numbers a person did not mean to type.
 */
export function parseFigure(text: string): number | null {
  const trimmed = text.trim()
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed)) return null
  const figure = Number(trimmed)
  return Number.isFinite(figure) ? figure : null
}

/** Has the field been typed to say something other than what the style holds? */
export const isPending = (style: ProjectStyle, drafts: Drafts, key: StyleKey): boolean =>
  drafts[key] !== fieldText(style, key)

/** What a commit made of the fields. */
export interface Committed {
  /** The style to draw: valid, and the one given when nothing could be applied. */
  style: ProjectStyle
  /** What was refused, beside the field it concerns. */
  problems: Problems
  /** The fields as they should read now: what was applied, normalised, and what was refused, as typed. */
  drafts: Drafts
}

/**
 * Commit what has been typed (blur or Enter on `edited`), before anything is
 * sent: every field typed to say something other than the style holds is
 * read, a figure outside the engine's range or not a figure is refused in
 * the engine's sentence beside its field, an empty field goes back to the
 * engine's own number, and the pair of radii is judged together as the
 * engine judges them.
 *
 * **Every pending field is read, not only the one just left**, so that a
 * refusal that depended on another field mends itself when the other is
 * fixed: a station radius of 8 is refused while the interchange radius is
 * the engine's 6, stays on the screen with its sentence, and is taken the
 * moment the interchange radius is set to 9, in the one redraw.
 *
 * A style that still holds a number the engine would refuse - a record
 * written by hand - applies nothing until that is fixed, since nothing the
 * store would write could be; each refused field says so beside itself.
 */
export function commitDrafts(stored: ProjectStyle, drafts: Drafts, edited: StyleKey): Committed {
  const problems: Problems = {}
  let candidate: ProjectStyle = { ...stored }
  const read: StyleKey[] = []
  for (const key of STYLE_KEYS) {
    if (!isPending(stored, drafts, key)) continue
    const text = drafts[key].trim()
    if (text === '') {
      delete candidate[key]
      read.push(key)
      continue
    }
    const figure = parseFigure(text)
    if (figure === null || !inStyleRange(key, figure)) problems[key] = styleRangeSentence(key)
    else {
      candidate[key] = figure
      read.push(key)
    }
  }
  candidate = settledStyle(candidate)

  // The pair is the engine's rule on two fields: the sentence goes beside
  // the radius that was just edited, else the one that is pending, and those
  // changes are not applied; the others are.
  const radii = radiiRefusal(candidate)
  if (radii !== null) {
    const pending = (['stationRadius', 'interchangeRadius'] as const).filter((key) =>
      read.includes(key),
    )
    if (pending.length > 0) {
      const beside = pending.find((key) => key === edited) ?? pending[0]
      problems[beside] = radii
      for (const key of pending) {
        if (stored[key] === undefined) delete candidate[key]
        else candidate[key] = stored[key]
        read.splice(read.indexOf(key), 1)
      }
      candidate = settledStyle(candidate)
    }
  }

  // Whatever the style still holds that the engine would refuse stops the
  // draw, and is said where it is.
  const held = styleRefusals(candidate)
  const blocked = Object.keys(held).length > 0
  for (const key of STYLE_KEYS) {
    const sentence = held[key]
    if (sentence !== undefined && problems[key] === undefined) problems[key] = sentence
  }

  const style = blocked ? stored : candidate
  const next = { ...drafts }
  if (!blocked) for (const key of read) next[key] = fieldText(style, key)
  return { style, problems, drafts: next }
}

/**
 * What to do with a style a person has chosen, at this moment: draw it, wait
 * for the page a layout, a rebuild or an export is reading, or nothing
 * because it is not a change. A change made during a run waits rather than
 * being refused, so no control has to disable itself under a person's hands
 * (A4-01's rule, `nextStep` in `colours.ts`).
 */
export function nextStyleStep(
  next: ProjectStyle,
  stored: ProjectStyle,
  busy: boolean,
): 'build' | 'wait' | 'none' {
  if (sameStyle(next, stored)) return 'none'
  return busy ? 'wait' : 'build'
}

/** What cell 04's summary adds to the theme when any size has been set, else nothing. */
export const sizesWords = (style: ProjectStyle): string | null =>
  styleIsSet(style) ? 'sizes of your own' : null
