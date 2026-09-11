import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
  validateServiceWindow,
  withinWindow,
  type ProjectRecord,
  AGENCY_MAX,
  MODE_PATTERN,
} from '../../src/shared/project'

const WINDOW = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest: '2026-09-15',
  anchor: '2026-09-08',
}

// The record from contracts/record.md, verbatim.
const full: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: null,
  service: null,
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

describe('the two rules the engine also checks', () => {
  // graph.build validates mode and agency itself now; the app's rules are
  // the engine's, read from the committed description rather than repeated.
  const schema = JSON.parse(
    readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
  ) as {
    $defs: {
      GraphBuildParams: { properties: { mode: { pattern: string }; agency: { maxLength: number } } }
    }
  }
  it('match the engine schema', () => {
    const props = schema.$defs.GraphBuildParams.properties
    expect(MODE_PATTERN.source).toBe(props.mode.pattern)
    expect(AGENCY_MAX).toBe(props.agency.maxLength)
  })
})

describe('validateMode', () => {
  // The engine's rule: what LOOM's -m takes, names or route_type numbers,
  // comma-joined; the registry's own entries are the proof.
  it('accepts what gtfs2graph -m takes', () => {
    for (const mode of ['all', 'rail', 'tram,subway', 'rail,funicular', '1', 'mono-rail']) {
      expect(validateMode(mode), mode).toBeNull()
    }
  })
  it('refuses the rest', () => {
    for (const mode of ['', 'Rail', 'a'.repeat(65), 'a b', 'tram,', ',tram', 'tram,,rail']) {
      expect(validateMode(mode), JSON.stringify(mode)).toBe(
        'mode must be one or more of the modes LOOM knows, such as tram or subway, comma-joined',
      )
    }
  })
})

describe('validateAgency', () => {
  it('accepts none, or text up to 64 characters after trimming, as the engine does', () => {
    expect(validateAgency(null)).toBeNull()
    expect(validateAgency('Metro')).toBeNull()
    expect(validateAgency('x'.repeat(64))).toBeNull()
    expect(validateAgency(`  ${'x'.repeat(64)}  `)).toBeNull()
  })
  it('caps the length', () => {
    expect(validateAgency('x'.repeat(65))).toBe('agency is too long (64 characters at most)')
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

describe('validateServiceWindow and withinWindow', () => {
  it('accepts four calendar days in order, a single-day window included', () => {
    expect(validateServiceWindow(WINDOW)).toBeNull()
    expect(validateServiceWindow({ ...WINDOW, start: '2026-12-31' })).toBeNull()
  })
  it('names what is wrong', () => {
    expect(validateServiceWindow(null)).toMatch(/four days/)
    expect(validateServiceWindow({ ...WINDOW, anchor: undefined })).toMatch(/missing its anchor/)
    expect(validateServiceWindow({ ...WINDOW, end: '2026-02-30' })).toMatch(
      /end: that is not a day/,
    )
    expect(validateServiceWindow({ ...WINDOW, start: '2027-01-01' })).toMatch(
      /ends before it starts/,
    )
  })
  it('bounds a day inclusively', () => {
    expect(withinWindow('2026-01-01', WINDOW)).toBe(true)
    expect(withinWindow('2026-12-31', WINDOW)).toBe(true)
    expect(withinWindow('2025-12-31', WINDOW)).toBe(false)
    expect(withinWindow('2027-01-01', WINDOW)).toBe(false)
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
      service: null,
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
      layout: '3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f',
      service: { ...WINDOW, extra: 'dropped' },
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
      layout: '3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f',
      service: WINDOW,
    })
    // A layout identifier is 64 hex digits, the engine's id (ADR-033) or the
    // digest the app wrote before; anything else is dropped rather than half-trusted.
    const badDate = parseRecord({
      ...full,
      date: '7 September 2026',
      theme: 'neon',
      layout: 'abc123',
    })
    if (!('record' in badDate)) throw new Error(badDate.error)
    expect(badDate.record.date).toBeNull()
    expect(badDate.record.theme).toBe(DEFAULT_THEME)
    expect(badDate.record.layout).toBeNull()
    // A window is whole or nothing: a half-valid block is not half-trusted.
    for (const service of [
      { ...WINDOW, end: '2025-01-01' },
      { ...WINDOW, busiest: 'Tuesday' },
      { start: '2026-01-01', end: '2026-12-31' },
      'all year',
      [WINDOW],
    ]) {
      const parsed = parseRecord({ ...full, service })
      if (!('record' in parsed)) throw new Error(parsed.error)
      expect(parsed.record.service, JSON.stringify(service)).toBeNull()
    }
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
