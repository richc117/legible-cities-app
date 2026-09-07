import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COLOR,
  DEFAULT_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  ID_PATTERN,
  RECORD_VERSION,
  parseRecord,
  summarise,
  validateAgency,
  validateFeedKey,
  validateId,
  validateMode,
  validateName,
  type ProjectRecord,
} from '../../src/shared/project'

// The record from contracts/record.md, verbatim.
const full: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: null,
  style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  layout: null,
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

describe('validateName', () => {
  it('requires something other than whitespace', () => {
    expect(validateName('')).toBe('name is required')
    expect(validateName('   \t ')).toBe('name is required')
  })
  it('caps the length after trimming', () => {
    expect(validateName('x'.repeat(121))).toBe('name is too long (120 characters at most)')
    expect(validateName('x'.repeat(120))).toBeNull()
    expect(validateName(`  ${'x'.repeat(120)}  `)).toBeNull()
  })
  it('accepts an ordinary name', () => {
    expect(validateName('Los Angeles')).toBeNull()
    expect(validateName('  padded  ')).toBeNull()
  })
})

describe('validateFeedKey', () => {
  const message = 'feed key must be lowercase letters, digits and hyphens'
  it('accepts the registry form', () => {
    for (const key of ['la-metro-rail', 'a', '0', 'x'.repeat(64), 'a-b-c-1']) {
      expect(validateFeedKey(key), key).toBeNull()
    }
  })
  it('refuses anything else', () => {
    for (const key of ['', 'LA-Metro', '-lead', 'a_b', 'a b', 'a.b', 'x'.repeat(65), 'ünïcode']) {
      expect(validateFeedKey(key), JSON.stringify(key)).toBe(message)
    }
  })
})

describe('validateMode', () => {
  it('accepts a short lowercase word', () => {
    for (const mode of ['all', 'rail', 'a', 'a'.repeat(16)]) {
      expect(validateMode(mode), mode).toBeNull()
    }
  })
  it('refuses the rest', () => {
    for (const mode of ['', 'Rail', 'a'.repeat(17), 'a-b', 'a1', 'a b']) {
      expect(validateMode(mode), JSON.stringify(mode)).toBe('mode must be a short lowercase word')
    }
  })
})

describe('validateAgency', () => {
  it('accepts none, or text up to 120 characters after trimming', () => {
    expect(validateAgency(null)).toBeNull()
    expect(validateAgency('Metro')).toBeNull()
    expect(validateAgency('x'.repeat(120))).toBeNull()
    expect(validateAgency(`  ${'x'.repeat(120)}  `)).toBeNull()
  })
  it('caps the length', () => {
    expect(validateAgency('x'.repeat(121))).toBe('agency is too long (120 characters at most)')
  })
})

describe('validateId', () => {
  it('accepts the generated form only', () => {
    expect(validateId('kq7x2mzp4dna')).toBeNull()
    expect(ID_PATTERN.test('kq7x2mzp4dna')).toBe(true)
    for (const id of [
      '',
      '1q7x2mzp4dna',
      'kq7x2mzp4dn',
      'kq7x2mzp4dnaa',
      'KQ7X2MZP4DNA',
      'kq7x-mzp4dna',
    ]) {
      expect(validateId(id), JSON.stringify(id)).toBe('invalid id')
    }
  })
})

describe('parseRecord', () => {
  it('reads a full record as written', () => {
    expect(parseRecord(structuredClone(full))).toEqual({ record: full, readOnly: false })
  })
  it('fills defaults for missing optional fields', () => {
    const parsed = parseRecord({ version: 1, id: full.id, name: 'Minimal', feed: 'la-metro-rail' })
    expect('record' in parsed).toBe(true)
    if (!('record' in parsed)) return
    expect(parsed.readOnly).toBe(false)
    expect(parsed.record).toMatchObject({
      version: RECORD_VERSION,
      id: full.id,
      name: 'Minimal',
      feed: 'la-metro-rail',
      mode: DEFAULT_MODE,
      agency: null,
      date: null,
      style: DEFAULT_STYLE,
      colors: {},
      defaultColor: DEFAULT_COLOR,
      lineOrder: [],
      theme: DEFAULT_THEME,
      layout: null,
    })
    // Times default to now, in the form every other time uses.
    expect(parsed.record.created).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(parsed.record.modified).toBe(parsed.record.created)
  })
  it('keeps a valid value and drops an invalid one, field by field', () => {
    const parsed = parseRecord({
      ...full,
      mode: 'Rail',
      agency: 'Metro',
      date: '2026-09-07',
      style: { lineWidth: 12, labelSize: 'big' },
      colors: { A: '#ff0000', B: 'red' },
      defaultColor: 'grey',
      lineOrder: ['A', 2, 'B'],
      theme: 'sepia',
      layout: 'abc123',
    })
    expect('record' in parsed).toBe(true)
    if (!('record' in parsed)) return
    expect(parsed.record).toMatchObject({
      mode: DEFAULT_MODE,
      agency: 'Metro',
      date: '2026-09-07',
      style: { ...DEFAULT_STYLE, lineWidth: 12 },
      colors: { A: '#ff0000' },
      defaultColor: DEFAULT_COLOR,
      lineOrder: ['A', 'B'],
      theme: 'sepia',
      layout: 'abc123',
    })
    const badDate = parseRecord({ ...full, date: '7 September 2026', theme: 'neon', layout: '' })
    if (!('record' in badDate)) throw new Error(badDate.error)
    expect(badDate.record.date).toBeNull()
    expect(badDate.record.theme).toBe(DEFAULT_THEME)
    expect(badDate.record.layout).toBeNull()
  })
  it('marks a record from a later version read-only without rewriting it', () => {
    const parsed = parseRecord({ ...full, version: 2, future: 'field' })
    expect('record' in parsed && parsed.readOnly).toBe(true)
    if ('record' in parsed) expect(parsed.record.version).toBe(2)
  })
  it('refuses a record without its identity', () => {
    const noId: Record<string, unknown> = { ...full }
    delete noId.id
    expect(parseRecord(noId)).toEqual({ error: 'missing or invalid id' })
    expect(parseRecord({ ...full, id: 'Not-An-Id' })).toEqual({ error: 'missing or invalid id' })
    expect(parseRecord({ ...full, version: undefined })).toEqual({
      error: 'missing or invalid version',
    })
    expect(parseRecord({ ...full, version: 0 })).toEqual({ error: 'missing or invalid version' })
    expect(parseRecord({ ...full, name: '  ' })).toEqual({ error: 'missing name' })
    expect(parseRecord({ ...full, feed: 'LA' })).toEqual({ error: 'missing or invalid feed' })
  })
  it('refuses anything that is not an object', () => {
    for (const input of [null, undefined, 'text', 42, true, [full]]) {
      expect(parseRecord(input), JSON.stringify(input)).toEqual({ error: 'not an object' })
    }
  })
})

describe('summarise', () => {
  it('keeps what the Library shows and nothing else', () => {
    expect(summarise({ ...full, date: '2026-09-07' }, true)).toEqual({
      id: full.id,
      name: full.name,
      feed: full.feed,
      date: '2026-09-07',
      modified: full.modified,
      readOnly: true,
    })
    expect(summarise(full, false).readOnly).toBe(false)
  })
})
