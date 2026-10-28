// What a record holds that this build does not read, kept and written back
// (issue 425, ADR-056; spec 037, User Story 5). Main only: it is the
// parser's second answer, and nothing the renderer or the engine is handed
// can hold one. Pure: no Electron, no filesystem.

import { CHOICE_OPTION_KEYS, EXPORT_CHOICE_FIELDS } from '../../shared/export'
import {
  type DrawnFrom,
  LINE_FIELDS,
  type LineChoice,
  type ProjectInputs,
  type ProjectRecord,
  type ServiceWindow,
  STYLE_GROUP,
  TUNING_FIELDS,
} from '../../shared/project/types'
import type { Station } from '../../shared/trip'
import { isObject } from '../../shared/errors'

/**
 * The blocks that record a fact rather than a choice: what a draw drew
 * from, and what the engine answered at a layout run - the window, the
 * inputs and the tuning the layout was asked with - and the store's count
 * of its writes. A writer that records a new block (`drew` in the store,
 * for every draw and the layout run) renews it whole, and
 * the keys a later build kept inside the old block are not carried onto the
 * new one: they described a draw or an answer that is no longer the one on
 * disk, and this build's draw did not send what they say it did.
 */
// Exported for tests/unit/record-carries.test.ts alone; the store names a fact by `RecordFact`.
export const RECORD_FACTS = [
  'drawn',
  'service',
  'built',
  'laidOutWith',
  // The store's own count of its writes (spec 037): a fact about the file,
  // never a choice, which every write renews.
  'revision',
] as const satisfies readonly (keyof ProjectRecord)[]

export type RecordFact = (typeof RECORD_FACTS)[number]

/**
 * Which keys this build reads in one object of the record. An object of
 * named fields carries every key not on its list; a map keyed by data (a
 * line label) has no key of its own that is unknown, only entries; a list
 * carries what its items do, by position.
 */
type Shape =
  | { readonly fields: readonly string[]; readonly inner?: Readonly<Record<string, Shape>> }
  | { readonly entries: Shape }
  | { readonly items: Shape }

/**
 * Every key of a type, named: a field added to the type and not here is a
 * type error, so it can never be mistaken for a later build's and carried
 * past its own writer.
 */
const fieldsOf = <T>(fields: Readonly<Record<keyof T, true>>): readonly string[] =>
  Object.keys(fields)

let recordShape: Shape | undefined

/**
 * The record's shape, every object the parser rebuilds from the keys it
 * knows. Built on first use, not at load. That was needed while the record's
 * module and `shared/export.ts` imported each other, when the export's two
 * lists could be unset as the record loaded; the cycle is gone (spec 037,
 * User Story 5), and the build is left lazy because the split moved code and
 * changed none.
 */
function shapeOfRecord(): Shape {
  if (recordShape !== undefined) return recordShape
  // The lists the readers themselves read by: what `readStyle`, `readTuning`
  // and `readLines` take, so the reader and the carry never disagree.
  const style: Shape = { fields: STYLE_GROUP }
  const tuning: Shape = { fields: TUNING_FIELDS }
  const lines: Shape = {
    entries: {
      fields: LINE_FIELDS,
      inner: {
        casing: {
          fields: fieldsOf<NonNullable<LineChoice['casing']>>({ width: true, color: true }),
        },
      },
    },
  }
  recordShape = {
    fields: fieldsOf<ProjectRecord>({
      version: true,
      id: true,
      name: true,
      feed: true,
      mode: true,
      agency: true,
      date: true,
      service: true,
      style: true,
      colors: true,
      defaultColor: true,
      lineOrder: true,
      lines: true,
      theme: true,
      export: true,
      destination: true,
      tuning: true,
      layout: true,
      built: true,
      laidOutWith: true,
      made: true,
      drawn: true,
      opened: true,
      created: true,
      modified: true,
      revision: true,
    }),
    inner: {
      style,
      tuning,
      laidOutWith: tuning,
      lines,
      export: {
        fields: EXPORT_CHOICE_FIELDS,
        inner: { options: { fields: CHOICE_OPTION_KEYS } },
      },
      service: {
        fields: fieldsOf<ServiceWindow>({ start: true, end: true, busiest: true, anchor: true }),
      },
      built: { fields: fieldsOf<ProjectInputs>({ mode: true, agency: true }) },
      drawn: {
        fields: fieldsOf<DrawnFrom>({
          layout: true,
          made: true,
          date: true,
          colors: true,
          defaultColor: true,
          lineOrder: true,
          theme: true,
          style: true,
          lines: true,
          stations: true,
          engine: true,
        }),
        inner: {
          style,
          lines,
          stations: { items: { fields: fieldsOf<Station>({ id: true, name: true }) } },
        },
      },
    },
  }
  return recordShape
}

/**
 * What was carried from one object: its keys this build does not read, in
 * their order, and what was carried from inside the ones it does.
 */
interface Kept {
  readonly own: readonly (readonly [string, unknown])[]
  readonly inner: ReadonlyMap<string, Kept>
}

/**
 * What an object holds that its shape does not name, at every depth; null
 * for nothing. A carried value is held as the parser was handed it, by
 * reference and never copied: the store's is the JSON it has just parsed,
 * which nothing else holds, and a copy would recurse into a value of any
 * depth on every read - a list of every project included - where
 * `JSON.parse` does not.
 */
function keep(value: unknown, shape: Shape): Kept | null {
  const own: [string, unknown][] = []
  const inner = new Map<string, Kept>()
  if ('items' in shape) {
    if (!Array.isArray(value)) return null
    value.forEach((item, index) => {
      const inside = keep(item, shape.items)
      if (inside !== null) inner.set(String(index), inside)
    })
  } else {
    if (!isObject(value)) return null
    for (const [key, field] of Object.entries(value)) {
      // The one key never carried: assigning this name to a plain object
      // sets its prototype rather than a key, so it could not be written back
      // as one (the line label is refused for the same reason).
      if (key === '__proto__') continue
      if ('entries' in shape) {
        const inside = keep(field, shape.entries)
        if (inside !== null) inner.set(key, inside)
      } else if (!shape.fields.includes(key)) {
        own.push([key, field])
      } else if (shape.inner?.[key] !== undefined) {
        const inside = keep(field, shape.inner[key])
        if (inside !== null) inner.set(key, inside)
      }
    }
  }
  return own.length === 0 && inner.size === 0 ? null : { own, inner }
}

/**
 * A writer's value with what was carried put back into it. A known field
 * whose own answer is that there is no object here - `null`, a string - is
 * that answer, and carries nothing; a key the writer left out where the
 * record had an object (a tuning reset, a line's options reset) gets an
 * object back holding only what was carried, which this build reads as
 * nothing set. Carried values go in by reference, for the store to
 * serialise at once; nothing here copies them.
 */
function put(value: unknown, kept: Kept, shape: Shape): unknown {
  if ('items' in shape) {
    if (!Array.isArray(value)) return value
    return value.map((item: unknown, index) => {
      const inside = kept.inner.get(String(index))
      return inside === undefined ? item : put(item, inside, shape.items)
    })
  }
  if (value !== undefined && !isObject(value)) return value
  const out: Record<string, unknown> = { ...value }
  for (const [key, inside] of kept.inner) {
    const nested = 'entries' in shape ? shape.entries : shape.inner?.[key]
    if (nested === undefined) continue
    // Only the writer's own key: a line label is data, and one called
    // `toString` or `constructor` would otherwise read the function every
    // plain object inherits under that name.
    const merged = put(Object.hasOwn(out, key) ? out[key] : undefined, inside, nested)
    if (merged !== undefined) out[key] = merged
  }
  // After the writer's own fields, so a known one is never overwritten.
  for (const [key, field] of kept.own) out[key] = field
  return out
}

/**
 * What a stored record holds that this build does not read (issue 425,
 * ADR-056): every key a later build wrote that the parser does not know, at
 * the top level and inside every object the parser rebuilds from the keys it
 * knows - the style, the export choice and its options, the tuning and what
 * the layout was asked with, each line's options and its casing, the window,
 * the inputs, and what the map was drawn from with its stations.
 *
 * It is the parser's second answer and never part of a `ProjectRecord`, so
 * nothing built from the record can hold one: not the renderer, which is
 * handed the record, and not the engine, which is sent what is read from it.
 * Its keys are private fields, so a spread of it adds nothing and the
 * bridge's structured clone sends `{}`. They come out in one place, `onto`,
 * which is what the store writes. A key is carried as it was read and never
 * interpreted: not validated, not compared, not sent.
 *
 * A key with a known field's name is that field's and never carried, valid or
 * not: a value this build refuses is the known field's to read, by the
 * field's own rule. And a key named `__proto__` is not carried at all: a
 * plain object cannot be given one by assignment.
 */
export class Carried {
  /** A record that carries nothing: a new one, which no other build has written. */
  static readonly NONE = new Carried(null)

  readonly #kept: Kept | null

  private constructor(kept: Kept | null) {
    this.#kept = kept
  }

  /** What a record's parsed JSON holds beyond what this build reads. */
  static of(json: unknown): Carried {
    const kept = keep(json, shapeOfRecord())
    return kept === null ? Carried.NONE : new Carried(kept)
  }

  /** Whether the record held anything this build does not read. */
  get empty(): boolean {
    return this.#kept === null
  }

  /**
   * The record as it is written: the writer's record, every field as the
   * writer left it, and every carried key back in the object it was found
   * in, after the known ones. Inside a fact the writer renews (`renewed`,
   * one of `RECORD_FACTS`), nothing is carried: the block is the writer's
   * new fact, whole.
   */
  onto(record: ProjectRecord, renewed: readonly RecordFact[] = []): Record<string, unknown> {
    const kept = this.#kept
    if (kept === null) return { ...record }
    const inner = new Map(
      [...kept.inner].filter(([key]) => !(renewed as readonly string[]).includes(key)),
    )
    return put(record, { own: kept.own, inner }, shapeOfRecord()) as Record<string, unknown>
  }
}
