// Reading a stored record (spec 037, User Story 5): the record's version,
// the parser and every field's reader, and the store's count of its writes.
// Main only, since only the store reads a file; the renderer is handed the
// record this makes. What a record holds that this build does not read is
// `./carried`. Pure: no Electron, no filesystem, so the unit tests run it in
// Node. Contract: specs/003-project/contracts/record.md.

import { readStoredChoice } from '../../shared/export'
import { isLayoutId } from '../../shared/layout'
import { settledLine, settledTuning, tuningIsSet } from '../../shared/project/helpers'
import {
  CHOICE_KEYS,
  DEFAULT_COLOR,
  DEFAULT_MODE,
  DEFAULT_THEME,
  type DrawnFrom,
  FIGURE_KEYS,
  type LineChoice,
  type LineOrder,
  type ProjectInputs,
  type ProjectLines,
  type ProjectRecord,
  type ProjectStyle,
  type ProjectTuning,
  type ServiceWindow,
  TUNING_KEYS,
} from '../../shared/project/types'
import {
  COLORS_MAX,
  FEED_PATTERN,
  inTuningRange,
  isEngineVersion,
  isGrid,
  isHexColor,
  isLineDash,
  isLineName,
  isStyleChoice,
  isTheme,
  MODE_PATTERN,
  SERVICE_DATE_PATTERN,
  validateLineLabel,
  validateLineOrder,
  validateServiceDate,
} from '../../shared/project/validate'
import { isStorableFolder } from '../../shared/settings'
import { isObject } from '../../shared/errors'
import { readStations } from '../../shared/trip'
import { Carried } from './carried'
import {
  ID_PATTERN,
  isCasingWidth,
  isLineWidth,
  validateMade,
  validatePalette,
  validateServiceWindow,
} from './validate'

// Version 2 (issue 350, ADR-049): the record's `style` is eight optional
// numbers in the engine's own names, each unset until a person sets it. A
// version-1 record held four numbers that were never sent and were not the
// engine's, so what it meant has to be read differently (`readStyle`), and a
// build that does not know the difference would misread the new one: that is
// what moves the version (contracts/run-graph.md, "Adding a field").
export const RECORD_VERSION = 2

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
/**
 * The one shape `opened` is written in, `Date.prototype.toISOString`'s: the
 * list orders by it as a string, which is right only while every value
 * shares the format (A5.6-04).
 */
// Exported for tests/unit/compatibility.test.ts alone, which holds the shapes a record is read by.
export const OPENED_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

/**
 * A tuning as a record holds it, read field by field: a grid the engine
 * offers, a number inside its range, and nothing else, then settled. A field
 * that would be refused on write is read as not held - the colours' and the
 * order's rule, not the style's - so a value written by hand never reaches
 * `graph.build`, and what a person sees in the section is what the store
 * would keep. Undefined where nothing is left, so the record carries no key.
 */
// Exported for tests/unit/tuning-record.test.ts alone; `readRecord` is its one caller.
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
 * A whole casing the engine takes, as a record holds it: a width in range and
 * a `#rrggbb` colour, both. Any other key in it is a later build's, which the
 * reader does not take and the store carries back to the file (ADR-056); it
 * no longer costs the casing its two fields.
 */
function isCasing(value: unknown): value is { width: number; color: string } {
  return isObject(value) && isCasingWidth(value.width) && isHexColor(value.color)
}

/**
 * The options a record holds, read field by field: a field the store would
 * refuse on write - a name past 40 or with a line break, a width or casing
 * outside its range, a casing without its colour, a dash the engine does not
 * offer, `hidden` that is not a boolean, a key not on the list - is read as
 * not held, the colours' rule, so a value written by hand never reaches
 * `map.build`. A label the record could not hold is dropped with its line, a
 * line with nothing left is dropped, and no more lines are read than a record
 * holds colours. Undefined where nothing is left, so the record carries no key.
 */
// Exported for tests/unit/line-options-record.test.ts alone; `readRecord` and `readDrawn` call it.
export function readLines(value: unknown): ProjectLines | undefined {
  if (!isObject(value)) return undefined
  const read: ProjectLines = {}
  let count = 0
  for (const [label, stored] of Object.entries(value)) {
    if (count === COLORS_MAX) break
    if (validateLineLabel(label) !== null || !isObject(stored)) continue
    const choice: LineChoice = {}
    if (isLineName(stored.name)) choice.name = stored.name
    if (typeof stored.hidden === 'boolean') choice.hidden = stored.hidden
    if (isLineWidth(stored.width)) choice.width = stored.width
    if (isCasing(stored.casing))
      choice.casing = { width: stored.casing.width, color: stored.casing.color }
    if (isLineDash(stored.dash)) choice.dash = stored.dash
    const line = settledLine(label, choice)
    if (Object.keys(line).length === 0) continue
    read[label] = line
    count += 1
  }
  return Object.keys(read).length > 0 ? read : undefined
}

type Parsed = { record: ProjectRecord; readOnly: boolean; carried: Carried } | { error: string }

const isString = (v: unknown): v is string => typeof v === 'string'
const isColor = isHexColor

/** A record's `revision`: a whole number, 0 or more, that a number can hold exactly. */
const isRevision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The revision a write after this record carries: one more than it, absent read as 0. */
export const nextRevision = (record: Pick<ProjectRecord, 'revision'>): number =>
  (isRevision(record.revision) ? record.revision : 0) + 1

/**
 * Read a record from parsed JSON. Missing optional fields take their
 * defaults; a missing identity field is an error; a version above ours
 * marks the record read-only (data-model.md). Beside the record, what it
 * held that this build does not read (`carried`, ADR-056), which the store
 * writes back and nothing else sees.
 *
 * It answers for any input and never throws. A record it cannot read whole,
 * what it carries included, is an error like any other record that will not
 * read: the store skips it and names it in the log, as it does a file that
 * is not JSON. That is the record kept out of every write, never one
 * written back without what it carried, and never a list of projects or a
 * reset refused over one file.
 */
export function parseRecord(json: unknown): Parsed {
  try {
    return readRecord(json)
  } catch (error) {
    // The kind only: a message could quote what the file holds.
    return { error: `could not be read (${error instanceof Error ? error.name : 'unknown'})` }
  }
}

function readRecord(json: unknown): Parsed {
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
    date: isString(json.date) && SERVICE_DATE_PATTERN.test(json.date) ? json.date : null,
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
  // The line options (issue 394), the same way: absent unless something is
  // left of them once read.
  const lines = readLines(json.lines)
  if (lines !== undefined) record.lines = lines
  // The store's count of its writes (spec 037), when it is one; anything
  // else is a record from before it was kept, which reads as 0.
  if (isRevision(json.revision)) record.revision = json.revision
  return { record, readOnly: version > RECORD_VERSION, carried: Carried.of(json) }
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
  // Written as the draw sent them (issue 394), so read under the record's
  // own rule; a block from before the field was drawn with none.
  const lines = readLines(value.lines)
  if (lines !== undefined) drawn.lines = lines
  // The stations are read on their own (issue 272): a list that is not
  // whole is no list, and leaves the rest of the block as it was, because
  // the block says whether the map is current and the list says only what
  // a trip may be picked from.
  const stations = readStations(value.stations)
  if (stations !== null) drawn.stations = stations
  // The engine that drew it (issue 494), read on its own as the stations
  // are: a value that is not a version is none, and leaves the block alone,
  // because the block says whether the map is current and this says only
  // which engine drew it, which the page's seam can still say in its place.
  if (isEngineVersion(value.engine)) drawn.engine = value.engine
  return drawn
}

/** The stored window, whole, or null: a half-valid block is not half-trusted. */
function readServiceWindow(value: unknown): ServiceWindow | null {
  if (validateServiceWindow(value) !== null) return null
  const { start, end, busiest, anchor } = value as ServiceWindow
  return { start, end, busiest, anchor }
}
