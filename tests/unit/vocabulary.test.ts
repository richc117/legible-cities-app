// The interface's words are plain English, not the pipeline's (issue 560).
// "fudge", "octilinear" and "collapse" were the engine's words and the
// wireframes', and a person met them in the cells before anything said what
// they meant; LOOM was named in four places before the one that says what
// it is. So every sentence the renderer writes is read here, as
// `no-literals.test.ts` reads its files, and those words are refused in it.
//
// What is read is what a person can be shown: every string literal, every
// template's text and every run of JSX text under `src/renderer/src`, found
// by TypeScript's own parser, so a comment is never read and a word split
// across lines in JSX is still one run. Identifiers are not text: the grid
// named `octilinear` in the record, or a table keyed by it, is the engine's
// name and stays. What is composed at run time from the engine's values -
// the stage words, the grid's options, the diagnostics' sentences - is
// called and read too, since no literal holds it.
//
// The allowances are exact sentences in named files, each with its reason,
// and an allowance that no longer matches anything fails, so the list
// cannot outlive what it excuses. The engine's own sentences (a refusal of
// a tuning's range, an inspection's warning) are the engine's to word and
// are not here: they reach the screen as the engine wrote them (DESIGN.md
// 11). Each test was watched failing under its mutation in
// `vocabulary.mutations.json`.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
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

const root = resolve(__dirname, '../../src/renderer/src')

/** The pipeline's words a cell no longer says, in any case. */
const REFUSED = /\b(fudge|octilinear|collapse)\b/i

/** The layout engine's name, which a cell says once. */
const NAMED = /\bLOOM\b/

interface Allowance {
  file: string
  text: string
  why: string
}

/** Where a refused word is not a word a person reads. */
const REFUSED_ALLOWED: Allowance[] = [
  {
    file: 'engine/diagnostics.ts',
    text: 'octilinear',
    why: 'the row id of the Octilinearity figure, the engine’s field name, which is never drawn',
  },
]

/** Where LOOM is named, and why there. */
const NAMED_ALLOWED: Allowance[] = [
  {
    file: 'tuningRules.ts',
    text: TUNING_SENTENCE,
    why: 'the tuning’s lead: the cells’ one naming, which says what LOOM is, for the grid’s names below it',
  },
  {
    file: 'notebook/EngineLog.tsx',
    text: 'This run logged nothing: it ended before any stage finished, and no LOOM tool had anything to report.',
    why: 'the engine’s log is where the tools’ own words belong, and it prints theirs',
  },
  {
    file: 'Settings.tsx',
    text: 'LOOM tools',
    why: 'Settings names the bundled tools as their licences and the first-run check do; it is not a cell',
  },
  {
    file: 'Settings.tsx',
    text: 'LOOM backend',
    why: 'Settings’ versions list, the engine’s report of the tools it runs',
  },
  {
    file: 'Settings.tsx',
    text: 'LOOM commit',
    why: 'Settings’ versions list, the engine’s report of the tools it runs',
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

interface Said {
  file: string
  line: number
  text: string
}

/** Every piece of text a file holds that a screen could show, with where it is. */
function textOf(path: string): Said[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const file = relative(root, path).replace(/\\/g, '/')
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
      // A module's own path is not text, and JSX text is one run however
      // the formatter broke its lines.
      const isModule = ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)
      const text = ts.isJsxText(node) ? node.text.replace(/\s+/g, ' ').trim() : node.text
      if (!isModule && text !== '') {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        said.push({ file, line, text })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return said
}

const everything = walk(root).flatMap(textOf)

const allowed = (list: Allowance[], said: Said): boolean =>
  list.some((each) => each.file === said.file && each.text === said.text)

const where = (said: Said): string => `${said.file}:${said.line}: ${said.text}`

describe('the words the renderer writes', () => {
  it('reads the renderer’s files, and finds their text', () => {
    // A walk that found nothing would pass every test below.
    expect(everything.length).toBeGreaterThan(1000)
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
    for (const each of [...REFUSED_ALLOWED, ...NAMED_ALLOWED]) {
      expect(
        everything.some((said) => said.file === each.file && said.text === each.text),
        `${each.file}: "${each.text}" (${each.why})`,
      ).toBe(true)
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
