import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The flaky-test policy's mechanical half (CONTRIBUTING.md, "Flaky tests";
// issue 553). A flaky end-to-end test is quarantined by a tag, not with
// `test.fixme`, because a fixme'd test no longer runs and so is no longer
// measured: the required `e2e` job leaves the tagged tests out and a job
// that is not required runs only them. That works only while each tag names
// the issue it was quarantined for, there are few of them, and the two jobs
// keep the flags that split the suite. None of this launches anything.

const repo = resolve(__dirname, '../..')
const CAP = 3
const TAG = '@quarantine'

interface Found {
  where: string
  problems: string[]
}

/** The `*.spec.ts` files under a folder, in a stable order. */
function specsUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return specsUnder(path)
      return entry.name.endsWith('.spec.ts') ? [path] : []
    })
}

/** The brace pair around an index: the details object of the call it is in. */
function enclosingObject(text: string, at: number): [number, number] | null {
  let depth = 0
  let start = -1
  for (let i = at - 1; i >= 0; i--) {
    if (text[i] === '}') depth++
    else if (text[i] === '{') {
      if (depth === 0) {
        start = i
        break
      }
      depth--
    }
  }
  if (start < 0) return null
  depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return [start, i + 1]
  }
  return null
}

/**
 * Every place a spec under `dir` writes the tag, with what is wrong with it.
 * The tag belongs in a test's details object (`{ tag: '@quarantine',
 * annotation: { type: 'issue', description: '<issue URL>' } }`), which is
 * what ties it to one test and to its issue: in a title there is no place
 * for the annotation, and on a describe it quarantines every test inside.
 * A line that is a comment is not a use of the tag.
 */
function quarantined(dir: string): Found[] {
  const found: Found[] = []
  for (const file of specsUnder(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const hit of text.matchAll(new RegExp(TAG, 'g'))) {
      const at = hit.index
      const lineStart = text.lastIndexOf('\n', at) + 1
      const line = text.slice(
        lineStart,
        text.indexOf('\n', at) < 0 ? undefined : text.indexOf('\n', at),
      )
      const where = `${relative(dir, file).replaceAll('\\', '/')}:${text.slice(0, at).split('\n').length}`
      if (/^\s*(\/\/|\/?\*)/.test(line)) continue
      const problems: string[] = []
      const object = enclosingObject(text, at)
      if (!/\btag:\s*\[?[^\]{}]*$/.test(text.slice(lineStart, at)) || !object) {
        problems.push(`${where}: ${TAG} is not in a test's \`tag\` option`)
      } else {
        const details = text.slice(...object)
        const call = [...text.slice(0, object[0]).matchAll(/\b(?:test|it)((?:\.\w+)*)\s*\(/g)].pop()
        if (call?.[1]?.includes('describe')) {
          problems.push(`${where}: ${TAG} is on a describe, which quarantines every test in it`)
        }
        const issue = /type:\s*['"]issue['"]/.test(details)
        const url =
          /description:\s*['"]https:\/\/github\.com\/[^/\s'"]+\/[^/\s'"]+\/issues\/\d+['"]/
        if (!/\bannotation:/.test(details) || !issue || !url.test(details)) {
          problems.push(
            `${where}: ${TAG} carries no \`annotation: { type: 'issue', description: '<issue URL>' }\``,
          )
        }
      }
      found.push({ where, problems })
    }
  }
  return found
}

/** A job's block of a workflow, from its key to the next job's. */
function job(workflow: string, id: string): string {
  const own = new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  \\S[^\\n]*:\\n|(?![\\s\\S]))`, 'm').exec(
    workflow,
  )
  if (!own) throw new Error(`ci.yml has no job ${id}`)
  return own[1]
}

/** The commands of a job that run the end-to-end suite. */
const suiteRuns = (block: string): string[] =>
  [...block.matchAll(/^\s+run: (npm run test:e2e\b.*)$/gm)].map((m) => m[1].trim())

describe('the scan', () => {
  const fixtures = join(repo, 'tests', 'fixtures', 'quarantine')

  it('accepts a test tagged with the issue it is quarantined for', () => {
    const found = quarantined(join(fixtures, 'annotated'))
    expect(found).toHaveLength(1)
    expect(found.flatMap((f) => f.problems)).toEqual([])
  })

  it('refuses a tag with no issue annotation, or one that is not an issue', () => {
    const found = quarantined(join(fixtures, 'unannotated'))
    expect(found).toHaveLength(2)
    expect(found.map((f) => f.problems.length)).toEqual([1, 1])
    expect(found[0].problems[0]).toContain('carries no `annotation')
  })

  it('refuses the tag in a title and on a describe', () => {
    const found = quarantined(join(fixtures, 'title-form'))
    expect(found.map((f) => f.problems.length)).toEqual([1, 1])
    expect(found[0].problems[0]).toContain('is not in a test')
    expect(found[1].problems[0]).toContain('describe')
  })

  it('counts every tag, so that the cap can bite', () => {
    expect(quarantined(join(fixtures, 'over-cap'))).toHaveLength(CAP + 1)
  })

  it('does not take a comment for a use of the tag', () => {
    // The fixtures' own header comments name the tag.
    expect(quarantined(join(fixtures, 'unannotated')).map((f) => f.where)).toEqual([
      'flaky.spec.ts:5',
      'flaky.spec.ts:9',
    ])
  })
})

describe('the end-to-end tests in quarantine', () => {
  const found = quarantined(join(repo, 'tests', 'e2e'))

  it('each carry the issue they are quarantined for', () => {
    expect(found.flatMap((f) => f.problems)).toEqual([])
  })

  it(`are at most ${CAP}, so that quarantine is not where tests go to be forgotten`, () => {
    expect(found.length).toBeLessThanOrEqual(CAP)
  })
})

describe('ci.yml keeps the quarantine apart from the required suite', () => {
  const ci = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8')

  it('leaves the quarantined tests out of the required e2e job, which cannot be allowed to fail', () => {
    const block = job(ci, 'e2e')
    expect(suiteRuns(block)).toEqual([`npm run test:e2e -- --grep-invert ${TAG}`])
    expect(block).not.toMatch(/^ {4}continue-on-error:/m)
  })

  it('runs only the quarantined tests in a job that passes where there are none, and cannot fail the run', () => {
    const block = job(ci, 'e2e-quarantine')
    expect(suiteRuns(block)).toEqual([`npm run test:e2e -- --grep ${TAG} --pass-with-no-tests`])
    expect(block).toMatch(/^ {4}continue-on-error: true$/m)
    expect(block).toMatch(/^ {4}timeout-minutes: \d+$/m)
  })
})
