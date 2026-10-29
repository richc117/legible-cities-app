// The stand-in engine held to the conformance table (spec 038, FR-007).
//
// `tests/support/conformance.ts` holds every refusal the engine can be made
// to give here, each sentence once; this suite asks them of the stand-in
// (`tests/fake-engine/schematic/serve.py`) on every pull request, and
// `conformance-real.test.ts` asks the same rows of the pinned engine in the
// determinism workflow. A stand-in is worth what it refuses: one that took a
// request the engine refuses, or refused it in other words, would pass every
// end-to-end test and fail only against the real engine (issue 473).
//
// Beside the table, the requests the stand-in must take (`taken`): the same
// methods with each field left out, which every params refusal is the null
// of, answered with a result or with the engine's error past the params.
//
// Needs a Python 3 on the PATH to run the stand-in; skips, saying so, without
// one.

import { readFileSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineEnvironment } from '../../src/main/interpreter'
import {
  BUILDING,
  expected,
  FEED,
  HERE,
  LAYOUT,
  PLAN,
  prepareFiles,
  removeFiles,
  rows,
  said,
  UNREACHED,
} from '../support/conformance'
import { FAKE_ENGINE, findPython } from '../support/python'
import { Server } from '../support/raw-server'

// The requests the judgement must let by: the same methods with the field
// left out, which every params refusal in the table is the null of. The
// stand-in answers each with something other than a params refusal; `then`
// says what.
interface Taken {
  method: string
  what: string
  params?: unknown
  raw?: string
  /** What the stand-in answers: a result, or the error's kind (the engine's, past the params). */
  then: 'result' | { kind: string }
}
const taken: Taken[] = [
  { method: 'engine.info', what: 'with no params', then: 'result' },
  { method: 'feeds.list', what: 'with an empty object', params: {}, then: 'result' },
  { method: 'style.presets', what: 'with no params', then: 'result' },
  { method: 'export.presets', what: 'with no params', then: 'result' },
  { method: 'export.storyboards', what: 'with no params', then: 'result' },
  { method: 'graph.build', what: 'with its key alone', params: { key: FEED }, then: 'result' },
  {
    method: 'graph.build',
    what: 'with every field it may take',
    params: {
      key: FEED,
      force: false,
      mode: 'tram,subway',
      agency: '',
      label_pattern: '^Metro (.+) Line$',
      label_strip: '^Metro ',
      tuning: { merge_distance: 50, grid: 'octilinear', grid_size: 100, penalties: { deg45: 2 } },
    },
    then: 'result',
  },
  {
    method: 'map.build',
    what: 'with the three it requires',
    params: { key: FEED, layout: LAYOUT, date: '2026-06-16' },
    then: { kind: 'layout' },
  },
  {
    method: 'map.build',
    what: 'with every field it may take',
    params: {
      key: FEED,
      layout: LAYOUT,
      date: '2026-06-16',
      out: 'abcdefghijk1',
      width: 1800,
      colors: { A: '#aabbcc' },
      default_color: '#112233',
      line_order: ['A', 'B'],
      style: { line_width: 6, station_shape: 'tick', label_font: 'inter' },
      dot_radius: 5,
      trail: 1,
      lines: {
        A: {
          name: 'Alpha',
          hidden: false,
          width: 1,
          casing: { width: 0.5, color: '#000000' },
          dash: 'dashed',
        },
      },
    },
    then: { kind: 'layout' },
  },
  { method: 'feeds.service', what: 'with its key alone', params: { key: FEED }, then: 'result' },
  {
    method: 'feeds.service',
    what: 'with an anchor and lines',
    params: { key: FEED, anchor: '2026-06-16', lines: ['A'] },
    then: 'result',
  },
  {
    method: 'feeds.inspect',
    what: 'with an anchor',
    params: { key: FEED, anchor: '2026-06-16' },
    then: 'result',
  },
  { method: 'feeds.remove', what: 'with its key', params: { key: FEED }, then: { kind: 'feed' } },
  {
    method: 'feeds.add',
    what: 'with every field it may take',
    params: {
      source: join(HERE, 'metro.zip'),
      key: 'metro',
      name: 'Metro',
      mode: 'subway',
      agency: 'X',
    },
    then: { kind: 'feed' },
  },
  {
    method: 'render.stage',
    what: 'with every field it may take',
    params: {
      key: FEED,
      layout: LAYOUT,
      stage: 'topo',
      width: 1200,
      labels: true,
      date: '2026-06-16',
    },
    then: { kind: 'layout' },
  },
  {
    method: 'export.plan',
    what: 'with its key and preset',
    params: { key: FEED, preset: 'instagram-reel' },
    then: 'result',
  },
  {
    method: 'export.plan',
    what: 'with every field it may take',
    params: {
      key: FEED,
      preset: 'instagram-reel',
      page: 'app://local/projects/abcdefghijk1/la.html',
      date: '2026-06-16',
      out: 'abcdefghijk1',
      options: {
        view: 'map',
        labels: true,
        title: true,
        clock: true,
        safe: false,
        theme: 'light',
        at: '08:00',
        lines: ['A'],
        storyboard: 'tour',
        quality: 'high',
        fade: 0.5,
        tag: 'v2',
        caption: 'Rush hour',
        clock_corner: 'bottom-left',
      },
    },
    then: 'result',
  },
  {
    method: 'export.encode',
    what: 'with a plan whole, its colours null, and no provenance',
    params: {
      plan: { ...PLAN, key: FEED },
      source: join(HERE, 'frames'),
      dest: join(HERE, 'out.mp4'),
    },
    then: { kind: 'io' },
  },
  {
    method: 'export.encode',
    what: 'with a whole number written with a point, and every provenance field',
    raw: JSON.stringify({
      plan: { ...PLAN, key: FEED },
      source: join(HERE, 'frames'),
      dest: join(HERE, 'out.mp4'),
      provenance: {
        service_date: '2026-06-16',
        trips: 3,
        stations: 4,
        lines: 2,
        caveats: ['a'],
        alt: 'A map.',
      },
    }).replace('"width":540', '"width":540.0'),
    then: { kind: 'io' },
  },
]

// --------------------------------------------------------------- the runs

const PYTHON = findPython()
const WHY = PYTHON === null ? ' (skipped: no Python 3 on the PATH)' : ''
const READY_MS = 30_000

const SCHEMA = JSON.parse(
  readFileSync(resolve(__dirname, '../../vendor/protocol.schema.json'), 'utf8'),
) as {
  methods: Record<string, unknown>
  $defs: { ErrorData: { properties: { kind: { enum: string[] } } } }
}

const text = (row: { params?: unknown; raw?: string }): string | undefined =>
  row.raw ?? (row.params === undefined ? undefined : JSON.stringify(row.params))

/** The stand-in on a home of its own, with the control file given, answering. */
async function standIn(
  control: Record<string, unknown>,
): Promise<{ home: string; server: Server }> {
  const home = mkdtempSync(join(tmpdir(), 'lc-params-'))
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify(control))
  const server = new Server(
    PYTHON as string,
    engineEnvironment({
      config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
      base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
      development: true,
    }),
    home,
  )
  await server.request('engine.info')
  return { home, server }
}

const plain = rows.filter((row) => row.setup === undefined)
const building = rows.filter((row) => row.setup === 'building')

beforeAll(() => prepareFiles())
afterAll(() => removeFiles())

describe.skipIf(PYTHON === null)(`the stand-in engine’s refusals${WHY}`, () => {
  let home = ''
  let server: Server

  beforeAll(async () => {
    ;({ home, server } = await standIn({ map_draws: true, progress_delay_ms: 1 }))
  }, READY_MS + 5_000)

  afterAll(async () => {
    await server?.stop()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })

  it('holds a table of refusals across every method the schema has', () => {
    // The table is the claim: a method with no row would be a method whose
    // refusals are not held to the engine. The one method the schema lacks
    // is the transport's refusal of a method no engine has.
    const methods = new Set(rows.map((row) => row.method))
    expect([...methods].filter((m) => !(m in SCHEMA.methods))).toEqual(['engine.nothing'])
    expect(Object.keys(SCHEMA.methods).filter((m) => !methods.has(m))).toEqual([])
    expect(rows.length).toBeGreaterThan(300)
  })

  it('holds every kind of error the schema names, or says why it cannot', () => {
    const kinds = new Set(rows.map((row) => row.expect.error.kind).filter((k) => k !== undefined))
    expect([...kinds, ...Object.keys(UNREACHED)].sort()).toEqual(
      [...SCHEMA.$defs.ErrorData.properties.kind.enum].sort(),
    )
  })

  it.each(plain)('refuses $method with $what, in the engine’s words', async (row) => {
    const reply = await server.request(row.method, row.params)
    expect(said(reply)).toEqual(expected(row.expect.error))
  })

  it.each(taken)('takes $method $what', async (row) => {
    const reply = await server.request(row.method, text(row))
    const answer = said(reply)
    if (row.then === 'result') expect(answer).toEqual({ result: true })
    else expect(answer).toMatchObject({ code: -32000, kind: row.then.kind })
  })
})

// The rows that need a build in flight: the stand-in's own home, its
// graph.build held after the stage `BUILDING` names until the file it names
// is written, and asked while it is held.
describe.skipIf(PYTHON === null)(
  `the stand-in engine’s refusals while a layout is built${WHY}`,
  () => {
    let home = ''
    let server: Server
    let build: Promise<unknown> | undefined

    beforeAll(async () => {
      ;({ home, server } = await standIn({
        map_draws: true,
        progress_delay_ms: 1,
        holds_after_stage: {
          [BUILDING.request.method]: { stage: BUILDING.reported, until: BUILDING.release },
        },
      }))
      const id = server.nextId
      build = server.request(BUILDING.request.method, BUILDING.request.params)
      const deadline = Date.now() + READY_MS
      const report = (): Record<string, unknown> | undefined =>
        server.notifications.find(
          (n) =>
            n.method === 'job/progress' &&
            n.params?.id === id &&
            n.params.stage === BUILDING.reported,
        )?.params
      while (report() === undefined) {
        if (Date.now() > deadline)
          throw new Error(`no report of ${BUILDING.reported} for the build`)
        await new Promise((ready) => setTimeout(ready, 10))
      }
      // The rows name the layout the build is under; a stand-in that names it
      // otherwise would refuse them in other words, for a reason not theirs.
      expect(report()?.layout).toBe(BUILDING.layout)
    }, READY_MS + 5_000)

    afterAll(async () => {
      if (home !== '') writeFileSync(join(home, BUILDING.release), '')
      await build?.catch(() => undefined)
      await server?.stop()
      if (home !== '') rmSync(home, { recursive: true, force: true })
    })

    it.each(building)('refuses $method with $what, in the engine’s words', async (row) => {
      const reply = await server.request(row.method, row.params)
      expect(said(reply)).toEqual(expected(row.expect.error))
    })
  },
)
