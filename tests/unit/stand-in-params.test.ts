// What the stand-in engine refuses of a request's params, held to the engine.
//
// Engine v0.19.0 (its issue 83) judges every method's params as the schema
// does: a `null` in a field that may be left out is a refusal and no longer
// the field left out, a plan handed back with a field missing is refused, so
// is a text that is not text and a number no double holds. The stand-in
// (`tests/fake-engine/schematic/serve.py`) used to know two of these, the
// `null` `style` and `lines` of `map.build` (issue 471), and took the rest
// for the field left out; a change that began to send one would then pass
// every test here and fail only against the real engine (issue 473). A
// stand-in is worth what it refuses.
//
// The engine's refusals are written by hand, field by field, and every
// sentence is that field's own, so the stand-in restates its handler
// (`params_problem`) and this table holds the result: the code, the kind and
// the sentence of each refusal, with the engine's own `hint` and `detail`
// (the same sentence, as its `invalid_params` writes them). Every sentence
// below was copied from the engine's `serve.py` at v0.19.0, and the table was
// also run against that engine, row by row, as the second half of this file
// does wherever an engine checkout is named on the command line:
//
//   LEGIBLE_ENGINE_CHECKOUT=/path/to/engine npm test -- stand-in-params
//
// (the environment alone, never `.env.local`, so a run here never reads a
// person's own file). The rows are refusals, which the engine gives before it
// looks at a feed, so the run starts no work and downloads nothing.
//
// Needs a Python 3 on the PATH to run the stand-in; skips, saying so, without
// one.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { FAKE_ENGINE, findPython } from '../support/python'

// ------------------------------------------------------------ a raw client

/** A reply to one request: the result, or the error as the engine writes it. */
interface Reply {
  result?: unknown
  error?: {
    code: number
    message: string
    data?: { kind?: string; hint?: string; detail?: string }
  }
}

// Under vitest's own test timeout, so a row that hangs says which request it was.
const DEADLINE_MS = 20_000

/**
 * The server on its stdio, spoken to in its framing with the params as JSON
 * *text*: the table needs numbers no JavaScript value holds (`1e999` is
 * `Infinity` here and `null` on the wire), which the app's own client could
 * never send and a hand-written one could.
 */
class Server {
  #child: ChildProcessWithoutNullStreams
  #buffer = Buffer.alloc(0)
  #waiting = new Map<number, (reply: Reply) => void>()
  #next = 1
  #exited = false
  #why = 'the server has exited'
  #ended: (() => void)[] = []

  constructor(command: string, env: Record<string, string>, cwd: string) {
    this.#child = spawn(command, ['-m', 'schematic.serve'], {
      env,
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    // Drained and dropped: the server logs to its stderr and nothing here reads it.
    this.#child.stderr.resume()
    const ended = (why: string): void => {
      if (this.#exited) return
      this.#exited = true
      this.#why = why
      for (const end of this.#ended) end()
    }
    this.#child.once('exit', () => ended('the server has exited'))
    // An interpreter that is not there never starts, and says so only here.
    this.#child.once('error', (error) =>
      ended(`the server could not be run (${command}): ${error.message}`),
    )
    // A write to a server that exited between the check and the write.
    this.#child.stdin.on('error', () => {})
    this.#child.stdout.on('data', (chunk: Buffer) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk])
      this.#read()
    })
  }

  #read(): void {
    for (;;) {
      const end = this.#buffer.indexOf('\r\n\r\n')
      if (end < 0) return
      const head = this.#buffer.subarray(0, end).toString('ascii')
      const length = Number(/content-length:\s*(\d+)/i.exec(head)?.[1])
      const start = end + 4
      if (this.#buffer.length < start + length) return
      const message = JSON.parse(this.#buffer.subarray(start, start + length).toString('utf8')) as {
        id?: number
      } & Reply
      this.#buffer = this.#buffer.subarray(start + length)
      if (message.id !== undefined) this.#waiting.get(message.id)?.(message)
    }
  }

  /** One request, its params written as `paramsText` (JSON), or left out. */
  request(method: string, paramsText?: string): Promise<Reply> {
    const id = this.#next++
    const body =
      `{"jsonrpc":"2.0","id":${id},"method":${JSON.stringify(method)}` +
      (paramsText === undefined ? '' : `,"params":${paramsText}`) +
      '}'
    return new Promise<Reply>((resolve, reject) => {
      // A server that has ended answers nothing, so say so at once and not at the deadline.
      if (this.#exited) return reject(new Error(`${method}: ${this.#why}`))
      const timer = setTimeout(() => {
        this.#waiting.delete(id)
        reject(new Error(`${method} was not answered in ${DEADLINE_MS} ms`))
      }, DEADLINE_MS)
      this.#ended.push(() => {
        clearTimeout(timer)
        reject(new Error(`${method}: ${this.#why}, unanswered`))
      })
      this.#waiting.set(id, (reply) => {
        clearTimeout(timer)
        this.#waiting.delete(id)
        resolve(reply)
      })
      this.#child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    })
  }

  async stop(): Promise<void> {
    if (this.#exited) return
    const exited = new Promise<void>((resolve) => this.#child.once('exit', () => resolve()))
    this.#child.stdin.end()
    const killer = setTimeout(() => this.#child.kill(), 10_000)
    await exited
    clearTimeout(killer)
  }
}

// --------------------------------------------------------------- the table

// A key that fits the pattern and that no registry has, in every refusal row
// whose field under test is not the key: were the engine ever to disagree with a
// row, it would stop at its registry check with a feed error and fail the row
// cleanly, and not go on to download a feed and start LOOM.
const KEY = 'no-such-feed'
// A feed the stand-in has, for the requests it must take.
const FEED = 'la-metro-rail'
const LAYOUT = 'a'.repeat(64)
const HERE = mkdtempSync(join(tmpdir(), 'lc-params-table-'))

type Params = Record<string, unknown>

/** One refusal: a method, params (or their JSON text), and the engine's sentence. */
interface Row {
  method: string
  what: string
  params?: unknown
  raw?: string
  says: string
}

const rows: Row[] = []
const refuses = (method: string, what: string, params: unknown, says: string): void => {
  rows.push({ method, what, params, says })
}
const refusesRaw = (method: string, what: string, raw: string, says: string): void => {
  rows.push({ method, what, raw, says })
}
const omit = (base: Params, ...names: string[]): Params => {
  const copy = { ...base }
  for (const name of names) delete copy[name]
  return copy
}

// The sentences several fields share, as `serve.py` writes them.
const KEY_SAYS = 'key must be a feed key: lower-case letters, digits and hyphens'
const LAYOUT_SAYS =
  'layout is required: the id graph.build answered with. A map is drawn from a stored layout and never lays one out itself.'
const DATE_REQUIRED =
  'date is required: the service day to draw, as YYYY-MM-DD. The engine never picks one, because its choice would depend on the day you asked.'
const TOKEN_SAYS =
  'out must be a folder name: letters, digits, dot, underscore and hyphen, not starting with a dot, never a path'
const DOUBLE =
  ' must be a number a double holds: finite, and at most about 1.8e308 either side of zero'
const NOT_A_DAY = 'must be a calendar day as YYYY-MM-DD'
const COLOUR = 'must be a colour written #rrggbb'

// -- the methods that take no parameters (serve._no_params)
for (const method of [
  'engine.info',
  'feeds.list',
  'style.presets',
  'export.presets',
  'export.storyboards',
]) {
  refuses(method, 'an object with a member', { key: KEY }, `${method} takes no parameters`)
  refusesRaw(method, 'a list', '[]', `${method} takes no parameters`)
  refusesRaw(method, 'a text', '"x"', `${method} takes no parameters`)
}

// -- a method that takes an object, given anything else (serve._object)
for (const method of [
  'graph.build',
  'map.build',
  'feeds.service',
  'feeds.add',
  'feeds.remove',
  'feeds.inspect',
  'render.stage',
  'export.plan',
  'export.encode',
]) {
  for (const [what, raw] of [
    ['null', 'null'],
    ['a list', '[]'],
    ['a number', '7'],
  ] as const)
    refusesRaw(method, `params that are ${what}`, raw, `${method} takes an object of parameters`)
}

// -- graph.build
{
  const base = { key: KEY }
  refuses('graph.build', 'key: null', { key: null }, KEY_SAYS)
  refuses('graph.build', 'key: a number', { key: 7 }, KEY_SAYS)
  refuses('graph.build', 'key: left out', {}, KEY_SAYS)
  refuses('graph.build', 'force: null', { ...base, force: null }, 'force must be true or false')
  refuses('graph.build', 'force: a text', { ...base, force: 'yes' }, 'force must be true or false')
  const mode =
    'mode must be what gtfs2graph -m takes: names such as tram, subway or rail, or route_type numbers, comma-joined'
  refuses('graph.build', 'mode: null', { ...base, mode: null }, mode)
  refuses('graph.build', 'mode: a number', { ...base, mode: 1 }, mode)
  refuses('graph.build', 'mode: a name LOOM does not know', { ...base, mode: 'hovercraft' }, mode)
  const agency = 'agency must be an agency_id from the feed, or empty for every operator'
  refuses('graph.build', 'agency: null', { ...base, agency: null }, agency)
  refuses('graph.build', 'agency: a list', { ...base, agency: ['X'] }, agency)
  for (const name of ['label_pattern', 'label_strip']) {
    refuses(
      'graph.build',
      `${name}: null`,
      { ...base, [name]: null },
      `${name} must be a regular expression`,
    )
    refuses(
      'graph.build',
      `${name}: not a pattern`,
      { ...base, [name]: '(' },
      `${name} must be a regular expression`,
    )
  }
  refuses(
    'graph.build',
    'tuning: null',
    { ...base, tuning: null },
    "tuning must be an object of LOOM's own settings, or left out",
  )
  refuses(
    'graph.build',
    'tuning.merge_distance: null',
    { ...base, tuning: { merge_distance: null } },
    'tuning.merge_distance must be from 5 to 500, in metres',
  )
  refuses(
    'graph.build',
    'tuning.grid: null',
    { ...base, tuning: { grid: null } },
    'tuning.grid must be one of octilinear, ortholinear, orthoradial, hexalinear',
  )
  refuses(
    'graph.build',
    'tuning.penalties: null',
    { ...base, tuning: { penalties: null } },
    'tuning.penalties must be an object of deg45, deg90, deg135, deg180, diagonal',
  )
  refuses(
    'graph.build',
    'tuning.penalties.deg45: null',
    { ...base, tuning: { penalties: { deg45: null } } },
    'tuning.penalties.deg45 must be from 0 to 10, as a cost without a unit',
  )
  refuses(
    'graph.build',
    'a member it does not take',
    { ...base, bogus: 1 },
    'graph.build does not take bogus',
  )
  refusesRaw(
    'graph.build',
    'tuning.merge_distance: a number no double holds',
    `{"key":"${KEY}","tuning":{"merge_distance":1e999}}`,
    `tuning.merge_distance${DOUBLE}`,
  )
}

// -- map.build
{
  const base = { key: KEY, layout: LAYOUT, date: '2026-06-16' }
  refuses('map.build', 'key: null', { ...base, key: null }, KEY_SAYS)
  refuses('map.build', 'layout: null', { ...base, layout: null }, LAYOUT_SAYS)
  refuses('map.build', 'layout: left out', omit(base, 'layout'), LAYOUT_SAYS)
  refuses(
    'map.build',
    'layout: not an id',
    { ...base, layout: 'abc' },
    'layout must be a layout id: 64 hex digits, as graph.build reports',
  )
  refuses('map.build', 'date: null', { ...base, date: null }, DATE_REQUIRED)
  refuses('map.build', 'date: left out', omit(base, 'date'), DATE_REQUIRED)
  refuses('map.build', 'date: a number', { ...base, date: 20260616 }, `date ${NOT_A_DAY}`)
  refuses(
    'map.build',
    'date: not on the calendar',
    { ...base, date: '2026-02-30' },
    'date: 2026-02-30 is not a calendar day',
  )
  refuses('map.build', 'out: null', { ...base, out: null }, TOKEN_SAYS)
  refuses('map.build', 'out: a path', { ...base, out: '../x' }, TOKEN_SAYS)
  refuses('map.build', 'width: null', { ...base, width: null }, 'width must be a number above zero')
  refuses('map.build', 'width: zero', { ...base, width: 0 }, 'width must be a number above zero')
  refuses(
    'map.build',
    'width: a text',
    { ...base, width: '1800' },
    'width must be a number above zero',
  )
  const colors = 'colors must be an object of line label to a colour written #rrggbb'
  refuses('map.build', 'colors: null', { ...base, colors: null }, colors)
  refuses('map.build', 'colors: a list', { ...base, colors: ['#aabbcc'] }, colors)
  refuses('map.build', 'colors: a colour that is none', { ...base, colors: { A: 'red' } }, colors)
  refuses('map.build', 'colors: a colour that is null', { ...base, colors: { A: null } }, colors)
  refuses(
    'map.build',
    'default_color: null',
    { ...base, default_color: null },
    `default_color ${COLOUR}`,
  )
  refuses(
    'map.build',
    'default_color: short',
    { ...base, default_color: '#abc' },
    `default_color ${COLOUR}`,
  )
  refuses(
    'map.build',
    'line_order: null',
    { ...base, line_order: null },
    'line_order must be a list of strings',
  )
  refuses(
    'map.build',
    'line_order: a text',
    { ...base, line_order: 'A' },
    'line_order must be a list of strings',
  )
  refuses(
    'map.build',
    'line_order: a list with a null',
    { ...base, line_order: ['A', null] },
    'line_order must be a list of strings',
  )
  refuses('map.build', 'style: null', { ...base, style: null }, 'style must be an object')
  refuses(
    'map.build',
    'style.line_width: null',
    { ...base, style: { line_width: null } },
    "style.line_width must be from 1 to 24, in SVG user units at the map's width",
  )
  refuses(
    'map.build',
    'style.station_shape: null',
    { ...base, style: { station_shape: null } },
    'style.station_shape must be circle, tick or square',
  )
  refuses(
    'map.build',
    'style.label_font: null',
    { ...base, style: { label_font: null } },
    'style.label_font must be system, inter or atkinson-hyperlegible-next',
  )
  refuses(
    'map.build',
    'dot_radius: null',
    { ...base, dot_radius: null },
    "dot_radius must be from 2 to 12, in SVG user units at the map's width",
  )
  refuses(
    'map.build',
    'trail: null',
    { ...base, trail: null },
    'trail must be from 0 to 3, in seconds of playback',
  )
  refuses(
    'map.build',
    'lines: null',
    { ...base, lines: null },
    "lines must be an object of line label to the line's name, hidden, width, casing and dash",
  )
  refuses(
    'map.build',
    'lines.A: null',
    { ...base, lines: { A: null } },
    "lines['A'] must be an object of name, hidden, width, casing and dash",
  )
  refuses(
    'map.build',
    'lines.A.name: null',
    { ...base, lines: { A: { name: null } } },
    "lines['A'].name must be from 1 to 40 characters with no line break",
  )
  refuses(
    'map.build',
    'lines.A.hidden: null',
    { ...base, lines: { A: { hidden: null } } },
    "lines['A'].hidden must be true or false",
  )
  refuses(
    'map.build',
    'lines.A.width: null',
    { ...base, lines: { A: { width: null } } },
    "lines['A'].width must be from 0.75 to 1.5, as a multiple of line_width",
  )
  refuses(
    'map.build',
    'lines.A.casing: null',
    { ...base, lines: { A: { casing: null } } },
    "lines['A'].casing must be an object of width and color",
  )
  refuses(
    'map.build',
    'lines.A.dash: null',
    { ...base, lines: { A: { dash: null } } },
    "lines['A'].dash must be solid, dashed or dotted",
  )
  refuses(
    'map.build',
    'a member it does not take',
    { ...base, bogus: 1 },
    'map.build does not take bogus',
  )
  refusesRaw(
    'map.build',
    'width: a number no double holds',
    `{"key":"${KEY}","layout":"${LAYOUT}","date":"2026-06-16","width":1e999}`,
    `width${DOUBLE}`,
  )
  refusesRaw(
    'map.build',
    'style.line_width: a number no double holds',
    `{"key":"${KEY}","layout":"${LAYOUT}","date":"2026-06-16","style":{"line_width":-1e999}}`,
    `style.line_width${DOUBLE}`,
  )
}

// -- feeds.service, feeds.inspect, feeds.remove
{
  const base = { key: KEY }
  refuses('feeds.service', 'key: null', { key: null }, KEY_SAYS)
  refuses(
    'feeds.service',
    'anchor: null',
    { ...base, anchor: null },
    `anchor ${NOT_A_DAY}, or left out`,
  )
  refuses('feeds.service', 'anchor: a number', { ...base, anchor: 20260616 }, `anchor ${NOT_A_DAY}`)
  refuses(
    'feeds.service',
    'anchor: not on the calendar',
    { ...base, anchor: '2026-02-30' },
    'anchor: 2026-02-30 is not a calendar day',
  )
  refuses(
    'feeds.service',
    'lines: null',
    { ...base, lines: null },
    'lines must be a list of strings',
  )
  refuses(
    'feeds.service',
    'lines: a text',
    { ...base, lines: 'A' },
    'lines must be a list of strings',
  )
  refuses(
    'feeds.service',
    'a member it does not take',
    { ...base, bogus: 1 },
    'feeds.service does not take bogus',
  )
  refuses('feeds.inspect', 'key: left out', {}, KEY_SAYS)
  refuses(
    'feeds.inspect',
    'anchor: null',
    { ...base, anchor: null },
    `anchor ${NOT_A_DAY}, or left out`,
  )
  refuses(
    'feeds.inspect',
    'a member it does not take',
    { ...base, mode: 'tram' },
    'feeds.inspect does not take mode',
  )
  refuses('feeds.remove', 'key: null', { key: null }, KEY_SAYS)
  refuses(
    'feeds.remove',
    'a member it does not take',
    { ...base, force: true },
    'feeds.remove does not take force',
  )
}

// -- feeds.add
{
  const base = { source: join(HERE, 'metro.zip') }
  const source =
    'source must be a URL with its scheme, or an absolute path to a zip the client owns'
  refuses('feeds.add', 'source: null', { source: null }, source)
  refuses('feeds.add', 'source: left out', {}, source)
  refuses('feeds.add', 'source: a relative path', { source: 'metro.zip' }, source)
  const keySays = 'key must be a feed key: lower-case letters, digits and hyphens'
  refuses('feeds.add', 'key: null', { ...base, key: null }, keySays)
  refuses('feeds.add', 'key: capitals', { ...base, key: 'Metro' }, keySays)
  const name = 'name must be text, up to 120 characters'
  refuses('feeds.add', 'name: null', { ...base, name: null }, name)
  refuses('feeds.add', 'name: blank', { ...base, name: '   ' }, name)
  refuses('feeds.add', 'name: over 120', { ...base, name: 'x'.repeat(121) }, name)
  refuses(
    'feeds.add',
    'mode: null',
    { ...base, mode: null },
    'mode must be what gtfs2graph -m takes: names such as tram, subway or rail, or route_type numbers, comma-joined',
  )
  refuses(
    'feeds.add',
    'agency: null',
    { ...base, agency: null },
    'agency must be an agency_id from the feed, or empty for every operator',
  )
  refuses(
    'feeds.add',
    'agency: empty',
    { ...base, agency: '' },
    'agency must be an agency_id from the feed, or left out',
  )
  refuses(
    'feeds.add',
    'label_pattern: given',
    { ...base, label_pattern: '^a' },
    'feeds.add does not take label_pattern',
  )
  refuses(
    'feeds.add',
    'label_pattern: null',
    { ...base, label_pattern: null },
    'label_pattern must be a regular expression',
  )
  refuses(
    'feeds.add',
    'a member it does not take',
    { ...base, bogus: 1 },
    'feeds.add does not take bogus',
  )
}

// -- render.stage
{
  const base = { key: KEY, layout: LAYOUT, stage: 'topo' }
  refuses('render.stage', 'key: null', { ...base, key: null }, KEY_SAYS)
  refuses('render.stage', 'layout: null', { ...base, layout: null }, LAYOUT_SAYS)
  const stage = 'stage must be one of gtfs2graph, topo, loom, octi'
  refuses('render.stage', 'stage: null', { ...base, stage: null }, stage)
  refuses('render.stage', 'stage: left out', omit(base, 'stage'), stage)
  refuses('render.stage', 'stage: an array', { ...base, stage: ['topo'] }, stage)
  refuses(
    'render.stage',
    'width: null',
    { ...base, width: null },
    'width must be a number above zero',
  )
  refuses('render.stage', 'labels: null', { ...base, labels: null }, 'labels must be true or false')
  refuses(
    'render.stage',
    'date: null',
    { ...base, date: null },
    'date must be the service day as YYYY-MM-DD, or left out for a description without minutes',
  )
  refuses('render.stage', 'date: a number', { ...base, date: 20260616 }, `date ${NOT_A_DAY}`)
  refuses(
    'render.stage',
    'a member it does not take',
    { ...base, bogus: 1 },
    'render.stage does not take bogus',
  )
  refusesRaw(
    'render.stage',
    'width: a number no double holds',
    `{"key":"${KEY}","layout":"${LAYOUT}","stage":"topo","width":-Infinity}`,
    `width${DOUBLE}`,
  )
}

// -- export.plan
{
  const base = { key: KEY, preset: 'instagram-reel' }
  const options = (extra: Params): Params => ({ ...base, options: extra })
  refuses('export.plan', 'key: null', { ...base, key: null }, KEY_SAYS)
  const preset = 'preset must be the name of an export preset; export.presets lists them'
  refuses('export.plan', 'preset: null', { ...base, preset: null }, preset)
  refuses('export.plan', 'preset: left out', omit(base, 'preset'), preset)
  refuses('export.plan', 'preset: a number', { ...base, preset: 1 }, preset)
  const page = "page must be the page's address, with its scheme"
  refuses('export.plan', 'page: null', { ...base, page: null }, page)
  refuses('export.plan', 'page: no scheme', { ...base, page: 'maps/x.html' }, page)
  refuses('export.plan', 'date: null', { ...base, date: null }, `date ${NOT_A_DAY}, or left out`)
  refuses('export.plan', 'date: a number', { ...base, date: 20260616 }, `date ${NOT_A_DAY}`)
  refuses(
    'export.plan',
    'date: not on the calendar',
    { ...base, date: '2026-02-30' },
    'date: 2026-02-30 is not a calendar day',
  )
  refuses('export.plan', 'out: null', { ...base, out: null }, TOKEN_SAYS)
  refuses('export.plan', 'options: null', { ...base, options: null }, 'options must be an object')
  refuses('export.plan', 'options: a list', { ...base, options: [] }, 'options must be an object')
  const views = 'view must be one of geographic, map, linear, time'
  refuses('export.plan', 'options.view: null', options({ view: null }), views)
  refuses('export.plan', 'options.view: a list', options({ view: [] }), views)
  for (const flag of ['labels', 'title', 'clock', 'safe']) {
    refuses(
      'export.plan',
      `options.${flag}: null`,
      options({ [flag]: null }),
      `${flag} must be true or false`,
    )
    refuses(
      'export.plan',
      `options.${flag}: a text`,
      options({ [flag]: 'yes' }),
      `${flag} must be true or false`,
    )
  }
  refuses(
    'export.plan',
    'options.theme: null',
    options({ theme: null }),
    'theme must be dark or light',
  )
  refuses(
    'export.plan',
    'options.theme: sepia',
    options({ theme: 'sepia' }),
    'theme must be dark or light',
  )
  refuses('export.plan', 'options.at: null', options({ at: null }), 'at must be a clock, HH:MM')
  refuses('export.plan', 'options.at: a number', options({ at: 800 }), 'at must be a clock, HH:MM')
  refuses(
    'export.plan',
    'options.lines: null',
    options({ lines: null }),
    'lines must be a list of strings',
  )
  refuses(
    'export.plan',
    'options.lines: a list with a number',
    options({ lines: ['A', 1] }),
    'lines must be a list of strings',
  )
  const board = 'storyboard must be the name of a storyboard; export.storyboards lists them'
  refuses('export.plan', 'options.storyboard: null', options({ storyboard: null }), board)
  refuses('export.plan', 'options.storyboard: an object', options({ storyboard: {} }), board)
  refuses(
    'export.plan',
    'options.storyboard: a name it lacks',
    options({ storyboard: 'nope' }),
    board,
  )
  const quality = 'quality must be draft, standard or high'
  refuses('export.plan', 'options.quality: null', options({ quality: null }), quality)
  refuses('export.plan', 'options.quality: an array', options({ quality: ['high'] }), quality)
  refuses(
    'export.plan',
    'options.quality: an object',
    options({ quality: { high: true } }),
    quality,
  )
  refuses(
    'export.plan',
    'options.fade: null',
    options({ fade: null }),
    'fade must be seconds, 0 or more',
  )
  refuses(
    'export.plan',
    'options.fade: negative',
    options({ fade: -1 }),
    'fade must be seconds, 0 or more',
  )
  const tag = 'tag must be a short filename suffix: letters, digits, dot, underscore, hyphen'
  refuses('export.plan', 'options.tag: null', options({ tag: null }), tag)
  refuses('export.plan', 'options.tag: a path', options({ tag: 'a/b' }), tag)
  const caption = 'caption must be text of 1 to 80 characters on one line'
  refuses('export.plan', 'options.caption: null', options({ caption: null }), caption)
  refuses('export.plan', 'options.caption: empty', options({ caption: '' }), caption)
  refuses('export.plan', 'options.caption: two lines', options({ caption: 'a\nb' }), caption)
  const corner = 'clock_corner must be one of top-left, top-right, bottom-left, bottom-right'
  refuses('export.plan', 'options.clock_corner: null', options({ clock_corner: null }), corner)
  refuses(
    'export.plan',
    'options.clock_corner: centre',
    options({ clock_corner: 'centre' }),
    corner,
  )
  refuses(
    'export.plan',
    'options: a member it does not take',
    options({ bogus: 1 }),
    'export.plan options does not take bogus',
  )
  refuses(
    'export.plan',
    'options.view beside a list of beats',
    options({ view: 'map', storyboard: [{ secs: 2, view: 'map', at: '08:00' }] }),
    "view and at go on a list's first beat (storyboard[0]), not beside the list",
  )
  refuses(
    'export.plan',
    'a member it does not take',
    { ...base, bogus: 1 },
    'export.plan does not take bogus',
  )
  refusesRaw(
    'export.plan',
    'options.fade: a number no double holds',
    `{"key":"${KEY}","preset":"instagram-reel","options":{"fade":1e999}}`,
    `options.fade${DOUBLE}`,
  )
  refusesRaw(
    'export.plan',
    'options.fade: NaN, which is not JSON at all',
    `{"key":"${KEY}","preset":"instagram-reel","options":{"fade":NaN}}`,
    `options.fade${DOUBLE}`,
  )
}

// -- export.encode: the plan handed back as export.plan answered it
const BEAT = {
  secs: 2,
  view: 'map',
  labels: null,
  at: 28800,
  speed: 120,
  sweep: false,
  hours: null,
  lo: null,
  hi: null,
  tween: 0,
}
const PLAN = {
  key: KEY,
  preset: 'instagram-reel',
  mode: 'video',
  url: 'app://local/projects/abcdefghijk1/la.html?present=1',
  width: 540,
  height: 960,
  scale: 1,
  fps: 30,
  format: 'mp4',
  settle: 300,
  beats: [BEAT],
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
  colors: null,
  filename: 'la-metro-rail-instagram-reel.mp4',
}
{
  const encode = (patch: Params = {}): Params => ({
    plan: PLAN,
    source: join(HERE, 'frames'),
    dest: join(HERE, 'out.mp4'),
    ...patch,
  })
  const withPlan = (patch: Params): Params => encode({ plan: { ...PLAN, ...patch } })
  const noPlan = (...names: string[]): Params => encode({ plan: omit(PLAN, ...names) })
  const missing = (name: string): string =>
    `plan.${name} is missing; hand the plan back as export.plan answered it`
  refuses(
    'export.encode',
    'plan: null',
    encode({ plan: null }),
    'plan must be the object export.plan answered with',
  )
  refuses(
    'export.encode',
    'plan: left out',
    omit(encode(), 'plan'),
    'plan must be the object export.plan answered with',
  )
  // Each field the schema requires, left out.
  for (const name of [
    'key',
    'preset',
    'mode',
    'url',
    'width',
    'height',
    'scale',
    'fps',
    'format',
    'settle',
    'beats',
    'keep',
    'crf',
    'fade',
    'stem',
    'theme',
    'view',
    'storyboard',
    'at',
    'notes',
    'caption',
    'clock_corner',
    'filename',
  ])
    refuses('export.encode', `plan.${name}: left out`, noPlan(name), missing(name))
  refuses(
    'export.encode',
    'plan.filename: null',
    withPlan({ filename: null }),
    'plan.filename must be the file name export.plan answered with',
  )
  refuses(
    'export.encode',
    'plan.filename: a number',
    withPlan({ filename: 7 }),
    'plan.filename must be the file name export.plan answered with',
  )
  refuses('export.encode', 'plan.key: null', withPlan({ key: null }), KEY_SAYS)
  refuses(
    'export.encode',
    'plan.preset: null',
    withPlan({ preset: null }),
    'preset must be the name of an export preset; export.presets lists them',
  )
  refuses(
    'export.encode',
    'plan.mode: null',
    withPlan({ mode: null }),
    'plan.mode must be still or video',
  )
  refuses(
    'export.encode',
    'plan.url: null',
    withPlan({ url: null }),
    "plan.url must be the page's address",
  )
  for (const name of ['width', 'height', 'scale', 'fps']) {
    refuses(
      'export.encode',
      `plan.${name}: null`,
      withPlan({ [name]: null }),
      `plan.${name} must be a whole number, 1 or more`,
    )
    refuses(
      'export.encode',
      `plan.${name}: a fraction`,
      withPlan({ [name]: 1.5 }),
      `plan.${name} must be a whole number, 1 or more`,
    )
  }
  refuses(
    'export.encode',
    'plan.settle: null',
    withPlan({ settle: null }),
    'plan.settle must be a whole number, 0 or more',
  )
  refuses(
    'export.encode',
    'plan.crf: negative',
    withPlan({ crf: -1 }),
    'plan.crf must be a whole number, 0 or more',
  )
  refuses(
    'export.encode',
    'plan.format: null',
    withPlan({ format: null }),
    'plan.format must be png, jpg, mp4 or gif',
  )
  refuses(
    'export.encode',
    'plan.beats: null',
    withPlan({ beats: null }),
    'plan.beats must be a list',
  )
  refuses(
    'export.encode',
    'plan.keep: null',
    withPlan({ keep: null }),
    'plan.keep must be true or false',
  )
  refuses(
    'export.encode',
    'plan.fade: null',
    withPlan({ fade: null }),
    'plan.fade must be seconds, 0 or more',
  )
  refuses(
    'export.encode',
    'plan.stem: a path',
    withPlan({ stem: 'a/b' }),
    'plan.stem must be a file name without a path or an extension',
  )
  refuses(
    'export.encode',
    'plan.theme: null',
    withPlan({ theme: null }),
    'plan.theme must be dark or light',
  )
  refuses(
    'export.encode',
    'plan.view: null',
    withPlan({ view: null }),
    'plan.view must be one of geographic, map, linear, time',
  )
  refuses(
    'export.encode',
    'plan.storyboard: null',
    withPlan({ storyboard: null }),
    "plan.storyboard must be a storyboard's name, custom, or empty",
  )
  refuses(
    'export.encode',
    'plan.at: a text',
    withPlan({ at: '08:00' }),
    'plan.at must be seconds, or null',
  )
  refuses(
    'export.encode',
    'plan.notes: null',
    withPlan({ notes: null }),
    'plan.notes must be a list of strings',
  )
  refuses(
    'export.encode',
    'plan.notes: a list with a number',
    withPlan({ notes: [1] }),
    'plan.notes must be a list of strings',
  )
  refuses(
    'export.encode',
    'plan.caption: empty',
    withPlan({ caption: '' }),
    'plan.caption must be text of 1 to 80 characters on one line, or null',
  )
  refuses(
    'export.encode',
    'plan.clock_corner: null',
    withPlan({ clock_corner: null }),
    'plan.clock_corner must be one of top-left, top-right, bottom-left, bottom-right',
  )
  const colours = 'plan.colors must be a list of distinct colours written #rrggbb, or null'
  refuses('export.encode', 'plan.colors: a text', withPlan({ colors: '#aabbcc' }), colours)
  refuses(
    'export.encode',
    'plan.colors: a colour twice',
    withPlan({ colors: ['#aabbcc', '#aabbcc'] }),
    colours,
  )
  refuses(
    'export.encode',
    'plan: a member it does not take',
    withPlan({ bogus: 1 }),
    'plan does not take bogus',
  )
  // The beats of the plan, each field required.
  for (const name of Object.keys(BEAT))
    refuses(
      'export.encode',
      `plan.beats[0].${name}: left out`,
      withPlan({ beats: [omit(BEAT, name)] }),
      `plan.beats[0].${name} is missing; hand the plan back as export.plan answered it`,
    )
  refuses(
    'export.encode',
    'plan.beats[0]: null',
    withPlan({ beats: [null] }),
    'plan.beats[0] is not an object',
  )
  refuses(
    'export.encode',
    'plan.beats[0].secs: null',
    withPlan({ beats: [{ ...BEAT, secs: null }] }),
    'plan.beats[0] lasts no time',
  )
  refuses(
    'export.encode',
    'plan.beats[0].view: a view the page lacks',
    withPlan({ beats: [{ ...BEAT, view: 'globe' }] }),
    'plan.beats[0].view names a view the page lacks',
  )
  refuses(
    'export.encode',
    'plan.beats[0].labels: a text',
    withPlan({ beats: [{ ...BEAT, labels: 'yes' }] }),
    'plan.beats[0].labels must be true, false or null',
  )
  for (const field of ['at', 'speed', 'hours', 'lo', 'hi', 'tween'])
    refuses(
      'export.encode',
      `plan.beats[0].${field}: a text`,
      withPlan({ beats: [{ ...BEAT, [field]: 'x' }] }),
      `plan.beats[0].${field} must be a number or null`,
    )
  refuses(
    'export.encode',
    'plan.beats[0].sweep: null',
    withPlan({ beats: [{ ...BEAT, sweep: null }] }),
    'plan.beats[0] has a sweep that is not true or false',
  )
  refuses(
    'export.encode',
    'plan.beats[0].card: null',
    withPlan({ beats: [{ ...BEAT, card: null }] }),
    'plan.beats[0] has a card that is not true or false',
  )
  refuses(
    'export.encode',
    'plan.beats[1].draw_in: null',
    withPlan({ beats: [BEAT, { ...BEAT, draw_in: null }] }),
    'plan.beats[1] has a draw_in that is not true or false',
  )
  refusesRaw(
    'export.encode',
    'plan.width: a number no double holds',
    JSON.stringify(encode()).replace('"width":540', '"width":1e999'),
    `plan.width${DOUBLE}`,
  )
  // The paths and the provenance.
  const absolute = (name: string): string => `${name} must be an absolute path`
  refuses('export.encode', 'source: null', encode({ source: null }), absolute('source'))
  refuses('export.encode', 'source: relative', encode({ source: 'frames' }), absolute('source'))
  refuses('export.encode', 'dest: null', encode({ dest: null }), absolute('dest'))
  refuses('export.encode', 'dest: left out', omit(encode(), 'dest'), absolute('dest'))
  refuses(
    'export.encode',
    'dest: the source itself',
    encode({ source: join(HERE, 'same.mp4'), dest: join(HERE, 'same.mp4') }),
    'dest must not be the source, or put its sidecar or a .part file on it: the source is read and never written to',
  )
  refuses(
    'export.encode',
    'provenance: null',
    encode({ provenance: null }),
    'provenance must be an object',
  )
  refuses(
    'export.encode',
    'provenance.service_date: null',
    encode({ provenance: { service_date: null } }),
    `service_date ${NOT_A_DAY}, or left out`,
  )
  refuses(
    'export.encode',
    'provenance.service_date: not on the calendar',
    encode({ provenance: { service_date: '2026-13-01' } }),
    'service_date: 2026-13-01 is not a calendar day',
  )
  for (const name of ['trips', 'stations', 'lines']) {
    refuses(
      'export.encode',
      `provenance.${name}: null`,
      encode({ provenance: { [name]: null } }),
      `${name} must be a count`,
    )
    refuses(
      'export.encode',
      `provenance.${name}: a fraction`,
      encode({ provenance: { [name]: 1.5 } }),
      `${name} must be a count`,
    )
    refuses(
      'export.encode',
      `provenance.${name}: negative`,
      encode({ provenance: { [name]: -1 } }),
      `${name} must be a count`,
    )
  }
  refuses(
    'export.encode',
    'provenance.caveats: null',
    encode({ provenance: { caveats: null } }),
    'caveats must be a list of strings',
  )
  refuses(
    'export.encode',
    'provenance.alt: null',
    encode({ provenance: { alt: null } }),
    'provenance.alt must be text',
  )
  refuses(
    'export.encode',
    'provenance.alt: blank',
    encode({ provenance: { alt: '  ' } }),
    'provenance.alt is empty; omit it instead, and the sidecar keeps the description the engine writes',
  )
  refuses(
    'export.encode',
    'provenance.alt: over 1,000',
    encode({ provenance: { alt: 'x'.repeat(1001) } }),
    'provenance.alt is 1,001 characters; it may be at most 1,000',
  )
  refuses(
    'export.encode',
    'provenance: a member it does not take',
    encode({ provenance: { bogus: 1 } }),
    'provenance does not take bogus',
  )
  refuses(
    'export.encode',
    'a member it does not take',
    encode({ bogus: 1 }),
    'export.encode does not take bogus',
  )
}

// -- engine.shutdown, last: refused before it stops anything, and a server it did
// stop would answer no row after it
for (const [what, params] of [
  ['an object with a member', '{"key":"x"}'],
  ['a list', '[]'],
  ['a text', '"x"'],
] as const)
  refusesRaw('engine.shutdown', what, params, 'engine.shutdown takes no parameters')

// The requests the judgement must let by: the same methods with the field
// left out, which every refusal above is the null of. The stand-in answers
// each with something other than a params refusal; `then` says what.
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

const said_ = (reply: Reply): Record<string, unknown> =>
  reply.error === undefined
    ? { result: true }
    : {
        code: reply.error.code,
        kind: reply.error.data?.kind,
        message: reply.error.message,
        hint: reply.error.data?.hint,
        detail: reply.error.data?.detail,
      }

const text = (row: { params?: unknown; raw?: string }): string | undefined =>
  row.raw ?? (row.params === undefined ? undefined : JSON.stringify(row.params))

/** What every row of the table expects: the engine's `invalid_params`, whole. */
const refusal = (says: string): Record<string, unknown> => ({
  code: -32602,
  kind: 'params',
  message: says,
  hint: says,
  detail: says,
})

describe.skipIf(PYTHON === null)(`the stand-in engine’s refusals of params${WHY}`, () => {
  let home = ''
  let server: Server

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lc-params-'))
    writeFileSync(
      join(home, 'fake-engine.json'),
      JSON.stringify({ map_draws: true, progress_delay_ms: 1 }),
    )
    server = new Server(
      PYTHON as string,
      engineEnvironment({
        config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
        base: { ...process.env, PYTHONPATH: FAKE_ENGINE },
        development: true,
      }),
      home,
    )
    await server.request('engine.info')
  }, READY_MS + 5_000)

  afterAll(async () => {
    await server?.stop()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })

  it('holds a table of refusals across every method it answers', () => {
    // The table is the claim: a method with no row would be a method whose
    // params are not held to the engine.
    const methods = new Set(rows.map((row) => row.method))
    expect([...methods].sort()).toEqual(
      [
        'engine.info',
        'engine.shutdown',
        'export.encode',
        'export.plan',
        'export.presets',
        'export.storyboards',
        'feeds.add',
        'feeds.inspect',
        'feeds.list',
        'feeds.remove',
        'feeds.service',
        'graph.build',
        'map.build',
        'render.stage',
        'style.presets',
      ].sort(),
    )
    expect(rows.length).toBeGreaterThan(200)
  })

  it.each(rows)('refuses $method with $what, in the engine’s words', async (row) => {
    const reply = await server.request(row.method, text(row))
    expect(said_(reply)).toEqual(refusal(row.says))
  })

  it.each(taken)('takes $method $what', async (row) => {
    const reply = await server.request(row.method, text(row))
    const said = said_(reply)
    if (row.then === 'result') expect(said).toEqual({ result: true })
    else expect(said).toMatchObject({ code: -32000, kind: row.then.kind })
  })
})

// ------------------------------------------- the same table, the real engine

// Where the environment names an engine, the table is asked of it too, so the
// stand-in and the engine cannot drift apart again: the sentences are no
// longer only copied but checked. The engine's own interpreter, a home of its
// own, and nothing written into the checkout.
const RESOLUTION = resolveInterpreter({
  config: {
    enginePython: process.env.LEGIBLE_ENGINE_PYTHON ?? null,
    engineCheckout: process.env.LEGIBLE_ENGINE_CHECKOUT ?? null,
  },
  packaged: false,
  resourcesPath: '',
  platform: process.platform,
  exists: existsSync,
})
const ENGINE = RESOLUTION.interpreter
// A skipped block prints only its title, so the title says why, in the words
// the resolution gave.
const WHY_NOT_ENGINE = RESOLUTION.interpreter === null ? ` (skipped: ${RESOLUTION.reason})` : ''

describe.skipIf(ENGINE === null)(
  `the same table, asked of the real engine${WHY_NOT_ENGINE}`,
  () => {
    let home = ''
    let server: Server

    beforeAll(async () => {
      home = mkdtempSync(join(tmpdir(), 'lc-params-engine-'))
      const base = { ...process.env }
      delete base.PYTHONPATH
      server = new Server(
        ENGINE as string,
        {
          ...engineEnvironment({
            config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
            base,
            development: true,
          }),
          PYTHONDONTWRITEBYTECODE: '1',
        },
        home,
      )
      await server.request('engine.info')
    }, READY_MS + 5_000)

    afterAll(async () => {
      await server?.stop()
      if (home !== '') rmSync(home, { recursive: true, force: true })
    })

    // `engine.info` and its kin answer to nothing but a refusal here too; every
    // row is a params refusal, which the engine gives before it reads a feed.
    it.each(rows)('refuses $method with $what', async (row) => {
      const reply = await server.request(row.method, text(row))
      expect(said_(reply)).toEqual(refusal(row.says))
    })
  },
)

afterAll(() => {
  rmSync(HERE, { recursive: true, force: true })
})
