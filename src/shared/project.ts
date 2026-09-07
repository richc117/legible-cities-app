// The project record and its validators. Pure: no Electron, no filesystem,
// so the preload, the renderer and the main process share one definition
// and the unit tests run in Node. Contract: specs/003-project/contracts/record.md.

export const RECORD_VERSION = 1

export interface ProjectStyle {
  lineWidth: number
  stationRadius: number
  interchangeRadius: number
  labelSize: number
}

export type Theme = 'warm-dark' | 'sepia'

export interface ProjectRecord {
  version: number
  id: string
  name: string
  feed: string
  mode: string
  agency: string | null
  /** The service day, YYYY-MM-DD; null until the first layout resolves it (ADR-023). */
  date: string | null
  style: ProjectStyle
  colors: Record<string, string>
  defaultColor: string
  lineOrder: string[]
  theme: Theme
  /** The stored layout's identifier; null until A3-01 produces one. */
  layout: string | null
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
const MODE_PATTERN = /^[a-z]{1,16}$/
const NAME_MAX = 120
const AGENCY_MAX = 120

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
  if (!MODE_PATTERN.test(mode)) return 'mode must be a short lowercase word'
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
    layout: isString(json.layout) && json.layout !== '' ? json.layout : null,
    created: isString(json.created) ? json.created : epoch,
    modified: isString(json.modified) ? json.modified : epoch,
  }
  return { record, readOnly: version > RECORD_VERSION }
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
