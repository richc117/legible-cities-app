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
// them. The emitter knows sixteen JSON Schema keywords: ten it acts on and
// six that constrain values rather than shapes, which it reads and ignores.
// A seventeenth stops the build naming the keyword and its path, so an
// engine that outgrows this script cannot receive a plausible wrong type.
//
// Contract: specs/006-typed-engine-client/contracts/generation.md.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  additionalProperties?: boolean
}

interface Description {
  protocol: number
  $defs: Record<string, Node>
  methods: Record<string, { params: Node; result: Node }>
  notifications: Record<string, Node>
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
])

const PRIMITIVES: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  null: 'null',
  object: 'Record<string, unknown>',
}

/** A definition's name from a `#/$defs/Name` reference. */
function refName(ref: string, path: string): string {
  const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(ref)
  if (match === null) throw new Error(`${path}: a $ref this script cannot follow: ${ref}`)
  return match[1]
}

// Single quotes and no semicolons, to match the repository's style: the
// generated file is read by people even though it is written by a script.
const literal = (value: string | number | boolean): string =>
  typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value)

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
  if (node.const !== undefined) return literal(node.const)
  if (node.enum !== undefined) return node.enum.map(literal).join(' | ')
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
    if (node.items === undefined) throw new Error(`${path}: an array without items`)
    const item = typeOf(node.items, `${path}.items`, defs, indent)
    return /[ |]/.test(item) ? `(${item})[]` : `${item}[]`
  }
  if (node.type === 'object') {
    if (node.properties !== undefined) return objectBody(node, path, defs, indent)
    // No properties and no extras allowed: an empty object, not a bag.
    if (node.additionalProperties === false) return 'Record<string, never>'
  }
  const primitive = PRIMITIVES[node.type]
  if (primitive === undefined)
    throw new Error(`${path}: this script does not know the type "${node.type}"`)
  return primitive
}

/** An object's members, braced, one per line. */
function objectBody(node: Node, path: string, defs: Set<string>, indent: string): string {
  const required = new Set(node.required ?? [])
  const inner = indent + '  '
  const lines: string[] = []
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    if (child.description !== undefined) lines.push(...comment(child.description, inner))
    const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : `'${name}'`
    const optional = required.has(name) ? '' : '?'
    lines.push(`${inner}${key}${optional}: ${typeOf(child, `${path}.${name}`, defs, inner)}`)
  }
  return `{\n${lines.join('\n')}\n${indent}}`
}

/** A description as a doc comment, wrapped at 76 columns. */
function comment(text: string, indent: string): string[] {
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

/** The whole module, from the description. Deterministic: no date, no path. */
export function emit(description: Description, tag: string): string {
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
    if (node.description !== undefined) out.push(...comment(node.description, ''))
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
    out.push(`  '${name}': {`)
    out.push(`    params: ${typeOf(method.params, `methods.${name}.params`, defs, '    ')}`)
    out.push(`    result: ${typeOf(method.result, `methods.${name}.result`, defs, '    ')}`)
    out.push('  }')
  }
  out.push('}', '')
  out.push('/** Every notification the engine sends, with its parameters. */')
  out.push('export interface Notifications {')
  for (const [name, node] of Object.entries(description.notifications)) {
    out.push(`  '${name}': ${typeOf(node, `notifications.${name}`, defs, '  ')}`)
  }
  out.push('}', '')
  out.push('export type Method = keyof Methods')
  out.push('export type NotificationName = keyof Notifications')
  out.push('')
  out.push('/** The protocol version this app was generated against. */')
  out.push(`export const PROTOCOL = ${description.protocol} as const`)
  out.push('')
  return out.join('\n')
}

export const fingerprint = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

// --------------------------------------------------------------- writing

function main(): void {
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
  const module = emit(description, pins.engine.tag)

  writeFileSync(join(repoRoot, 'vendor', 'protocol.schema.json'), schemaText)
  pins.engine.schema_sha256 = fingerprint(schemaText)
  writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + '\n')
  writeFileSync(join(repoRoot, 'src', 'shared', 'protocol.ts'), module)

  const methods = Object.keys(description.methods).length
  const notifications = Object.keys(description.notifications).length
  console.log(
    `Wrote vendor/protocol.schema.json (${methods} methods, ${notifications} notifications),\n` +
      `its fingerprint into vendor/pins.json, and src/shared/protocol.ts from ${pins.engine.tag}.`,
  )
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
