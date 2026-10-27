import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// docs/accessibility.md claims WCAG 2.2 AA, which means every A and AA
// criterion, including the six that 2.2 added (issue 550). It also said "not
// yet run" of checks that CI runs, which misleads the person deciding what to
// walk. This test reads the record, as adr-index.test.ts reads the ADR index,
// and holds three things:
//
// 1. the section "WCAG 2.2: the criteria it added" has one row for each of the
//    six, each with a status, the evidence and the issue or pull request;
//    a `pass` carries no limit in brackets (that is a `partial`); and the
//    files and tests the evidence names are real: a file at a path from the
//    root, a test by a title that is a `test(`, `it(` or `describe(` in it;
// 2. no row of a screen's table says, in a machine column (keyboard, labels,
//    focus, motion, contrast), that a spec has not run. CI runs every spec in
//    tests/e2e/ (ci.yml, `e2e`), so such a cell is wrong the day the spec
//    exists. The reader columns are the last two of the nine and are judged
//    by position: they are a person's, and no spec answers them;
// 3. every spec a table row names exists, so a renamed spec cannot take its
//    row out of the rule above by no longer being found.

const root = join(__dirname, '..', '..')
const record = readFileSync(join(root, 'docs', 'accessibility.md'), 'utf8')
const lines = record.split('\n')

/** The criteria WCAG 2.2 added at level A or AA. */
const CRITERIA = ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8'] as const

/**
 * What a status is, exactly: `pass` alone, or `partial (the limit)`,
 * `not applicable (why)` or `finding <what>`. Nothing else, so "pass, but" and
 * "pass; with a limit" are refused: a limit is what *partial* is for.
 */
const STATUS = /^(?:pass|partial \(.+\)|not applicable \(.+\)|finding .+)$/

const HEADING = '## WCAG 2.2: the criteria it added'

/** The table cells of one row, without the outer bars. No cell holds a `|`. */
const cellsOf = (row: string): string[] =>
  row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())

/** A screen's table has nine columns: the part, four machine checks, two contrasts and two readers. */
const COLUMNS = 9
/** The machine columns of such a row: Keyboard to Contrast (Parchment). The last two are the readers'. */
const machineCells = (row: string): string[] => cellsOf(row).slice(1, COLUMNS - 2)

/** What a machine cell may not say of a spec that is in the repository. */
const SPEC_HAS_NOT_RUN = /not yet run|written,? (?:but )?not (?:yet )?run|has not run|not run yet/i

/** A spec named in backticks, bare or by its path, `.spec.ts` or `.spec.tsx`. */
const SPEC_NAMED = /`((?:[\w./-]+\/)?[\w-]+\.spec\.tsx?)`/g

/** The lines of the section, from its heading to the next second-level one. */
function section(): string[] {
  const start = lines.indexOf(HEADING)
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return end === -1 ? rest : rest.slice(0, end)
}

/**
 * Where a file the record names lives. A path from the root is placed as it
 * is; a bare spec is under tests/e2e/ (or tests/acceptance/) and a bare unit
 * test under tests/unit/. Any other bare name is not placed, and the caller
 * fails on it rather than skipping it.
 */
function placed(name: string): string | null {
  if (name.includes('/')) return join(root, name)
  if (/\.spec\.tsx?$/.test(name)) {
    const e2e = join(root, 'tests', 'e2e', name)
    return existsSync(e2e) ? e2e : join(root, 'tests', 'acceptance', name)
  }
  if (/\.test\.tsx?$/.test(name)) return join(root, 'tests', 'unit', name)
  return null
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Is `title` the title of a live `test(`, `it(` or `describe(` in `source`?
 * The call opens its line, so a comment that quotes one is not a test; only
 * `.only`, `.serial` and `.parallel` may follow the keyword, so a `.skip`,
 * `.fixme` or `.todo` is not a test that runs.
 */
function isATitle(source: string, title: string): boolean {
  return new RegExp(
    String.raw`^[ \t]*(?:test\.describe|test|it|describe)(?:\.(?:only|serial|parallel))?\(\s*(['"` +
      '`' +
      String.raw`])${escaped(title)}\1`,
    'm',
  ).test(source)
}

describe('the accessibility record maps WCAG 2.2', () => {
  const rows = section().filter((line) => line.startsWith('| '))
  const byCriterion = new Map(rows.map((row) => [cellsOf(row)[0]?.split(/\s/)[0], row]))

  it('reads the section and its table', () => {
    expect(
      section().length,
      `"${HEADING}" is a second-level heading of the record`,
    ).toBeGreaterThan(0)
    // The header row and a row for each criterion.
    expect(rows.length).toBeGreaterThanOrEqual(CRITERIA.length + 1)
  })

  for (const id of CRITERIA) {
    describe(`SC ${id}`, () => {
      const row = byCriterion.get(id)

      it('has a row', () => {
        expect(row, `the section has a row that begins with ${id}`).toBeDefined()
      })

      it('gives a status, the evidence, and the issue or pull request', () => {
        if (row === undefined) return expect.fail(`no row for ${id}`)
        const cells = cellsOf(row)
        expect(cells.length, `${id}: criterion, status, evidence, issue or pull request`).toBe(4)
        const [, status, evidence, ref] = cells as [string, string, string, string]
        expect(
          STATUS.test(status),
          `${id}: the status is "pass", "partial (…)", "not applicable (…)" or "finding …"; it reads "${status}"`,
        ).toBe(true)
        expect(evidence.length, `${id}: the evidence is not empty`).toBeGreaterThan(20)
        expect(
          /(#\d+|\bissues? \d+|\bpull request \d+)/i.test(ref),
          `${id}: names an issue or a pull request; it reads "${ref}"`,
        ).toBe(true)
      })

      it('is not a pass that carries a limit', () => {
        if (row === undefined) return expect.fail(`no row for ${id}`)
        const status = cellsOf(row)[1] ?? ''
        // A limit in brackets is what *partial* is for. A pass is met as the
        // evidence says, and the evidence does not say less than it claims.
        if (status.toLowerCase().startsWith('pass'))
          expect(status, `${id}: a pass has no bracketed limit; say partial`).not.toMatch(/[()]/)
      })

      it('names files and tests that exist', () => {
        if (row === undefined) return expect.fail(`no row for ${id}`)
        const evidence = cellsOf(row)[2] ?? ''
        const status = cellsOf(row)[1] ?? ''
        const files = [...evidence.matchAll(/`([\w./-]+\.(?:tsx?|css|md|mjs))`/g)].map((m) => m[1]!)
        if (!status.toLowerCase().startsWith('not applicable'))
          expect(files.length, `${id}: the evidence names at least one file`).toBeGreaterThan(0)
        for (const name of files) {
          const path = placed(name)
          expect(
            path,
            `${id}: ${name} is a path from the root, or a bare spec or unit test; write the path`,
          ).not.toBeNull()
          expect(existsSync(path!), `${id}: ${name} exists`).toBe(true)
        }
        // A test named by its title: `file` ("title"). The title has to be
        // one a `test(`, `it(` or `describe(` in that file opens with, not
        // a sentence a comment happens to quote.
        const titles = [...evidence.matchAll(/`([\w./-]+\.(?:spec|test)\.tsx?)` \("([^"]+)"/g)]
        for (const m of titles) {
          const path = placed(m[1]!)
          expect(path, `${id}: ${m[1]} is placeable`).not.toBeNull()
          const source = existsSync(path!) ? readFileSync(path!, 'utf8') : ''
          expect(
            isATitle(source, m[2]!),
            `${id}: ${m[1]} has a test(), it() or describe() titled "${m[2]}"`,
          ).toBe(true)
        }
      })
    })
  }

  it('has no row for a criterion it does not mean to claim, or twice', () => {
    const ids = rows
      .map((row) => cellsOf(row)[0]?.split(/\s/)[0] ?? '')
      .filter((id) => /^\d/.test(id))
    expect([...ids].sort()).toEqual([...CRITERIA].sort())
  })

  it('tells a title from a sentence in a comment', () => {
    const source = "// 'a quoted title' is only said here\ntest('a real title', () => {})\n"
    expect(isATitle(source, 'a real title')).toBe(true)
    expect(isATitle(source, 'a quoted title')).toBe(false)
    expect(isATitle("describe(\n  'split over lines',\n", 'split over lines')).toBe(true)
    expect(isATitle("test('a real title and more', () => {})", 'a real title')).toBe(false)
    // A test that does not run is not a test the record can cite.
    expect(isATitle("test.skip('a skipped title', () => {})", 'a skipped title')).toBe(false)
    expect(isATitle("test.fixme('a title', () => {})", 'a title')).toBe(false)
    expect(isATitle("it.todo('a title')", 'a title')).toBe(false)
    expect(isATitle("  // test('a commented title', () => {})", 'a commented title')).toBe(false)
    expect(isATitle("test.only('an only title', () => {})", 'an only title')).toBe(true)
    expect(isATitle("  test.describe.serial('a suite', () => {})", 'a suite')).toBe(true)
  })

  it('reads a status exactly', () => {
    for (const ok of ['pass', 'partial (a limit)', 'not applicable (no sign-in)', 'finding F7'])
      expect(STATUS.test(ok), ok).toBe(true)
    for (const bad of [
      'pass, with a limit',
      'pass; mostly',
      'pass (limit)',
      'partial',
      'Pass',
      'not applicable',
    ])
      expect(STATUS.test(bad), bad).toBe(false)
  })
})

describe('the record does not say a check CI runs has not run', () => {
  // CI's end-to-end job runs the whole of tests/e2e/ on two systems for every
  // pull request and push to main. The rule below is only as good as that.
  it('rests on CI running every spec under tests/e2e/', () => {
    const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')
    expect(ci).toMatch(/^\s+run: npm run test:e2e\s*$/m)
    const config = readFileSync(join(root, 'playwright.config.ts'), 'utf8')
    expect(config).toMatch(/testDir: 'tests\/e2e'/)
  })

  const tableRows = lines
    .map((line, i) => ({ line, at: i + 1 }))
    .filter((r) => r.line.startsWith('| '))
  // A screen's table is the one whose header row begins "Part": every row of
  // it, up to the first line that is not a table row, is a screen's row.
  const screens: { line: string; at: number }[] = []
  {
    let inScreenTable = false
    lines.forEach((line, i) => {
      if (!line.startsWith('|')) inScreenTable = false
      else if (cellsOf(line)[0] === 'Part') inScreenTable = true
      else if (inScreenTable && line.startsWith('| ')) screens.push({ line, at: i + 1 })
    })
  }

  it('tells the person’s columns from the machine’s by position', () => {
    const row =
      '| A part | swept | not yet run, here | swept | swept | swept | swept | not yet run: a person’s | not yet run: a person’s |'
    expect(machineCells(row)).toEqual([
      'swept',
      'not yet run, here',
      'swept',
      'swept',
      'swept',
      'swept',
    ])
    expect(machineCells(row).some((cell) => SPEC_HAS_NOT_RUN.test(cell))).toBe(true)
    // Whatever the readers' cells say, and whatever words they use, they are
    // not read: not a phrase, a column.
    const readers =
      '| A part | swept | swept | swept | swept | swept | swept | not yet run | written, not run |'
    expect(machineCells(readers).some((cell) => SPEC_HAS_NOT_RUN.test(cell))).toBe(false)
    expect(SPEC_HAS_NOT_RUN.test('driven in `tuning.spec.ts`, written, not yet run')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('driven in `tuning.spec.ts`, written, not run')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('driven in `tuning.spec.ts`, written but not run')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('`tuning.spec.ts` has not run')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('`tuning.spec.ts` is not run yet')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('`tuning.spec.ts` has not run yet')).toBe(true)
    expect(SPEC_HAS_NOT_RUN.test('`tuning.spec.ts` was not run yet')).toBe(true)
    // Where the sweep really does not reach a part, saying so is allowed.
    expect(SPEC_HAS_NOT_RUN.test('not yet swept: drawn only once an opening is chosen')).toBe(false)
  })

  it('reads the screens’ rows', () => {
    expect(screens.length).toBeGreaterThan(60)
    expect(screens.filter((r) => /\.spec\.tsx?`/.test(r.line)).length).toBeGreaterThan(20)
  })

  it('has nine cells in every row of a screen’s table, and none is skipped', () => {
    const odd = screens
      .filter((r) => cellsOf(r.line).length !== COLUMNS)
      .map((r) => `line ${r.at}: ${cellsOf(r.line).length} cells (${cellsOf(r.line)[0]})`)
    expect(
      odd,
      `a row with a stray bar or a missing cell hides its columns from the rules here`,
    ).toEqual([])
  })

  it('names, in every table row, only specs that exist', () => {
    const missing: string[] = []
    for (const { line, at } of tableRows)
      for (const m of line.matchAll(SPEC_NAMED)) {
        const path = placed(m[1]!)
        if (path === null || !existsSync(path)) missing.push(`line ${at}: ${m[1]}`)
      }
    expect(missing, 'specs a row names that are not under tests/').toEqual([])
  })

  it('says of no spec that exists, in a machine column, that it has not run', () => {
    const stale: string[] = []
    for (const { line, at } of screens) {
      const specs = [...line.matchAll(SPEC_NAMED)].map((m) => m[1]!)
      if (!specs.some((name) => existsSync(placed(name) ?? ''))) continue
      cellsOf(line)
        .slice(1, COLUMNS - 2)
        .forEach((cell, i) => {
          const found = cell.match(new RegExp(SPEC_HAS_NOT_RUN.source, 'gi'))
          if (found !== null)
            stale.push(
              `line ${at} (${cellsOf(line)[0]!.slice(0, 50)}), column ${i + 2}: ${found.join(', ')}`,
            )
        })
    }
    expect(stale, 'cells that say a spec has not run when it exists and CI runs it').toEqual([])
  })
})
