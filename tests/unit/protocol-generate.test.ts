// The generated types are committed because the machines that build the app
// have no engine to generate them from. That only works if anyone can
// reproduce the file from the committed description and get the same bytes,
// and if the emitter refuses what it does not understand instead of
// guessing. Neither test needs an engine.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ERROR_KINDS,
  ENGINE_ERROR_KINDS,
  isEngineErrorKind,
  isErrorKind,
} from '../../src/shared/engine'
import { parseEnvFile } from '../../src/main/config'
import { emit, emitFormatted, engineCheckout, fingerprint } from '../../scripts/protocol'

const repo = resolve(__dirname, '../..')
const schemaText = readFileSync(resolve(repo, 'vendor/protocol.schema.json'), 'utf8')
const description = JSON.parse(schemaText)
const pins = JSON.parse(readFileSync(resolve(repo, 'vendor/pins.json'), 'utf8'))
const committed = readFileSync(resolve(repo, 'src/shared/protocol.ts'), 'utf8')

describe('the generated protocol module', () => {
  it('is reproducible from the committed description, byte for byte', async () => {
    expect(
      await emitFormatted(description, pins.engine.tag, repo),
      'src/shared/protocol.ts is not what the description produces; run `npm run typegen`',
    ).toBe(committed)
  })

  it('carries no date, path or machine name', () => {
    expect(committed).not.toMatch(/\/(Users|home)\//)
    expect(committed).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)
    expect(committed).not.toMatch(/generated on/i)
  })

  // Counted, not listed: a method the engine adds shows up here rather than
  // being quietly absent from the app's types.
  it('covers every method and notification the description names', () => {
    const methods = Object.keys(description.methods)
    const notifications = Object.keys(description.notifications)
    expect(methods.length).toBeGreaterThan(0)
    expect(notifications.length).toBeGreaterThan(0)
    for (const name of methods) expect(committed, name).toContain(`'${name}': {`)
    for (const name of notifications) expect(committed, name).toContain(`'${name}': `)
    const declared = [...committed.matchAll(/^ {2}'([^']+)': \{$/gm)].map((m) => m[1])
    expect(declared.sort()).toEqual([...methods].sort())
  })

  it('exports one type per definition and the protocol number', () => {
    for (const name of Object.keys(description.$defs)) {
      expect(committed, name).toMatch(new RegExp(`export (interface|type) ${name}\\b`))
    }
    expect(committed).toContain(`export const PROTOCOL = ${description.protocol} as const`)
  })
})

describe('the emitter refuses what it does not understand', () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {} }

  it('names an unknown keyword and where it is', () => {
    const schema = {
      ...base,
      $defs: { Thing: { type: 'object', properties: { a: { allOf: [] } } } },
    }
    expect(() => emit(schema as never, 'v0.0.0')).toThrow(/\$defs\.Thing\.a.*allOf/s)
  })

  it('names a reference the description does not define', () => {
    const schema = { ...base, $defs: { Thing: { $ref: '#/$defs/Absent' } } }
    expect(() => emit(schema as never, 'v0.0.0')).toThrow(/Absent/)
  })

  it('refuses a reference it cannot follow at all', () => {
    const schema = { ...base, $defs: { Thing: { $ref: 'https://example.com/other.json' } } }
    expect(() => emit(schema as never, 'v0.0.0')).toThrow(/cannot follow/)
  })

  it('refuses a node with no type, reference, enum or constant', () => {
    const schema = { ...base, $defs: { Thing: { description: 'nothing at all' } } }
    expect(() => emit(schema as never, 'v0.0.0')).toThrow(/no type/)
  })

  it('refuses an array with no items and an unknown primitive', () => {
    expect(() => emit({ ...base, $defs: { A: { type: 'array' } } } as never, 'v0.0.0')).toThrow(
      /without items/,
    )
    expect(() => emit({ ...base, $defs: { A: { type: 'sausage' } } } as never, 'v0.0.0')).toThrow(
      /"sausage"/,
    )
  })
})

describe('the checkout is read from the environment or the local file', () => {
  const root = '/repo'
  const where = (env: NodeJS.ProcessEnv, file: string | null): string | null =>
    engineCheckout(env, file, root)

  it('prefers the environment', () => {
    expect(where({ LEGIBLE_ENGINE_CHECKOUT: '/a/b' }, 'LEGIBLE_ENGINE_CHECKOUT=/c/d')).toBe('/a/b')
  })

  it('falls back to the file, quoted or not', () => {
    expect(where({}, 'OTHER=1\nLEGIBLE_ENGINE_CHECKOUT="/c/d"\n')).toBe('/c/d')
    expect(where({}, "LEGIBLE_ENGINE_CHECKOUT='/e/f'")).toBe('/e/f')
  })

  // Compared with `resolve`'s own answer, not with a literal: a path
  // written POSIX-style resolves against the current drive on Windows, so
  // a hard-coded '/engine' is a test that only passes on three platforms.
  it('resolves a relative path against the repository', () => {
    expect(where({}, 'LEGIBLE_ENGINE_CHECKOUT=../engine')).toBe(resolve(root, '../engine'))
  })

  // The app's own parser is the one used here, so a file naming the key
  // twice resolves the same way for the generator, for the app and for the
  // drift test. Two parsers disagreeing would have the generator reading
  // one checkout while the drift test compared against another.
  it('agrees with the app about a key given twice', () => {
    const text = 'LEGIBLE_ENGINE_CHECKOUT=/first\nLEGIBLE_ENGINE_CHECKOUT=/second\n'
    expect(where({}, text)).toBe(parseEnvFile(text).LEGIBLE_ENGINE_CHECKOUT)
    expect(where({}, text)).toBe('/second')
  })

  it('is null when nothing names one', () => {
    expect(where({}, null)).toBeNull()
    expect(where({ LEGIBLE_ENGINE_CHECKOUT: '  ' }, null)).toBeNull()
    expect(where({}, 'LEGIBLE_ENGINE_CHECKOUT=')).toBeNull()
  })
})

// The one value the app keeps by hand from the description, because a kind
// arriving over the wire has to be checked before it is trusted as one.
describe('the runtime list of error kinds', () => {
  it('is exactly what the description defines', () => {
    expect([...ENGINE_ERROR_KINDS]).toEqual(description.$defs.ErrorData.properties.kind.enum)
  })

  it("does not overlap the kinds the app produces on the engine's behalf", () => {
    for (const kind of APP_ERROR_KINDS) expect(ENGINE_ERROR_KINDS).not.toContain(kind)
  })

  it("tells the engine's kinds from the app's, and refuses anything else", () => {
    for (const kind of ENGINE_ERROR_KINDS) {
      expect(isEngineErrorKind(kind), kind).toBe(true)
      expect(isErrorKind(kind), kind).toBe(true)
    }
    // The app's three are kinds the interface may see and the wire may not:
    // an engine claiming one would be indistinguishable from the
    // supervisor's own.
    for (const kind of APP_ERROR_KINDS) {
      expect(isEngineErrorKind(kind), kind).toBe(false)
      expect(isErrorKind(kind), kind).toBe(true)
    }
    for (const value of ['sausage', '', 7, null, undefined, {}]) {
      expect(isErrorKind(value), String(value)).toBe(false)
      expect(isEngineErrorKind(value), String(value)).toBe(false)
    }
  })
})

describe('the fingerprint', () => {
  it('is the SHA-256 of the description as it is committed', () => {
    expect(fingerprint(schemaText)).toBe(pins.engine.schema_sha256)
  })
})
