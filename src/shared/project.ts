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

export type Theme = 'warm-dark' | 'sepia'

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
const isColor = (v: unknown): v is string => isString(v) && /^#[0-9a-fA-F]{6}$/.test(v)

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
    for (const [k, v] of Object.entries(json.colors)) if (isColor(v)) colors[k] = v
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
    lineOrder: Array.isArray(json.lineOrder) ? json.lineOrder.filter(isString) : [],
    theme: json.theme === 'sepia' ? 'sepia' : DEFAULT_THEME,
    layout: isLayoutId(json.layout) ? json.layout : null,
    made: validateMade(json.made) === null ? (json.made as string) : null,
    created: isString(json.created) ? json.created : epoch,
    modified: isString(json.modified) ? json.modified : epoch,
  }
  return { record, readOnly: version > RECORD_VERSION }
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
