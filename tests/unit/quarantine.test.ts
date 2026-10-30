import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

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
// Playwright builds the regexp of `--grep` and `--grep-invert` with the `i`
// flag, so `@Quarantine` is the tag to it, and is left out of the required
// suite: the scan and the workflow's first step must see it too.

interface Found {
  where: string
  problems: string[]
}

/**
 * Every file under a folder, in a stable order. Not only the `*.spec.ts`
 * files: Playwright finds a test in `.spec.tsx`, `.test.ts` and the rest of
 * its default pattern, and a tag in a helper there is not one to overlook.
 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? filesUnder(path) : [path]
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
  for (const file of filesUnder(dir)) {
    const text = readFileSync(file, 'utf8')
    for (const hit of text.matchAll(new RegExp(TAG, 'gi'))) {
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
      // From the details object's opening to the tag: the `tag` option's
      // value, which may be an array wrapped over several lines.
      const inTagOption = object && /\btag:\s*\[?[^\]{}:]*$/.test(text.slice(object[0], at))
      if (!inTagOption || !object) {
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

  it('counts the tag in any case, as Playwright matches it', () => {
    const found = quarantined(join(fixtures, 'mixed-case'))
    expect(found).toHaveLength(1)
    expect(found.flatMap((f) => f.problems)).toEqual([])
  })

  it('accepts a tag in an array wrapped over several lines', () => {
    const found = quarantined(join(fixtures, 'wrapped-array'))
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

  it('scans every file under the folder, not only *.spec.ts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quarantine-scan-'))
    try {
      const tagged = "test('a', { tag: '@quarantine' }, async () => {})\n"
      for (const name of ['a.spec.tsx', 'a.test.ts', 'helper.ts'])
        writeFileSync(join(dir, name), tagged)
      expect(quarantined(dir).map((f) => f.where)).toEqual([
        'a.spec.tsx:1',
        'a.test.ts:1',
        'helper.ts:1',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

  it('ends the quarantine job at its first step where nothing is tagged, and gates every later one on it', () => {
    const steps = job(ci, 'e2e-quarantine')
      .split(/^ {6}- /m)
      .slice(1)
    const look = steps.findIndex((step) => /^name: Look for quarantined tests$/m.test(step))
    expect(look).toBeGreaterThan(0)
    // Everything after the step is gated on its answer, the evidence upload
    // too; the checkout before it is not.
    const gate = "steps.look.outputs.tagged == 'true'"
    const ungated = steps.slice(look + 1).filter((step) => !step.includes(gate))
    expect(ungated.map((step) => step.split('\n')[0])).toEqual([])
    // The documentation-only gate stays beside it on the steps that read it.
    const install = steps.find((step) => /^name: Install$/m.test(step))
    expect(install).toContain("steps.decide.outputs.run != 'false'")
  })
})

describe('the quarantine job’s first step', () => {
  const ci = readFileSync(join(repo, '.github', 'workflows', 'ci.yml'), 'utf8')
  const step = job(ci, 'e2e-quarantine')
    .split(/^ {6}- /m)
    .find((s) => /^name: Look for/m.test(s))
  // The step's script, as the runner is handed it: the `run: |` block, dedented.
  const script = /^ {8}run: \|\n((?: {10}.*\n?)+)/m.exec(step ?? '')?.[1].replace(/^ {10}/gm, '')
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  /** What the step writes as its output, over a checkout holding one spec. */
  function answer(spec: string, name = 'a.spec.ts'): string {
    const dir = mkdtempSync(join(tmpdir(), 'quarantine-look-'))
    dirs.push(dir)
    mkdirSync(join(dir, 'tests', 'e2e'), { recursive: true })
    writeFileSync(join(dir, 'tests', 'e2e', name), spec)
    const output = join(dir, 'output')
    writeFileSync(output, '')
    const run = spawnSync('bash', ['-c', script ?? 'exit 99'], {
      cwd: dir,
      env: { ...process.env, GITHUB_OUTPUT: output },
      encoding: 'utf8',
      timeout: 10_000,
    })
    expect(run.status, run.stderr).toBe(0)
    return readFileSync(output, 'utf8').trim()
  }

  // The runners use Git Bash on Windows; the script is tried where bash is
  // the shell the suite already runs on.
  const posix = process.platform === 'win32' ? it.skip : it

  posix('says a test is tagged where a line uses the tag', () => {
    expect(answer("test('a', { tag: '@quarantine' }, async () => {})\n")).toBe('tagged=true')
  })

  posix('says a test is tagged where the tag is in another case, as Playwright matches it', () => {
    expect(answer("test('a', { tag: '@Quarantine' }, async () => {})\n")).toBe('tagged=true')
  })

  posix('looks in every file under tests/e2e, not only in *.spec.ts', () => {
    const tagged = "test('a', { tag: '@quarantine' }, async () => {})\n"
    expect(answer(tagged, 'a.spec.tsx')).toBe('tagged=true')
    expect(answer(tagged, 'a.test.ts')).toBe('tagged=true')
    expect(answer(tagged, 'helper.ts')).toBe('tagged=true')
  })

  posix('says nothing is tagged where no line has the tag', () => {
    expect(answer("test('a', async () => {})\n")).toBe('tagged=false')
  })

  posix('does not take a comment for a use of the tag, as the scan does not', () => {
    const comments =
      "// A test tagged '@quarantine' is left out.\n  /* @quarantine\n   * @quarantine\n   */\n"
    expect(answer(comments)).toBe('tagged=false')
  })
})
