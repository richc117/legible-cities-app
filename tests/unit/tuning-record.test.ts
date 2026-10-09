// The layout's tuning on the record (issue 385, spec 033): the table of
// LOOM's ranges, defaults and grids the fields, the validator and the reader
// share, held to the committed protocol schema; the engine's own refusal
// sentences; what a record keeps of a tuning, and how one is read back.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { progressWords } from '../../src/renderer/src/projectProgress'
import {
  DEFAULT_TUNING,
  drawnFrom,
  GRID_SENTENCE,
  GRIDS,
  inTuningRange,
  parseRecord,
  PENALTY_KEYS,
  readTuning,
  sameTuning,
  settledTuning,
  summarise,
  TUNING_KEYS,
  TUNING_RANGES,
  tuningIsSet,
  tuningRangeSentence,
  validateTuning,
  withTuning,
  type ProjectRecord,
} from '../../src/shared/project'

const ID = 'kq7x2mzp4dna'

const read = (json: Record<string, unknown>): ProjectRecord => {
  const parsed = parseRecord({
    version: 2,
    id: ID,
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    ...json,
  })
  if (!('record' in parsed)) throw new Error(parsed.error)
  return parsed.record
}

describe('what the engine takes of each field, from the committed schema', () => {
  type Property = { minimum?: number; maximum?: number; enum?: string[]; description: string }
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
  ) as {
    $defs: {
      LayoutTuning: { properties: Record<string, Property> }
      LayoutPenalties: { properties: Record<string, Property> }
    }
  }
  const tuning = schema.$defs.LayoutTuning.properties
  const penalties = schema.$defs.LayoutPenalties.properties
  /** The schema's property for a field's name on the wire, a penalty under `penalties`. */
  const property = (wire: string): Property =>
    wire.startsWith('penalties.') ? penalties[wire.slice('penalties.'.length)] : tuning[wire]

  it('is the engine’s own name and range for every number', () => {
    // Mutation: mergeDistance's high loosened to 600 - fails here first.
    for (const key of TUNING_KEYS) {
      const { wire, low, high } = TUNING_RANGES[key]
      expect(property(wire), key).toBeDefined()
      expect(property(wire).minimum, `${key} minimum`).toBe(low)
      expect(property(wire).maximum, `${key} maximum`).toBe(high)
    }
  })

  it('names every field the schema does, and no other', () => {
    const named = TUNING_KEYS.map((key) => TUNING_RANGES[key].wire)
    expect([...named, 'grid', 'penalties'].filter((wire) => !wire.includes('.')).sort()).toEqual(
      Object.keys(tuning).sort(),
    )
    expect(named.filter((wire) => wire.includes('.')).sort()).toEqual(
      Object.keys(penalties)
        .map((name) => `penalties.${name}`)
        .sort(),
    )
    expect([...PENALTY_KEYS].sort()).toEqual(Object.keys(penalties).sort())
  })

  it('offers the engine’s four grids, in its order', () => {
    expect([...GRIDS]).toEqual(tuning.grid.enum)
  })

  it('is LOOM’s own number and grid where a field is left out, from the schema’s words', () => {
    // Mutation: DEFAULT_TUNING.deg90 written 1 - fails here.
    for (const key of TUNING_KEYS) {
      const said = /LOOM's default is (\d+(?:\.\d+)?)/.exec(
        property(TUNING_RANGES[key].wire).description,
      )
      expect(said, key).not.toBeNull()
      expect(DEFAULT_TUNING[key], key).toBe(Number(said?.[1]))
    }
    expect(tuning.grid.description).toMatch(/LOOM's default is octilinear/)
    expect(DEFAULT_TUNING.grid).toBe('octilinear')
  })

  it('says a refusal in the engine’s sentence, word for word', () => {
    // `serve._tuned` and `serve._tuning` at v0.14.0.
    expect(tuningRangeSentence('mergeDistance')).toBe(
      'tuning.merge_distance must be from 5 to 500, in metres',
    )
    expect(tuningRangeSentence('gridSize')).toBe(
      'tuning.grid_size must be from 25 to 400, as a percentage of the distance between adjacent stations',
    )
    expect(tuningRangeSentence('deg45')).toBe(
      'tuning.penalties.deg45 must be from 0 to 10, as a cost without a unit',
    )
    expect(tuningRangeSentence('diagonal')).toBe(
      'tuning.penalties.diagonal must be from 0 to 10, as a cost without a unit',
    )
    expect(GRID_SENTENCE).toBe(
      'tuning.grid must be one of octilinear, ortholinear, orthoradial, hexalinear',
    )
  })
})

describe('what a store may be asked to write', () => {
  it('takes either end of every range and refuses a step past it, in the engine’s sentence', () => {
    // Mutation: `inTuningRange` reads `value > low` - the low ends fail.
    // Mutation: the high bound dropped - the step past it is let through.
    for (const key of TUNING_KEYS) {
      const { low, high } = TUNING_RANGES[key]
      expect(validateTuning({ [key]: low }), `${key} at ${low}`).toBeNull()
      expect(validateTuning({ [key]: high }), `${key} at ${high}`).toBeNull()
      expect(validateTuning({ [key]: high + 0.01 }), key).toBe(tuningRangeSentence(key))
      expect(validateTuning({ [key]: low - 0.01 }), key).toBe(tuningRangeSentence(key))
    }
  })

  it('refuses what is not a number, null and not a finite one, in the same sentence', () => {
    for (const value of ['50', null, Number.NaN, Number.POSITIVE_INFINITY, true, [50]]) {
      expect(validateTuning({ mergeDistance: value }), String(value)).toBe(
        tuningRangeSentence('mergeDistance'),
      )
    }
  })

  it('takes the four grids and refuses any other, the research variants included', () => {
    // Mutation: the grid check removed from `validateTuning` - 'quadtree' passes.
    for (const grid of GRIDS) expect(validateTuning({ grid }), grid).toBeNull()
    for (const grid of ['quadtree', 'octihanan', 'Octilinear', '', null, 8]) {
      expect(validateTuning({ grid }), String(grid)).toBe(GRID_SENTENCE)
    }
  })

  it('refuses a field not on the list, the engine’s nested penalties among them', () => {
    expect(validateTuning({ merge_distance: 60 })).toBe('the tuning does not take merge_distance')
    expect(validateTuning({ penalties: { deg45: 3 } })).toBe('the tuning does not take penalties')
    expect(validateTuning({ gridSize: 50, slider: 1 })).toBe('the tuning does not take slider')
  })

  it('refuses what is not an object, and takes an empty one', () => {
    for (const value of [null, undefined, 'grid', [], 42])
      expect(validateTuning(value), String(value)).toBe('the tuning must be an object')
    expect(validateTuning({})).toBeNull()
    expect(validateTuning({ ...DEFAULT_TUNING })).toBeNull()
  })

  it('judges a range as the engine does: closed, finite, and nothing else', () => {
    expect(inTuningRange('gridSize', 25)).toBe(true)
    expect(inTuningRange('gridSize', 24.999)).toBe(false)
    expect(inTuningRange('deg180', 0)).toBe(true)
    expect(inTuningRange('deg180', -0.5)).toBe(false)
  })
})

describe('what a record keeps of a tuning', () => {
  it('keeps the fields a person chose, and none at LOOM’s own', () => {
    // Mutation: `settledTuning` keeps a field equal to its default - the
    // grid of octilinear and the 45° of 2 are then stored.
    expect(settledTuning({ grid: 'octilinear', deg45: 2, deg90: 3 })).toEqual({ deg90: 3 })
    expect(settledTuning({ ...DEFAULT_TUNING })).toEqual({})
    expect(settledTuning({})).toEqual({})
  })

  it('keeps them in the engine’s order, whatever order they were given in', () => {
    expect(
      Object.keys(
        settledTuning({ diagonal: 1, gridSize: 50, grid: 'hexalinear', mergeDistance: 80 }),
      ),
    ).toEqual(['mergeDistance', 'grid', 'gridSize', 'diagonal'])
  })

  it('says a tuning is set only when a field is away from LOOM’s own', () => {
    expect(tuningIsSet(undefined)).toBe(false)
    expect(tuningIsSet({})).toBe(false)
    expect(tuningIsSet({ ...DEFAULT_TUNING })).toBe(false)
    expect(tuningIsSet({ grid: 'orthoradial' })).toBe(true)
    expect(tuningIsSet({ deg180: 0.5 })).toBe(true)
  })

  it('compares two tunings by what the engine would be sent', () => {
    expect(sameTuning(undefined, {})).toBe(true)
    expect(sameTuning(undefined, { ...DEFAULT_TUNING })).toBe(true)
    expect(sameTuning({ grid: 'octilinear', gridSize: 100 }, {})).toBe(true)
    expect(sameTuning({ grid: 'hexalinear' }, {})).toBe(false)
    expect(sameTuning({ deg45: 3 }, { deg45: 3 })).toBe(true)
    expect(sameTuning({ deg45: 3 }, { deg45: 3.5 })).toBe(false)
    expect(sameTuning(undefined, { mergeDistance: 49 })).toBe(false)
  })

  it('writes one of the two fields as chosen, and removes the key when nothing is left', () => {
    const base = read({})
    const tuned = withTuning(base, 'tuning', { grid: 'ortholinear', deg45: 2 })
    expect(tuned.tuning).toEqual({ grid: 'ortholinear' })
    expect(tuned).not.toHaveProperty('laidOutWith')
    const reset = withTuning(tuned, 'tuning', {})
    expect(reset, 'a reset leaves no key').not.toHaveProperty('tuning')
    const asked = withTuning(base, 'laidOutWith', { gridSize: 50 })
    expect(asked.laidOutWith).toEqual({ gridSize: 50 })
    expect(withTuning(asked, 'laidOutWith', { ...DEFAULT_TUNING })).not.toHaveProperty(
      'laidOutWith',
    )
    // The record handed in is not changed.
    expect(base).not.toHaveProperty('tuning')
  })
})

describe('reading a record’s tuning', () => {
  it('reads a record that never held one without the keys', () => {
    const record = read({})
    expect(record).not.toHaveProperty('tuning')
    expect(record).not.toHaveProperty('laidOutWith')
    expect(Object.keys(read({ tuning: {} }))).not.toContain('tuning')
  })

  it('reads one of nothing but LOOM’s own as none at all', () => {
    // Mutation: `readTuning` returns the settled `{}` instead of undefined -
    // the record then carries an empty key.
    expect(read({ tuning: { ...DEFAULT_TUNING } })).not.toHaveProperty('tuning')
    expect(read({ laidOutWith: { grid: 'octilinear' } })).not.toHaveProperty('laidOutWith')
  })

  it('reads both as written when they hold choices', () => {
    const record = read({
      tuning: { grid: 'orthoradial', mergeDistance: 80, deg135: 4 },
      laidOutWith: { gridSize: 50 },
    })
    expect(record.tuning).toEqual({ mergeDistance: 80, grid: 'orthoradial', deg135: 4 })
    expect(record.laidOutWith).toEqual({ gridSize: 50 })
  })

  it('reads a field the store would refuse as not held, field by field', () => {
    // A hand-edited file: the number out of range and the grid the engine
    // does not offer go; the rest stays. Mutation: the range check dropped
    // from `readTuning` - 600 is then read and would reach graph.build.
    expect(
      read({ tuning: { mergeDistance: 600, grid: 'quadtree', deg90: 3, colour: 'red' } }).tuning,
    ).toEqual({ deg90: 3 })
    expect(read({ tuning: { gridSize: '50' } })).not.toHaveProperty('tuning')
    expect(read({ tuning: 'hexalinear' })).not.toHaveProperty('tuning')
    expect(readTuning({ penalties: { deg45: 3 } })).toBeUndefined()
  })

  it('carries both into the front door’s summary, where the run graph reads them', () => {
    const record = read({ layout: 'a'.repeat(64), tuning: { grid: 'hexalinear' } })
    expect(summarise(record, false).tuning).toEqual({ grid: 'hexalinear' })
    expect(summarise(record, false)).not.toHaveProperty('laidOutWith')
    expect(summarise(read({}), false)).not.toHaveProperty('tuning')
  })

  it('makes a project’s card say how far it has got from them', () => {
    // The card derives its words from the summary with the run graph
    // (`projectFacts` -> `progressWords`). Mutation: the two left out of
    // `summarise` - the card then says "finished up to 05 Lines" of a
    // project whose layout is of another tuning.
    const drawn = read({ layout: 'a'.repeat(64), date: '2026-09-12' })
    const record = read({
      layout: 'a'.repeat(64),
      date: '2026-09-12',
      drawn: drawnFrom(drawn),
      tuning: { grid: 'hexalinear' },
    })
    expect(progressWords(summarise(record, false), null)).toBe('finished up to 02 Process')
    expect(
      progressWords(summarise({ ...record, laidOutWith: { grid: 'hexalinear' } }, false), null),
    ).toBe('finished up to 05 Lines')
  })
})
