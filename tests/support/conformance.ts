// The conformance table (spec 038, User Story 2, FR-007): every refusal the
// engine can be made to give without the network, a real LOOM or a long run,
// as the request and the answer, each sentence written here once. Two suites
// read it: `tests/unit/stand-in-params.test.ts` asks the stand-in engine
// (`tests/fake-engine/schematic/serve.py`) on every pull request, and
// `tests/unit/conformance-real.test.ts` asks the pinned engine in the
// determinism workflow, so the stand-in and the engine cannot drift apart
// unnoticed: a sentence changed on either side fails a row.
//
// A row is the data model's conformance row: a method, its params as JSON
// text (so a number no double holds, NaN, or no params at all can be sent),
// and the error expected, its code, kind and sentence. The sentence is the
// error's message and its `hint`; a params refusal (`invalid_params`, kind
// `params`, -32602) writes it as its `detail` too, where any other error's
// detail says where in the engine it was raised, which is the engine's own
// business and not compared.
//
// The params rows came first (issue 473): engine v0.19.0 (its issue 83)
// judges every method's params as the schema does, field by field, each
// sentence that field's own, and the stand-in restates its handler
// (`params_problem`). Their key is one no registry has, so were the engine
// ever to take a row's params it would stop at its registry check and fail
// the row cleanly, and not go on to download a feed and start LOOM. The rows
// after them are what the engine refuses once the params are judged: a key
// no feed has, a preset that cannot be removed, a zip that is not a feed, an
// address that is not on a public host, a layout that is not stored, a
// capture that is not there, a plan the preset cannot take.
//
// A row that needs state the engine cannot be put in here is the stand-in's
// alone, and says why (`standInOnly`); its state is a `Setup`, which the
// stand-in's suite makes before it asks. `UNREACHED` names each kind of error
// the protocol has that no row holds, and why.

import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gtfsZip } from './gtfs-zip'
import type { Reply } from './raw-server'

// ------------------------------------------------------------- the row

/** What a row expects: the error's code, its kind (none for a transport error) and its sentence. */
export interface Refusal {
  code: number
  kind?: string
  sentence: string
}

/** The state a stand-in-only row needs, made before it is asked. */
export type Setup = 'building'

export interface Row {
  method: string
  /** What the row sends, for its title. */
  what: string
  /** The params as JSON text; left out, the request carries no params member. */
  params?: string
  expect: { error: Refusal }
  /** Why the real engine is not asked this row; left out, both are. */
  standInOnly?: string
  setup?: Setup
}

export const PARAMS_CODE = -32602
export const ENGINE_CODE = -32000
export const METHOD_NOT_FOUND = -32601

export const rows: Row[] = []

const text = (params: unknown): string | undefined =>
  params === undefined ? undefined : JSON.stringify(params)

/** A params refusal, the params given as a value. */
const refuses = (method: string, what: string, params: unknown, says: string): void => {
  rows.push({
    method,
    what,
    params: text(params),
    expect: { error: { code: PARAMS_CODE, kind: 'params', sentence: says } },
  })
}
/** A params refusal, the params given as JSON text, or left out. */
const refusesRaw = (method: string, what: string, raw: string | undefined, says: string): void => {
  rows.push({
    method,
    what,
    params: raw,
    expect: { error: { code: PARAMS_CODE, kind: 'params', sentence: says } },
  })
}
/** What the engine refuses once the params are judged, with the kind of error it is. */
const engineRefuses = (
  method: string,
  what: string,
  params: unknown,
  kind: string,
  says: string,
): void => {
  rows.push({
    method,
    what,
    params: text(params),
    expect: { error: { code: ENGINE_CODE, kind, sentence: says } },
  })
}

type Params = Record<string, unknown>
const omit = (base: Params, ...names: string[]): Params => {
  const copy = { ...base }
  for (const name of names) delete copy[name]
  return copy
}

// ------------------------------------------------------------- the values

// A key that fits the pattern and that no registry has.
export const KEY = 'no-such-feed'
// A feed both registries have, a preset of each: the engine never reads its
// zip for a row below, so it needs none cached.
export const FEED = 'la-metro-rail'
export const LAYOUT = 'a'.repeat(64)

/**
 * The folder the rows' paths are in, made when this module is loaded, so a
 * suite that reads the table owns one of its own. `prepareFiles` writes the
 * files the `feeds.add` rows name; `removeFiles` takes the folder away.
 */
export const HERE = mkdtempSync(join(tmpdir(), 'lc-conformance-'))

const ZIPS = {
  missing: 'missing.zip',
  notAZip: 'not-a-zip.zip',
  noStops: 'no-stops.zip',
  noStopTimes: 'no-stop-times.zip',
  noCalendar: 'no-calendar.zip',
  whole: 'whole.zip',
}

/** The files the `feeds.add` rows read; `missing.zip` is the one never written. */
export function prepareFiles(): void {
  writeFileSync(join(HERE, ZIPS.notAZip), 'this is a page, not a zip\n')
  gtfsZip(join(HERE, ZIPS.noStops), ['stops'])
  gtfsZip(join(HERE, ZIPS.noStopTimes), ['stop_times'])
  gtfsZip(join(HERE, ZIPS.noCalendar), ['calendar'])
  gtfsZip(join(HERE, ZIPS.whole))
}

export function removeFiles(): void {
  rmSync(HERE, { recursive: true, force: true })
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
const MODE_SAYS =
  'mode must be what gtfs2graph -m takes: names such as tram, subway or rail, or route_type numbers, comma-joined'
const AGENCY_SAYS = 'agency must be an agency_id from the feed, or empty for every operator'
const PRESET_SAYS = 'preset must be the name of an export preset; export.presets lists them'
const FORCE_SAYS = 'force must be true or false'
const WIDTH_SAYS = 'width must be a number above zero'
const LINE_ORDER_SAYS = 'line_order must be a list of strings'
const LINES_SAYS = 'lines must be a list of strings'
const OPTIONS_SAYS = 'options must be an object'
const THEME_SAYS = 'theme must be dark or light'
const CLOCK_SAYS = 'at must be a clock, HH:MM'
const FADE_SAYS = 'fade must be seconds, 0 or more'
const PLAN_SAYS = 'plan must be the object export.plan answered with'
const FILENAME_SAYS = 'plan.filename must be the file name export.plan answered with'
const NOTES_SAYS = 'plan.notes must be a list of strings'
const notOnTheCalendar = (name: string): string => `${name}: 2026-02-30 is not a calendar day`

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
  refuses('graph.build', 'force: null', { ...base, force: null }, FORCE_SAYS)
  refuses('graph.build', 'force: a text', { ...base, force: 'yes' }, FORCE_SAYS)
  refuses('graph.build', 'mode: null', { ...base, mode: null }, MODE_SAYS)
  refuses('graph.build', 'mode: a number', { ...base, mode: 1 }, MODE_SAYS)
  refuses(
    'graph.build',
    'mode: a name LOOM does not know',
    { ...base, mode: 'hovercraft' },
    MODE_SAYS,
  )
  refuses('graph.build', 'agency: null', { ...base, agency: null }, AGENCY_SAYS)
  refuses('graph.build', 'agency: a list', { ...base, agency: ['X'] }, AGENCY_SAYS)
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
    notOnTheCalendar('date'),
  )
  refuses('map.build', 'out: null', { ...base, out: null }, TOKEN_SAYS)
  refuses('map.build', 'out: a path', { ...base, out: '../x' }, TOKEN_SAYS)
  refuses('map.build', 'width: null', { ...base, width: null }, WIDTH_SAYS)
  refuses('map.build', 'width: zero', { ...base, width: 0 }, WIDTH_SAYS)
  refuses('map.build', 'width: a text', { ...base, width: '1800' }, WIDTH_SAYS)
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
  refuses('map.build', 'line_order: null', { ...base, line_order: null }, LINE_ORDER_SAYS)
  refuses('map.build', 'line_order: a text', { ...base, line_order: 'A' }, LINE_ORDER_SAYS)
  refuses(
    'map.build',
    'line_order: a list with a null',
    { ...base, line_order: ['A', null] },
    LINE_ORDER_SAYS,
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
    notOnTheCalendar('anchor'),
  )
  refuses('feeds.service', 'lines: null', { ...base, lines: null }, LINES_SAYS)
  refuses('feeds.service', 'lines: a text', { ...base, lines: 'A' }, LINES_SAYS)
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
  refuses('feeds.add', 'key: null', { ...base, key: null }, KEY_SAYS)
  refuses('feeds.add', 'key: capitals', { ...base, key: 'Metro' }, KEY_SAYS)
  const name = 'name must be text, up to 120 characters'
  refuses('feeds.add', 'name: null', { ...base, name: null }, name)
  refuses('feeds.add', 'name: blank', { ...base, name: '   ' }, name)
  refuses('feeds.add', 'name: over 120', { ...base, name: 'x'.repeat(121) }, name)
  refuses('feeds.add', 'mode: null', { ...base, mode: null }, MODE_SAYS)
  refuses('feeds.add', 'agency: null', { ...base, agency: null }, AGENCY_SAYS)
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
  refuses('render.stage', 'width: null', { ...base, width: null }, WIDTH_SAYS)
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
  refuses('export.plan', 'preset: null', { ...base, preset: null }, PRESET_SAYS)
  refuses('export.plan', 'preset: left out', omit(base, 'preset'), PRESET_SAYS)
  refuses('export.plan', 'preset: a number', { ...base, preset: 1 }, PRESET_SAYS)
  const page = "page must be the page's address, with its scheme"
  refuses('export.plan', 'page: null', { ...base, page: null }, page)
  refuses('export.plan', 'page: no scheme', { ...base, page: 'maps/x.html' }, page)
  refuses('export.plan', 'date: null', { ...base, date: null }, `date ${NOT_A_DAY}, or left out`)
  refuses('export.plan', 'date: a number', { ...base, date: 20260616 }, `date ${NOT_A_DAY}`)
  refuses(
    'export.plan',
    'date: not on the calendar',
    { ...base, date: '2026-02-30' },
    notOnTheCalendar('date'),
  )
  refuses('export.plan', 'out: null', { ...base, out: null }, TOKEN_SAYS)
  refuses('export.plan', 'options: null', { ...base, options: null }, OPTIONS_SAYS)
  refuses('export.plan', 'options: a list', { ...base, options: [] }, OPTIONS_SAYS)
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
  refuses('export.plan', 'options.theme: null', options({ theme: null }), THEME_SAYS)
  refuses('export.plan', 'options.theme: sepia', options({ theme: 'sepia' }), THEME_SAYS)
  refuses('export.plan', 'options.at: null', options({ at: null }), CLOCK_SAYS)
  refuses('export.plan', 'options.at: a number', options({ at: 800 }), CLOCK_SAYS)
  refuses('export.plan', 'options.lines: null', options({ lines: null }), LINES_SAYS)
  refuses(
    'export.plan',
    'options.lines: a list with a number',
    options({ lines: ['A', 1] }),
    LINES_SAYS,
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
  refuses('export.plan', 'options.fade: null', options({ fade: null }), FADE_SAYS)
  refuses('export.plan', 'options.fade: negative', options({ fade: -1 }), FADE_SAYS)
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
export const BEAT = {
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
export const PLAN = {
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
  refuses('export.encode', 'plan: null', encode({ plan: null }), PLAN_SAYS)
  refuses('export.encode', 'plan: left out', omit(encode(), 'plan'), PLAN_SAYS)
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
  refuses('export.encode', 'plan.filename: null', withPlan({ filename: null }), FILENAME_SAYS)
  refuses('export.encode', 'plan.filename: a number', withPlan({ filename: 7 }), FILENAME_SAYS)
  refuses('export.encode', 'plan.key: null', withPlan({ key: null }), KEY_SAYS)
  refuses('export.encode', 'plan.preset: null', withPlan({ preset: null }), PRESET_SAYS)
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
  refuses('export.encode', 'plan.notes: null', withPlan({ notes: null }), NOTES_SAYS)
  refuses('export.encode', 'plan.notes: a list with a number', withPlan({ notes: [1] }), NOTES_SAYS)
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

// -- a request with no params at all, to a method that takes an object
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
])
  refusesRaw(method, 'no params at all', undefined, `${method} takes an object of parameters`)

// -- export.plan: a storyboard written as a list of beats, which the handler
// has export.authored_beats judge, its sentences the params refusal's
{
  const FIRST = { secs: 2, view: 'map', at: '08:00' }
  const listed = (what: string, beats: unknown[], says: string): void =>
    refuses(
      'export.plan',
      `options.storyboard: ${what}`,
      { key: KEY, preset: 'instagram-reel', options: { storyboard: beats } },
      says,
    )
  listed('no beats', [], 'storyboard holds no beats: a list holds 1 to 16')
  listed(
    'seventeen beats',
    Array.from({ length: 17 }, () => FIRST),
    'storyboard[16] is one beat too many: a list holds 1 to 16 beats',
  )
  listed('a beat that is null', [null], "storyboard[0] must be an object with a beat's fields")
  listed(
    'a beat with a field it does not take',
    [{ ...FIRST, bogus: 1 }],
    "storyboard[0] does not take bogus; a beat's fields are secs, view, labels, at, speed, sweep, hours, span, tween, card, draw_in",
  )
  listed(
    'a beat too short',
    [{ ...FIRST, secs: 0.25 }],
    'storyboard[0].secs must be seconds, from 0.5 to 30',
  )
  listed(
    'beats longer than a list may last',
    [FIRST, { secs: 30 }, { secs: 30 }, { secs: 30 }],
    'storyboard[3].secs brings the storyboard to 92 seconds, past the 90 seconds a list may last',
  )
  listed(
    'a view the page lacks',
    [{ ...FIRST, view: 'globe' }],
    'storyboard[0].view must be one of geographic, map, linear, time, or null',
  )
  listed(
    'a first beat with no view',
    [{ secs: 2, at: '08:00' }],
    'storyboard[0].view is missing: the first beat names the view frame 0 is in',
  )
  listed(
    'labels: a text',
    [{ ...FIRST, labels: 'yes' }],
    'storyboard[0].labels must be true, false or null',
  )
  listed(
    'at: not a clock',
    [{ ...FIRST, at: '8am' }],
    'storyboard[0].at must be a clock, HH:MM, or null',
  )
  listed(
    'speed: negative',
    [{ ...FIRST, speed: -1 }],
    'storyboard[0].speed must be simulated seconds a second, 0 or more, or null',
  )
  listed('sweep: a text', [{ ...FIRST, sweep: 'yes' }], 'storyboard[0].sweep must be true or false')
  listed(
    'hours: more than a day',
    [{ ...FIRST, hours: 25 }],
    'storyboard[0].hours must be more than 0 and at most 24, or null',
  )
  listed(
    'span: one clock',
    [{ ...FIRST, span: ['08:00'] }],
    'storyboard[0].span must be two clocks, HH:MM, or null',
  )
  listed(
    'span: backwards',
    [{ ...FIRST, span: ['09:00', '08:00'] }],
    'storyboard[0].span must run forward: 09:00 is not before 08:00',
  )
  listed(
    'tween: negative',
    [FIRST, { secs: 2, tween: -1 }],
    'storyboard[1].tween must be seconds, 0 or more, or null',
  )
  listed(
    'a first beat that transitions',
    [{ ...FIRST, tween: 1 }],
    'storyboard[0].tween must be 0 or left out: frame 0 must already be in a view, so the first beat cannot transition into one',
  )
  listed(
    'a first beat with no clock',
    [{ secs: 2, view: 'map' }],
    'storyboard[0].at is missing: frame 0 is not reproducible without a clock, so the first beat names one, unless it sweeps a span rather than a number of hours',
  )
  listed('card: a text', [{ ...FIRST, card: 'yes' }], 'storyboard[0].card must be true or false')
  listed(
    'a title card too short to read',
    [{ ...FIRST, secs: 0.5, card: true }],
    'storyboard[0].secs must be at least 1 second on a title card',
  )
  listed(
    'draw_in: a text',
    [{ ...FIRST, draw_in: 'yes' }],
    'storyboard[0].draw_in must be true or false',
  )
  listed(
    'a draw-in too short',
    [{ ...FIRST, secs: 1, draw_in: true }],
    'storyboard[0].secs must be at least 2 seconds on a draw-in',
  )
  listed(
    'a second draw-in',
    [
      { ...FIRST, draw_in: true },
      { secs: 2, draw_in: true },
    ],
    'storyboard[1].draw_in is a second draw-in: a storyboard draws the network in once, and storyboard[0] does',
  )
  listed(
    'a draw-in that sweeps',
    [{ ...FIRST, sweep: true, draw_in: true }],
    'storyboard[0].sweep must be false on a draw-in: the clock holds while the network draws in',
  )
  listed(
    'a draw-in on the rows',
    [{ ...FIRST, view: 'linear', draw_in: true }],
    'storyboard[0].view must be geographic or map on a draw-in, not linear',
  )
  listed(
    'a draw-in that keeps the rows from the beat before',
    [
      { ...FIRST, view: 'linear' },
      { secs: 2, draw_in: true },
    ],
    'storyboard[1].draw_in is on the linear view, which it keeps from the beat before: a draw-in is on the geographic or map view',
  )
  listed(
    'the chart before the draw-in',
    [
      { ...FIRST, view: 'time' },
      { secs: 2, view: 'map', draw_in: true },
    ],
    'storyboard[0].view must be geographic or map: the network is undrawn until the draw-in at storyboard[1], and the time view shows it whole',
  )
}

// -- past the params: a key no feed has (serve._registered), asked by every
// method that names a feed once its params are judged, before any work
{
  const says = `'${KEY}' is not a registered feed`
  const day = '2026-06-16'
  for (const [method, params] of [
    ['graph.build', { key: KEY }],
    ['map.build', { key: KEY, layout: LAYOUT, date: day }],
    ['feeds.service', { key: KEY }],
    ['feeds.inspect', { key: KEY }],
    ['feeds.remove', { key: KEY }],
    ['render.stage', { key: KEY, layout: LAYOUT, stage: 'topo' }],
    ['export.plan', { key: KEY, preset: 'instagram-reel' }],
    ['export.encode', { plan: PLAN, source: join(HERE, 'frames'), dest: join(HERE, 'out.mp4') }],
  ] as const)
    engineRefuses(method, 'a key no feed has', params, 'feed', says)
}

// -- feeds.remove and feeds.add: what the registry refuses (feeds.py)
engineRefuses(
  'feeds.remove',
  'a preset',
  { key: FEED },
  'feed',
  `'${FEED}' is a built-in feed and cannot be removed`,
)
{
  const add = (name: string, extra: Params = {}): Params => ({
    source: join(HERE, name),
    ...extra,
  })
  engineRefuses(
    'feeds.add',
    'a file that is not there',
    add(ZIPS.missing),
    'feed',
    `${ZIPS.missing} is not a file`,
  )
  engineRefuses(
    'feeds.add',
    'a file that is not a zip',
    add(ZIPS.notAZip),
    'feed',
    `${ZIPS.notAZip} is not a zip file, so it is not a GTFS feed`,
  )
  engineRefuses(
    'feeds.add',
    'a zip with no stops',
    add(ZIPS.noStops),
    'feed',
    `${ZIPS.noStops} has no stops.txt, so there is no network to draw`,
  )
  engineRefuses(
    'feeds.add',
    'a zip with no stop times',
    add(ZIPS.noStopTimes),
    'feed',
    `${ZIPS.noStopTimes} has no stop_times.txt, so there is no timetable to animate`,
  )
  engineRefuses(
    'feeds.add',
    'a zip with no calendar',
    add(ZIPS.noCalendar),
    'feed',
    `${ZIPS.noCalendar} has neither calendar.txt nor calendar_dates.txt, so there is no service day to draw`,
  )
  // An address on this machine or its network, refused before a byte is
  // fetched, so it needs no network to be asked.
  for (const source of [
    'http://localhost/feed.zip',
    'http://127.0.0.1:631/',
    'http://[::1]/feed.zip',
    'http://10.0.0.5/gtfs.zip',
  ])
    engineRefuses(
      'feeds.add',
      `an address that is not public, ${source}`,
      { source },
      'feed',
      `${source} could not be fetched. Use an address on a public host; a feed cannot be fetched from this machine or its network.`,
    )
  engineRefuses(
    'feeds.add',
    'a feed under a key a preset has',
    add(ZIPS.whole, { key: FEED }),
    'feed',
    `'${FEED}' is already a feed; choose another key`,
  )
}

// -- map.build and render.stage: a layout that is not stored (pipeline.LayoutMissing)
engineRefuses(
  'map.build',
  'a layout that is not stored',
  { key: FEED, layout: LAYOUT, date: '2026-06-16' },
  'layout',
  `${FEED} has no stored layout ${LAYOUT.slice(0, 8)}; lay the feed out first (graph.build)`,
)
engineRefuses(
  'render.stage',
  'a layout that is not stored',
  { key: FEED, layout: LAYOUT, stage: 'topo' },
  'layout',
  `'${FEED}' has no stored topo graph under layout ${LAYOUT.slice(0, 8)}; lay the feed out first (graph.build)`,
)

// -- export.encode: a capture that is not there (kind io)
engineRefuses(
  'export.encode',
  'frames that are not there',
  { plan: { ...PLAN, key: FEED }, source: join(HERE, 'no-frames'), dest: join(HERE, 'out.mp4') },
  'io',
  'the frames directory is not there',
)
engineRefuses(
  'export.encode',
  'a still that is not there',
  {
    plan: {
      ...PLAN,
      key: FEED,
      preset: 'instagram-post',
      mode: 'still',
      format: 'png',
      beats: [],
      storyboard: '',
      stem: 'la-metro-rail-instagram-post',
      filename: 'la-metro-rail-instagram-post.png',
    },
    source: join(HERE, 'no-still.png'),
    dest: join(HERE, 'out.png'),
  },
  'io',
  'the captured still is not there',
)

// -- export.plan: what the plan itself refuses (export.py, kind export)
{
  const plan = (preset: string, options?: Params): Params => ({
    key: FEED,
    preset,
    ...(options === undefined ? {} : { options }),
  })
  engineRefuses(
    'export.plan',
    'a vector preset',
    plan('portfolio-svg'),
    'export',
    'portfolio-svg is a vector preset: nothing to capture',
  )
  engineRefuses(
    'export.plan',
    "the clock where a reel's button rail is",
    plan('instagram-reel', { clock_corner: 'bottom-right' }),
    'export',
    "Choose another corner for the clock: on instagram-reel, Instagram's button rail covers the bottom right.",
  )
  engineRefuses(
    'export.plan',
    "the clock where a story's bottom zone is",
    plan('instagram-story', { clock: true, clock_corner: 'bottom-right' }),
    'export',
    "Choose another corner for the clock: on instagram-story, Instagram's bottom zone covers the bottom right.",
  )
  engineRefuses(
    'export.plan',
    'the clock over the title',
    plan('portfolio-mp4', { clock_corner: 'top-left' }),
    'export',
    'Choose another corner for the clock: the title sits top left.',
  )
  engineRefuses(
    'export.plan',
    'the clock over the title and the caption',
    plan('portfolio-mp4', { clock_corner: 'top-left', caption: 'Rush hour' }),
    'export',
    'Choose another corner for the clock: the title and the caption sit top left.',
  )
  engineRefuses(
    'export.plan',
    'the clock over the caption',
    plan('portfolio-mp4', { clock_corner: 'top-left', title: false, caption: 'Rush hour' }),
    'export',
    'Choose another corner for the clock: the caption sits top left.',
  )
}

// -- a method the engine does not have: the transport's refusal, with no data
rows.push({
  method: 'engine.nothing',
  what: 'a method the engine does not have',
  expect: { error: { code: METHOD_NOT_FOUND, sentence: 'Method Not Found: engine.nothing' } },
})

// -- render.stage while a build of the layout is in flight and has not reached
// the stage: the stand-in's alone
//
// The engine draws from a build's scratch only while LOOM is laying the
// layout out in that process, and a suite here has no LOOM; the stand-in is
// held after gtfs2graph (`holds_after_stage`, released by a file) and asked
// meanwhile. The layout is the id the stand-in names that build with: the
// SHA-256 of its inputs as Python's json.dumps(sort_keys=True) writes them.
export const BUILDING = {
  /** The held build's request. */
  request: { method: 'graph.build', params: JSON.stringify({ key: FEED, mode: 'subway' }) },
  /** The stage it is held after, reported before the rows are asked. */
  reported: 'gtfs2graph',
  /** The file whose writing into the home lets it go on. */
  release: 'conformance-released',
  layout: createHash('sha256')
    .update(JSON.stringify({ agency: null, feed: FEED, mode: 'subway' }).replace(/([:,])/g, '$1 '))
    .digest('hex'),
}
{
  const why =
    'the engine draws from a build in flight only while LOOM lays the layout out, and no suite here has LOOM'
  const notYet = (stage: string): string =>
    `'${FEED}' is still being laid out under layout ${BUILDING.layout.slice(0, 8)}, and the build has not reached its ${stage} stage yet; ask again when job/progress reports it`
  const building = (what: string, params: Params, sentence: string): void => {
    rows.push({
      method: 'render.stage',
      what,
      params: text(params),
      expect: { error: { code: ENGINE_CODE, kind: 'layout', sentence } },
      standInOnly: why,
      setup: 'building',
    })
  }
  building(
    'a stage the build in flight has not reached',
    { key: FEED, layout: BUILDING.layout, stage: 'octi' },
    notYet('octi'),
  )
  building(
    'a date, whose minutes wait on a stage the build has not reached',
    { key: FEED, layout: BUILDING.layout, stage: 'gtfs2graph', date: '2026-06-16' },
    `${notYet('octi')}; the minutes of a date are read from the octi stage, so leave date out to draw gtfs2graph now`,
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

// ------------------------------------------------------- what is not here

/**
 * Each kind of error the protocol names (`ErrorData.kind`) that no row holds,
 * and why no row can: the table's suites hold its kinds and these together to
 * the schema's list, so a kind added there is a kind this file must answer for.
 */
export const UNREACHED: Record<string, string> = {
  loom:
    'LOOM failing: the suites have no LOOM, and the engine is pointed at a folder that is not there, so a ' +
    'layout it would make fails with that folder in its sentence, and the stand-in has no tools to fail',
  schedule:
    "a service day the timetable cannot give: asked of a stored layout and a cached feed's tables, which " +
    'the stand-in has neither of in the shape the engine reads',
  engine:
    'the engine failing in a way it did not expect, or failing to start: no request makes either happen ' +
    "on purpose (the stand-in's info_refuses and its fallback -32603 stand in for them)",
}

// --------------------------------------------------------- the comparison

/** What a reply says, in the terms a row expects: its result, or its error's code, kind and words. */
export function said(reply: Reply): Record<string, unknown> {
  if (reply.error === undefined) return { result: true }
  const { code, message, data } = reply.error
  return {
    code,
    kind: data?.kind,
    message,
    hint: data?.hint,
    ...(data?.kind === 'params' ? { detail: data.detail } : {}),
  }
}

/** What a row expects a reply to say, in `said`'s terms. */
export function expected({ code, kind, sentence }: Refusal): Record<string, unknown> {
  return {
    code,
    kind,
    message: sentence,
    hint: kind === undefined ? undefined : sentence,
    ...(kind === 'params' ? { detail: sentence } : {}),
  }
}
