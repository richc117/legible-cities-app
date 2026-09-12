// The project record and its validators. Pure: no Electron, no filesystem,
// so the preload, the renderer and the main process share one definition
// and the unit tests run in Node. Contract: specs/003-project/contracts/record.md.

import { isLayoutId } from './layout'

export const RECORD_VERSION = 1

export interface ProjectStyle {
  lineWidth: number
  stationRadius: number
  interchangeRadius: number
  labelSize: number
}

/**
 * The two themes the engine's page draws itself in: warm-dark, which is
 * what it draws without being told, and sepia, the cream of the pocket map.
 * They are the page's own names and travel to it on its address (A4-03).
 */
export type Theme = 'warm-dark' | 'sepia'

/** The two, and nothing else; a record that names another is drawn warm-dark. */
export const THEMES: readonly Theme[] = ['warm-dark', 'sepia']

export function isTheme(value: unknown): value is Theme {
  return value === 'warm-dark' || value === 'sepia'
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
  /** The stored layout's identifier; null until the first layout produces one (ADR-027). */
  layout: string | null
  /**
   * The mode and agency the stored layout was made with, from the engine's
   * meta, so the screen can say when the record's differ (A2-02). Null
   * before a layout, and for a record from before this was kept.
   */
  built: ProjectInputs | null
  /**
   * When the stored layout was made, as the engine wrote it beside the set
   * (an ISO timestamp): the same id names the same inputs, and a different
   * `made` under it is a set laid out again since (A3-06). Null before.
   */
  made: string | null
  created: string
  modified: string
}

export interface ProjectSummary {
  id: string
  name: string
  feed: string
  date: string | null
  modified: string
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

// The engine's Style defaults at the pinned engine (render.py), as data.
export const DEFAULT_STYLE: ProjectStyle = {
  lineWidth: 10,
  stationRadius: 8,
  interchangeRadius: 11,
  labelSize: 26,
}
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
const NAME_MAX = 120
export const AGENCY_MAX = 64

export function validateName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'name is required'
  if (trimmed.length > NAME_MAX) return `name is too long (${NAME_MAX} characters at most)`
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

/** Is a day inside the window, inclusive? Both ISO, so strings compare. */
export function withinWindow(date: string, service: ServiceWindow): boolean {
  return date >= service.start && date <= service.end
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

  const style = isObject(json.style) ? json.style : {}
  const num = (v: unknown, d: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : d
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
    style: {
      lineWidth: num(style.lineWidth, DEFAULT_STYLE.lineWidth),
      stationRadius: num(style.stationRadius, DEFAULT_STYLE.stationRadius),
      interchangeRadius: num(style.interchangeRadius, DEFAULT_STYLE.interchangeRadius),
      labelSize: num(style.labelSize, DEFAULT_STYLE.labelSize),
    },
    colors,
    defaultColor: isColor(json.defaultColor) ? json.defaultColor : DEFAULT_COLOR,
    lineOrder: readLineOrder(json.lineOrder),
    theme: isTheme(json.theme) ? json.theme : DEFAULT_THEME,
    layout: isLayoutId(json.layout) ? json.layout : null,
    made: validateMade(json.made) === null ? (json.made as string) : null,
    built: readInputs(json.built),
    created: isString(json.created) ? json.created : epoch,
    modified: isString(json.modified) ? json.modified : epoch,
  }
  return { record, readOnly: version > RECORD_VERSION }
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
    modified: record.modified,
    readOnly,
  }
}
