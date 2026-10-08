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
// carry the thumbnail pair, which are files on disk, beside the page) and
// `feeds.remove` (its answer is `FeedsRemoveResult`).
//
// Needs a Python 3 on the PATH to run the stand-in; skips, saying so,
// without one.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { engineEnvironment } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin, EngineState } from '../../src/shared/engine'
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
})
