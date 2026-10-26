// The process boundaries, read from the imports themselves (spec 037, User
// Story 5, FR-013). The record's code was one module every process imported
// whole (`src/shared/project.ts`, issue 492); it is now split by what it
// holds and by which process uses it, and this holds the split: a module
// main alone runs is never reached from the interface, the interface's never
// from main, shared code from neither, and no two shared modules need each
// other's values to load.
//
// Every `import` and `export ... from` under `src/` is read, with
// `import('...')` both as a type and as a call, from the source text through
// the TypeScript parser, so a specifier in a comment or a string is not one.
// A type-only import (`import type`, every name marked `type`, or a type
// written `import('...').Name`) is counted as a crossing like any other: a
// renderer that names main's types depends on main's module, whether or not
// the bundler drops the line. It is not a value import, so it makes no value
// cycle: a type-only edge is erased before anything loads.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

/** A path from the repository's root, with forward slashes, as a message names it. */
const named = (path: string): string => relative(root, path).split(sep).join('/')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) out.push(path)
  }
  return out
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()

/**
 * The file a specifier names, or, for one that names nothing that exists,
 * the path it would name, so an import of a deleted module is still seen.
 * Null for a package. `@renderer/` is the renderer's alias.
 */
function target(from: string, specifier: string): string | null {
  const bare = specifier.replace(/\?.*$/, '')
  let base: string
  if (bare.startsWith('.')) base = resolve(dirname(from), bare)
  else if (bare.startsWith('@renderer/'))
    base = join(root, 'src', 'renderer', 'src', bare.slice('@renderer/'.length))
  else return null
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.d.ts`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  return candidates.find(isFile) ?? base
}

interface Edge {
  /** The importing file, from the root. */
  from: string
  line: number
  specifier: string
  /** The imported file, from the root; for a missing one, the path it names. */
  to: string
  /** Erased before anything runs: `import type`, all names `type`, or a type `import()`. */
  typeOnly: boolean
}

function edgesOf(file: string): Edge[] {
  const text = readFileSync(file, 'utf8')
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const edges: Edge[] = []
  const add = (node: ts.Node, specifier: string, typeOnly: boolean): void => {
    const to = target(file, specifier)
    if (to === null) return
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
    edges.push({ from: named(file), line, specifier, to: named(to), typeOnly })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const names =
        clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)
          ? clause.namedBindings.elements
          : undefined
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            names !== undefined &&
            names.length > 0 &&
            names.every((name) => name.isTypeOnly)))
      add(node, node.moduleSpecifier.text, typeOnly)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const names =
        node.exportClause !== undefined && ts.isNamedExports(node.exportClause)
          ? node.exportClause.elements
          : undefined
      const typeOnly =
        node.isTypeOnly ||
        (names !== undefined && names.length > 0 && names.every((name) => name.isTypeOnly))
      add(node, node.moduleSpecifier.text, typeOnly)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node, node.argument.literal.text, true)
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node, node.arguments[0].text, false)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      add(node, node.moduleReference.expression.text, node.isTypeOnly)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edges
}

const files = walk(join(root, 'src'))
const edges = files.flatMap(edgesOf)

const under = (path: string, ...folders: string[]): boolean =>
  folders.some((folder) => path.startsWith(`src/${folder}/`))

/** Each edge as a message names it: the file, the line and the import as written. */
const said = (edge: Edge): string =>
  `${edge.from}:${edge.line} imports '${edge.specifier}' (${edge.to})` +
  (edge.typeOnly ? ', a type-only import' : '')

/**
 * One value import cycle through each group of shared modules that need one
 * another's values, each written as the chain of imports that makes it.
 */
function valueCycles(among: readonly Edge[]): string[] {
  const next = new Map<string, Edge[]>()
  for (const edge of among) next.set(edge.from, [...(next.get(edge.from) ?? []), edge])
  const found: string[] = []
  const seen = new Set<string>()
  const done = new Set<string>()
  const path: Edge[] = []
  const onPath = new Set<string>()
  const visit = (file: string): void => {
    seen.add(file)
    onPath.add(file)
    for (const edge of next.get(file) ?? []) {
      if (onPath.has(edge.to)) {
        const start = path.findIndex((step) => step.from === edge.to)
        const loop = [...path.slice(start === -1 ? path.length : start), edge]
        found.push(loop.map(said).join(' -> '))
      } else if (!seen.has(edge.to)) {
        path.push(edge)
        visit(edge.to)
        path.pop()
      }
    }
    onPath.delete(file)
    done.add(file)
  }
  for (const file of [...next.keys()].sort()) if (!done.has(file)) visit(file)
  return found
}

describe('the import graph under src/', () => {
  it('is read: the parser finds the imports that are known to be there', () => {
    // So a reader that found nothing cannot pass every rule below.
    expect(files.length).toBeGreaterThan(100)
    expect(edges.length).toBeGreaterThan(500)
    const has = (from: string, to: string, typeOnly: boolean): boolean =>
      edges.some((e) => e.from === from && e.to === to && e.typeOnly === typeOnly)
    expect(has('src/shared/export.ts', 'src/shared/project/validate.ts', false)).toBe(true)
    expect(has('src/main/projects.ts', 'src/main/record/parse.ts', false)).toBe(true)
    expect(has('src/renderer/src/LineColours.tsx', 'src/renderer/src/record.ts', false)).toBe(true)
    expect(has('src/shared/layout.ts', 'src/shared/project/types.ts', true)).toBe(true)
    expect(has('src/preload/index.ts', 'src/shared/api.ts', false)).toBe(true)
  })

  it('has nothing under src/renderer/ or src/preload/ importing from src/main/', () => {
    const crossing = edges.filter(
      (e) => under(e.from, 'renderer', 'preload') && under(e.to, 'main'),
    )
    expect(crossing.map(said), crossing.map(said).join('\n')).toEqual([])
  })

  it('has nothing under src/main/ or src/preload/ importing from src/renderer/', () => {
    const crossing = edges.filter(
      (e) => under(e.from, 'main', 'preload') && under(e.to, 'renderer'),
    )
    expect(crossing.map(said), crossing.map(said).join('\n')).toEqual([])
  })

  it('has nothing under src/shared/ importing from src/main/ or src/renderer/', () => {
    const crossing = edges.filter((e) => under(e.from, 'shared') && under(e.to, 'main', 'renderer'))
    expect(crossing.map(said), crossing.map(said).join('\n')).toEqual([])
  })

  it('has no value import cycle among the modules under src/shared/', () => {
    const shared = edges.filter(
      (e) => !e.typeOnly && under(e.from, 'shared') && under(e.to, 'shared'),
    )
    // The record's modules and the export's are among them, and import each
    // other only one way (issue 492).
    expect(shared.some((e) => e.from.startsWith('src/shared/project/'))).toBe(true)
    const cycles = valueCycles(shared)
    expect(cycles, cycles.join('\n')).toEqual([])
  })

  it('has no src/shared/project.ts, and nothing imports it or a barrel in its place', () => {
    // Under src/ and wherever else code imports the record from: the tests
    // and the scripts. A re-export left behind would let every file keep
    // importing everything, which is the boundary this file holds.
    expect(existsSync(join(root, 'src', 'shared', 'project.ts'))).toBe(false)
    expect(existsSync(join(root, 'src', 'shared', 'project', 'index.ts'))).toBe(false)
    const everywhere = [
      ...edges,
      ...walk(join(root, 'tests')).flatMap(edgesOf),
      ...walk(join(root, 'scripts')).flatMap(edgesOf),
    ]
    const old = new Set([
      'src/shared/project',
      'src/shared/project.ts',
      'src/shared/project/index.ts',
      'src/shared/project/index.tsx',
    ])
    const importers = everywhere.filter((e) => old.has(e.to))
    expect(importers.map(said), importers.map(said).join('\n')).toEqual([])
  })
})
