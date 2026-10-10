import type { StylePresets } from '../../shared/protocol'
import {
  CHOICE_KEYS,
  DEFAULT_STYLE,
  FIGURE_KEYS,
  inStyleRange,
  isStyleChoice,
  radiiRefusal,
  settledStyle,
  STYLE_CHOICES,
  STYLE_KEYS,
  STYLE_RANGES,
  type ChoiceKey,
  type FigureKey,
  type ProjectStyle,
} from '../../shared/project'
import { fieldText, type View } from './styleRules'

// Cell 04's Look (issue 391, spec 034 FR-001): the engine's named looks,
// offered at the head of the sizes group, each a convenience over fields and
// never stored by name.
//
// The engine answers `style.presets` with each look's name and the fields of
// `style` it stands for. Choosing one writes those fields into the style the
// group shows, the engine's own numbers among them dropped as no choice, and
// the redraw sends fields as it always has: the engine's rule that a `preset`
// goes alone is never in play, because the app never sends one. What the
// select shows is worked out from the style, every time: the look whose
// fields equal it, else the engine's own sizes, else Custom.
//
// A look stands for everything `{ "preset": name }` draws - its eight numbers
// and both markers, a marker it does not name being the engine's circle,
// since the engine resolves a preset over its own defaults - and for nothing
// else: the label face and the trains are not a look's, so choosing one
// leaves them as they are.

/**
 * The fields a look stands for, in the cell's order: the eight sizes, then
 * the station's and the interchange's marker. Not the label face, which no
 * look carries, and not the trains, which are the animation's.
 */
export const LOOK_KEYS = [
  ...STYLE_KEYS,
  'stationShape',
  'interchangeShape',
] as const satisfies readonly (keyof ProjectStyle)[]

/** One of the engine's looks, as the select offers it: its name, its word, and its fields in the app's names. */
export interface Look {
  /** The engine's name for it (`StylePreset.name`), which is also the option's value. */
  name: string
  /** What the select says: the engine's name with a first capital. */
  label: string
  /** Its fields, settled: none at the engine's own value. */
  style: ProjectStyle
}

/**
 * The select's two values that are not a look's name. The engine names its
 * looks from a closed list (`beck`, `blueprint`, `paper` at v0.15.0) and a
 * look that took either of these would not be offered (`lookOf`).
 */
export const ENGINE_OWN = 'engine-own'
export const CUSTOM = 'custom'

/** The select's name, its options' words, and what is said under it. */
export const LOOK_LABEL = 'Look'
export const ENGINE_OWN_LABEL = 'The engine’s sizes'
export const CUSTOM_LABEL = 'Custom'
export const LOOK_SENTENCE =
  'A look sets the sizes and the markers; the typeface and the trains stay as they are.'
export const LOOKS_WAITING = 'The looks come from the engine, and are offered once it is running.'
export const LOOKS_FAILED = 'The engine did not list its looks, so only its own sizes are offered.'

/** A look's word: the engine's name with a first capital ("beck" is Beck). */
export const lookLabel = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1)

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The app's name for each of a look's fields, by the engine's. */
const BY_WIRE = new Map<string, FigureKey | ChoiceKey>([
  ...STYLE_KEYS.map((key) => [STYLE_RANGES[key].wire, key] as const),
  ...CHOICE_KEYS.map((key) => [STYLE_CHOICES[key].wire, key] as const),
])

const isFigureKey = (key: FigureKey | ChoiceKey): key is FigureKey =>
  (FIGURE_KEYS as readonly string[]).includes(key)

/**
 * One look as the engine answered it, in the app's names, or null where it
 * does not read: a field not among a look's, a number outside its range, a
 * marker the engine does not offer, the two radii in the wrong order, or a
 * name that is empty or one of the select's own values. A look the app could
 * not write is not offered, rather than offered and then refused.
 *
 * The answer crosses from another process, so it is read as data: the
 * engine's own schema says what it may hold, and nothing else is taken.
 */
export function lookOf(preset: unknown): Look | null {
  if (!isObject(preset) || !isObject(preset.style)) return null
  const { name } = preset
  if (typeof name !== 'string' || name === '' || name === ENGINE_OWN || name === CUSTOM) return null
  const read: Record<string, unknown> = {}
  for (const [wire, value] of Object.entries(preset.style)) {
    const key = BY_WIRE.get(wire)
    if (key === undefined || !(LOOK_KEYS as readonly string[]).includes(key)) return null
    if (isFigureKey(key) ? !inStyleRange(key, value) : !isStyleChoice(key, value)) return null
    read[key] = value
  }
  const style = read as ProjectStyle
  if (radiiRefusal(style) !== null) return null
  return { name, label: lookLabel(name), style: settledStyle(style) }
}

/** The engine's looks, in its order, each once; the ones that do not read are left out. */
export function looksOf(answer: unknown): Look[] {
  if (!isObject(answer) || !Array.isArray(answer.presets)) return []
  const looks: Look[] = []
  for (const preset of answer.presets) {
    const look = lookOf(preset)
    if (look !== null && !looks.some((known) => known.name === look.name)) looks.push(look)
  }
  return looks
}

/** Do two styles draw the same look: each of a look's fields as drawn, an absent one the engine's own. */
const sameLook = (a: ProjectStyle, b: ProjectStyle): boolean =>
  LOOK_KEYS.every((key) => (a[key] ?? DEFAULT_STYLE[key]) === (b[key] ?? DEFAULT_STYLE[key]))

/**
 * What the select shows for a style: the engine's own sizes when every field
 * a look sets is the engine's own, else the look whose fields equal the
 * style's, else Custom. Worked out each time from the style the group shows,
 * never remembered, so a size typed over a look turns it to Custom and typed
 * back turns it to the look again.
 */
export function matchLook(style: ProjectStyle, looks: readonly Look[]): string {
  if (sameLook(style, {})) return ENGINE_OWN
  return looks.find((look) => sameLook(style, look.style))?.name ?? CUSTOM
}

/** One option of the select. */
export interface LookOption {
  value: string
  label: string
}

/**
 * The select's options for a style: the engine's own sizes first, then the
 * engine's looks in its order, and Custom last and only while it is what
 * the style is - an option that can be chosen only by changing a size is not
 * one to offer otherwise.
 */
export function lookOptions(style: ProjectStyle, looks: readonly Look[]): LookOption[] {
  const options: LookOption[] = [
    { value: ENGINE_OWN, label: ENGINE_OWN_LABEL },
    ...looks.map((look) => ({ value: look.name, label: look.label })),
  ]
  if (matchLook(style, looks) === CUSTOM) options.push({ value: CUSTOM, label: CUSTOM_LABEL })
  return options
}

/**
 * A style with a look's fields in place of its own: every field a look sets
 * is replaced, a marker the look does not name going back to the engine's
 * circle, and the label face and the trains are kept. Null is the engine's
 * own look, which puts all ten back to the engine's own.
 *
 * "The engine's sizes" is read as that (spec 034, FR-001, with a
 * clarification marker): the issue's "clears the group as Reset does" is
 * read as the sizes group. If the whole group is meant, this is where the
 * face and the trains would go too.
 */
export function withLook(style: ProjectStyle, look: Look | null): ProjectStyle {
  const next: Record<string, unknown> = { ...style }
  for (const key of LOOK_KEYS) delete next[key]
  if (look !== null) Object.assign(next, look.style)
  return settledStyle(next as ProjectStyle)
}

/**
 * The group after a look is chosen: the style with the look's fields, the
 * eight sizes' fields showing the look's numbers, and whatever was refused
 * of the fields a look sets gone with them. A figure refused and waiting in
 * a train field stays where it is, since a look leaves the trains alone.
 */
export function chooseLook(view: View, look: Look | null): View {
  const style = withLook(view.style, look)
  const drafts = { ...view.drafts }
  const problems = { ...view.problems }
  for (const key of LOOK_KEYS) delete problems[key]
  for (const key of STYLE_KEYS) drafts[key] = fieldText(style, key)
  return { style, drafts, problems }
}

/** What the engine has said about its looks, as far as the select is concerned. */
export type Looks =
  { status: 'waiting' } | { status: 'ready'; looks: Look[] } | { status: 'failed' }

/** The looks the select may offer: the engine's, once it has answered; none before or after a refusal. */
export const offeredLooks = (looks: Looks): Look[] => (looks.status === 'ready' ? looks.looks : [])

/** What is said under the select: what a look does, or why there are none to choose. */
export const looksSentence = (looks: Looks): string =>
  looks.status === 'ready'
    ? LOOK_SENTENCE
    : looks.status === 'failed'
      ? LOOKS_FAILED
      : LOOKS_WAITING

/**
 * The group after the select is set to `value`, or null for no change:
 * Custom is not a choice of anything, and a name the select did not offer
 * is not one either.
 */
export function chooseValue(view: View, looks: readonly Look[], value: string): View | null {
  if (value === ENGINE_OWN) return chooseLook(view, null)
  const look = looks.find((known) => known.name === value)
  return look === undefined ? null : chooseLook(view, look)
}

/** The one engine request the select makes, as narrow as it is. */
export interface LooksClient {
  request(method: 'style.presets'): { result: Promise<StylePresets> }
}

let asked: Promise<Look[]> | null = null

/**
 * The engine's looks, asked once while it stays up (spec 034, FR-001): every
 * project's cell 04 reads the same answer, and a refusal is not kept, so the
 * next opening asks again.
 */
export function looksFor(client: LooksClient): Promise<Look[]> {
  if (asked !== null) return asked
  const pending = client.request('style.presets').result.then(looksOf)
  asked = pending
  pending.catch(() => {
    if (asked === pending) asked = null
  })
  return pending
}

/** The engine went away; the one that comes back may be another version, so ask it again. */
export function forgetLooks(): void {
  asked = null
}
