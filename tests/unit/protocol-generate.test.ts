// The generated types are committed because the machines that build the app
// have no engine to generate them from. That only works if anyone can
// reproduce the file from the committed description and get the same bytes,
// and if the emitter refuses what it does not understand instead of
// guessing. Neither test needs an engine.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  APP_ERROR_KINDS,
  ENGINE_ERROR_KINDS,
  isEngineErrorKind,
  isErrorKind,
} from '../../src/shared/engine'
import { parseEnvFile } from '../../src/main/config'
import { emit, emitFormatted, engineCheckout, fingerprint } from '../../scripts/protocol'
import {
  PAGE_FETCHES,
  PAGE_REQUIRES,
  PAGE_SEAM_NAMES,
  PAGE_SEAM_SINCE,
} from '../../src/shared/protocol'

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

/**
 * The least `page` a description may carry: one method of no arguments, and
 * the policy. The emitter refuses a description without one, so every
 * description written here carries it.
 */
const PAGE = {
  seam: {
    state: {
      since: '0.1.0',
      params: { type: 'array', maxItems: 0, items: { type: 'null' } },
      result: { type: 'null' },
    },
  },
  requires: ["script-src 'unsafe-inline'"],
  fetches: false,
}

describe('the emitter refuses what it does not understand', () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {}, page: PAGE }

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

// An open object is a map, and the node under `additionalProperties` says
// what it maps to. The emitter used to read the keyword only in its `false`
// form and type everything else `Record<string, unknown>`, silently, which
// is how the engine's colour map arrived in the app untyped (E06).
describe('an object that carries extras keeps their type', () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {}, page: PAGE }
  const hex = { type: 'string', pattern: '^#[0-9a-f]{6}$' }

  it('types a map by the node its values follow', () => {
    const schema = {
      ...base,
      $defs: { HexColor: hex, Colors: { type: 'object', additionalProperties: hex } },
    }
    expect(emit(schema as never, 'v0.0.0')).toContain('export type Colors = Record<string, string>')
  })

  it('follows a reference under the keyword rather than losing it', () => {
    const schema = {
      ...base,
      $defs: {
        HexColor: hex,
        Colors: { type: 'object', additionalProperties: { $ref: '#/$defs/HexColor' } },
      },
    }
    expect(emit(schema as never, 'v0.0.0')).toContain(
      'export type Colors = Record<string, HexColor>',
    )
  })

  it('gives named members an index signature beside them', () => {
    const schema = {
      ...base,
      $defs: {
        Bag: {
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
          additionalProperties: { type: 'string' },
        },
      },
    }
    const out = emit(schema as never, 'v0.0.0')
    expect(out).toContain('name: string')
    expect(out).toContain('[key: string]: string')
  })

  it('keeps a closed object closed and an open one a bag', () => {
    const closed = { ...base, $defs: { Nothing: { type: 'object', additionalProperties: false } } }
    expect(emit(closed as never, 'v0.0.0')).toContain('export type Nothing = Record<string, never>')
    const open = { ...base, $defs: { Anything: { type: 'object', additionalProperties: true } } }
    expect(emit(open as never, 'v0.0.0')).toContain(
      'export type Anything = Record<string, unknown>',
    )
  })

  it('names a reference under the keyword that the description does not define', () => {
    const schema = {
      ...base,
      $defs: { Colors: { type: 'object', additionalProperties: { $ref: '#/$defs/Absent' } } },
    }
    expect(() => emit(schema as never, 'v0.0.0')).toThrow(/Absent/)
  })
})

// The animation page's seam and host policy, from the description's `page`
// (engine v0.21.0, app issue 607): what the app used to keep as copies of its
// own - the seam's names, the version each arrived at, the four directives -
// is generated, so a method the engine renames or reshapes is a build error
// rather than a page that answers "this map cannot do that" at run time.
describe("the page's seam, from the description", () => {
  it('names every method, in the description’s order, with the version it arrived at', () => {
    const seam = description.page.seam as Record<string, { since: string }>
    expect([...PAGE_SEAM_NAMES]).toEqual(Object.keys(seam))
    expect(PAGE_SEAM_NAMES.length).toBe(20)
    expect({ ...PAGE_SEAM_SINCE }).toEqual(
      Object.fromEntries(Object.entries(seam).map(([name, method]) => [name, method.since])),
    )
    for (const name of PAGE_SEAM_NAMES) {
      expect(committed, name).toMatch(new RegExp(`^ {2}${name}: \\{$`, 'm'))
    }
  })

  it('carries the host policy and says the page fetches nothing', () => {
    expect([...PAGE_REQUIRES]).toEqual(description.page.requires)
    expect(PAGE_FETCHES).toBe(false)
  })

  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {} }
  const withSeam = (seam: Record<string, unknown>, rest: Record<string, unknown> = {}) =>
    ({ ...base, page: { ...PAGE, seam, ...rest } }) as never
  const one = (params: unknown, result: unknown = { type: 'null' }, since = '0.1.0') =>
    withSeam({ go: { since, params, result } })

  it('types the arguments as a tuple, those past minItems optional', () => {
    const out = emit(
      one({
        type: 'array',
        prefixItems: [
          { type: 'boolean' },
          { oneOf: [{ type: 'number' }, { type: 'null' }] },
          { type: 'string' },
        ],
        minItems: 1,
        maxItems: 3,
      }),
      'v0.0.0',
    )
    expect(out).toContain('params: [boolean, (number | null)?, string?]')
  })

  it('types a method of no arguments as an empty tuple, and an answer by its reference', () => {
    const schema = {
      ...base,
      $defs: { Box: { type: 'object', properties: { a: { type: 'number' } } } },
      page: {
        ...PAGE,
        seam: {
          box: {
            since: '0.1.0',
            params: { type: 'array', maxItems: 0, items: { type: 'null' } },
            result: { $ref: '#/$defs/Box' },
          },
        },
      },
    }
    const out = emit(schema as never, 'v0.0.0')
    expect(out).toContain('box: {\n    params: []\n    result: Box\n  }')
    expect(out).toContain('export const PAGE_SEAM_NAMES = ["box"] as const')
    expect(out).toContain('box: "0.1.0",')
  })

  it('refuses a since that is not three numbers', () => {
    const params = { type: 'array', maxItems: 0, items: { type: 'null' } }
    for (const since of ['0.11', 'v0.11.0', '0.11.0rc1', '01.2.3', '']) {
      expect(() => emit(one(params, { type: 'null' }, since), 'v0.0.0'), since).toThrow(
        /page\.seam\.go\.since: .* is not a version of three numbers/,
      )
    }
  })

  it('refuses a keyword it does not know inside the arguments and the answer', () => {
    expect(() =>
      emit(one({ type: 'array', maxItems: 0, items: { type: 'null' }, allOf: [] }), 'v0.0.0'),
    ).toThrow(/page\.seam\.go\.params: .*"allOf"/)
    expect(() =>
      emit(one({ type: 'array', prefixItems: [{ not: {} }], minItems: 1, maxItems: 1 }), 'v0.0.0'),
    ).toThrow(/page\.seam\.go\.params\.prefixItems\[0\]: .*"not"/)
    expect(() =>
      emit(one({ type: 'array', maxItems: 0, items: { type: 'null' } }, { anyOf: [] }), 'v0.0.0'),
    ).toThrow(/page\.seam\.go\.result: .*"anyOf"/)
    expect(() =>
      emit(
        one({ type: 'array', maxItems: 0, items: { type: 'null' } }, { $ref: '#/$defs/Absent' }),
        'v0.0.0',
      ),
    ).toThrow(/Absent/)
  })

  it('refuses arguments it cannot count', () => {
    // maxItems short of, or past, the arguments listed; minItems past maxItems;
    // no maxItems at all; not an array.
    const bool = { type: 'boolean' }
    for (const params of [
      { type: 'array', prefixItems: [bool, bool], minItems: 1, maxItems: 1 },
      { type: 'array', prefixItems: [bool], minItems: 1, maxItems: 2 },
      { type: 'array', prefixItems: [bool], minItems: 2, maxItems: 1 },
      { type: 'array', prefixItems: [bool], minItems: 1 },
      { type: 'array', items: bool },
      { type: 'object' },
    ]) {
      expect(() => emit(one(params), 'v0.0.0'), JSON.stringify(params)).toThrow(
        /page\.seam\.go\.params/,
      )
    }
  })

  it('refuses a key it does not know on the page or on a method, and a name that is no identifier', () => {
    const params = { type: 'array', maxItems: 0, items: { type: 'null' } }
    const result = { type: 'null' }
    expect(() =>
      emit(withSeam({ go: { since: '0.1.0', params, result, until: '0.2.0' } }), 'v0.0.0'),
    ).toThrow(/page\.seam\.go: .*"until"/)
    expect(() => emit(withSeam(PAGE.seam, { worker: 'present.js' }), 'v0.0.0')).toThrow(
      /page: .*"worker"/,
    )
    expect(() =>
      emit(withSeam({ 'go(); evil': { since: '0.1.0', params, result } }), 'v0.0.0'),
    ).toThrow(/not an identifier/)
  })

  it('refuses a description with no page, or a page with no seam', () => {
    expect(() => emit(base as never, 'v0.0.0')).toThrow(/needs engine v0\.21\.0/)
    expect(() => emit(withSeam({}), 'v0.0.0')).toThrow(/page\.seam: .*no seam/)
  })

  it('refuses a directive that is not one whole directive', () => {
    for (const directive of [
      "script-src 'unsafe-inline'; connect-src *",
      'img-src data:, https:',
      'font-src data:\r\nX-Header: 1',
      'font-src',
      7,
    ]) {
      expect(
        () => emit(withSeam(PAGE.seam, { requires: [directive] }), 'v0.0.0'),
        String(directive),
      ).toThrow(/page\.requires\[0\]/)
    }
    expect(() => emit(withSeam(PAGE.seam, { requires: [] }), 'v0.0.0')).toThrow(/page\.requires/)
  })

  // The app serves the page with no `connect-src`: a page that fetched would
  // be refused every fetch under that policy and break with nothing said.
  it('refuses a page that fetches, saying why', () => {
    expect(() => emit(withSeam(PAGE.seam, { fetches: true }), 'v0.0.0')).toThrow(
      /page\.fetches: the page now fetches, and the policy .* has no connect-src/,
    )
    expect(() => emit(withSeam(PAGE.seam, { fetches: 'no' }), 'v0.0.0')).toThrow(/page\.fetches/)
  })
})

// What the description says reaches the module as data, never as code: the
// main process imports `PAGE_REQUIRES`, so a string that closed its literal
// early would run there. Proven on the module as it is written - formatted,
// then its types stripped and run - not on the text alone.
describe('a string from the description stays a string', () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {} }

  /** The emitted module, formatted as committed, run with its types stripped. */
  async function load(
    schema: unknown,
  ): Promise<{ exports: Record<string, unknown>; ran: unknown }> {
    const text = await emitFormatted(schema as never, 'v0.0.0', repo)
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const sandbox = { exports: {} as Record<string, unknown>, ran: undefined as unknown }
    runInNewContext(js, sandbox)
    return { exports: sandbox.exports, ran: sandbox.ran }
  }

  it('round-trips a directive holding a backslash and a quote, and runs nothing', async () => {
    // One whole directive by the rule (no semicolon, comma or line break),
    // written to end a single-quoted literal and run what follows it.
    const directive = "img-src \\' + (globalThis.ran = 1)] /*"
    const { exports, ran } = await load({ ...base, page: { ...PAGE, requires: [directive] } })
    expect(ran, 'the directive ran as code').toBeUndefined()
    expect(exports.PAGE_REQUIRES).toEqual([directive])
  })

  it('refuses a description that would close its doc comment, naming where', () => {
    const closes = 'ends here */ export const X = 1 /*'
    const params = { type: 'array', maxItems: 0, items: { type: 'null' } }
    const result = { type: 'null' }
    const cases: [unknown, RegExp][] = [
      [{ ...base, page: { ...PAGE, description: closes } }, /page\.description: .*"\*\/"/],
      [
        {
          ...base,
          page: { ...PAGE, seam: { go: { since: '0.1.0', description: closes, params, result } } },
        },
        /page\.seam\.go\.description: .*"\*\/"/,
      ],
      [
        { ...base, page: PAGE, $defs: { Thing: { type: 'string', description: closes } } },
        /\$defs\.Thing\.description: .*"\*\/"/,
      ],
      [
        {
          ...base,
          page: PAGE,
          $defs: {
            Thing: { type: 'object', properties: { a: { type: 'string', description: closes } } },
          },
        },
        /\$defs\.Thing\.a\.description: .*"\*\/"/,
      ],
    ]
    for (const [schema, message] of cases)
      expect(() => emit(schema as never, 'v0.0.0')).toThrow(message)
  })
})

// Every name the description gives, every number and every value is written
// into the module, so each is checked before it is: a name that is not an
// identifier, a protocol that is not a number, a constant that is not a
// scalar would each be code rather than data (review of issue 607).
describe('what the description names is written as data, or refused', () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {}, page: PAGE }

  /** The emitted module, formatted as committed, run with its types stripped. */
  async function run(schema: unknown): Promise<{ exports: Record<string, unknown>; ran: unknown }> {
    const text = await emitFormatted(schema as never, 'v0.0.0', repo)
    const js = ts.transpileModule(text, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const sandbox = { exports: {} as Record<string, unknown>, ran: undefined as unknown }
    runInNewContext(js, sandbox)
    return { exports: sandbox.exports, ran: sandbox.ran }
  }

  /**
   * Refused before anything is written; and where it was not, whatever the
   * module then does is reported: it ran the description's text as code.
   */
  async function refusedBeforeRunning(schema: unknown, message: RegExp): Promise<void> {
    let outcome: { ran: unknown }
    try {
      outcome = await run(schema)
    } catch (error) {
      expect(String(error)).toMatch(message)
      return
    }
    expect(outcome.ran, 'the description ran as code').toBeUndefined()
    expect.fail('the description was not refused')
  }

  it('writes a method or notification name as a string, whatever it holds, and runs nothing', async () => {
    const hostile = "a': null } globalThis.ran = 1; interface X { 'b"
    const ok = { type: 'object', properties: {} }
    for (const schema of [
      { ...base, methods: { [hostile]: { params: ok, result: ok } } },
      { ...base, notifications: { [hostile]: ok } },
    ]) {
      const { ran } = await run(schema)
      expect(ran, 'the name ran as code').toBeUndefined()
      expect(emit(schema as never, 'v0.0.0')).toContain(`  ${JSON.stringify(hostile)}: `)
    }
  })

  it('refuses a protocol version that is not a whole number', async () => {
    // A line break ends the header's comment; the rest is the module's code.
    await refusedBeforeRunning(
      { ...base, protocol: '1.\nglobalThis.ran = 1\n//' },
      /protocol: the protocol version is not a whole number/,
    )
    for (const protocol of ['1', 1.5, null, Number.NaN]) {
      expect(() => emit({ ...base, protocol } as never, 'v0.0.0'), String(protocol)).toThrow(
        /not a whole number/,
      )
    }
  })

  it('refuses a constant or an enumerated value that is not a scalar', async () => {
    // `String` of a one-item list is its item's text: here, code.
    await refusedBeforeRunning(
      { ...base, $defs: { X: { const: ['1; globalThis.ran = 1; type Y = 1'] } } },
      /\$defs\.X\.const: a value that is not a string, a finite number or a boolean/,
    )
    await refusedBeforeRunning(
      { ...base, $defs: { X: { enum: ['a', ['1; globalThis.ran = 1; type Y = 1']] } } },
      /\$defs\.X\.enum\[1\]: a value that is not/,
    )
    for (const value of [{ a: 1 }, null, []]) {
      expect(() => emit({ ...base, $defs: { X: { enum: [value] } } } as never, 'v0.0.0')).toThrow(
        /\$defs\.X\.enum\[0\]: a value that is not/,
      )
    }
  })

  it('refuses a definition name that is not an identifier, referenced or not', async () => {
    await refusedBeforeRunning(
      { ...base, $defs: { 'A = 1; globalThis.ran = 1; type B': { type: 'string' } } },
      /\$defs\.A = 1.*: a definition name that is not an identifier/,
    )
    for (const name of ['two words', '1st', '']) {
      const schema = { ...base, $defs: { [name]: { type: 'string' } } }
      expect(() => emit(schema as never, 'v0.0.0'), name).toThrow(
        /a definition name that is not an identifier/,
      )
    }
  })
})

// The page's directives come first in the policy and the app's own after
// them (`PROJECT_CSP`), and a policy keeps the first of two directives of one
// name: so the engine may name only the four a self-contained page needs, an
// allow list, and nothing that would cancel, widen or reroute the app's.
describe("the page's directives cannot override the app's", () => {
  const base = { protocol: 1, $defs: {}, methods: {}, notifications: {} }
  const asking = (...requires: string[]) => ({ ...base, page: { ...PAGE, requires } }) as never

  it('refuses every directive but the four, naming it', () => {
    for (const directive of [
      "default-src 'self'",
      'frame-ancestors *',
      "base-uri 'self'",
      "form-action 'self'",
      'sandbox allow-same-origin',
      'report-uri /csp',
      'report-to csp',
      "script-src-elem 'unsafe-inline'",
      "worker-src 'self'",
    ]) {
      const name = directive.split(' ')[0]
      expect(() => emit(asking("script-src 'unsafe-inline'", directive), 'v0.0.0'), name).toThrow(
        new RegExp(
          `page\\.requires\\[1\\]: ${name} is not a directive the page may ask for; only script-src, style-src, img-src, font-src are`,
        ),
      )
    }
  })

  it('refuses connect-src from a page that says it fetches nothing, in its own words', () => {
    expect(() => emit(asking("connect-src 'self'"), 'v0.0.0')).toThrow(
      /page\.requires\[0\]: connect-src, from a page the description says fetches nothing/,
    )
  })

  it('refuses a directive named twice, since only the first would count', () => {
    expect(() => emit(asking('img-src data:', 'img-src *'), 'v0.0.0')).toThrow(
      /page\.requires\[1\]: img-src a second time/,
    )
  })

  it("takes the pinned engine's four", () => {
    expect(() => emit(asking(...PAGE_REQUIRES), 'v0.0.0')).not.toThrow()
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
