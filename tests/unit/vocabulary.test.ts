// The interface's words are plain English, not the pipeline's (issue 560).
// "fudge", "octilinear" and "collapse" were the engine's words and the
// wireframes', and a person met them in the cells before anything said what
// they meant; LOOM was named in four places before the one that says what
// it is. So every sentence the renderer writes is read here, as
// `no-literals.test.ts` reads its files, and those words are refused in it.
//
// What is read is what a person can be shown: every string literal, every
// template's text and every run of JSX text under `src/renderer/src`, and
// in every module of `src/shared` the renderer imports a value from (and
// what those import in turn), since a sentence written there - a refusal,
// a tool's name - reaches the same screen. TypeScript's own parser finds
// them, so a comment is never read, a string in a type is not text, and a
// word split across lines in JSX is still one run. Identifiers are not text:
// the grid named `octilinear` in the record, or a table keyed by it, is the
// engine's name and stays. What is composed at run time from the engine's
// values - the stage words, the grid's options, the diagnostics' sentences
// - is called and read too, since no literal holds it.
//
// The allowances are exact sentences in named files, or a whole file where
// every sentence in it names a tool, each with its reason, and an allowance
// that no longer matches anything fails, so the list cannot outlive what it
// excuses. The engine's own sentences (a refusal of a tuning's range, an
// inspection's warning) are the engine's to word and are not here: they
// reach the screen as the engine wrote them (DESIGN.md 11). Each test was
// watched failing under its mutation in `vocabulary.mutations.json`.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { caveatsSentence } from '../../src/renderer/src/engine/diagnostics'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'
import { STAGE_WORDS } from '../../src/renderer/src/stages'
import {
  describeTuningField,
  gridOptions,
  RESET_LABEL,
  TUNING_SENTENCE,
  tuningNotice,
  tuningWord,
} from '../../src/renderer/src/tuningRules'
import { TUNING_RESET_SAID } from '../../src/renderer/src/putBackWords'
import { TUNING_KEYS } from '../../src/shared/project/types'

const src = resolve(__dirname, '../../src')
const renderer = join(src, 'renderer', 'src')
const shared = join(src, 'shared')

/** The pipeline's words a cell no longer says, in any case and any form. */
const REFUSED = /\b(fudg\w*|octilinear\w*|collapse)\b/i

/** The layout engine's name, which a cell says once. */
const NAMED = /\bLOOM\b/

interface Allowance {
  /** The file, from `src/`. */
  file: string
  /** The exact text allowed, or null for every text in the file. */
  text: string | null
  why: string
}

/** Where a refused word is not a word a person reads, or is the engine's own and explained. */
const REFUSED_ALLOWED: Allowance[] = [
  {
    file: 'renderer/src/engine/diagnostics.ts',
    text: 'octilinear',
    why: 'the row id of the Octilinearity figure, the engine’s field name, which is never drawn',
  },
  {
    file: 'renderer/src/engine/diagnostics.ts',
    text: 'Octilinearity',
    why: 'the figure the engine prints under that name, explained beside it in plain words',
  },
  {
    file: 'shared/project/types.ts',
    text: 'octilinear',
    why: 'the grid’s name in the record and on the wire, shown only inside the grid option’s bracket',
  },
]

/** Where LOOM is named, and why there. */
const NAMED_ALLOWED: Allowance[] = [
  {
    file: 'renderer/src/tuningRules.ts',
    text: TUNING_SENTENCE,
    why: 'the tuning’s lead: the cells’ one naming, which says what LOOM is, for the grid’s names below it',
  },
  {
    file: 'renderer/src/Settings.tsx',
    text: 'LOOM tools',
    why: 'Settings names the bundled tools as their licences and the first-run check do; it is not a cell',
  },
  {
    file: 'renderer/src/Settings.tsx',
    text: 'LOOM backend',
    why: 'Settings’ versions list, the engine’s report of the tools it runs',
  },
  {
    file: 'renderer/src/Settings.tsx',
    text: 'LOOM commit',
    why: 'Settings’ versions list, the engine’s report of the tools it runs',
  },
  {
    file: 'shared/first-run.ts',
    text: null,
    why: 'the first-run check of the bundled tools, which names the tool that will not run',
  },
  {
    file: 'shared/licences.ts',
    text: null,
    why: 'the licences, which name each component as its licence does',
  },
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

const parse = (path: string): ts.SourceFile =>
  ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

/** The modules a file imports values from, resolved; a type-only import brings no text. */
function valueImports(path: string): string[] {
  const out: string[] = []
  for (const statement of parse(path).statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly === true) continue
    const spec = (statement.moduleSpecifier as ts.StringLiteral).text
    if (!spec.startsWith('.')) continue
    const base = resolve(dirname(path), spec)
    const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find(existsSync)
    if (found !== undefined) out.push(found)
  }
  return out
}

/** Every `src/shared` module the renderer's files import a value from, and what those import. */
function sharedModules(): string[] {
  const seen = new Set<string>()
  const next = walk(renderer).flatMap(valueImports)
  while (next.length > 0) {
    const path = next.pop() as string
    if (!path.startsWith(shared) || seen.has(path)) continue
    seen.add(path)
    next.push(...valueImports(path))
  }
  return [...seen].sort()
}

interface Said {
  file: string
  line: number
  text: string
}

/** Every piece of text a file holds that a screen could show, with where it is. */
function textOf(path: string): Said[] {
  const source = parse(path)
  const file = relative(src, path).replace(/\\/g, '/')
  const said: Said[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      // A module's own path is not text, nor a string in a type, and JSX
      // text is one run however the formatter broke its lines.
      const notText =
        ts.isImportDeclaration(node.parent) ||
        ts.isExportDeclaration(node.parent) ||
        ts.isLiteralTypeNode(node.parent)
      const text = ts.isJsxText(node) ? node.text.replace(/\s+/g, ' ').trim() : node.text
      if (!notText && text !== '') {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        said.push({ file, line, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return said
}

const modules = sharedModules()
const everything = [...walk(renderer), ...modules].flatMap(textOf)

const allowed = (list: Allowance[], said: Said): boolean =>
  list.some((each) => each.file === said.file && (each.text === null || each.text === said.text))

const where = (said: Said): string => `${said.file}:${said.line}: ${said.text}`

describe('the words the renderer writes', () => {
  it('reads the renderer’s files and the shared modules it imports, and finds their text', () => {
    // A walk that found nothing would pass every test below.
    expect(everything.length).toBeGreaterThan(1000)
    expect(modules.map((path) => relative(src, path).replace(/\\/g, '/'))).toEqual(
      expect.arrayContaining([
        'shared/project/validate.ts',
        'shared/first-run.ts',
        'shared/licences.ts',
      ]),
    )
    expect(everything.some((said) => said.text === 'What the layout had to compromise on')).toBe(
      true,
    )
  })

  it('say none of fudge, octilinear or collapse', () => {
    const found = everything.filter(
      (said) => REFUSED.test(said.text) && !allowed(REFUSED_ALLOWED, said),
    )
    expect(found.map(where), found.map(where).join('\n')).toEqual([])
  })

  it('name LOOM only in the tuning’s lead, once, and where the tools are listed', () => {
    const found = everything.filter(
      (said) => NAMED.test(said.text) && !allowed(NAMED_ALLOWED, said),
    )
    expect(found.map(where), found.map(where).join('\n')).toEqual([])
    expect(TUNING_SENTENCE.match(/\bLOOM\b/g), 'the lead names it once').toHaveLength(1)
  })

  it('keep every allowance to a sentence that is still there', () => {
    const lists: [Allowance[], RegExp][] = [
      [REFUSED_ALLOWED, REFUSED],
      [NAMED_ALLOWED, NAMED],
    ]
    for (const [list, word] of lists) {
      for (const each of list) {
        // An exact allowance names a text that is there; a whole file's
        // still holds a text that needs it.
        const there = everything.some(
          (said) =>
            said.file === each.file &&
            (each.text === null ? word.test(said.text) : said.text === each.text),
        )
        expect(there, `${each.file}: "${each.text ?? 'any'}" (${each.why})`).toBe(true)
      }
    }
  })
})

describe('the words composed from the engine’s values', () => {
  const report = (caveats: string[]): RunReport =>
    ({ date: '2026-09-12', caveats, issues: 0.2137 }) as unknown as RunReport

  it('name each stage in a plain word', () => {
    for (const word of Object.values(STAGE_WORDS)) expect(word).not.toMatch(REFUSED)
  })

  it('bracket the grid’s engine word, and say nothing of LOOM in its options', () => {
    for (const { grid, label } of gridOptions()) {
      const outside = label.replace(/\s*\([^)]*\)/g, '')
      expect(outside, label).not.toMatch(REFUSED)
      expect(outside, label).not.toContain(grid)
      expect(label, label).toContain(`(${grid}`)
      expect(label, label).not.toMatch(NAMED)
    }
  })

  it('say the tuning’s defaults, its fields and its notices without naming LOOM', () => {
    const sentences = [
      tuningWord(undefined),
      RESET_LABEL,
      TUNING_RESET_SAID,
      ...TUNING_KEYS.map(describeTuningField),
      tuningNotice({ layout: 'a', tuning: { gridSize: 120 }, laidOutWith: undefined }),
      tuningNotice({ layout: 'a', tuning: undefined, laidOutWith: { gridSize: 120 } }),
    ]
    for (const sentence of sentences) {
      expect(sentence).not.toBeNull()
      expect(sentence, String(sentence)).not.toMatch(NAMED)
      expect(sentence, String(sentence)).not.toMatch(REFUSED)
    }
  })

  it('say what the layout compromised on without fudge', () => {
    for (const caveats of [[], ['one'], ['one', 'two']]) {
      expect(caveatsSentence(report(caveats))).not.toMatch(REFUSED)
    }
  })
})
