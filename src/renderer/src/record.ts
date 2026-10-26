// What only the interface derives from a record (spec 037, User Story 5):
// the palette and the order as the engine takes them, the feed the new
// project sheet offers first and a free name for a project the app names,
// whether a style or a line's options are set or unchanged, the sent set a
// run builds its `map.build` from, and whether the page on screen is an
// older engine's. And one of the engine's sentences, `EVERY_LINE_HIDDEN`:
// only cell 05 says it, and main refuses nothing with it, so it is here and
// not in `shared/project/sentences.ts`. What both processes use is
// `src/shared/project/`; what only main uses is `src/main/record/`.

import { chosen, linesSent, styleSent } from '../../shared/project/helpers'
import {
  DEFAULT_STYLE,
  type LineChoice,
  type LineOrder,
  type Palette,
  type ProjectLines,
  type ProjectRecord,
  type ProjectStyle,
  type SentSet,
  STYLE_GROUP,
  STYLE_KEYS,
} from '../../shared/project/types'
import { isEngineVersion, NAME_MAX } from '../../shared/project/validate'

/**
 * Whether a map drawn by engine `drawn` was drawn by an engine older than
 * `running` (issue 494): true where its version is below, false where it is
 * the same or above, and null where either is not a version this build
 * reads (`isEngineVersion`), absent included. What a record that names no
 * engine means is its caller's to say (`redrawOnOpen` counts it as older).
 */
export function engineBefore(drawn: unknown, running: unknown): boolean | null {
  if (!isEngineVersion(drawn) || !isEngineVersion(running)) return null
  const a = drawn.split('.').map(Number)
  const b = running.split('.').map(Number)
  for (let at = 0; at < 3; at++) if (a[at] !== b[at]) return a[at] < b[at]
  return false
}

/** The palette a record holds, as the two fields the engine takes. */
export function paletteOf(record: Pick<ProjectRecord, 'colors' | 'defaultColor'>): Palette {
  return { colors: record.colors, defaultColor: record.defaultColor }
}

/** The order a record holds, as the field the engine takes. */
export function orderOf(record: Pick<ProjectRecord, 'lineOrder'>): LineOrder {
  return record.lineOrder
}

export const DEFAULT_FEED = 'la-metro-rail'

/**
 * A name no listed project has, for a project the app names itself - a
 * sample city pressed, or the new project sheet's filled-in name: the name
 * as it is when it is free, else the name followed by " 2", " 3" and on,
 * the first free (the macOS Finder's form, which keeps the first one bare).
 * Compared without regard to case, surrounding space or Unicode
 * composition, and without the machine's locale - closer to how APFS and
 * NTFS, which the export folder lives on, compare two names. A name a person types is never passed through this: two
 * projects may share a name when someone chooses so.
 *
 * Why it matters beyond the list: an export goes to a folder named after
 * the project, so two projects of one name write into one folder, and the
 * front door would draw two rows with the same accessible name. This covers
 * the common case, not every one: a typed name, a rename, and the export's
 * own folder rule (80 characters, some characters replaced) can still meet
 * in one folder, where a later export replaces the earlier file.
 *
 * The number is kept whole at the length limit: the name is shortened
 * instead, so "… 2" never becomes a name the store refuses.
 */
export function uniqueName(base: string, taken: readonly string[]): string {
  const key = (name: string): string => name.trim().normalize('NFC').toLowerCase()
  // Held to the limit whether or not it is free, so the two answers agree.
  const name = base.trim().slice(0, NAME_MAX).trimEnd()
  const used = new Set(taken.map(key))
  if (!used.has(key(name))) return name
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`
    const candidate = name.slice(0, NAME_MAX - suffix.length).trimEnd() + suffix
    if (!used.has(key(candidate))) return candidate
  }
}

/**
 * Has a person set anything in the group - a size, a marker, the face or a
 * train number? A field at the engine's own value is no choice - it would
 * draw what is drawn without it - so it does not count. Reset can be pressed
 * while this is true.
 */
export function styleIsSet(style: ProjectStyle): boolean {
  return STYLE_GROUP.some((key) => chosen(style, key))
}

/**
 * Has a person set one of the eight sizes? The cell's collapsed row says
 * "sizes of your own" for this and for nothing else (DESIGN.md 8.2).
 */
export function sizesAreSet(style: ProjectStyle): boolean {
  return STYLE_KEYS.some((key) => chosen(style, key))
}

/** Two styles that send the same thing; a field at the engine's own value is no field. */
export function sameStyle(a: ProjectStyle, b: ProjectStyle): boolean {
  return STYLE_GROUP.every(
    (key) => (a[key] ?? DEFAULT_STYLE[key]) === (b[key] ?? DEFAULT_STYLE[key]),
  )
}

/**
 * The engine's sentence for a map whose every line is hidden (ADR-053, "as of
 * 7 Oct 2026"), less the feed key the engine opens it with: cell 05 says it
 * beside the switch that would have hidden the last line.
 */
export const EVERY_LINE_HIDDEN =
  'every line on this map is hidden; show at least one line to draw it'

/** Two sets of options that send the same thing; a field at the engine's own is no field. */
export function sameLines(a: ProjectLines | undefined, b: ProjectLines | undefined): boolean {
  return JSON.stringify(sortedLines(linesSent(a))) === JSON.stringify(sortedLines(linesSent(b)))
}

/** The same options with the labels in one order, so two that differ only in it compare equal. */
function sortedLines(lines: ProjectLines): [string, LineChoice][] {
  return Object.entries(lines).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

/**
 * The sent set of a draw, from the arguments a run builds its `map.build`
 * from, copied: the run hands this on with its completion.
 */
export function sentSet(draw: {
  layout: string
  made: string | null
  date: string
  palette: Palette
  order: LineOrder
  style: ProjectStyle
  lines: ProjectLines | undefined
}): SentSet {
  const sent: SentSet = {
    layout: draw.layout,
    made: draw.made,
    date: draw.date,
    colors: { ...draw.palette.colors },
    defaultColor: draw.palette.defaultColor,
    lineOrder: [...draw.order],
    style: styleSent(draw.style),
  }
  const lines = linesSent(draw.lines)
  if (Object.keys(lines).length > 0) sent.lines = lines
  return sent
}
