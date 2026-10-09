// The stand-in engine's answers, held to the engine's own description.
//
// The unit and end-to-end suites run against `tests/fake-engine`, which
// restates what the engine answers. A stand-in that answers a shape the real
// engine cannot produce lets a consumer pass here and fail there, and one
// that leaves out what the engine now requires lets a test mean less than it
// says. So the answers the pin's newest shapes ride in are read off the
// running stand-in and checked against `vendor/protocol.schema.json`, the
// file the generated types come from: `feeds.list` and `feeds.add` (a
// registry entry carries `headways`, since v0.11.0), `map.build` (its files
// carry the thumbnail pair, which are files on disk, beside the page, and it
// takes `style` and `lines`, since v0.12.0, and answers `stations`, sorted by
// name as code points and then by id, since v0.13.0), `feeds.remove` (its answer is
// `FeedsRemoveResult`), `render.stage` (its answer carries a `description`,
// timed only for a day), `export.plan` (a `CaptureJob` carries `caption` and
// `clock_corner`, and a storyboard may be a list of beats), `export.encode`
// (a person's `alt` replaces the engine's sentence) and the two tables
// `export.presets` and `export.storyboards`. The requests the tests send are
// held to the description's params as well, so a test cannot ask the stand-in
// for something the engine would refuse for its shape. The refusals it
// answers are held to the engine's handler as well, over the protocol: the
// code, the kind (params for the shape of the options, export for what the
// plan itself cannot take) and the sentence.
//
// Needs a Python 3 on the PATH to run the stand-in; skips, saying so,
// without one.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { engineEnvironment } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import { EngineError, ERROR_CODES, type EnginePin, type EngineState } from '../../src/shared/engine'
import { FAKE_ENGINE, findPython } from '../support/python'

// -------------------------------------------------------------- validating

interface Node {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, Node>
  required?: string[]
  items?: Node
  oneOf?: Node[]
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  pattern?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  prefixItems?: Node[]
  additionalProperties?: boolean | Node
  [other: string]: unknown
}

interface Description {
  $defs: Record<string, Node>
  methods: Record<string, { params: Node; result: Node }>
}

// The keywords scripts/protocol.ts knows. One it does not stops the check,
// so a description that outgrows this validator cannot pass by being ignored.
const KNOWN = new Set([
  '$ref',
  'type',
  'properties',
  'required',
  'items',
  'oneOf',
  'enum',
  'const',
  'description',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'pattern',
  'format',
  'default',
  'additionalProperties',
  'minLength',
  'minItems',
  'maxItems',
  'prefixItems',
  'maxLength',
])

const description = JSON.parse(
  readFileSync(join(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
) as Description

const kindOf = (value: unknown): string =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : Number.isInteger(value)
        ? 'integer'
        : typeof value

const isType = (value: unknown, type: string): boolean =>
  type === 'number' ? typeof value === 'number' : kindOf(value) === type

/** What is wrong with `value` against `node`, one sentence each; empty when nothing. */
function problems(node: Node, value: unknown, path: string): string[] {
  for (const key of Object.keys(node)) {
    if (!KNOWN.has(key)) throw new Error(`${path}: the keyword "${key}" is not understood here`)
  }
  if (node.$ref !== undefined) {
    const name = node.$ref.replace('#/$defs/', '')
    const target = description.$defs[name]
    if (target === undefined) throw new Error(`${path}: $ref to ${name}, which is not defined`)
    return problems(target, value, path)
  }
  if (node.const !== undefined) {
    return value === node.const ? [] : [`${path}: expected ${JSON.stringify(node.const)}`]
  }
  if (node.enum !== undefined) {
    return node.enum.includes(value) ? [] : [`${path}: ${JSON.stringify(value)} is not one of it`]
  }
  if (node.oneOf !== undefined) {
    const each = node.oneOf.map((branch) => problems(branch, value, path))
    return each.some((found) => found.length === 0) ? [] : [`${path}: matches no branch`]
  }
  const types = Array.isArray(node.type) ? node.type : node.type === undefined ? [] : [node.type]
  if (types.length > 0 && !types.some((type) => isType(value, type))) {
    return [`${path}: expected ${types.join(' or ')}, got ${kindOf(value)}`]
  }
  const found: string[] = []
  if (typeof value === 'number') {
    if (node.minimum !== undefined && value < node.minimum) found.push(`${path}: below minimum`)
    if (node.maximum !== undefined && value > node.maximum) found.push(`${path}: above maximum`)
    if (node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum) {
      found.push(`${path}: not above its exclusive minimum`)
    }
  }
  if (typeof value === 'string') {
    if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
      found.push(`${path}: does not match ${node.pattern}`)
    }
    if (node.minLength !== undefined && value.length < node.minLength) found.push(`${path}: short`)
    if (node.maxLength !== undefined && value.length > node.maxLength) found.push(`${path}: long`)
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined && value.length < node.minItems) found.push(`${path}: short`)
    if (node.maxItems !== undefined && value.length > node.maxItems) found.push(`${path}: long`)
    if (node.prefixItems !== undefined) {
      node.prefixItems.forEach((item, i) =>
        found.push(...problems(item, value[i], `${path}[${i}]`)),
      )
    }
    if (node.items !== undefined) {
      value.forEach((item, i) => found.push(...problems(node.items as Node, item, `${path}[${i}]`)))
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const members = value as Record<string, unknown>
    for (const name of node.required ?? []) {
      if (!(name in members)) found.push(`${path}: lacks "${name}"`)
    }
    for (const [name, member] of Object.entries(members)) {
      const declared = node.properties?.[name]
      if (declared !== undefined) {
        found.push(...problems(declared, member, `${path}.${name}`))
      } else if (node.additionalProperties === false) {
        found.push(`${path}: carries "${name}", which the description does not define`)
      } else if (typeof node.additionalProperties === 'object') {
        found.push(...problems(node.additionalProperties, member, `${path}.${name}`))
      }
    }
  }
  return found
}

/** What is wrong with an engine's answer to `method`, against the description's result. */
const answerProblems = (method: string, answer: unknown): string[] =>
  problems(description.methods[method].result, answer, method)

// ------------------------------------------------------ the validator itself

describe('the check of an answer against the description', () => {
  const entry = {
    key: 'x',
    name: 'X',
    city: '',
    network: '',
    url: '',
    mode: 'all',
    label_pattern: null,
    label_strip: null,
    agency: null,
    geographic: true,
    notes: [],
    headways: false,
    source: 'preset',
    cached: true,
  }

  it('accepts a registry entry as the description shapes it', () => {
    expect(answerProblems('feeds.list', { feeds: [entry] })).toEqual([])
  })

  it('refuses an entry without headways, and one that carries a member it does not define', () => {
    const without: Record<string, unknown> = { ...entry }
    delete without.headways
    expect(answerProblems('feeds.list', { feeds: [without] })).toEqual([
      'feeds.list.feeds[0]: lacks "headways"',
    ])
    expect(answerProblems('feeds.list', { feeds: [{ ...entry, extra: 1 }] })).toEqual([
      'feeds.list.feeds[0]: carries "extra", which the description does not define',
    ])
  })

  it('refuses a removal answer that is not exactly the description’s', () => {
    expect(answerProblems('feeds.remove', { ok: true })).toEqual([])
    expect(answerProblems('feeds.remove', { ok: true, cancel_too_late: true })).toEqual([])
    expect(answerProblems('feeds.remove', { ok: true, cancel_too_late: false })).not.toEqual([])
    expect(answerProblems('feeds.remove', { ok: true, removed: 'x' })).not.toEqual([])
    expect(answerProblems('feeds.remove', {})).toEqual(['feeds.remove: lacks "ok"'])
  })
})

/** What is wrong with the params a client sends to `method`, against the description's. */
const paramsProblems = (method: string, params: unknown): string[] =>
  problems(description.methods[method].params, params, `${method} params`)

// The shapes v0.12.0 changed or added, checked on answers made by hand, so a
// field the description now requires is shown to be required whatever the
// stand-in does. The running stand-in is held to the same below.
describe('the check of the v0.12.0 shapes against the description', () => {
  const stage = {
    layout: 'a'.repeat(64),
    stage: 'octi',
    svg: '<svg/>',
    width: 1200,
    height: 720,
    counts: { nodes: 3, stations: 3, junctions: 0, edges: 2, lines: ['A'] },
    description: {
      extent: null,
      lines: [
        {
          label: 'A',
          termini: ['Alpha', 'Charlie'],
          stations: ['Alpha', 'Bravo', 'Charlie'],
          meets: [],
          branches: [],
          trip: null,
        },
      ],
    },
  }
  const job = {
    key: 'la-metro-rail',
    preset: 'instagram-reel',
    mode: 'video',
    url: 'app://local/projects/abcdefghijk1/la.html?present=1',
    width: 1080,
    height: 1920,
    scale: 1,
    fps: 30,
    format: 'mp4',
    settle: 300,
    beats: [],
    keep: false,
    crf: 26,
    fade: 0,
    stem: 'la-metro-rail-instagram-reel',
    theme: 'dark',
    view: 'map',
    storyboard: 'tour',
    at: null,
    notes: [],
    caption: null,
    clock_corner: 'top-right',
    filename: 'la-metro-rail-instagram-reel.mp4',
  }
  const without = (shape: object, name: string): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...shape }
    delete copy[name]
    return copy
  }

  it('requires a stage’s description, and what it is made of', () => {
    expect(answerProblems('render.stage', stage)).toEqual([])
    expect(answerProblems('render.stage', without(stage, 'description'))).toEqual([
      'render.stage: lacks "description"',
    ])
    expect(
      answerProblems('render.stage', {
        ...stage,
        description: without(stage.description, 'extent'),
      }),
    ).toEqual(['render.stage.description: lacks "extent"'])
    const line = stage.description.lines[0]
    for (const name of ['label', 'termini', 'stations', 'meets', 'branches', 'trip']) {
      expect(
        answerProblems('render.stage', {
          ...stage,
          description: { ...stage.description, lines: [without(line, name)] },
        }),
        name,
      ).toEqual([`render.stage.description.lines[0]: lacks "${name}"`])
    }
    const timed = {
      ...stage,
      description: {
        extent: { minutes: 14, line: 'A', from: 'Alpha', to: 'Charlie' },
        lines: [{ ...line, trip: { minutes: 14, from: 'Alpha', to: 'Charlie' } }],
      },
    }
    expect(answerProblems('render.stage', timed)).toEqual([])
    expect(
      answerProblems('render.stage', {
        ...timed,
        description: { ...timed.description, extent: { minutes: 14, line: 'A' } },
      }),
    ).toEqual(['render.stage.description.extent: matches no branch'])
  })

  it('requires a plan’s caption and clock corner, and only the corners the engine has', () => {
    expect(answerProblems('export.plan', job)).toEqual([])
    expect(answerProblems('export.plan', { ...job, caption: 'Rush hour' })).toEqual([])
    expect(answerProblems('export.plan', without(job, 'caption'))).toEqual([
      'export.plan: lacks "caption"',
    ])
    expect(answerProblems('export.plan', without(job, 'clock_corner'))).toEqual([
      'export.plan: lacks "clock_corner"',
    ])
    expect(answerProblems('export.plan', { ...job, clock_corner: 'middle' })).not.toEqual([])
    expect(answerProblems('export.plan', { ...job, caption: '' })).not.toEqual([])
    expect(answerProblems('export.plan', { ...job, caption: 'a\nb' })).not.toEqual([])
    expect(answerProblems('export.plan', { ...job, storyboard: 'custom' })).toEqual([])
  })

  it('asks a beat for its seconds alone, and a storyboard as a name or a list', () => {
    const board = { name: 'one', views: '', seconds: 2, geographic: false }
    expect(
      answerProblems('export.storyboards', { storyboards: [{ ...board, beats: [{ secs: 2 }] }] }),
    ).toEqual([])
    expect(
      answerProblems('export.storyboards', {
        storyboards: [{ ...board, beats: [{ view: 'map' }] }],
      }),
    ).toEqual(['export.storyboards.storyboards[0].beats[0]: lacks "secs"'])
    const plan = (storyboard: unknown) =>
      paramsProblems('export.plan', {
        key: 'la-metro-rail',
        preset: 'instagram-reel',
        options: { storyboard },
      })
    expect(plan('tour')).toEqual([])
    expect(plan([{ secs: 2, view: 'map', at: '08:00' }, { secs: 3 }])).toEqual([])
    expect(plan([])).not.toEqual([])
    expect(plan(Array.from({ length: 17 }, () => ({ secs: 2 })))).not.toEqual([])
    expect(plan([{ secs: 0.4 }])).not.toEqual([])
    expect(plan([{ secs: 2, colour: 'red' }])).not.toEqual([])
  })

  it('takes the caption and the corner as options, a style and lines for the map, an alt for the sidecar and a day for a stage', () => {
    const options = (o: unknown) =>
      paramsProblems('export.plan', { key: 'la-metro-rail', preset: 'instagram-reel', options: o })
    expect(options({ caption: 'Rush hour', clock_corner: 'top-left' })).toEqual([])
    expect(options({ clock_corner: 'centre' })).not.toEqual([])
    expect(options({ caption: 'x'.repeat(81) })).not.toEqual([])
    const map = (extra: object) =>
      paramsProblems('map.build', {
        key: 'la-metro-rail',
        layout: 'a'.repeat(64),
        date: '2026-06-16',
        ...extra,
      })
    expect(
      map({
        style: { line_width: 9, label_size: 12 },
        lines: { A: { name: 'Alpha', hidden: true } },
      }),
    ).toEqual([])
    expect(map({ style: { line_width: 99 } })).not.toEqual([])
    expect(map({ style: { colour: '#ffffff' } })).not.toEqual([])
    expect(map({ lines: { A: { name: '' } } })).not.toEqual([])
    expect(map({ lines: { A: { colour: 'red' } } })).not.toEqual([])
    const provenance = (p: unknown) =>
      paramsProblems('export.encode', { plan: job, source: '/a', dest: '/b', provenance: p })
    expect(provenance({ alt: 'A map.' })).toEqual([])
    expect(provenance({ alt: '' })).not.toEqual([])
    const stageParams = (extra: object) =>
      paramsProblems('render.stage', {
        key: 'la-metro-rail',
        layout: 'a'.repeat(64),
        stage: 'octi',
        ...extra,
      })
    expect(stageParams({ date: '2026-06-16' })).toEqual([])
    expect(stageParams({ date: null })).not.toEqual([])
    expect(stageParams({ date: 'tomorrow' })).not.toEqual([])
  })
})

// ------------------------------------------- the map's stations (engine v0.13.0)

type Station = { id: string; name: string }

/**
 * Code points, one at a time: how the engine sorts a name (Python compares
 * strings by code point). Not UTF-16 units, in which a character beyond the
 * plane sorts before U+FFFF, and not a locale, in which "Z" follows "a".
 */
function byCodePoints(a: string, b: string): number {
  const left = Array.from(a, (c) => c.codePointAt(0) as number)
  const right = Array.from(b, (c) => c.codePointAt(0) as number)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return left.length - right.length
}

/**
 * What is wrong with the order of a `stations` list, one sentence for each
 * neighbour that is out of order: the schema says "sorted by name as code
 * points and then by id", and a schema cannot say that, so this does.
 */
function stationOrderProblems(stations: Station[]): string[] {
  const found: string[] = []
  for (let i = 1; i < stations.length; i++) {
    const before = stations[i - 1]
    const after = stations[i]
    const order = byCodePoints(before.name, after.name) || byCodePoints(before.id, after.id)
    if (order > 0) found.push(`stations[${i}] ${JSON.stringify(after)} sorts before its neighbour`)
  }
  return found
}

// The shape v0.13.0 added, checked on an answer made by hand, so `stations` is
// shown to be required, and what it is made of, whatever the stand-in does.
describe('the check of the v0.13.0 shapes against the description', () => {
  const built = {
    layout: 'a'.repeat(64),
    date: '2026-06-16',
    files: {
      svg: '/a/x.svg',
      html: '/a/x.html',
      positions: '/a/x.positions.json',
      thumb_dark: '/a/x-thumb-dark.svg',
      thumb_light: '/a/x-thumb-light.svg',
    },
    stations: [
      { id: '0x1', name: 'Alpha' },
      { id: '0x2', name: 'Bravo' },
    ],
    summary: 'a map',
    diagnostics: {
      stations: 2,
      junctions: 0,
      edges: 1,
      lines: ['A'],
      octilinear: 1,
      stops: {
        matched: 2,
        total: 2,
        unmatched: [],
        by: { station_id: 2, parent_station: 0, name: 0 },
      },
      trips: { total: 1, paths: 1, unrouted: 0 },
      degraded: { borrowed_track: 0, skipped_calls: 0 },
      labels_dropped: 0,
      peak_concurrent: 1,
    },
    caveats: [],
    issues: 0,
  }

  it('requires a map’s stations, each an id and a name, and nothing else', () => {
    expect(answerProblems('map.build', built)).toEqual([])
    const bare: Record<string, unknown> = { ...built }
    delete bare.stations
    expect(answerProblems('map.build', bare)).toEqual(['map.build: lacks "stations"'])
    // A station the feed gives no name is the empty string, and is still a station.
    expect(answerProblems('map.build', { ...built, stations: [{ id: '0x3', name: '' }] })).toEqual(
      [],
    )
    expect(answerProblems('map.build', { ...built, stations: [] })).toEqual([])
    expect(answerProblems('map.build', { ...built, stations: [{ id: '0x1' }] })).toEqual([
      'map.build.stations[0]: lacks "name"',
    ])
    expect(answerProblems('map.build', { ...built, stations: [{ name: 'Alpha' }] })).toEqual([
      'map.build.stations[0]: lacks "id"',
    ])
    expect(answerProblems('map.build', { ...built, stations: [{ id: 1, name: 'Alpha' }] })).toEqual(
      ['map.build.stations[0].id: expected string, got integer'],
    )
    expect(
      answerProblems('map.build', {
        ...built,
        stations: [{ id: '0x1', name: 'Alpha', lines: ['A'] }],
      }),
    ).toEqual(['map.build.stations[0]: carries "lines", which the description does not define'])
  })

  it('judges the order by name as code points and then by id', () => {
    const at = (id: string, name: string): Station => ({ id, name })
    expect(stationOrderProblems([])).toEqual([])
    expect(stationOrderProblems([at('0x9', 'Only')])).toEqual([])
    expect(stationOrderProblems([at('0x2', 'Alpha'), at('0x1', 'Bravo')])).toEqual([])
    expect(stationOrderProblems([at('0x1', 'Bravo'), at('0x2', 'Alpha')])).toHaveLength(1)
    // Two stations that share a name are told apart by id.
    expect(stationOrderProblems([at('0x1', 'Main'), at('0x2', 'Main')])).toEqual([])
    expect(stationOrderProblems([at('0x2', 'Main'), at('0x1', 'Main')])).toHaveLength(1)
    // A station without a name sorts first; capitals sort before lower case.
    expect(stationOrderProblems([at('0x5', ''), at('0x1', 'Alpha')])).toEqual([])
    expect(stationOrderProblems([at('0x1', 'Alpha'), at('0x5', '')])).toHaveLength(1)
    expect(stationOrderProblems([at('0x1', 'Zone'), at('0x2', 'alder')])).toEqual([])
    expect(stationOrderProblems([at('0x2', 'alder'), at('0x1', 'Zone')])).toHaveLength(1)
    // By code point, not by UTF-16 unit: U+FFFF comes before U+10000.
    expect(stationOrderProblems([at('0x1', '￿'), at('0x2', '\u{10000}')])).toEqual([])
    expect(stationOrderProblems([at('0x2', '\u{10000}'), at('0x1', '￿')])).toHaveLength(1)
  })
})

// ------------------------------------------------------ the running stand-in

const PYTHON = findPython()
const WHY = PYTHON === null ? ' (skipped: no Python 3 on the PATH)' : ''
const PIN: EnginePin = {
  repo: 'https://github.com/x/y',
  tag: 'v0.2.0',
  version: '0.2.0',
  protocol: 1,
}
const READY_MS = 30_000

describe.skipIf(PYTHON === null)(`the stand-in engine’s answers${WHY}`, () => {
  let home = ''
  let sidecar: Sidecar
  const states: EngineState[] = []

  const ask = (method: string, params: Record<string, unknown> = {}): Promise<unknown> =>
    sidecar.request(method, params, { deadlineMs: READY_MS }).result

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lc-shapes-'))
    writeFileSync(
      join(home, 'fake-engine.json'),
      JSON.stringify({ map_draws: true, progress_delay_ms: 1, add_delay_ms: 1 }),
    )
    sidecar = new Sidecar({
      command: [PYTHON as string, '-m', 'schematic.serve'],
      env: engineEnvironment({
        config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
        base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
        development: true,
      }),
      pin: PIN,
      log: () => {},
      bounds: { handshakeMs: READY_MS, inactivityMs: READY_MS },
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the stand-in never became ready')), READY_MS)
      sidecar.onState((s) => {
        states.push(s)
        if (s.state === 'ready') {
          clearTimeout(timer)
          resolve()
        }
      })
      sidecar.start()
    })
  }, READY_MS + 5_000)

  afterAll(async () => {
    await sidecar?.stop()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })

  it('lists a registry entry with headways, true for Mexico City alone among its presets', async () => {
    const answer = (await ask('feeds.list')) as { feeds: { key: string; headways: boolean }[] }
    expect(answerProblems('feeds.list', answer)).toEqual([])
    expect(answer.feeds.filter((f) => f.headways).map((f) => f.key)).toEqual(['cdmx-metro'])
  })

  it('draws the thumbnail pair beside the page and names both in the files', async () => {
    const built = (await ask('graph.build', { key: 'la-metro-rail' })) as { layout: string }
    const answer = (await ask('map.build', {
      key: 'la-metro-rail',
      layout: built.layout,
      date: '2026-06-16',
    })) as { files: Record<string, string> }
    expect(answerProblems('map.build', answer)).toEqual([])
    const { html, thumb_dark: dark, thumb_light: light } = answer.files
    for (const picture of [dark, light]) {
      expect(dirname(picture), `${picture} is beside the page`).toBe(dirname(html))
      expect(existsSync(picture), `${picture} is a file`).toBe(true)
      const text = readFileSync(picture, 'utf8')
      expect(text, basename(picture)).toMatch(/^<svg\b[^>]*>.*<rect\b.*<\/svg>$/s)
    }
    expect(basename(dark)).toBe('la-metro-rail-thumb-dark.svg')
    expect(basename(light)).toBe('la-metro-rail-thumb-light.svg')
    expect(readFileSync(dark, 'utf8')).not.toBe(readFileSync(light, 'utf8'))
  })

  it('adds a feed as a registry entry and removes it with the removal’s own answer', async () => {
    const added = await ask('feeds.add', {
      source: 'https://feeds.example.org/mine.zip',
      key: 'mine',
    })
    expect(answerProblems('feeds.add', added)).toEqual([])
    expect(added).toMatchObject({ key: 'mine', source: 'user', headways: false })

    const listed = (await ask('feeds.list')) as { feeds: { key: string }[] }
    expect(answerProblems('feeds.list', listed)).toEqual([])
    expect(listed.feeds.map((f) => f.key)).toContain('mine')

    const removed = await ask('feeds.remove', { key: 'mine' })
    expect(answerProblems('feeds.remove', removed)).toEqual([])
    expect(removed).toEqual({ ok: true })
  })

  it('reads a record written without headways as false, as the engine does one from before', async () => {
    mkdirSync(join(home, 'data', 'feeds'), { recursive: true })
    writeFileSync(
      join(home, 'data', 'feeds', 'user-feeds.json'),
      JSON.stringify([{ key: 'older', name: 'Older', source: 'user' }]),
    )
    const listed = (await ask('feeds.list')) as { feeds: { key: string; headways: boolean }[] }
    expect(listed.feeds.find((f) => f.key === 'older')?.headways).toBe(false)
  })

  // ---- engine v0.12.0

  interface StageAnswer {
    svg: string
    counts: { lines: string[] }
    description: {
      extent: { minutes: number; line: string; from: string; to: string } | null
      lines: {
        label: string
        termini: string[]
        stations: string[]
        meets: { station: string; lines: string[] }[]
        branches: unknown[]
        trip: { minutes: number; from: string; to: string } | null
      }[]
    }
  }

  const layoutOf = async (extra: Record<string, unknown> = {}): Promise<string> =>
    ((await ask('graph.build', { key: 'la-metro-rail', ...extra })) as { layout: string }).layout

  it('describes a stage beside its drawing, timed only for a service day', async () => {
    const params = { key: 'la-metro-rail', layout: await layoutOf(), stage: 'octi' }
    expect(paramsProblems('render.stage', params)).toEqual([])
    const bare = (await ask('render.stage', params)) as StageAnswer
    expect(answerProblems('render.stage', bare)).toEqual([])
    expect(bare.counts.lines).toEqual(['A', 'B'])
    expect(bare.description.extent).toBeNull()
    expect(bare.description.lines.map((l) => l.label)).toEqual(['A', 'B'])
    for (const line of bare.description.lines) {
      expect(line.trip, line.label).toBeNull()
      expect(line.termini).toEqual(['Alpha', 'Charlie'])
      expect(line.meets.map((m) => m.station)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    }
    expect(bare.description.lines[0].meets[0].lines).toEqual(['B'])

    const withDay = { ...params, date: '2026-06-16' }
    expect(paramsProblems('render.stage', withDay)).toEqual([])
    const dated = (await ask('render.stage', withDay)) as StageAnswer
    expect(answerProblems('render.stage', dated)).toEqual([])
    expect(dated.description.lines.map((l) => l.trip?.minutes)).toEqual([14, 11])
    expect(dated.description.extent).toEqual({
      minutes: 14,
      line: 'A',
      from: 'Alpha',
      to: 'Charlie',
    })
    // The day times the description and changes nothing the drawing says.
    expect(dated.svg).toBe(bare.svg)
    expect(dated.counts).toEqual(bare.counts)
  })

  it('describes only the lines a narrower mode kept', async () => {
    const layout = await layoutOf({ mode: 'tram' })
    const stage = (await ask('render.stage', {
      key: 'la-metro-rail',
      layout,
      stage: 'topo',
    })) as StageAnswer
    expect(answerProblems('render.stage', stage)).toEqual([])
    expect(stage.description.lines.map((l) => l.label)).toEqual(['A'])
    expect(stage.description.lines[0].meets).toEqual([])
  })

  it('refuses a day as the engine’s handler does: null, malformed, and not on the calendar', async () => {
    const layout = await layoutOf()
    const stage = (date: unknown): Promise<unknown> =>
      ask('render.stage', { key: 'la-metro-rail', layout, stage: 'topo', date })
    const params = { code: PARAMS, kind: 'params' }
    expect(await refusal(stage(null))).toEqual({
      ...params,
      message:
        'date must be the service day as YYYY-MM-DD, or left out for a description without minutes',
    })
    for (const date of ['tomorrow', 20260616, '2026-6-16', '']) {
      expect(await refusal(stage(date)), JSON.stringify(date)).toEqual({
        ...params,
        message: 'date must be a calendar day as YYYY-MM-DD',
      })
    }
    expect(await refusal(stage('2026-02-30'))).toEqual({
      ...params,
      message: 'date: 2026-02-30 is not a calendar day',
    })
  })

  interface PlanAnswer {
    mode: string
    url: string
    view: string
    at: number | null
    storyboard: string
    beats: { secs: number; view: string | null; at: number | null; tween: number }[]
    caption: string | null
    clock_corner: string
    notes: string[]
  }

  const planFor = async (
    preset: string,
    options: Record<string, unknown> = {},
  ): Promise<PlanAnswer> => {
    const params = { key: 'la-metro-rail', preset, options }
    expect(paramsProblems('export.plan', params), 'the request').toEqual([])
    const answer = (await ask('export.plan', params)) as PlanAnswer
    expect(answerProblems('export.plan', answer)).toEqual([])
    return answer
  }
  const queryOf = (url: string): URLSearchParams => new URL(url).searchParams

  // How the engine refuses over the protocol: the code, the kind in its data
  // and the sentence. Its handler judges the shape of the options before the
  // plan runs (params, -32602); what the plan itself refuses is an export
  // error (export, -32000).
  const PARAMS = -32602
  const EXPORT = -32000
  interface Refusal {
    code: number
    kind: string | undefined
    message: string
  }
  const refusal = async (request: Promise<unknown>): Promise<Refusal> => {
    try {
      await request
    } catch (error) {
      if (error instanceof EngineError) {
        return { code: error.code, kind: error.data?.kind, message: error.message }
      }
      throw error
    }
    throw new Error('the stand-in answered a request the engine refuses')
  }
  const planRefused = (preset: string, options: Record<string, unknown>): Promise<Refusal> =>
    refusal(ask('export.plan', { key: 'la-metro-rail', preset, options }))

  it('plans a caption (null unless asked) and the clock’s corner, top right where the platform covers the bottom right', async () => {
    const reel = await planFor('instagram-reel')
    expect(reel).toMatchObject({ caption: null, clock_corner: 'top-right', notes: [] })
    expect(queryOf(reel.url).get('corner')).toBe('top-right')
    expect(queryOf(reel.url).has('caption')).toBe(false)

    // A still without a clock still resolves a corner, and the address names none.
    const story = await planFor('instagram-story')
    expect(story.clock_corner).toBe('top-right')
    expect(queryOf(story.url).has('corner')).toBe(false)

    const post = await planFor('instagram-post')
    expect(post).toMatchObject({ caption: null, clock_corner: 'bottom-right' })
    expect(queryOf((await planFor('portfolio-mp4')).url).has('corner')).toBe(false)

    const captioned = await planFor('instagram-post', { caption: 'Rush hour, Los Angeles' })
    expect(captioned.caption).toBe('Rush hour, Los Angeles')
    expect(queryOf(captioned.url).get('caption')).toBe('Rush hour, Los Angeles')

    const corner = await planFor('portfolio-mp4', { clock_corner: 'bottom-left' })
    expect(corner.clock_corner).toBe('bottom-left')
    expect(queryOf(corner.url).get('corner')).toBe('bottom-left')
  })

  it('refuses a caption or a corner that is not one in the handler’s words, as a params error', async () => {
    const caption = 'caption must be text of 1 to 80 characters on one line'
    // One sentence for not text, empty, over 80 and a line break alike.
    for (const bad of ['x'.repeat(81), 'two\nlines', 'two\u2028lines', '', 7]) {
      expect(await planRefused('instagram-post', { caption: bad }), JSON.stringify(bad)).toEqual({
        code: PARAMS,
        kind: 'params',
        message: caption,
      })
    }
    expect(await planRefused('portfolio-mp4', { clock_corner: 'middle' })).toEqual({
      code: PARAMS,
      kind: 'params',
      message: 'clock_corner must be one of top-left, top-right, bottom-left, bottom-right',
    })
    // Eighty characters is allowed, and so is one.
    expect((await planFor('instagram-post', { caption: 'x'.repeat(80) })).caption).toHaveLength(80)
    expect((await planFor('instagram-post', { caption: 'x' })).caption).toBe('x')
  })

  it('refuses a corner the preset cannot take, in the plan’s words, as an export error', async () => {
    const exportError = { code: EXPORT, kind: 'export' }
    expect(await planRefused('instagram-reel', { clock_corner: 'bottom-right' })).toEqual({
      ...exportError,
      message:
        "Choose another corner for the clock: on instagram-reel, Instagram's button rail covers the bottom right.",
    })
    expect(
      await planRefused('instagram-story', { clock: true, clock_corner: 'bottom-right' }),
    ).toEqual({
      ...exportError,
      message:
        "Choose another corner for the clock: on instagram-story, Instagram's bottom zone covers the bottom right.",
    })
    expect(await planRefused('portfolio-mp4', { clock_corner: 'top-left' })).toEqual({
      ...exportError,
      message: 'Choose another corner for the clock: the title sits top left.',
    })
    expect(
      await planRefused('portfolio-mp4', { clock_corner: 'top-left', caption: 'Rush hour' }),
    ).toEqual({
      ...exportError,
      message: 'Choose another corner for the clock: the title and the caption sit top left.',
    })
    expect(
      await planRefused('portfolio-mp4', {
        clock_corner: 'top-left',
        title: false,
        caption: 'Rush hour',
      }),
    ).toEqual({
      ...exportError,
      message: 'Choose another corner for the clock: the caption sits top left.',
    })
  })

  it('lets a corner through where nothing sits or covers it, with a note where the platform may', async () => {
    // The title off and no caption: nothing sits top left, so the clock may.
    const free = await planFor('portfolio-mp4', { clock_corner: 'top-left', title: false })
    expect(free.clock_corner).toBe('top-left')
    // A still without a clock is not judged: the corner is carried all the same.
    const still = await planFor('instagram-post', { clock_corner: 'top-left' })
    expect(still.clock_corner).toBe('top-left')
    // The reel's bottom left is allowed, with a note saying what covers it.
    const note = await planFor('instagram-reel', { clock_corner: 'bottom-left' })
    expect(note.notes).toEqual([
      expect.stringMatching(
        /bottom left, inside Instagram's bottom zone \(the lowest 35% of the frame\)/,
      ),
    ])
  })

  it('writes the zones of a preset that has them on the address, as the engine does, and none for one that has not', async () => {
    const zones = (url: string): Record<string, string> =>
      Object.fromEntries([...queryOf(url)].filter(([name]) => /^z[a-z]+$/.test(name)))
    const reel = await planFor('instagram-reel')
    expect(zones(reel.url)).toEqual({
      ztop: '0.14',
      zbottom: '0.35',
      zside: '0.06',
      zrail: '0.21',
      zrailtop: '0.6',
    })
    // The story has no side and no rail, and a member without a number is not written.
    const story = await planFor('instagram-story')
    expect(zones(story.url)).toEqual({ ztop: '0.14', zbottom: '0.2' })
    // After the caption and the corner, which come after everything else.
    const names = [
      ...queryOf((await planFor('instagram-reel', { caption: 'Rush hour' })).url).keys(),
    ]
    expect(names.slice(-7)).toEqual([
      'caption',
      'corner',
      'ztop',
      'zbottom',
      'zside',
      'zrail',
      'zrailtop',
    ])
    for (const preset of ['instagram-post', 'portfolio-mp4', 'bluesky']) {
      expect(zones((await planFor(preset)).url), preset).toEqual({})
    }
    // The zones are the preset's: a plan that draws them too (safe) writes the same.
    expect(zones((await planFor('instagram-reel', { safe: true })).url)).toEqual(zones(reel.url))
  })

  it('plans a storyboard written as a list of beats, opening where its first beat does', async () => {
    const list = [
      { secs: 2, view: 'map', at: '08:00', speed: 60 },
      { secs: 3, view: 'linear' },
      { secs: 4, sweep: true, hours: 2 },
    ]
    const plan = await planFor('portfolio-mp4', { storyboard: list })
    expect(plan).toMatchObject({ mode: 'video', storyboard: 'custom', view: 'map', at: 8 * 3600 })
    expect(queryOf(plan.url).get('view')).toBe('map')
    expect(queryOf(plan.url).get('at')).toBe('08:00')
    expect(plan.beats.map((b) => b.secs)).toEqual([2, 3, 4])
    expect(plan.beats.map((b) => b.view)).toEqual(['map', 'linear', null])
    expect(plan.beats[0]).toMatchObject({ at: 8 * 3600, tween: 0 })
    // A transition left out is the shorter of the beat and 1.2 seconds.
    expect(plan.beats.map((b) => b.tween)).toEqual([0, 1.2, 1.2])
    // A named storyboard is still its own name.
    expect((await planFor('portfolio-mp4', { storyboard: 'morph' })).storyboard).toBe('morph')
  })

  it('judges a list beat by beat whatever the preset, and ignores a good one on a still', async () => {
    const first = { secs: 2, view: 'map', at: '08:00' }
    // The handler runs the engine's authored_beats on any list before it looks at the preset.
    expect(await planRefused('instagram-post', { storyboard: [{ secs: 2 }] })).toEqual({
      code: PARAMS,
      kind: 'params',
      message: 'storyboard[0].view is missing: the first beat names the view frame 0 is in',
    })
    expect(await planRefused('instagram-post', { storyboard: [] })).toMatchObject({
      code: PARAMS,
      message: 'storyboard holds no beats: a list holds 1 to 16',
    })
    // A list that is good is ignored by a still, and so are a view and a clock beside it:
    // only a video's list says where it opens.
    const still = await planFor('instagram-post', { storyboard: [first] })
    expect(still).toMatchObject({ mode: 'still', storyboard: '', view: 'map', at: 7 * 3600 })
    const beside = await planFor('instagram-post', {
      storyboard: [first],
      view: 'time',
      at: '09:30',
    })
    expect(beside).toMatchObject({ mode: 'still', storyboard: '', view: 'time', at: 9.5 * 3600 })
    // On a video preset the same request is the caller's mistake.
    expect(await planRefused('portfolio-mp4', { storyboard: [first], view: 'time' })).toEqual({
      code: PARAMS,
      kind: 'params',
      message: "view and at go on a list's first beat (storyboard[0]), not beside the list",
    })
  })

  it('refuses a list the engine refuses, naming the beat and the field', async () => {
    const refused = (
      storyboard: unknown[],
      extra: Record<string, unknown> = {},
    ): Promise<unknown> =>
      ask('export.plan', {
        key: 'la-metro-rail',
        preset: 'portfolio-mp4',
        options: { storyboard, ...extra },
      })
    const first = { secs: 2, view: 'map', at: '08:00' }
    await expect(refused([first], { view: 'time' })).rejects.toThrow(
      /view and at go on a list's first beat \(storyboard\[0\]\), not beside the list/,
    )
    await expect(refused([])).rejects.toThrow(/storyboard holds no beats: a list holds 1 to 16/)
    await expect(refused(Array.from({ length: 17 }, () => first))).rejects.toThrow(
      /storyboard\[16\] is one beat too many/,
    )
    await expect(refused([{ secs: 2, at: '08:00' }])).rejects.toThrow(
      /storyboard\[0\]\.view is missing/,
    )
    await expect(refused([{ secs: 2, view: 'map' }])).rejects.toThrow(
      /storyboard\[0\]\.at is missing/,
    )
    await expect(refused([first, { secs: 31 }])).rejects.toThrow(
      /storyboard\[1\]\.secs must be seconds, from 0\.5 to 30/,
    )
    await expect(refused([first, { secs: 1, view: 'sideways' }])).rejects.toThrow(
      /storyboard\[1\]\.view must be one of geographic, map, linear, time, or null/,
    )
    await expect(refused([{ ...first, tween: 1 }])).rejects.toThrow(
      /storyboard\[0\]\.tween must be 0/,
    )
    await expect(refused([first, { secs: 1, colour: 'red' }])).rejects.toThrow(
      /storyboard\[1\] does not take colour/,
    )
    await expect(
      refused([first, ...Array.from({ length: 3 }, () => ({ secs: 30 }))]),
    ).rejects.toThrow(/past the 90 seconds a list may last/)
  })

  it('answers the preset table and the storyboard table, a beat with every field as before', async () => {
    const presets = await ask('export.presets')
    expect(answerProblems('export.presets', presets)).toEqual([])
    const boards = (await ask('export.storyboards')) as {
      storyboards: { beats: Record<string, unknown>[] }[]
    }
    expect(answerProblems('export.storyboards', boards)).toEqual([])
    // The description no longer requires them; the engine still writes all nine.
    const fields = ['at', 'hours', 'labels', 'secs', 'span', 'speed', 'sweep', 'tween', 'view']
    for (const board of boards.storyboards) {
      for (const beat of board.beats) expect(Object.keys(beat).sort()).toEqual(fields)
    }
  })

  it('takes a style and per-line options for the map, and keeps what was sent where a test can read it', async () => {
    const params = {
      key: 'la-metro-rail',
      layout: await layoutOf(),
      date: '2026-06-16',
      style: { line_width: 9, label_size: 12 },
      lines: { A: { name: 'Alpha line' }, B: { hidden: true } },
    }
    expect(paramsProblems('map.build', params)).toEqual([])
    const answer = await ask('map.build', params)
    expect(answerProblems('map.build', answer)).toEqual([])
    const received = readFileSync(join(home, 'fake-engine.received'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> })
    const sent = received.filter((m) => m.method === 'map.build').pop()
    expect(sent?.params).toMatchObject({ style: params.style, lines: params.lines })
  })

  it('writes a person’s own alt text into the sidecar, trimmed, and refuses a blank or overlong one', async () => {
    const planned = await planFor('instagram-post')
    mkdirSync(join(home, 'shots'), { recursive: true })
    const source = join(home, 'shots', '000000.png')
    writeFileSync(source, 'a still')
    const dest = join(home, 'exported', 'one.png')
    const encode = async (
      provenance: Record<string, unknown>,
    ): Promise<{ sidecar: { alt: string } }> => {
      const params = { plan: planned, source, dest, provenance }
      expect(paramsProblems('export.encode', params), 'the request').toEqual([])
      const answer = (await ask('export.encode', params)) as { sidecar: { alt: string } }
      expect(answerProblems('export.encode', answer)).toEqual([])
      return answer
    }
    expect((await encode({ service_date: '2026-06-16' })).sidecar.alt).toBe(
      "The stand-in's la-metro-rail map.",
    )
    expect((await encode({ alt: '  Two lines meet at Bravo.\n' })).sidecar.alt).toBe(
      'Two lines meet at Bravo.',
    )
    const refused = (alt: string): Promise<unknown> =>
      ask('export.encode', { plan: planned, source, dest, provenance: { alt } })
    await expect(refused('  \n ')).rejects.toThrow(/provenance\.alt is empty; omit it instead/)
    await expect(refused('x'.repeat(1001))).rejects.toThrow(
      /provenance\.alt is 1,001 characters; it may be at most 1,000/,
    )
  })

  // ---- engine v0.13.0

  it('answers the map’s stations by id and name, sorted by name and then id', async () => {
    const layout = await layoutOf()
    const params = { key: 'la-metro-rail', layout, date: '2026-06-16' }
    const answer = (await ask('map.build', params)) as { stations: Station[] }
    expect(answerProblems('map.build', answer)).toEqual([])
    const { stations } = answer
    expect(stationOrderProblems(stations)).toEqual([])
    expect(stations.map((s) => s.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    // Ids are what the page's setTrip takes, so each names one station.
    expect(stations.every((s) => s.id !== '')).toBe(true)
    expect(new Set(stations.map((s) => s.id)).size).toBe(stations.length)
    // The same three stations the stand-in's stage describes.
    const stage = (await ask('render.stage', {
      key: 'la-metro-rail',
      layout,
      stage: 'octi',
    })) as StageAnswer
    expect(stations.map((s) => s.name).sort()).toEqual(
      [...stage.description.lines[0].stations].sort(),
    )
  })
})

// ----------------------------------------- the removal as a job (issue 351)

// Since engine v0.11.0 (its issue 35) `feeds.remove` is a job, like
// `feeds.add`: the reader goes on answering while it works, the write of the
// registry is its point of no return, a cancel before it is answered with the
// cancelled error and changes nothing, and one after it is not honoured and
// is told so. The app's Cancel in the removal's confirmation depends on all
// three, so the stand-in is held to them here, over the protocol. Each test
// starts a stand-in of its own, because the control file is read once.
describe.skipIf(PYTHON === null)(`the stand-in engine’s removal is a job${WHY}`, () => {
  const running: { sidecar: Sidecar; home: string }[] = []

  afterEach(async () => {
    for (const { sidecar, home } of running.splice(0)) {
      await sidecar.stop()
      rmSync(home, { recursive: true, force: true })
    }
  })

  /** A stand-in with one added feed, "mine", in its registry and its zip on disk. */
  async function standIn(
    control: Record<string, unknown>,
    inactivityMs = READY_MS,
  ): Promise<{ sidecar: Sidecar; home: string }> {
    const home = mkdtempSync(join(tmpdir(), 'lc-removal-'))
    writeFileSync(join(home, 'fake-engine.json'), JSON.stringify(control))
    mkdirSync(join(home, 'data', 'feeds'), { recursive: true })
    writeFileSync(
      join(home, 'data', 'feeds', 'user-feeds.json'),
      JSON.stringify([{ key: 'mine', name: 'Mine', source: 'user' }]),
    )
    writeFileSync(join(home, 'data', 'feeds', 'mine.zip'), 'a zip')
    const sidecar = new Sidecar({
      command: [PYTHON as string, '-m', 'schematic.serve'],
      env: engineEnvironment({
        config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
        base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
        development: true,
      }),
      pin: PIN,
      log: () => {},
      bounds: { handshakeMs: READY_MS, inactivityMs },
    })
    running.push({ sidecar, home })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the stand-in never became ready')), READY_MS)
      sidecar.onState((state) => {
        if (state.state === 'ready') {
          clearTimeout(timer)
          resolve()
        }
      })
      sidecar.start()
    })
    return { sidecar, home }
  }

  const zip = (home: string): string => join(home, 'data', 'feeds', 'mine.zip')
  const registry = (home: string): string[] =>
    (
      JSON.parse(readFileSync(join(home, 'data', 'feeds', 'user-feeds.json'), 'utf8')) as {
        key: string
      }[]
    ).map((record) => record.key)
  const read = (home: string, method: string): number =>
    readFileSync(join(home, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((line) => line.includes(`"method": "${method}"`)).length
  const keys = async (sidecar: Sidecar): Promise<string[]> =>
    ((await sidecar.request('feeds.list').result) as { feeds: { key: string }[] }).feeds.map(
      (feed) => feed.key,
    )
  async function until(predicate: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 10_000
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  it('answers a cancel before the point of no return with the cancelled error, and the feed is kept', async () => {
    const { sidecar, home } = await standIn({ remove_blocks_ms: 6_000 })
    const started = Date.now()
    const removal = sidecar.request('feeds.remove', { key: 'mine' })
    await until(() => read(home, 'feeds.remove') === 1, 'the stand-in to read the removal')
    sidecar.cancel(removal.id)
    const error = (await removal.result.catch((e: unknown) => e)) as EngineError
    expect(error, 'a rejection, not an answer').toBeInstanceOf(EngineError)
    expect(error.code, 'the cancelled error').toBe(ERROR_CODES.cancelled)
    expect(Date.now() - started, 'answered at the cancel, not at the removal’s end').toBeLessThan(
      5_000,
    )
    expect(await keys(sidecar), 'the list still names the feed').toContain('mine')
    expect(registry(home), 'the registry is as it was').toEqual(['mine'])
    expect(existsSync(zip(home)), 'its zip is where it was').toBe(true)
  })

  it('answers a cancel after the point of no return with cancel_too_late, the feed forgotten and its zip gone', async () => {
    const { sidecar, home } = await standIn({
      remove_blocks_ms: 2_500,
      remove_commits_after_ms: 100,
    })
    const started = Date.now()
    const removal = sidecar.request('feeds.remove', { key: 'mine' })
    await until(() => registry(home).length === 0, 'the registry to be written without the feed')
    expect(existsSync(zip(home)), 'the zip is still there at the point of no return').toBe(true)
    sidecar.cancel(removal.id)
    const answer = await removal.result
    expect(answer).toEqual({ ok: true, cancel_too_late: true })
    expect(answerProblems('feeds.remove', answer)).toEqual([])
    expect(Date.now() - started, 'the removal went on to its end').toBeGreaterThanOrEqual(2_400)
    expect(await keys(sidecar), 'the list no longer names the feed').not.toContain('mine')
    expect(existsSync(zip(home)), 'its zip went with it').toBe(false)
  })

  it('answers feeds.list while a removal runs, and the feed is still listed until it is forgotten', async () => {
    const { sidecar } = await standIn({ remove_blocks_ms: 6_000 })
    const started = Date.now()
    const removal = sidecar.request('feeds.remove', { key: 'mine' })
    const listed = await keys(sidecar)
    expect(Date.now() - started, 'answered while the removal runs').toBeLessThan(5_000)
    expect(listed).toContain('mine')
    sidecar.cancel(removal.id)
    await removal.result.catch(() => undefined)
  })

  it('answers a removal nobody cancels with exactly ok, the feed forgotten and its zip gone', async () => {
    const { sidecar, home } = await standIn({ remove_blocks_ms: 300 })
    const answer = await sidecar.request('feeds.remove', { key: 'mine' }).result
    expect(answer).toEqual({ ok: true })
    expect(answerProblems('feeds.remove', answer)).toEqual([])
    expect(await keys(sidecar)).not.toContain('mine')
    expect(existsSync(zip(home))).toBe(false)
  })

  it('never answers a removal it is told to stall on, so only the inactivity bound ends it', async () => {
    const { sidecar, home } = await standIn({ remove_stalls: true }, 400)
    const removal = sidecar.request('feeds.remove', { key: 'mine' })
    expect(sidecar.deadlinesArmed, 'no deadline of its own is armed').toBe(0)
    const error = (await removal.result.catch((e: unknown) => e)) as EngineError
    expect(error.code).toBe(ERROR_CODES.inactive)
    expect(error.data?.hint).toBe('No progress for 400 ms; the request was cancelled.')
    // The bound asked it to cancel, once, and it still did not answer.
    await until(() => read(home, '$/cancelRequest') === 1, 'the bound’s cancel to be read')
    expect(registry(home), 'nothing was done').toEqual(['mine'])
    expect(sidecar.abandoned, 'the engine still has it').toBe(1)
  })
})
