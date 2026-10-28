// The engine's protocol, brought into the app as data and as types.
//
// `npm run typegen` asks the engine at the checkout named by
// LEGIBLE_ENGINE_CHECKOUT for its own description of the protocol, commits
// that description verbatim, records its fingerprint beside the engine's
// pin, and writes the types the app is built against. All three or none:
// a half-updated set is what the fingerprint test exists to catch.
//
// The description is a static file in the engine, printed with a two-space
// indent, so its bytes are already canonical and nothing here reformats
// them. The emitter knows a closed set of JSON Schema keywords (`KNOWN`):
// those it acts on and those that constrain values rather than shapes, which
// it reads and ignores. Any other stops the build naming the keyword and its
// path, so an engine that outgrows this script cannot receive a plausible
// wrong type.
//
// Since engine v0.21.0 the description also says the animation page's seam
// (`page`): the methods of its `window.__present`, each with its positional
// arguments, its answer and the version it arrived at, and the policy a frame
// hosting the page must allow. They become `PageSeam`, `PAGE_SEAM_NAMES`,
// `PAGE_SEAM_SINCE`, `PAGE_REQUIRES` and `PAGE_FETCHES`, so the app keeps no
// copy of its own of any of them; the same refusals apply inside them.
//
// Contract: specs/006-typed-engine-client/contracts/generation.md.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { format, resolveConfig } from 'prettier'
import { isAbsolute, join, resolve } from 'node:path'
import { parseEnvFile } from '../src/main/config.ts'

// ---------------------------------------------------------------- reading

/**
 * The engine checkout, from the environment or `.env.local`; null if
 * neither names one. The file is read with the app's own parser rather than
 * a second one: two parsers disagreeing about which of two lines wins would
 * have this script generating from one checkout while the drift test
 * compares against another.
 */
export function engineCheckout(
  env: NodeJS.ProcessEnv,
  fileText: string | null,
  repoRoot: string,
): string | null {
  const absolute = (value: string): string => (isAbsolute(value) ? value : resolve(repoRoot, value))
  const fromEnv = env.LEGIBLE_ENGINE_CHECKOUT
  if (fromEnv !== undefined && fromEnv.trim() !== '') return absolute(fromEnv.trim())
  if (fileText === null) return null
  const value = parseEnvFile(fileText).LEGIBLE_ENGINE_CHECKOUT
  return value === undefined || value.trim() === '' ? null : absolute(value.trim())
}

/** Print the engine's description, or explain what is missing. */
function readDescription(checkout: string): string {
  const python = join(
    checkout,
    '.venv',
    'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  )
  const interpreter = existsSync(python) ? python : join(checkout, '.venv', 'Scripts', 'python.exe')
  if (!existsSync(interpreter)) {
    throw new Error(
      `No interpreter at ${python}. The engine checkout needs its virtual environment with the engine installed.`,
    )
  }
  // An allowlist rather than the whole environment, as the app does for the
  // engine it runs (src/main/interpreter.ts): a token in this shell has no
  // business in a child we did not write, even one that only prints a file.
  const env: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'SystemRoot', 'LANG']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  const run = spawnSync(interpreter, ['-m', 'schematic.serve', '--schema'], {
    cwd: checkout,
    encoding: 'utf8',
    env,
    timeout: 30_000,
    windowsHide: true,
  })
  if (run.error) throw run.error
  if (run.signal !== null) {
    throw new Error(`The engine did not print its schema within 30 s (${run.signal}).`)
  }
  if (run.status !== 0) {
    throw new Error(
      `The engine refused to print its schema (exit ${run.status}): ${run.stderr.trim()}`,
    )
  }
  return run.stdout
}

// --------------------------------------------------------------- emitting

/** The subset of JSON Schema the engine's description uses. */
interface Node {
  $ref?: string
  type?: string | string[]
  properties?: Record<string, Node>
  required?: string[]
  items?: Node
  oneOf?: Node[]
  enum?: (string | number)[]
  const?: string | number | boolean
  description?: string
  // Constraints on values rather than on shapes: read and ignored.
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  pattern?: string
  format?: string
  default?: unknown
  // `false` closes the object, `true` opens it, and a node types the values
  // an open object carries: `{"additionalProperties": {"$ref": ...}}` is a
  // map, not a bag, and typing it as one is the point.
  additionalProperties?: boolean | Node
  minLength?: number
  minItems?: number
  maxItems?: number
  // Distinct items: a constraint on values, read and ignored (a list's type is
  // the same with or without it).
  uniqueItems?: boolean
  prefixItems?: Node[]
  maxLength?: number
}

/** One method of the page's `window.__present`, as the description gives it. */
interface SeamMethod {
  since: string
  description?: string
  params: Node
  result: Node
}

/**
 * The animation page `map.build` writes, as a host drives it (engine
 * v0.21.0): its seam, the policy a frame hosting it must allow, and whether
 * it fetches anything.
 */
interface Page {
  description?: string
  seam: Record<string, SeamMethod>
  requires: string[]
  fetches: boolean
}

interface Description {
  protocol: number
  $defs: Record<string, Node>
  methods: Record<string, { params: Node; result: Node }>
  notifications: Record<string, Node>
  page: Page
}

// Everything the emitter understands. A key outside this set means the
// engine's description has grown a construct nobody has taught this
// script, which is a build failure rather than a guess.
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
  'uniqueItems',
  'prefixItems',
  'maxLength',
])

const PRIMITIVES: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
  object: 'Record<string, unknown>',
}

/** A name the module writes as an identifier: a definition's, a seam method's. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** A definition's name from a `#/$defs/Name` reference. */
function refName(ref: string, path: string): string {
  const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref)
  if (match === null) throw new Error(`${path}: a $ref this script cannot follow: ${ref}`)
  return match[1]
}

// A string from the description is written as JSON writes it, which escapes
// every character that could end the literal early - a quote, a backslash, a
// line break - so whatever the engine says reaches the module as data and
// never as code. The formatter then gives it the repository's single quotes
// wherever that needs no escape, so the file still reads as written by hand.
//
// Only a scalar is a literal: a string, a finite number or a boolean. Anything
// else - an array or an object in `const` or `enum`, a null - is refused,
// because `String` would write it as whatever its text happens to be.
function literal(value: unknown, path: string): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  throw new Error(`${path}: a value that is not a string, a finite number or a boolean`)
}

/** One node as a TypeScript type. `indent` is the current body's indent. */
function typeOf(node: Node, path: string, defs: Set<string>, indent: string): string {
  for (const key of Object.keys(node)) {
    if (!KNOWN.has(key)) throw new Error(`${path}: this script does not know the keyword "${key}"`)
  }
  if (node.$ref !== undefined) {
    const name = refName(node.$ref, path)
    if (!defs.has(name))
      throw new Error(`${path}: $ref to ${name}, which the description does not define`)
    return name
  }
  if (node.const !== undefined) return literal(node.const, `${path}.const`)
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum)) throw new Error(`${path}.enum: not a list of values`)
    return node.enum.map((value, i) => literal(value, `${path}.enum[${i}]`)).join(' | ')
  }
  if (node.oneOf !== undefined) {
    return node.oneOf
      .map((branch, i) => typeOf(branch, `${path}.oneOf[${i}]`, defs, indent))
      .join(' | ')
  }
  if (node.type === undefined) throw new Error(`${path}: no type, no $ref, no enum, no const`)
  if (Array.isArray(node.type)) {
    return node.type.map((one) => typeOf({ ...node, type: one }, path, defs, indent)).join(' | ')
  }
  if (node.type === 'array') {
    // A tuple: each position typed on its own, closed by min and max items.
    if (node.prefixItems !== undefined) {
      const parts = node.prefixItems.map((item, i) =>
        typeOf(item, `${path}.prefixItems[${i}]`, defs, indent),
      )
      return `[${parts.join(', ')}]`
    }
    if (node.items === undefined) throw new Error(`${path}: an array without items`)
    const item = typeOf(node.items, `${path}.items`, defs, indent)
    return /[ |]/.test(item) ? `(${item})[]` : `${item}[]`
  }
  if (node.type === 'object') {
    if (node.properties !== undefined) return objectBody(node, path, defs, indent)
    // No properties and no extras allowed: an empty object, not a bag.
    if (node.additionalProperties === false) return 'Record<string, never>'
    // No properties but a node for the extras: a map, keyed by whatever the
    // client holds. `Record<string, unknown>` would lose the value's type
    // silently, which is how a colour map reached the app untyped.
    const extra = extraNode(node)
    if (extra !== null) {
      return `Record<string, ${typeOf(extra, `${path}.additionalProperties`, defs, indent)}>`
    }
  }
  const primitive = PRIMITIVES[node.type]
  if (primitive === undefined)
    throw new Error(`${path}: this script does not know the type "${node.type}"`)
  return primitive
}

/** The node typing an open object's values, or null if there is none. */
function extraNode(node: Node): Node | null {
  const extra = node.additionalProperties
  return typeof extra === 'object' && extra !== null ? extra : null
}

/** An object's members, braced, one per line. */
function objectBody(node: Node, path: string, defs: Set<string>, indent: string): string {
  const required = new Set(node.required ?? [])
  const inner = indent + '  '
  const lines: string[] = []
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    if (child.description !== undefined)
      lines.push(...comment(child.description, inner, `${path}.${name}.description`))
    const key = IDENTIFIER.test(name) ? name : literal(name, `${path}.${name}`)
    const optional = required.has(name) ? '' : '?'
    lines.push(`${inner}${key}${optional}: ${typeOf(child, `${path}.${name}`, defs, inner)}`)
  }
  // Named members and a node for the rest: an index signature beside them,
  // so the extras keep their type instead of disappearing.
  const extra = extraNode(node)
  if (extra !== null) {
    lines.push(
      `${inner}[key: string]: ${typeOf(extra, `${path}.additionalProperties`, defs, inner)}`,
    )
  }
  return `{\n${lines.join('\n')}\n${indent}}`
}

// A description as a doc comment, wrapped at 76 columns. One that would close
// the comment early is refused rather than escaped: the text after a star and
// a slash would be the module's code, and a description has no reason to say
// it.
function comment(text: string, indent: string, path: string): string[] {
  if (text.includes('*/'))
    throw new Error(
      `${path}: a description that closes a comment ("*/"), which this script refuses`,
    )
  const words = text.split(/\s+/).filter((w) => w !== '')
  const width = 74 - indent.length
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line === '') line = word
    else if (line.length + 1 + word.length <= width) line += ` ${word}`
    else {
      lines.push(line)
      line = word
    }
  }
  if (line !== '') lines.push(line)
  return [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`), `${indent} */`]
}

// ------------------------------------------------------------ the page

// The keys a part of `page` may carry. Anything else is a construct this
// script has not been taught, refused as an unknown keyword is: the seam is
// written into the page's script by name and the policy into a header, so
// neither is a place to guess.
const PAGE_KEYS = new Set(['description', 'seam', 'requires', 'fetches'])
const SEAM_KEYS = new Set(['since', 'description', 'params', 'result'])

/** A method name the app writes into a script as `window.__present.<name>(…)`. */
const SEAM_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** A version in the pins' form: three numbers. */
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/

/**
 * One whole directive, as a header carries it: a name and its sources, and
 * nothing that would end the directive or the header early.
 */
const DIRECTIVE = /^[a-z][a-z-]* [^;,\r\n]+$/

/**
 * The only directives the page may ask a host for: what one self-contained
 * file needs to run, style itself, and draw its icons and its face. Every
 * other is refused, an allow list rather than a deny list, because the
 * page's directives come before the app's own in `PROJECT_CSP`
 * (`src/main/protocol.ts`) and a policy keeps the first of two of one name:
 * a `frame-ancestors *` from the engine would cancel the app's, and a
 * `report-uri`, a `report-to` or a `script-src-elem` would each widen or
 * reroute the policy in a way no list of the app's could foresee.
 */
const PAGE_DIRECTIVES = new Set(['script-src', 'style-src', 'img-src', 'font-src'])

function onlyKeys(value: object, known: Set<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new Error(`${path}: this script does not know the key "${key}"`)
  }
}

/**
 * A seam method's positional arguments as a tuple. The description says them
 * as an array with `prefixItems`, `minItems` for the ones a call must give
 * and `maxItems` for all of them, so an argument past `minItems` is optional;
 * a method with none is an array capped at no items. Anything else is
 * refused: a list of arguments the script cannot count is no signature.
 */
function paramsOf(node: Node, path: string, defs: Set<string>): string {
  for (const key of Object.keys(node)) {
    if (!KNOWN.has(key)) throw new Error(`${path}: this script does not know the keyword "${key}"`)
  }
  if (node.type !== 'array') throw new Error(`${path}: the arguments are not an array`)
  const items = node.prefixItems ?? []
  const max = node.maxItems
  const min = node.minItems ?? 0
  if (max === undefined || max !== items.length)
    throw new Error(
      `${path}: maxItems must name every argument prefixItems lists (${items.length})`,
    )
  if (!Number.isInteger(min) || min < 0 || min > max)
    throw new Error(`${path}: minItems must be a whole number no greater than maxItems`)
  if (items.length === 0) {
    // `items` is what lets the description say "none" without a new
    // keyword; it is read for its keywords and says nothing more.
    if (node.items !== undefined) typeOf(node.items, `${path}.items`, defs, '    ')
    return '[]'
  }
  const parts = items.map((item, i) => {
    const type = typeOf(item, `${path}.prefixItems[${i}]`, defs, '    ')
    if (i < min) return type
    return /[ |]/.test(type) ? `(${type})?` : `${type}?`
  })
  return `[${parts.join(', ')}]`
}

/**
 * The page's seam and its host policy: `PageSeam`, one `{ params, result }`
 * per method; the names in the description's order; the version each
 * arrived at; the directives a frame hosting the page must allow; and that
 * the page fetches nothing.
 */
function emitPage(page: Page | undefined, defs: Set<string>): string[] {
  if (page === undefined || page === null || typeof page !== 'object')
    throw new Error(
      'page: the description says nothing of the page it writes; this script needs engine v0.21.0 or later',
    )
  onlyKeys(page, PAGE_KEYS, 'page')
  if (typeof page.seam !== 'object' || page.seam === null)
    throw new Error('page.seam: the description names no seam')
  const names = Object.keys(page.seam)
  if (names.length === 0) throw new Error('page.seam: the description names no seam')
  const out: string[] = []
  if (page.description !== undefined) out.push(...comment(page.description, '', 'page.description'))
  out.push('export interface PageSeam {')
  for (const name of names) {
    const path = `page.seam.${name}`
    if (!SEAM_NAME.test(name)) throw new Error(`${path}: a method name that is not an identifier`)
    const method = page.seam[name]
    if (typeof method !== 'object' || method === null)
      throw new Error(`${path}: a method that is not described`)
    onlyKeys(method, SEAM_KEYS, path)
    if (typeof method.since !== 'string' || !VERSION.test(method.since))
      throw new Error(
        `${path}.since: "${String(method.since)}" is not a version of three numbers, as the pins write one`,
      )
    if (method.description !== undefined)
      out.push(...comment(method.description, '  ', `${path}.description`))
    out.push(`  ${name}: {`)
    out.push(`    params: ${paramsOf(method.params, `${path}.params`, defs)}`)
    out.push(`    result: ${typeOf(method.result, `${path}.result`, defs, '    ')}`)
    out.push('  }')
  }
  out.push('}', '')

  out.push("/** Every method of the page's seam, in the description's order. */")
  out.push(
    `export const PAGE_SEAM_NAMES = [${names.map((name) => literal(name, `page.seam.${name}`)).join(', ')}] as const`,
  )
  out.push('')
  out.push(
    '/** The first engine version whose page has each method: a page lacking one is older than it. */',
  )
  out.push('export const PAGE_SEAM_SINCE: { readonly [K in keyof PageSeam]: string } = {')
  for (const name of names)
    out.push(`  ${name}: ${literal(page.seam[name].since, `page.seam.${name}.since`)},`)
  out.push('}', '')

  // The app serves the page with no `connect-src`, so `default-src 'none'`
  // refuses every fetch it could make. A page that fetched would be broken
  // under that policy silently; the policy has to be rethought first.
  if (page.fetches === true)
    throw new Error(
      'page.fetches: the page now fetches, and the policy the app serves it with has no connect-src; decide what it may reach before generating',
    )
  if (page.fetches !== false) throw new Error('page.fetches: neither true nor false')

  if (!Array.isArray(page.requires) || page.requires.length === 0)
    throw new Error('page.requires: the description names no directive a host must allow')
  const named = new Set<string>()
  for (const [i, directive] of page.requires.entries()) {
    if (typeof directive !== 'string' || !DIRECTIVE.test(directive))
      throw new Error(`page.requires[${i}]: not one whole Content-Security-Policy directive`)
    const name = directive.slice(0, directive.indexOf(' '))
    if (name === 'connect-src')
      throw new Error(
        `page.requires[${i}]: connect-src, from a page the description says fetches nothing`,
      )
    if (!PAGE_DIRECTIVES.has(name))
      throw new Error(
        `page.requires[${i}]: ${name} is not a directive the page may ask for; only ${[...PAGE_DIRECTIVES].join(', ')} are`,
      )
    if (named.has(name))
      throw new Error(
        `page.requires[${i}]: ${name} a second time, and a policy keeps only the first`,
      )
    named.add(name)
  }
  out.push(
    '/** What a frame hosting the page must allow, as whole Content-Security-Policy directives. */',
  )
  out.push(
    `export const PAGE_REQUIRES = [${page.requires.map((d, i) => literal(d, `page.requires[${i}]`)).join(', ')}] as const`,
  )
  out.push('')

  out.push('/** The page fetches nothing, which is why its policy has no `connect-src`. */')
  out.push('export const PAGE_FETCHES = false as const')
  out.push('')
  return out
}

/** The whole module, from the description. Deterministic: no date, no path. */
export function emit(description: Description, tag: string): string {
  // Written into the header's comment and as `PROTOCOL`'s value, so anything
  // but a whole number would be text in the one and code in the other.
  if (!Number.isInteger(description.protocol))
    throw new Error('protocol: the protocol version is not a whole number')
  const defs = new Set(Object.keys(description.$defs))
  const out: string[] = [
    "// Generated from the engine's own description of its protocol.",
    '// Run `npm run typegen` to regenerate; edits here are lost.',
    '//',
    `// Engine: ${tag}, protocol ${description.protocol}.`,
    "// Source: vendor/protocol.schema.json, printed by the engine's",
    '// `python -m schematic.serve --schema` and committed verbatim.',
    '',
  ]

  for (const [name, node] of Object.entries(description.$defs)) {
    const path = `$defs.${name}`
    // The name is written as the type's identifier, referenced or not, so a
    // name that is not one would be code rather than a name.
    if (!IDENTIFIER.test(name))
      throw new Error(`${path}: a definition name that is not an identifier`)
    if (node.description !== undefined)
      out.push(...comment(node.description, '', `${path}.description`))
    const isInterface =
      node.$ref === undefined &&
      node.type === 'object' &&
      node.properties !== undefined &&
      node.oneOf === undefined
    if (isInterface) out.push(`export interface ${name} ${objectBody(node, path, defs, '')}`)
    else out.push(`export type ${name} = ${typeOf(node, path, defs, '')}`)
    out.push('')
  }

  out.push('/** Every request the engine answers, with its parameters and its result. */')
  out.push('export interface Methods {')
  for (const [name, method] of Object.entries(description.methods)) {
    out.push(`  ${literal(name, `methods.${name}`)}: {`)
    out.push(`    params: ${typeOf(method.params, `methods.${name}.params`, defs, '    ')}`)
    out.push(`    result: ${typeOf(method.result, `methods.${name}.result`, defs, '    ')}`)
    out.push('  }')
  }
  out.push('}', '')
  out.push('/** Every notification the engine sends, with its parameters. */')
  out.push('export interface Notifications {')
  for (const [name, node] of Object.entries(description.notifications)) {
    out.push(
      `  ${literal(name, `notifications.${name}`)}: ${typeOf(node, `notifications.${name}`, defs, '  ')}`,
    )
  }
  out.push('}', '')
  out.push('export type Method = keyof Methods')
  out.push('export type NotificationName = keyof Notifications')
  out.push('')
  out.push('/** The protocol version this app was generated against. */')
  out.push(`export const PROTOCOL = ${description.protocol} as const`)
  out.push('')
  out.push(...emitPage(description.page, defs))
  return out.join('\n')
}

/**
 * The module as committed: `emit`'s text through the repository's own
 * formatter, so what the generator writes is what `npm run lint` checks. A
 * long enumeration wraps the way prettier wraps it, and nobody has to teach
 * the generator prettier's rules one case at a time.
 */
export async function emitFormatted(
  description: Description,
  tag: string,
  repoRoot: string,
): Promise<string> {
  const options = (await resolveConfig(join(repoRoot, 'src', 'shared', 'protocol.ts'))) ?? {}
  return format(emit(description, tag), { ...options, parser: 'typescript' })
}

export const fingerprint = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

// --------------------------------------------------------------- writing

async function main(): Promise<void> {
  const repoRoot = resolve(import.meta.dirname, '..')
  const envFile = existsSync(join(repoRoot, '.env.local'))
    ? readFileSync(join(repoRoot, '.env.local'), 'utf8')
    : null
  const checkout = engineCheckout(process.env, envFile, repoRoot)
  if (checkout === null) {
    console.error(
      'No engine checkout. Set LEGIBLE_ENGINE_CHECKOUT in .env.local or the environment to\n' +
        'the engine checkout whose virtual environment holds the pinned engine, then run\n' +
        'npm run typegen again. Nothing was written.',
    )
    process.exit(1)
  }

  const pinsPath = join(repoRoot, 'vendor', 'pins.json')
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8')) as {
    engine: { tag: string; version: string; schema_sha256?: string }
  }

  const schemaText = readDescription(checkout)
  const description = JSON.parse(schemaText) as Description
  const module = await emitFormatted(description, pins.engine.tag, repoRoot)

  writeFileSync(join(repoRoot, 'vendor', 'protocol.schema.json'), schemaText)
  pins.engine.schema_sha256 = fingerprint(schemaText)
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + '\n')
  writeFileSync(join(repoRoot, 'src', 'shared', 'protocol.ts'), module)

  const methods = Object.keys(description.methods).length
  const notifications = Object.keys(description.notifications).length
  const seam = Object.keys(description.page.seam).length
  console.log(
    `Wrote vendor/protocol.schema.json (${methods} methods, ${notifications} notifications, ${seam} page methods),\n` +
      `its fingerprint into vendor/pins.json, and src/shared/protocol.ts from ${pins.engine.tag}.`,
  )
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: Error) => {
    console.error(error.message)
    process.exit(1)
  })
}
