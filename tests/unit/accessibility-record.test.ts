import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// docs/accessibility.md claims WCAG 2.2 AA, which means every A and AA
// criterion, including the six that 2.2 added (issue 550). It also said "not
// yet run" of checks that CI runs, which misleads the person deciding what to
// walk. This test reads the record, as adr-index.test.ts reads the ADR index,
// and holds two things:
//
// 1. the section "WCAG 2.2: the criteria it added" has one row for each of the
//    six, each with a status, the evidence and the issue or pull request, and
//    the files and tests the evidence names exist;
// 2. no row that names a spec under tests/e2e/ says of its automated checks
//    that they are "not yet run", "not yet swept" or "not yet in the sweep".
//    CI runs every spec in that folder (ci.yml, `e2e`), so such a row is
//    wrong the day the spec exists. A person's column ("not yet run: a
//    person's") is a different statement and is left alone: no spec can
//    answer it.

const root = join(__dirname, '..', '..')
const record = readFileSync(join(root, 'docs', 'accessibility.md'), 'utf8')
const lines = record.split('\n')

/** The criteria WCAG 2.2 added at level A or AA. */
const CRITERIA = ['2.4.11', '2.5.7', '2.5.8', '3.2.6', '3.3.7', '3.3.8'] as const

/** The words a row's status may begin with. */
const STATUSES = ['pass', 'partial', 'not applicable', 'finding'] as const

const HEADING = '## WCAG 2.2: the criteria it added'

/** The table cells of one row, without the outer bars. No cell holds a `|`. */
const cellsOf = (row: string): string[] =>
  row
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())

/** The lines of the section, from its heading to the next second-level one. */
function section(): string[] {
  const start = lines.indexOf(HEADING)
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return end === -1 ? rest : rest.slice(0, end)
}

/** Where a file the record names lives; null when the name is not one this test knows how to place. */
function placed(name: string): string | null {
  if (name.includes('/')) return join(root, name)
  if (/\.spec\.tsx?$/.test(name)) return join(root, 'tests', 'e2e', name)
  if (/\.test\.tsx?$/.test(name)) return join(root, 'tests', 'unit', name)
  return null
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
          STATUSES.some((word) => status.toLowerCase().startsWith(word)),
          `${id}: the status begins with one of ${STATUSES.join(', ')}; it reads "${status}"`,
        ).toBe(true)
        expect(evidence.length, `${id}: the evidence is not empty`).toBeGreaterThan(20)
        expect(
          /(#\d+|\bissues? \d+|\bpull request \d+)/i.test(ref),
          `${id}: names an issue or a pull request; it reads "${ref}"`,
        ).toBe(true)
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
          if (path === null) continue
          expect(existsSync(path), `${id}: ${name} exists`).toBe(true)
        }
        // A test named by its title: `file` ("title"). The file has to hold
        // the title, so a rename in the spec is a failure here.
        for (const m of evidence.matchAll(/`([\w./-]+\.(?:spec|test)\.tsx?)` \("([^"]+)"/g)) {
          const path = placed(m[1]!)
          expect(path, `${id}: ${m[1]} is placeable`).not.toBeNull()
          const source = existsSync(path!) ? readFileSync(path!, 'utf8') : ''
          expect(
            source.includes(m[2]!),
            `${id}: ${m[1]} holds a test or suite titled "${m[2]}"`,
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

  /** A person's column, which no spec can answer. */
  const PERSONS = /not yet run: a person[’']s/gi
  const UNRUN = /not yet (?:run|swept|in the sweep)/i

  it('tells the person’s column from an automated one', () => {
    expect(
      UNRUN.test('not yet run: a person’s (this part changed after 0.1.0)'.replace(PERSONS, '')),
    ).toBe(false)
    expect(
      UNRUN.test('driven in `tuning.spec.ts`, written, not yet run; not yet in the sweep'),
    ).toBe(true)
    expect(UNRUN.test('not yet swept: drawn on the default reel'.replace(PERSONS, ''))).toBe(true)
    // A person's column beside an automated one in the same row: only the
    // automated one is left to find.
    expect(
      UNRUN.test('swept | not yet run: a person’s | not yet run: a person’s'.replace(PERSONS, '')),
    ).toBe(false)
    expect(UNRUN.test('not yet run | not yet run: a person’s'.replace(PERSONS, ''))).toBe(true)
  })

  it('finds rows to read', () => {
    const named = lines.filter((line) => line.startsWith('| ') && /\w[\w-]*\.spec\.ts/.test(line))
    expect(named.length).toBeGreaterThan(20)
  })

  it('says it of no row that names a spec which exists', () => {
    const stale: string[] = []
    lines.forEach((line, i) => {
      if (!line.startsWith('| ')) return
      const specs = [...line.matchAll(/`([\w-]+\.spec\.ts)`/g)].map((m) => m[1]!)
      if (!specs.some((name) => existsSync(join(root, 'tests', 'e2e', name)))) return
      const found = line.replace(PERSONS, '').match(new RegExp(UNRUN.source, 'gi'))
      if (found === null) return
      const part = cellsOf(line)[0] ?? ''
      stale.push(
        `line ${i + 1} (${part.slice(0, 60)}): ${found.join(', ')}, naming ${specs.join(', ')}`,
      )
    })
    expect(stale, 'rows that say a check has not run when its spec exists and CI runs it').toEqual(
      [],
    )
  })
})
