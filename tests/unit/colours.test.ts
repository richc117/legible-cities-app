// The colour handling, without a screen: which lines a project has, what
// each is drawn in, what an edit does to the palette, and what the record
// and the bridge will accept. The panel above these is only a screen, so
// this is where the behaviour is held (.claude/rules/renderer.md).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  feedColour,
  feedWords,
  hasOverride,
  isReset,
  linesOf,
  nextStep,
  readHex,
  resetAll,
  samePalette,
  shownColour,
  sourceWords,
  withDefault,
  withOverride,
  withoutOverride,
  type Line,
} from '../../src/renderer/src/colours'
import {
  DEFAULT_COLOR,
  LABEL_MAX,
  parseRecord,
  paletteOf,
  validatePalette,
  type Palette,
} from '../../src/shared/project'
import type { Inspection, Route, RouteType } from '../../src/shared/protocol'

const palette = (over: Partial<Palette> = {}): Palette => ({
  colors: {},
  defaultColor: DEFAULT_COLOR,
  ...over,
})

const route = (over: Partial<Route>): Route => ({
  route_id: 'r',
  agency_id: 'A',
  short_name: '',
  long_name: '',
  label: 'A',
  route_type: 1,
  color: null,
  text_color: null,
  trips: 1,
  ...over,
})

const type = (over: Partial<RouteType>): RouteType => ({
  route_type: 1,
  name: 'subway',
  mode: 'subway',
  modes: ['subway', 'metro'],
  routes: 1,
  trips: 1,
  ...over,
})

const inspection = (routes: Route[], types: RouteType[]): Inspection =>
  ({ key: 'k', name: 'K', routes, route_types: types }) as unknown as Inspection

describe('linesOf', () => {
  const types = [
    type({ route_type: 0, name: 'tram', mode: 'tram', modes: ['tram', 'streetcar'] }),
    type({ route_type: 1 }),
    type({ route_type: 3, name: 'bus', mode: 'bus', modes: ['bus', 'coach'] }),
  ]
  const routes = [
    route({ route_id: '1', label: 'B', route_type: 1, color: 'E3131B' }),
    route({ route_id: '2', label: 'A', route_type: 0, color: '0072BC' }),
    route({ route_id: '3', label: 'Rapid 720', route_type: 3, color: null }),
  ]
  const feed = inspection(routes, types)

  it('answers one line per label, sorted, with the feed colour hashed and lower-cased', () => {
    expect(linesOf(feed, { mode: 'all', agency: null })).toEqual([
      { label: 'A', feed: '#0072bc' },
      { label: 'B', feed: '#e3131b' },
      { label: 'Rapid 720', feed: null },
    ])
  })

  it('keeps only the route types the mode keeps, as the histogram says', () => {
    expect(linesOf(feed, { mode: 'subway', agency: null }).map((l) => l.label)).toEqual(['B'])
    expect(linesOf(feed, { mode: 'tram,bus', agency: null }).map((l) => l.label)).toEqual([
      'A',
      'Rapid 720',
    ])
  })

  it('keeps only the chosen operator; none means every operator', () => {
    const two = inspection(
      [
        route({ route_id: '1', label: 'A', agency_id: 'LACMTA', color: '0072BC' }),
        route({ route_id: '2', label: 'M', agency_id: 'METRO', color: 'F04E98' }),
      ],
      [type({})],
    )
    expect(linesOf(two, { mode: 'all', agency: 'METRO' })).toEqual([
      { label: 'M', feed: '#f04e98' },
    ])
    expect(linesOf(two, { mode: 'all', agency: null })).toHaveLength(2)
  })

  it('folds several routes under one label and takes the first colour the feed publishes', () => {
    const shared = inspection(
      [
        route({ route_id: 'north', label: 'A', color: null }),
        route({ route_id: 'south', label: 'A', color: '0072BC' }),
      ],
      [type({})],
    )
    expect(linesOf(shared, { mode: 'all', agency: null })).toEqual([
      { label: 'A', feed: '#0072bc' },
    ])
  })

  it('drops a route with no label and a route of a type no mode names', () => {
    const odd = inspection(
      [route({ route_id: 'x', label: '' }), route({ route_id: 'y', label: 'Y', route_type: 99 })],
      [type({})],
    )
    expect(linesOf(odd, { mode: 'all', agency: null })).toEqual([])
  })

  it('sorts numerically, so line 2 comes before line 10', () => {
    const many = inspection(
      [
        route({ route_id: 'a', label: '10' }),
        route({ route_id: 'b', label: '2' }),
        route({ route_id: 'c', label: '1' }),
      ],
      [type({})],
    )
    expect(linesOf(many, { mode: 'all', agency: null }).map((l) => l.label)).toEqual([
      '1',
      '2',
      '10',
    ])
  })
})

describe('feedColour', () => {
  it("reads the engine's six digits without a hash, and lower-cases them", () => {
    expect(feedColour('0072BC')).toBe('#0072bc')
    expect(feedColour('#0072bc')).toBe('#0072bc')
  })
  it('treats anything that is not a colour as no colour, never as one', () => {
    for (const value of [null, undefined, '', 'blue', '00', '0072BCC', '#ggg'])
      expect(feedColour(value as string | null), String(value)).toBeNull()
  })
})

describe('shownColour: the override, then the feed, then the default', () => {
  const coloured: Line = { label: 'A', feed: '#0072bc' }
  const blank: Line = { label: 'K', feed: null }

  it('shows the feed colour when nothing was chosen', () => {
    expect(shownColour(coloured, palette())).toEqual({ color: '#0072bc', source: 'feed' })
  })
  it('shows the default for a line the feed leaves uncoloured', () => {
    expect(shownColour(blank, palette())).toEqual({ color: DEFAULT_COLOR, source: 'default' })
    expect(feedWords(blank)).toBe('no colour in feed')
    expect(feedWords(coloured)).toBe('#0072bc')
  })
  it('shows the override over both', () => {
    const chosen = palette({ colors: { A: '#112233', K: '#445566' } })
    expect(shownColour(coloured, chosen)).toEqual({ color: '#112233', source: 'override' })
    expect(shownColour(blank, chosen)).toEqual({ color: '#445566', source: 'override' })
  })
  it('follows a changed default only where neither an override nor the feed speaks', () => {
    const other = withDefault(palette({ colors: { A: '#112233' } }), '#ff0000')
    expect(shownColour(blank, other).color).toBe('#ff0000')
    expect(shownColour(coloured, other).color, 'the override wins').toBe('#112233')
    expect(shownColour({ label: 'B', feed: '#00ff00' }, other).color, 'the feed wins').toBe(
      '#00ff00',
    )
  })
  it('says in words where a colour came from', () => {
    expect(sourceWords({ color: '#0072bc', source: 'feed' })).toContain('in the feed')
    expect(sourceWords({ color: '#112233', source: 'override' })).toContain('your colour')
    expect(sourceWords({ color: DEFAULT_COLOR, source: 'default' })).toContain('the default')
  })
  it('ignores a stored override that is not a colour, rather than drawing it', () => {
    const broken = { colors: { A: 'rgb(1,2,3)' }, defaultColor: DEFAULT_COLOR }
    expect(shownColour(coloured, broken)).toEqual({ color: '#0072bc', source: 'feed' })
  })
})

describe('editing the palette', () => {
  it('adds one override and leaves the rest alone', () => {
    const before = palette({ colors: { A: '#112233' } })
    const after = withOverride(before, 'B', '#445566')
    expect(after.colors).toEqual({ A: '#112233', B: '#445566' })
    expect(before.colors, 'the palette it was given is untouched').toEqual({ A: '#112233' })
  })
  it('takes a typed colour in any of its spellings', () => {
    expect(withOverride(palette(), 'A', '#ABC').colors.A).toBe('#aabbcc')
    expect(withOverride(palette(), 'A', '0072bc').colors.A).toBe('#0072bc')
    expect(withDefault(palette(), ' #FF0000 ').defaultColor).toBe('#ff0000')
  })
  it('refuses a value that is not a colour, changing nothing', () => {
    const before = palette({ colors: { A: '#112233' } })
    expect(withOverride(before, 'B', 'teal')).toBe(before)
    expect(withDefault(before, '')).toBe(before)
  })
  // A feed names its own lines, and nothing stops one being called
  // `toString`: `in` would say such a line had an override when it has
  // none, which would light its Reset and make the panel lie.
  it('does not mistake an inherited name for an override', () => {
    const empty = palette()
    for (const label of ['toString', 'constructor', 'valueOf', '__proto__']) {
      expect(hasOverride(empty, label), label).toBe(false)
      expect(shownColour({ label, feed: '#0072bc' }, empty), label).toEqual({
        color: '#0072bc',
        source: 'feed',
      })
      expect(withoutOverride(empty, label), label).toBe(empty)
    }
    // And a line the record could not hold is refused rather than written
    // and lost: assigning __proto__ on a plain object writes no property.
    expect(withOverride(empty, '__proto__', '#ff0000')).toBe(empty)
    const chosen = withOverride(empty, 'toString', '#ff0000')
    expect(hasOverride(chosen, 'toString')).toBe(true)
    expect(shownColour({ label: 'toString', feed: '#0072bc' }, chosen).source).toBe('override')
    expect(withoutOverride(chosen, 'toString').colors).toEqual({})
  })

  it('reset removes one line only', () => {
    const before = palette({ colors: { A: '#112233', B: '#445566' } })
    expect(withoutOverride(before, 'A').colors).toEqual({ B: '#445566' })
    expect(withoutOverride(before, 'Z'), 'a line with no override is not a change').toBe(before)
  })
  it('reset for all empties the overrides and returns the default', () => {
    expect(resetAll()).toEqual({ colors: {}, defaultColor: DEFAULT_COLOR })
    expect(isReset(resetAll())).toBe(true)
    expect(isReset(palette({ colors: { A: '#112233' } }))).toBe(false)
    expect(isReset(palette({ defaultColor: '#ff0000' }))).toBe(false)
  })
  it('knows two palettes that are the same, so nothing is rebuilt for a change that is not one', () => {
    expect(
      samePalette(palette({ colors: { A: '#112233' } }), palette({ colors: { A: '#112233' } })),
    ).toBe(true)
    expect(samePalette(palette(), palette({ defaultColor: '#ff0000' }))).toBe(false)
    expect(samePalette(palette({ colors: { A: '#112233' } }), palette())).toBe(false)
    expect(
      samePalette(palette({ colors: { A: '#112233' } }), palette({ colors: { B: '#112233' } })),
    ).toBe(false)
  })
})

// FR-009: a change made while a layout, a rebuild or an export is reading
// the project's page waits and builds once - it is never refused and never
// dropped, so no control has to disable itself under a person's hands.
describe('nextStep: build, wait, or nothing at all', () => {
  const stored = palette({ colors: { A: '#0072bc' } })
  const changed = palette({ colors: { A: '#ff0000' } })

  it('builds a change when the way is clear', () => {
    expect(nextStep(changed, stored, false)).toBe('build')
  })
  it('waits rather than refusing while something else reads the page', () => {
    expect(nextStep(changed, stored, true)).toBe('wait')
  })
  it('does nothing for a change that is not one, busy or not', () => {
    expect(nextStep(stored, stored, false)).toBe('none')
    expect(nextStep(palette({ colors: { A: '#0072BC' } }), stored, false)).toBe('build')
    expect(nextStep(stored, stored, true), 'and does not wait for one either').toBe('none')
  })
  it('sees a changed default as a change', () => {
    expect(nextStep(withDefault(stored, '#112233'), stored, false)).toBe('build')
  })
})

describe('readHex', () => {
  it('takes the spellings a person types', () => {
    expect(readHex('#0072BC')).toBe('#0072bc')
    expect(readHex('0072bc')).toBe('#0072bc')
    expect(readHex('  #abc  ')).toBe('#aabbcc')
  })
  it('refuses everything else', () => {
    for (const value of ['', '#', 'blue', '#00ff', '#0000000', 'rgb(0,0,0)', '#gggggg'])
      expect(readHex(value), value).toBeNull()
  })
})

describe('validatePalette: the gate the main process runs', () => {
  it('accepts a palette the panel would send', () => {
    expect(validatePalette({ colors: {}, defaultColor: DEFAULT_COLOR })).toBeNull()
    expect(validatePalette({ colors: { A: '#0072bc' }, defaultColor: '#FF0000' })).toBeNull()
  })
  it('refuses anything that is not a palette', () => {
    for (const value of [undefined, null, 42, 'grey', [], { colors: {} }])
      expect(validatePalette(value), JSON.stringify(value) ?? 'undefined').not.toBeNull()
  })
  it('refuses a colour that is not six hexadecimal digits behind a hash', () => {
    for (const colour of ['0072bc', '#0072b', '#0072bcc', 'red', '', null, 42])
      expect(
        validatePalette({ colors: { A: colour }, defaultColor: DEFAULT_COLOR }),
        String(colour),
      ).not.toBeNull()
    expect(validatePalette({ colors: {}, defaultColor: 'grey' })).not.toBeNull()
  })
  it('refuses a label that is empty, too long or carries a control character', () => {
    const bad = [' ', 'a'.repeat(LABEL_MAX + 1), 'A\nB', 'A\u0000B']
    for (const label of bad.slice(1))
      expect(
        validatePalette({ colors: { [label]: '#0072bc' }, defaultColor: DEFAULT_COLOR }),
        label,
      ).not.toBeNull()
    expect(validatePalette({ colors: { '': '#0072bc' }, defaultColor: DEFAULT_COLOR })).toBe(
      'a line needs a label',
    )
    expect(
      validatePalette({ colors: { ' ': '#0072bc' }, defaultColor: DEFAULT_COLOR }),
      'a label that is only spaces is still a label, and a feed may publish one',
    ).toBeNull()
  })
  it('refuses more lines than a feed could draw', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 513; i++) many[`line-${i}`] = '#0072bc'
    expect(validatePalette({ colors: many, defaultColor: DEFAULT_COLOR })).toMatch(/more than/)
  })
  it('names the line whose colour is wrong, so a person can find it', () => {
    expect(
      validatePalette({ colors: { 'Rapid 720': 'x' }, defaultColor: DEFAULT_COLOR }),
    ).toContain('Rapid 720')
  })
})

describe('the record keeps a palette and reads one back', () => {
  it('drops an entry the validator would refuse, so what is read is what would be written', () => {
    const parsed = parseRecord({
      version: 1,
      id: 'abcdefghijk1',
      name: 'LA',
      feed: 'la-metro-rail',
      colors: { A: '#0072bc', B: 'teal', '': '#ffffff', 'C\u0000': '#ffffff' },
      defaultColor: '#FF0000',
    })
    expect('record' in parsed).toBe(true)
    if (!('record' in parsed)) return
    expect(parsed.record.colors).toEqual({ A: '#0072bc' })
    expect(parsed.record.defaultColor).toBe('#FF0000')
    expect(paletteOf(parsed.record)).toEqual({ colors: { A: '#0072bc' }, defaultColor: '#FF0000' })
  })
  it('falls back to the engine default when the record names no colour', () => {
    const parsed = parseRecord({ version: 1, id: 'abcdefghijk1', name: 'LA', feed: 'la' })
    expect('record' in parsed && parsed.record.defaultColor).toBe(DEFAULT_COLOR)
  })
})

// The packager copies every production dependency into the app whole, and
// the renderer's packages are bundled by vite: a picker in `dependencies`
// would ship twice. The kit is kept out for the same reason and a stronger
// one (figui-guard.test.ts); this holds the picker to the same rule.
describe('the colour picker is a build input', () => {
  it('is a devDependency, pinned exactly', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(pkg.dependencies?.['react-colorful']).toBeUndefined()
    expect(pkg.devDependencies?.['react-colorful']).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('is named in the third-party notices with its licence', () => {
    const notices = readFileSync(resolve(__dirname, '../../THIRD_PARTY_NOTICES.md'), 'utf8')
    const row = notices.split('\n').find((line) => line.startsWith('| react-colorful '))
    expect(row).toBeDefined()
    expect(row).toContain('MIT')
  })
})
