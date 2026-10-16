import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECORD_VERSION } from '../../src/shared/project'

// docs/ARCHITECTURE.md used to state counts that the code outgrew: fourteen
// bridge methods when there were seventeen, `version: 1` when the record was
// at 2, three stylesheets when ten are loaded (issue 431). Where a number
// reads honestly as a pointer at the code the document no longer states it;
// where it must state one (the record's version) this holds it to the code.

const root = join(__dirname, '..', '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf8')
const architecture = read('docs/ARCHITECTURE.md')

describe('docs/ARCHITECTURE.md against the code', () => {
  it('names the record version the code has, wherever it names one', () => {
    const stated = [
      ...architecture.matchAll(/RECORD_VERSION` is (\d+)/g),
      ...architecture.matchAll(/`version: (\d+)`/g),
    ].map((m) => Number(m[1]))
    // The document may state no number at all; any it does state is held.
    for (const n of stated) expect(n).toBe(RECORD_VERSION)
  })

  it('does not state a count of the bridge, and its projects table covers the interface', () => {
    // Not a number in front of "methods under `api.projects`": the interface
    // in src/shared/api.ts is the list.
    expect(architecture).not.toMatch(
      /\b(?:\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\w+teen)) methods under `api\.projects`/,
    )
    const api = read('src/shared/api.ts')
    const block = api.slice(api.indexOf('  projects: {'), api.indexOf('  viewer: {'))
    const methods = [...block.matchAll(/^ {4}([a-zA-Z]+)\(/gm)].map((m) => m[1])
    // The shape is read, so a rename that empties it is caught here.
    expect(methods.length).toBeGreaterThan(10)
    // Every channel under projects: is a method of the interface.
    const channels = [...api.matchAll(/^ {2}projects([A-Z][a-zA-Z]+): 'projects:/gm)]
    expect(channels.length).toBe(methods.length)
    // The table describes every one of them: a method named in api.ts is
    // named in the document as `name(`.
    for (const name of methods) expect(architecture, name).toContain('`' + name + '(')
    // The table describes every one of them: a method named in api.ts is
    // named in the document as `name(`.
    for (const name of methods) expect(architecture, name).toContain('`' + name + '(')
  })

  it('does not count the stylesheets, and lists only ones main.tsx loads', () => {
    expect(architecture).not.toMatch(/\b(three|four) stylesheets/i)
    const main = read('src/renderer/src/main.tsx')
    const loaded = [...main.matchAll(/import '\.\/styles\/([\w-]+\.css)'/g)].map((m) => m[1])
    const table = [...architecture.matchAll(/^\| `styles\/([\w-]+\.css)` \|/gm)].map((m) => m[1])
    expect(table.length).toBeGreaterThan(0)
    for (const name of table) expect(loaded).toContain(name)
  })

  it('does not count the kit wrappers or the SCHEMATIC keys', () => {
    expect(architecture).not.toMatch(/\b(three|five) thin wrappers/)
    expect(architecture).not.toMatch(/engine's (four|five) `SCHEMATIC_\*` keys/)
    // What the sentence points at exists.
    expect(readdirSync(join(root, 'src/renderer/src/kit'))).toEqual(
      expect.arrayContaining(['Button.tsx', 'TextInput.tsx', 'Select.tsx']),
    )
    expect(read('src/main/interpreter.ts')).toContain('function engineEnvironment')
  })
})
