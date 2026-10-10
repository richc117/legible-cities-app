// The project record and its validators. Pure: no Electron, no filesystem,
// so the preload, the renderer and the main process share one definition
// and the unit tests run in Node. Contract: specs/003-project/contracts/record.md.

import { readStoredChoice, type ExportChoice } from './export'
import { isLayoutId } from './layout'
import { isStorableFolder } from './settings'
import { readStations, type Station } from './trip'

// Version 2 (issue 350, ADR-049): the record's `style` is eight optional
// numbers in the engine's own names, each unset until a person sets it. A
// version-1 record held four numbers that were never sent and were not the
// engine's, so what it meant has to be read differently (`readStyle`), and a
// build that does not know the difference would misread the new one: that is
// what moves the version (contracts/run-graph.md, "Adding a field").
export const RECORD_VERSION = 2

/**
 * What a person chose for the map's sizes, in SVG user units at the map's
 * width (1,800 by default, so a line width of 7 is seven of 1,800), except
 * `lineGap`, a multiple of the line width. Every field is optional and the
 * absence of one is the engine's own number: the app sends only what a
 * person set (ADR-049). The names are the engine's `Style` in camel case.
 */
export interface ProjectStyle {
  lineWidth?: number
  lineGap?: number
  stationRadius?: number
  interchangeRadius?: number
  stationStroke?: number
  labelSize?: number
  labelOffset?: number
  /** The margin round the drawing, on every side (ADR-050). */
  padding?: number
  /**
   * The marker of a station on one line (engine issue 74, issue 391): the
   * engine's circle, TfL's tick or a square. Absent is the circle.
   */
  stationShape?: StationShape
  /** The marker of a station where lines meet: the ring or a square. Absent is the ring. */
  interchangeShape?: InterchangeShape
  /**
   * The face the station names are set in (engine issue 76): the system's,
   * or one of the two the engine ships and embeds. Absent is the system's.
   */
  labelFont?: LabelFont
  /**
   * The radius of a train's dot on the animation page, in the sizes' unit
   * (engine issue 75). Kept with the style, the smallest change, and sent as
   * `map.build`'s own `dot_radius`, never inside `style`: it is the
   * animation's and never reaches the SVG (spec 034, FR-004).
   */
  dotRadius?: number
  /** How far behind a train its trail reaches, in seconds of playback; sent as `map.build`'s own `trail`. */
  trail?: number
}

/** The eight, in the order the cell draws them. */
export const STYLE_KEYS = [
  'lineWidth',
  'lineGap',
  'stationRadius',
  'interchangeRadius',
  'stationStroke',
  'labelSize',
  'labelOffset',
  'padding',
] as const satisfies readonly (keyof ProjectStyle)[]

export type StyleKey = (typeof STYLE_KEYS)[number]

/**
 * What the engine accepts of each field: its name on the wire and its closed
 * range, held to the engine's `render.STYLE_RANGES` (v0.12.0) by a unit test
 * against the protocol's schema. `ratio` marks the one field with no unit, a
 * multiple of the line width.
 */
export const STYLE_RANGES: Readonly<
  Record<StyleKey, { wire: string; low: number; high: number; ratio: boolean }>
> = {
  lineWidth: { wire: 'line_width', low: 1, high: 24, ratio: false },
  lineGap: { wire: 'line_gap', low: 1, high: 3, ratio: true },
  stationRadius: { wire: 'station_radius', low: 1, high: 20, ratio: false },
  interchangeRadius: { wire: 'interchange_radius', low: 1, high: 30, ratio: false },
  stationStroke: { wire: 'station_stroke', low: 0, high: 8, ratio: false },
  labelSize: { wire: 'label_size', low: 6, high: 32, ratio: false },
  labelOffset: { wire: 'label_offset', low: 0, high: 40, ratio: false },
  padding: { wire: 'padding', low: 0, high: 200, ratio: false },
}

/**
 * The markers and the faces the engine offers (`render.STATION_SHAPES`,
 * `INTERCHANGE_SHAPES` and `LABEL_FONTS` at v0.15.0), in the engine's order
 * and its names. An interchange is never a tick. Held to the protocol's
 * enums by a unit test.
 */
export const STATION_SHAPES = ['circle', 'tick', 'square'] as const
export type StationShape = (typeof STATION_SHAPES)[number]
export const INTERCHANGE_SHAPES = ['circle', 'square'] as const
export type InterchangeShape = (typeof INTERCHANGE_SHAPES)[number]
export const LABEL_FONTS = ['system', 'inter', 'atkinson-hyperlegible-next'] as const
export type LabelFont = (typeof LABEL_FONTS)[number]

/** The three fields a person chooses from a list, in the order the cell draws them. */
export const CHOICE_KEYS = [
  'stationShape',
  'interchangeShape',
  'labelFont',
] as const satisfies readonly (keyof ProjectStyle)[]

export type ChoiceKey = (typeof CHOICE_KEYS)[number]

/** What each choice is called on the wire, inside `style`, and what it may be. */
export const STYLE_CHOICES: Readonly<
  Record<ChoiceKey, { wire: string; options: readonly string[] }>
> = {
  stationShape: { wire: 'station_shape', options: STATION_SHAPES },
  interchangeShape: { wire: 'interchange_shape', options: INTERCHANGE_SHAPES },
  labelFont: { wire: 'label_font', options: LABEL_FONTS },
}

/** The two numbers that say how a train is drawn, in the order the cell draws them. */
export const TRAIN_KEYS = ['dotRadius', 'trail'] as const satisfies readonly (keyof ProjectStyle)[]

export type TrainKey = (typeof TRAIN_KEYS)[number]

/**
 * What the engine accepts of the two train numbers (`animate.DOT_RADIUS_RANGE`
 * and `TRAIL_RANGE` at v0.15.0, `serve._animation_number`): each a parameter
 * of `map.build` itself, by the name its refusal writes, its closed range,
 * and the unit the refusal says it in. Held to the schema by a unit test.
 */
export const TRAIN_RANGES: Readonly<
  Record<TrainKey, { wire: string; low: number; high: number; unit: string }>
> = {
  dotRadius: { wire: 'dot_radius', low: 2, high: 12, unit: "SVG user units at the map's width" },
  trail: { wire: 'trail', low: 0, high: 3, unit: 'seconds of playback' },
}

/** Every field a person types a number into: the eight sizes, then the trains. */
export const FIGURE_KEYS = [...STYLE_KEYS, ...TRAIN_KEYS] as const

export type FigureKey = StyleKey | TrainKey

/**
 * Every field of the group, in the order the cell draws them (spec 034,
 * FR-005): the eight sizes, the two markers and the face, the trains. One
 * list drives the validator, the reader and what is kept.
 */
export const STYLE_GROUP = [
  ...STYLE_KEYS,
  ...CHOICE_KEYS,
  ...TRAIN_KEYS,
] as const satisfies readonly (keyof ProjectStyle)[]

export type StyleGroupKey = (typeof STYLE_GROUP)[number]

const isTrainKey = (key: FigureKey): key is TrainKey =>
  (TRAIN_KEYS as readonly string[]).includes(key)

/**
 * The two themes the engine's page draws itself in: warm-dark, which is
 * what it draws without being told, and sepia, the cream of the pocket map.
 * They are the page's own names and travel to it on its address (A4-03).
 */
export type Theme = 'warm-dark' | 'sepia'

/**
 * The two, and nothing else; a record that names another is drawn
 * warm-dark. One list, which the switch offers and the validator checks, so
 * a third theme cannot be half-added.
 */
export const THEMES = ['warm-dark', 'sepia'] as const satisfies readonly Theme[]

export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value)
}

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

/**
 * What the engine answered when the project was laid out: the days its
 * feed's calendar covers, the busiest weekday scanning from the anchor,
 * and the anchor, so the choice can be reproduced (ADR-031, engine E21).
 * Four calendar days, YYYY-MM-DD.
 */
export interface ServiceWindow {
  start: string
  end: string
  busiest: string
  anchor: string
}

/**
 * What the page on screen was drawn from (ADR-045, A5.5-04): the layout and
 * when the engine made it, the day, the colours, the default colour, the
 * order and the theme, as they were at the end of the draw that produced
 * the map now in the project's output folder.
 *
 * It is the record's copy of itself at that moment, which is what makes
 * staleness a comparison of the record against itself, with no events and
 * no dirty flags: a field that has moved since is a field the map on screen
 * does not show.
 *
 * It carries `made` and not only `layout` because two projects can draw
 * from one layout set and either can re-lay it out under the other, the
 * case A3-06 added `made` for: without it a re-laid set would read current
 * over a page drawn from the geometry it replaced.
 */
export interface DrawnFrom {
  layout: string
  made: string | null
  date: string | null
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  theme: Theme
  /**
   * The sizes the map carries: what `map.build` was sent, in the app's names
   * (`styleSent`), so empty for a map drawn without a style. Like the
   * colours and the order it is a cheap edit's and raises no staleness; a
   * block from before the field existed holds none, which is what it was
   * drawn with (issue 350).
   */
  style: ProjectStyle
  /**
   * The stations the map draws, as `map.build` listed them for it - each an
   * id the page's `setTrip` takes and the name the map writes - in the
   * engine's order (issue 272, spec 030 FR-004). Cell 03's Trip section
   * offers these and nothing the app derives, and it has to outlive the
   * build: a project opened again shows its map from the stored files
   * without one.
   *
   * It is the map's own fact, like the colours and the order: every draw -
   * a layout run, a rebuild, a recolour, a reorder, a resize - writes the
   * list its build answered, since a redraw draws the stored set as it is
   * now and another project may have laid it out again (A3-06); a draw whose
   * build answered none the app would take keeps the list it had while the
   * layout is the one it was listed for (`drawnFrom`). Absent for a record
   * drawn before it was kept, for a block
   * whose list does not read whole, and for a map drawn from another layout
   * than the list was - which reads as "draw the map again to pick a trip",
   * never as a map with no stations. Added without moving `RECORD_VERSION`
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"). A
   * trip is never written here or anywhere in the record (FR-001).
   */
  stations?: Station[]
}

export interface ProjectRecord {
  version: number
  id: string
  name: string
  feed: string
  mode: string
  agency: string | null
  /** The service day, YYYY-MM-DD; null until the first layout resolves it (ADR-031). */
  date: string | null
  /** The feed's window and the engine's choice, stored at a layout run; null before one. */
  service: ServiceWindow | null
  style: ProjectStyle
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  theme: Theme
  /**
   * What the project was last set to export: the preset, the storyboard and
   * the options (A5-01). The reel with the engine's defaults for a record
   * from before the export tab, which is what the one button exported.
   */
  export: ExportChoice
  /**
   * Where this project's exports go, over the app's own export folder
   * (A5.5-19); null to use the app's, which is what every project did
   * before and what a project that has never been told otherwise still
   * does. The folder is the platform's dialog's own answer: no path
   * crosses the bridge inward, so the only two values that reach a record
   * are one this process's own chooser handed out and null.
   *
   * Added at `RECORD_VERSION` 1 and it does not move it: a record without
   * it reads as "the app's folder", which is what an older record meant,
   * and an older build that drops it sends the next export to the app's
   * folder rather than misreading anything
   * (specs/028-the-notebook/contracts/run-graph.md).
   */
  destination: string | null
  /**
   * LOOM's own settings a person chose for this project's layout (issue 385,
   * spec 033): the grid, the merge distance, the grid size and the bend
   * penalties. Absent means LOOM's defaults, and a field at LOOM's own
   * number is never kept (`settledTuning`), so a project that never touched
   * the tuning has no `tuning` at all and a reset removes it. Written the
   * moment it is chosen (`projects.setTuning`) and sent to `graph.build` by
   * the next layout run; nothing is laid out for it on its own.
   *
   * Added at `RECORD_VERSION` 2 without moving it
   * (specs/028-the-notebook/contracts/run-graph.md, "Adding a field"): its
   * absence is what every project before it was laid out with, and the one
   * released build holds records at version 1 and reads this one as
   * read-only, so it never writes one and cannot drop it.
   */
  tuning?: ProjectTuning
  /** The stored layout's identifier; null until the first layout produces one (ADR-027). */
  layout: string | null
  /**
   * The mode and agency the stored layout was made with, from the engine's
   * meta, so the screen can say when the record's differ (A2-02). Null
   * before a layout, and for a record from before this was kept.
   */
  built: ProjectInputs | null
  /**
   * The tuning the stored layout was asked with (issue 385, spec 033 FR-008):
   * what the layout run that wrote `layout` sent `graph.build`, in `tuning`'s
   * shape and under its rules, written by `completeLayout` in the same write
   * as the layout's id and by nothing else. Absent means LOOM's defaults,
   * which is what every layout before the field was asked with, so an
   * existing project reads current.
   *
   * It is `built`'s counterpart for the tuning: `built` is what the engine's
   * meta says the layout was made with, and this is what the app asked it
   * with, because reading the tuning back from `LayoutMeta.stages` would mean
   * computing LOOM's flags here. A record whose `tuning` would not send what
   * this does has a layout of another tuning: the run graph's `tuning`
   * source. Added without moving `RECORD_VERSION`, as `tuning` was.
   */
  laidOutWith?: ProjectTuning
  /**
   * When the stored layout was made, as the engine wrote it beside the set
   * (an ISO timestamp): the same id names the same inputs, and a different
   * `made` under it is a set laid out again since (A3-06). Null before.
   */
  made: string | null
  /**
   * What the map now on disk was drawn from (A5.5-04), written by the four
   * handlers that write the record at the end of a draw; null for a record
   * from before this was kept, which means only that we cannot prove its
   * map is current - never that it is stale.
   */
  drawn: DrawnFrom | null
  /**
   * When the project's screen was last opened (A5.6-04), an ISO timestamp,
   * written by `projects.markOpened` as the screen opens and by nothing
   * else - an edit moves `modified`, never this. The front door lists
   * projects newest opened first.
   *
   * Added at `RECORD_VERSION` 1 without moving it
   * (specs/028-the-notebook/contracts/run-graph.md): null means "not
   * opened since this was kept", which sorts by `created` instead, and an
   * older build that drops it loses only an order the next opening puts
   * back.
   */
  opened: string | null
  created: string
  modified: string
}

/**
 * What the front door lists for each project: the row's own words, and the
 * record's fields the run graph reads to say how far the project has got
 * (A5.6-04), so the renderer derives it with the notebook's own function
 * rather than with a second rule in the main process.
 */
export interface ProjectSummary extends Pick<
  ProjectRecord,
  | 'id'
  | 'name'
  | 'feed'
  | 'date'
  | 'mode'
  | 'agency'
  | 'layout'
  | 'made'
  | 'built'
  | 'drawn'
  | 'opened'
  | 'created'
  | 'modified'
  | 'tuning'
  | 'laidOutWith'
> {
  readOnly: boolean
}

export interface CreateProjectInput {
  name: string
  feed: string
  mode?: string
  agency?: string | null
}

/** What a rebuild for a chosen day hands back once the map is drawn. */
export interface RebuildDone {
  date: string
  /**
   * The stations `map.build` answered for the map just drawn (issue 272),
   * written into `drawn`; left out, the list the record had is kept when
   * the layout is the one it was listed for.
   */
  stations?: Station[]
}

/** The two inputs a person chooses with the feed in view (A2-02): what LOOM keeps, and whose routes. */
export interface ProjectInputs {
  mode: string
  agency: string | null
}

/**
 * What a project chooses for its lines (A4-01): the overrides a person set,
 * by line label, and what a line the feed leaves uncoloured is drawn in.
 * Exactly the record's two fields, and exactly what `map.build` takes as
 * `colors` and `default_color`. The engine resolves an override over the
 * feed's own `route_color` over the default, once, so the map, the chips
 * and the time chart agree (engine E06).
 */
export interface Palette {
  colors: Record<string, string>
  defaultColor: string
}

/** The palette a record holds, as the two fields the engine takes. */
export function paletteOf(record: Pick<ProjectRecord, 'colors' | 'defaultColor'>): Palette {
  return { colors: record.colors, defaultColor: record.defaultColor }
}

/**
 * Line labels in the order they are drawn, the later over the earlier where
 * they share track, and the same order the page lists them in. Exactly the
 * record's `lineOrder` and exactly `map.build`'s `line_order`.
 *
 * Empty is the engine's own order, alphabetical by label; the request then
 * carries no `line_order` at all. A partial order is safe: the engine draws
 * the lines it names first and every other line after them, and ignores a
 * label the layout does not carry (engine issue 28).
 */
export type LineOrder = string[]

/** The order a record holds, as the field the engine takes. */
export function orderOf(record: Pick<ProjectRecord, 'lineOrder'>): LineOrder {
  return record.lineOrder
}

export interface DeleteResult {
  removed: string[]
  failed: { folder: 'project' | 'output'; reason: string }[]
}

/**
 * The engine's `Style` numbers at the pinned engine (v0.12.0, `render.py`),
 * and since v0.15.0 its markers, face and train numbers, as data. They are what a field shows while it is unset and what a value is
 * compared with to know it is no choice at all; they are never sent. Until
 * issue 350 this held `10, 8, 11, 26` under a comment calling them the
 * engine's, and they were not (ADR-049); `OLD_STYLE` keeps them for the one
 * place that still needs to recognise them.
 */
export const DEFAULT_STYLE: Readonly<Required<ProjectStyle>> = {
  lineWidth: 7,
  lineGap: 1.6,
  stationRadius: 4.2,
  interchangeRadius: 6,
  stationStroke: 2.2,
  labelSize: 11,
  labelOffset: 9,
  padding: 24,
  // The engine's own markers, face and trains (v0.15.0): what is drawn
  // without the field, so a field at one of these is no choice (spec 034).
  stationShape: 'circle',
  interchangeShape: 'circle',
  labelFont: 'system',
  dotRadius: 5,
  trail: 0,
}

/**
 * What a version-1 record stored for the four numbers it had, which were
 * never sent. A number equal to its old one is a number nobody chose, and is
 * read as unset, field by field (`readStyle`).
 */
const OLD_STYLE = {
  lineWidth: 10,
  stationRadius: 8,
  interchangeRadius: 11,
  labelSize: 26,
} as const satisfies ProjectStyle
export const DEFAULT_COLOR = '#888888'
export const DEFAULT_THEME: Theme = 'warm-dark'
export const DEFAULT_MODE = 'all'
export const DEFAULT_FEED = 'la-metro-rail'

export const ID_PATTERN = /^[a-z][a-z0-9]{11}$/
const FEED_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
// The engine's own rules for the two it validates: a mode is what LOOM's -m
// takes, names or route_type numbers, comma-joined; an agency_id is at most
// 64 characters. Held to the engine's schema by tests/unit/project.test.ts.
export const MODE_PATTERN = /^[a-z0-9-]+(,[a-z0-9-]+)*$/
export const NAME_MAX = 120
export const AGENCY_MAX = 64

export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'name is required'
  if (trimmed.length > NAME_MAX) return `name is too long (${NAME_MAX} characters at most)`
  return null
}

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

export function validateId(id: string): string | null {
  return ID_PATTERN.test(id) ? null : 'invalid id'
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
 * The palette a person chose (A4-01): overrides by line label and the
 * colour a line the feed leaves uncoloured takes. Checked in the form for
 * a sentence, in the main-side handler because it arrived from another
 * process, and in the store because the store is the trusted layer.
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

/**
 * The one shape `opened` is written in, `Date.prototype.toISOString`'s: the
 * list orders by it as a string, which is right only while every value
 * shares the format (A5.6-04).
 */
const OPENED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

const MADE_MAX = 64
// ISO 8601 with a time and an offset, as the engine writes it beside a
// stored layout (isoformat with seconds, in UTC). Compared as a string, so
// the shape is pinned before the value is trusted, as a day's is.
const MADE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** The engine's `made`: an ISO timestamp a clock could have written. */
export function validateMade(made: unknown): string | null {
  if (typeof made !== 'string' || made === '')
    return 'the layout run did not say when the layout was made'
  if (made.length > MADE_MAX || !MADE_PATTERN.test(made) || Number.isNaN(Date.parse(made)))
    return 'the layout run gave a time that is not one'
  return null
}

// ---- The map's sizes (issue 350, ADR-049, ADR-050), and since issue 391 its
// markers, its label face and its trains (spec 034)

/** A finite number, which is the only thing a field can hold. */
const isFigure = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** `a, b or c`: the names a refusal offers, in the table's order, as the engine writes them. */
const either = (names: readonly string[]): string =>
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

/** Is a field a choice? Unset, or at the engine's own value, it is not. */
const chosen = (style: ProjectStyle, key: StyleGroupKey): boolean =>
  style[key] !== undefined && style[key] !== DEFAULT_STYLE[key]

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

/** Two styles that send the same thing; a field at the engine's own value is no field. */
export function sameStyle(a: ProjectStyle, b: ProjectStyle): boolean {
  return STYLE_GROUP.every(
    (key) => (a[key] ?? DEFAULT_STYLE[key]) === (b[key] ?? DEFAULT_STYLE[key]),
  )
}

// ---- The layout's tuning (issue 385, spec 033; engine issue 37, v0.14.0)

/**
 * The grids octi lays a network on, in the engine's words and order
 * (`pipeline.GRIDS` at v0.14.0): octilinear, the 45-degree multiples the map
 * has always been drawn on and LOOM's own, then ortholinear, orthoradial and
 * hexalinear. The engine refuses its research variants itself, so these four
 * are all the app offers (spec 033, FR-002). Held to the protocol's enum by
 * a unit test.
 */
export const GRIDS = ['octilinear', 'ortholinear', 'orthoradial', 'hexalinear'] as const

export type Grid = (typeof GRIDS)[number]

export function isGrid(value: unknown): value is Grid {
  return GRIDS.some((grid) => grid === value)
}

/**
 * LOOM's own settings a person chose for a project's layout, in the engine's
 * names in camel case (`LayoutTuning`), the five bend penalties flat beside
 * the others rather than inside a `penalties` object, so that one list drives
 * the fields, the validator and the reader. Every field is optional and the
 * absence of one is LOOM's own number: the app sends only what a person set,
 * and the engine writes no flag for a field at LOOM's default either.
 */
export interface ProjectTuning {
  /** topo's `-d`: how far apart two stretches of track may be, in metres, and still be merged. */
  mergeDistance?: number
  /** octi's `-b`: the grid the network is laid on. */
  grid?: Grid
  /** octi's `-g`: the grid's cell, as a percentage of the distance between adjacent stations. */
  gridSize?: number
  /** octi's `--pen-45`, `--pen-90`, `--pen-135`, `--pen-180`: the cost of a bend of that angle. */
  deg45?: number
  deg90?: number
  deg135?: number
  deg180?: number
  /** octi's `--diag-pen`: the cost of running on a diagonal. */
  diagonal?: number
}

/** The seven numbers, in the order the section draws them. */
export const TUNING_KEYS = [
  'mergeDistance',
  'gridSize',
  'deg45',
  'deg90',
  'deg135',
  'deg180',
  'diagonal',
] as const satisfies readonly (keyof ProjectTuning)[]

export type TuningKey = (typeof TUNING_KEYS)[number]

/** The five of them that travel inside the engine's `penalties` object. */
export const PENALTY_KEYS = [
  'deg45',
  'deg90',
  'deg135',
  'deg180',
  'diagonal',
] as const satisfies readonly TuningKey[]

/** What a penalty counts, in the engine's words for its refusal. */
const COST = 'as a cost without a unit'

/**
 * What the engine accepts of each number (`pipeline`'s table at v0.14.0): its
 * name on the wire, as its refusal sentence writes it, its closed range, and
 * what it counts, in the engine's own words. Held to the committed protocol
 * schema by a unit test, as the style's ranges are.
 */
export const TUNING_RANGES: Readonly<
  Record<TuningKey, { wire: string; low: number; high: number; unit: string }>
> = {
  mergeDistance: { wire: 'merge_distance', low: 5, high: 500, unit: 'in metres' },
  gridSize: {
    wire: 'grid_size',
    low: 25,
    high: 400,
    unit: 'as a percentage of the distance between adjacent stations',
  },
  deg45: { wire: 'penalties.deg45', low: 0, high: 10, unit: COST },
  deg90: { wire: 'penalties.deg90', low: 0, high: 10, unit: COST },
  deg135: { wire: 'penalties.deg135', low: 0, high: 10, unit: COST },
  deg180: { wire: 'penalties.deg180', low: 0, high: 10, unit: COST },
  diagonal: { wire: 'penalties.diagonal', low: 0, high: 10, unit: COST },
}

/**
 * LOOM's own numbers and grid, as data: what a field shows while it holds
 * nothing, and what a value is compared with to know it is no choice at all.
 * Never sent - the engine writes no flag for them either - and held to the
 * schema's "LOOM's default is" by a unit test.
 */
export const DEFAULT_TUNING: Readonly<Required<ProjectTuning>> = {
  mergeDistance: 50,
  grid: 'octilinear',
  gridSize: 100,
  deg45: 2,
  deg90: 1.5,
  deg135: 1,
  deg180: 0,
  diagonal: 0.5,
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

/** A finite number inside the field's closed range, as the engine judges one. */
export function inTuningRange(key: TuningKey, value: unknown): boolean {
  const { low, high } = TUNING_RANGES[key]
  return isFigure(value) && value >= low && value <= high
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

/** Is a field a choice? Not held, or at LOOM's own, it is not. */
const tunedField = (tuning: ProjectTuning, key: keyof ProjectTuning): boolean =>
  tuning[key] !== undefined && tuning[key] !== DEFAULT_TUNING[key]

/** Every field of a tuning, in the engine's order: the merge distance, the grid, the size, the penalties. */
const TUNING_FIELDS = [
  'mergeDistance',
  'grid',
  'gridSize',
  ...PENALTY_KEYS,
] as const satisfies readonly (keyof ProjectTuning)[]

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
 * A tuning as a record holds it, read field by field: a grid the engine
 * offers, a number inside its range, and nothing else, then settled. A field
 * that would be refused on write is read as not held - the colours' and the
 * order's rule, not the style's - so a value written by hand never reaches
 * `graph.build`, and what a person sees in the section is what the store
 * would keep. Undefined where nothing is left, so the record carries no key.
 */
export function readTuning(value: unknown): ProjectTuning | undefined {
  if (!isObject(value)) return undefined
  const read: ProjectTuning = {}
  if (isGrid(value.grid)) read.grid = value.grid
  for (const key of TUNING_KEYS) {
    if (inTuningRange(key, value[key])) read[key] = value[key] as number
  }
  const kept = settledTuning(read)
  return tuningIsSet(kept) ? kept : undefined
}

/**
 * A record with one of its two tunings set to what was asked: the fields a
 * person chose, settled, or no key at all where none is left, so a reset and
 * a layout asked with LOOM's defaults leave nothing behind in the file. The
 * one place either field is written, for the store's two writers.
 */
export function withTuning(
  record: ProjectRecord,
  field: 'tuning' | 'laidOutWith',
  tuning: ProjectTuning,
): ProjectRecord {
  const next: ProjectRecord = { ...record }
  const kept = settledTuning(tuning)
  if (tuningIsSet(kept)) next[field] = kept
  else delete next[field]
  return next
}

/**
 * What a record that has just been drawn was drawn from: the eight fields
 * of the record itself, copied (the style as `styleSent` makes it). It is
 * called on the record a handler is about to write, never on the one it
 * read, because the values the draw used are the ones that write stores -
 * the run is handed the record and draws from it, and no cheap edit can
 * land between the draw and the write (the panels that make one are shut
 * while a run holds the page).
 *
 * A record with no layout has drawn nothing, and gets null.
 */
export function drawnFrom(record: ProjectRecord): DrawnFrom | null {
  if (record.layout === null) return null
  const drawn: DrawnFrom = {
    layout: record.layout,
    made: record.made,
    date: record.date,
    colors: { ...record.colors },
    defaultColor: record.defaultColor,
    lineOrder: [...record.lineOrder],
    theme: record.theme,
    style: styleSent(record.style),
  }
  // The stations are the layout's (issue 272). A draw writes the list its
  // build answered (`withStations`); this is the fallback for one that
  // answered none: the list the last draw kept, while the layout and its
  // `made` are the record's. From another layout, or the same id laid out
  // again since, it is left out rather than claimed.
  const before = record.drawn
  if (
    before !== null &&
    before.stations !== undefined &&
    before.layout === record.layout &&
    before.made === record.made
  )
    drawn.stations = before.stations.map((station) => ({ ...station }))
  return drawn
}

/**
 * A draw's block with the stations its build answered (issue 272), or the
 * block as it is when the build answered none the bridge would take. The
 * list replaces whatever `drawnFrom` carried, because it is the map just
 * drawn.
 */
export function withStations(
  drawn: DrawnFrom | null,
  stations: Station[] | undefined,
): DrawnFrom | null {
  if (drawn === null || stations === undefined) return drawn
  // The two fields and nothing else, whatever the caller's objects carried.
  return { ...drawn, stations: stations.map(({ id, name }) => ({ id, name })) }
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

type Parsed = { record: ProjectRecord; readOnly: boolean } | { error: string }

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isString = (v: unknown): v is string => typeof v === 'string'
const isColor = isHexColor

/**
 * Read a record from parsed JSON. Missing optional fields take their
 * defaults; a missing identity field is an error; a version above ours
 * marks the record read-only (data-model.md).
 */
export function parseRecord(json: unknown): Parsed {
  if (!isObject(json)) return { error: 'not an object' }
  const version = json.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { error: 'missing or invalid version' }
  }
  const id = json.id
  if (!isString(id) || !ID_PATTERN.test(id)) return { error: 'missing or invalid id' }
  const name = json.name
  if (!isString(name) || name.trim() === '') return { error: 'missing name' }
  const feed = json.feed
  if (!isString(feed) || !FEED_PATTERN.test(feed)) return { error: 'missing or invalid feed' }

  const colors: Record<string, string> = {}
  if (isObject(json.colors)) {
    // A label the app would refuse to write is a label it does not read
    // back either, so what a person sees is what the store would keep.
    for (const [k, v] of Object.entries(json.colors))
      if (isColor(v) && validateLineLabel(k) === null) colors[k] = v
  }
  // A record without a timestamp gets a fixed one, so it sorts last and
  // reads the same on every open; every write sets both.
  const epoch = '1970-01-01T00:00:00.000Z'

  const record: ProjectRecord = {
    version,
    id,
    name,
    feed,
    mode: isString(json.mode) && MODE_PATTERN.test(json.mode) ? json.mode : DEFAULT_MODE,
    agency: isString(json.agency) && json.agency.trim() !== '' ? json.agency : null,
    date: isString(json.date) && /^\d{4}-\d{2}-\d{2}$/.test(json.date) ? json.date : null,
    service: readServiceWindow(json.service),
    style: readStyle(json.style, version),
    colors,
    defaultColor: isColor(json.defaultColor) ? json.defaultColor : DEFAULT_COLOR,
    lineOrder: readLineOrder(json.lineOrder),
    theme: isTheme(json.theme) ? json.theme : DEFAULT_THEME,
    // Whole or not at all, as the service window is: a half-valid choice
    // is not half-trusted, and the tab starts from the reel. The one
    // exception is an alt text that cannot be used, which is read as none
    // (`readStoredChoice`): it is not a plan option.
    export: readStoredChoice(json.export),
    // Missing, or anything that is not a folder this app would store, is
    // the app's own export folder: absent means "not told otherwise", never
    // "somewhere else" (A5.5-19).
    destination: isStorableFolder(json.destination) ? json.destination : null,
    layout: isLayoutId(json.layout) ? json.layout : null,
    made: validateMade(json.made) === null ? (json.made as string) : null,
    drawn: readDrawn(json.drawn),
    built: readInputs(json.built),
    // A moment the way every other one here is written, or null: an
    // unreadable value is "not opened since this was kept" (A5.6-04).
    opened:
      isString(json.opened) &&
      OPENED_PATTERN.test(json.opened) &&
      !Number.isNaN(Date.parse(json.opened))
        ? json.opened
        : null,
    created: isString(json.created) ? json.created : epoch,
    modified: isString(json.modified) ? json.modified : epoch,
  }
  // The tuning and what the layout was asked with (issue 385) are optional,
  // and absent unless something is left of them once read, so a record that
  // never held either reads, and is written back, without the keys.
  const tuning = readTuning(json.tuning)
  if (tuning !== undefined) record.tuning = tuning
  const laidOutWith = readTuning(json.laidOutWith)
  if (laidOutWith !== undefined) record.laidOutWith = laidOutWith
  return { record, readOnly: version > RECORD_VERSION }
}

/**
 * The sizes a record holds. A field is a finite number or it is unset; a
 * number outside the engine's range is **kept**, not clamped and not
 * dropped, so the cell shows what the record says and refuses it, and
 * nothing is sent until a person fixes it (`styleSent`). A version-2 record
 * is read as written.
 *
 * A version-1 record stored four numbers, `10, 8, 11, 26`, which were
 * written by this app at creation, were never sent, and were not the
 * engine's. Sending them would change every existing map (ADR-049), so a
 * version-1 record is read **field by field**: a number equal to its old
 * default is unset, and any other is a number somebody wrote, and is kept as
 * set. Per field and not all-or-nothing, so that one number written by hand
 * never sends the other three old defaults as if they were choices.
 *
 * The train numbers (issue 391) are read as the sizes are: a finite number
 * is kept, in range or not. A marker or a face is read only when it is one
 * the engine offers, field by field, since a select cannot show any other
 * and a record that named one would send what the engine refuses.
 */
function readStyle(value: unknown, version: number): ProjectStyle {
  const stored = isObject(value) ? value : {}
  const style: ProjectStyle = {}
  for (const key of FIGURE_KEYS) {
    const field = stored[key]
    if (typeof field === 'number' && Number.isFinite(field)) style[key] = field
  }
  const choices: Record<string, unknown> = {}
  for (const key of CHOICE_KEYS) if (isStyleChoice(key, stored[key])) choices[key] = stored[key]
  Object.assign(style, choices)
  if (version < 2) {
    for (const key of Object.keys(OLD_STYLE) as (keyof typeof OLD_STYLE)[])
      if (style[key] === OLD_STYLE[key]) delete style[key]
  }
  return style
}

/**
 * The order as the store would have written it: labels it could hold, each
 * once, no more than the cap. A record the app would refuse to write is not
 * one it reads back either, so what a person sees is what the store keeps -
 * and a line dropped here still draws, because the engine draws every line
 * an order leaves out.
 */
function readLineOrder(value: unknown): LineOrder {
  if (!Array.isArray(value)) return []
  const order: string[] = []
  const seen = new Set<string>()
  for (const label of value) {
    if (!isString(label) || validateLineLabel(label) !== null || seen.has(label)) continue
    seen.add(label)
    order.push(label)
    if (order.length === COLORS_MAX) break
  }
  return order
}

/** The inputs a layout was made with, whole, or null; an empty agency is none, as the record's is. */
function readInputs(value: unknown): ProjectInputs | null {
  if (!isObject(value) || !isString(value.mode) || !MODE_PATTERN.test(value.mode)) return null
  const agency = value.agency == null ? null : isString(value.agency) ? value.agency : undefined
  if (agency === undefined) return null
  return { mode: value.mode, agency: agency === null ? null : agency.trim() || null }
}

/**
 * What the map was drawn from, whole, or null. Half-valid is not
 * half-trusted here for the same reason it is not for the window: this
 * block is only ever read to decide whether the map on screen still matches
 * the record, and a block missing a field would answer that question about
 * a field it does not hold. A record whose block will not read is a record
 * whose map cannot be proved current, which reads as ready and not stale.
 */
function readDrawn(value: unknown): DrawnFrom | null {
  if (!isObject(value)) return null
  const { layout, made, date, defaultColor, theme } = value
  if (!isLayoutId(layout)) return null
  if (made !== null && validateMade(made) !== null) return null
  if (date !== null && (!isString(date) || validateServiceDate(date) !== null)) return null
  if (!isColor(defaultColor)) return null
  if (!isTheme(theme)) return null
  if (validatePalette({ colors: value.colors, defaultColor }) !== null) return null
  if (validateLineOrder(value.lineOrder) !== null) return null
  const drawn: DrawnFrom = {
    layout,
    made: made === null ? null : (made as string),
    date: date === null ? null : (date as string),
    colors: { ...(value.colors as Record<string, string>) },
    defaultColor,
    lineOrder: [...(value.lineOrder as string[])],
    theme,
    // Written as the draw sent it, so read as written; a block from before
    // the field was drawn without one.
    style: readStyle(value.style, RECORD_VERSION),
  }
  // The stations are read on their own (issue 272): a list that is not
  // whole is no list, and leaves the rest of the block as it was, because
  // the block says whether the map is current and the list says only what
  // a trip may be picked from.
  const stations = readStations(value.stations)
  if (stations !== null) drawn.stations = stations
  return drawn
}

/** The stored window, whole, or null: a half-valid block is not half-trusted. */
function readServiceWindow(value: unknown): ServiceWindow | null {
  if (validateServiceWindow(value) !== null) return null
  const { start, end, busiest, anchor } = value as ServiceWindow
  return { start, end, busiest, anchor }
}

export function summarise(record: ProjectRecord, readOnly: boolean): ProjectSummary {
  return {
    id: record.id,
    name: record.name,
    feed: record.feed,
    date: record.date,
    mode: record.mode,
    agency: record.agency,
    layout: record.layout,
    made: record.made,
    built: record.built,
    // Without its stations (issue 272): the front door reads `drawn` to say
    // how far a project has got, and a list of hundreds of stations a
    // project, for every project, is weight on every listing for nothing.
    drawn: withoutStations(record.drawn),
    opened: record.opened,
    created: record.created,
    modified: record.modified,
    // The two tunings, where the record holds them (issue 385). They are
    // read: a project's card on the front door says how far it has got
    // through the notebook's own run graph, from this summary
    // (`projectFacts` -> `progressWords` -> `runGraph`), and the run graph
    // compares these two to say a layout is of another tuning - without
    // them the card would say "finished up to 05 Lines" of a project whose
    // cells 03 to 06 read not drawn yet.
    ...(record.tuning === undefined ? {} : { tuning: { ...record.tuning } }),
    ...(record.laidOutWith === undefined ? {} : { laidOutWith: { ...record.laidOutWith } }),
    readOnly,
  }
}

/** A draw's block without its stations, for a summary; the same block where it has none. */
function withoutStations(drawn: DrawnFrom | null): DrawnFrom | null {
  if (drawn === null || drawn.stations === undefined) return drawn
  const rest = { ...drawn }
  delete rest.stations
  return rest
}

/**
 * When a project was last opened, for ordering: its `opened`, or its
 * `created` for one not opened since that was kept - so a project made a
 * moment ago comes first rather than last.
 */
export function openedOrder(summary: Pick<ProjectSummary, 'opened' | 'created'>): string {
  return summary.opened ?? summary.created
}
