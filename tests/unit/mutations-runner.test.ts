// The mutation job's own rules (spec 038, Part 3, FR-008): what makes an
// entry well formed, when a `find` is acceptable, what Vitest's report says
// about a mutation, and when the job refuses to start. A job that cannot
// tell a vacuous test from a biting one, or that mutates over someone's
// edit, is worse than none, so each decision has a row that passes through
// it and a row that would but for one thing.
//
// The last blocks run the script, never Vitest: `--check` over this
// repository's own mutations files, so an entry that has rotted fails
// `npm test`, and over throwaway repositories; and the refusals the job
// makes before it runs anything. What starts a real Vitest or sends a
// signal is in mutations-runner.live.test.ts, a step of its own
// (`npm run test:live`). This file is meant to take a few seconds.

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bites,
  cleanup,
  env,
  git,
  job,
  made,
  repo,
  repository,
  SCRIPT,
  SOURCE,
} from './mutations-lab'

const POSIX = process.platform !== 'win32'

afterEach(cleanup)

interface Entry {
  file: string
  find: string
  replace: string
  test: string
  title: string
  why: string
}
interface Module {
  validateEntry(entry: unknown): string[]
  occurrences(text: string, needle: string): number
  findProblem(text: string, entry: Entry): string | null
  applyMutation(text: string, entry: Entry): string
  titleIn(testText: string, title: string): boolean
  escapeForPattern(title: string): string
  verdictOf(report: unknown): string
  selected(entry: unknown, source: string, only?: string): boolean
  dirtyTree(repo: string, paths?: string[]): string[]
  dirtyRefusal(lines: string[]): string
  summary(rows: { verdict: string }[]): string
  baselineOf(report: unknown): { clean: boolean; why: string }
  parseArgs(args: string[]): { mode?: string; only?: string; error?: string }
  restoreFile(
    repo: string,
    file: string,
    original: Buffer,
    mutated: Buffer,
    keepIn?: string,
    written?: boolean,
  ): void
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

const entry = (over: Partial<Entry> = {}): Entry => ({
  file: 'src/a.ts',
  find: 'return a < b',
  replace: 'return a <= b',
  test: 'tests/unit/a.test.ts',
  title: 'is below',
  why: 'the comparison widened',
  ...over,
})

describe('an entry', () => {
  it('is well formed with every field a string and the paths inside the repository', async () => {
    const { validateEntry } = await load()
    expect(validateEntry(entry())).toEqual([])
  })

  it('may delete: an empty "replace" is allowed, an empty "find" is not', async () => {
    const { validateEntry } = await load()
    expect(validateEntry(entry({ replace: '' }))).toEqual([])
    expect(validateEntry(entry({ find: '' }))).toEqual(['has an empty "find"'])
  })

  it('names each field that is missing', async () => {
    const { validateEntry } = await load()
    for (const field of ['file', 'find', 'replace', 'test', 'title', 'why']) {
      const broken: Record<string, unknown> = { ...entry() }
      delete broken[field]
      expect(validateEntry(broken), field).toEqual([`has no "${field}"`])
    }
  })

  it('names each field that is not a string, and says what it was', async () => {
    const { validateEntry } = await load()
    expect(validateEntry({ ...entry(), title: 3 })).toEqual([
      'has a "title" that is not a string (it is number)',
    ])
    expect(validateEntry({ ...entry(), why: null })).toEqual([
      'has a "why" that is not a string (it is null)',
    ])
    expect(validateEntry({ ...entry(), find: ['x'] })).toEqual([
      'has a "find" that is not a string (it is an array)',
    ])
  })

  it('is refused for a field the form does not have, and for not being an object', async () => {
    const { validateEntry } = await load()
    expect(validateEntry({ ...entry(), reason: 'x' })).toEqual([
      'has a field "reason" that the form does not have',
    ])
    expect(validateEntry('a string')).toHaveLength(1)
    expect(validateEntry(null)).toHaveLength(1)
    expect(validateEntry([])).toHaveLength(1)
  })

  it('is refused where "replace" is "find": it changes nothing', async () => {
    const { validateEntry } = await load()
    expect(validateEntry(entry({ replace: 'return a < b' }))).toEqual([
      'has a "replace" equal to its "find": it changes nothing',
    ])
  })

  it('is refused for a path that leaves the repository or is not written with forward slashes', async () => {
    const { validateEntry } = await load()
    for (const file of ['../outside.ts', '/etc/hosts', 'C:/Windows/x.ts', 'src/../../x.ts']) {
      expect(validateEntry(entry({ file })), file).toHaveLength(1)
    }
    expect(validateEntry(entry({ test: 'tests\\unit\\a.test.ts' }))).toHaveLength(1)
  })
})

describe('a "find"', () => {
  const text = 'a\nreturn a < b\nb\nreturn c < d\n'

  it('is counted, overlaps included, so that "once" is strict', async () => {
    const { occurrences } = await load()
    expect(occurrences(text, 'return a < b')).toBe(1)
    expect(occurrences(text, 'return')).toBe(2)
    expect(occurrences(text, 'nowhere')).toBe(0)
    expect(occurrences('aaa', 'aa')).toBe(2)
    expect(occurrences(text, '')).toBe(0)
  })

  it('is accepted where it occurs once', async () => {
    const { findProblem } = await load()
    expect(findProblem(text, entry())).toBeNull()
  })

  it('is refused where it occurs twice, with what to do', async () => {
    const { findProblem } = await load()
    expect(findProblem(text, entry({ find: 'return' }))).toBe(
      '"find" occurs 2 times in src/a.ts: lengthen it until it occurs once',
    )
  })

  it('is refused where it does not occur, with what to do', async () => {
    const { findProblem } = await load()
    expect(findProblem(text, entry({ find: 'return z' }))).toMatch(
      /^"find" does not occur in src\/a\.ts: .*copy the text again/,
    )
  })

  it('is replaced as text: "$&" and "$1" in "replace" are not patterns', async () => {
    const { applyMutation } = await load()
    expect(applyMutation(text, entry({ replace: 'x($&)($1)' }))).toBe(
      'a\nx($&)($1)\nb\nreturn c < d\n',
    )
    expect(applyMutation(text, entry({ replace: '' }))).toBe('a\n\nb\nreturn c < d\n')
  })
})

describe('a title', () => {
  it('is found where the test file carries it, and not where it was renamed', async () => {
    const { titleIn } = await load()
    const file = "describe('x', () => {\n  it('is not below where it is the same', () => {})\n})"
    expect(titleIn(file, 'is not below where it is the same')).toBe(true)
    expect(titleIn(file, 'is not below where it is equal')).toBe(false)
  })

  it('reaches Vitest as text: the characters of a pattern are escaped', async () => {
    const { escapeForPattern } = await load()
    const title = 'a (b) [c] d.e + f? $g'
    expect(new RegExp(escapeForPattern(title)).test(title)).toBe(true)
    expect(new RegExp(escapeForPattern(title)).test('a b c d-e f g')).toBe(false)
  })
})

describe('the verdict from the report', () => {
  const report = (numPassedTests: number, numFailedTests: number, extra = {}) => ({
    numTotalTests: numPassedTests + numFailedTests + 30,
    numPassedTests,
    numFailedTests,
    ...extra,
  })

  // [name, the report, the verdict]
  const table: [string, unknown, string][] = [
    ['a test ran and failed', report(0, 1), 'red'],
    ['one passed and one failed', report(1, 1), 'red'],
    ['tests ran and none failed', report(2, 0), 'green'],
    ['nothing ran, though the file holds others (they are in the total)', report(0, 0), 'no test'],
    ['nothing ran and a suite did not load', report(0, 0, { numFailedTestSuites: 1 }), 'no test'],
    ['no report', null, 'error'],
    ['a report without the counts', { numTotalTests: 3 }, 'error'],
    ['counts that are not whole numbers', { numPassedTests: '1', numFailedTests: '0' }, 'error'],
  ]
  it.each(table)('is read from %s', async (_name, input, verdict) => {
    const { verdictOf } = await load()
    expect(verdictOf(input)).toBe(verdict)
  })

  it('counts the run, not the file: a total of many with none run is no test', async () => {
    const { verdictOf } = await load()
    expect(verdictOf({ numTotalTests: 40, numPassedTests: 0, numFailedTests: 0 })).toBe('no test')
  })

  it('has a summary that says how many did not go red', async () => {
    const { summary } = await load()
    expect(summary([{ verdict: 'red' }, { verdict: 'red' }])).toBe('2 mutations: 2 red')
    expect(summary([{ verdict: 'red' }, { verdict: 'green' }, { verdict: 'no test' }])).toBe(
      '3 mutations: 1 red, 1 green, 1 no test - 2 did not go red',
    )
  })
})

describe('--only', () => {
  it('matches a substring of the file, the test, the title or the mutations file', async () => {
    const { selected } = await load()
    const e = entry()
    expect(selected(e, 'tests/unit/a.mutations.json')).toBe(true)
    for (const only of ['src/a.ts', 'a.test.ts', 'is below', 'a.mutations']) {
      expect(selected(e, 'tests/unit/a.mutations.json', only), only).toBe(true)
    }
    expect(selected(e, 'tests/unit/a.mutations.json', 'obscured')).toBe(false)
  })
})

describe('whether a test file can be a baseline', () => {
  const counts = (numPassedTests: unknown, numFailedTests: unknown) => ({
    numPassedTests,
    numFailedTests,
  })
  // [name, the report of the unmutated run, clean, a phrase the reason carries]
  const table: [string, unknown, boolean, RegExp | null][] = [
    ['tests that all passed', counts(3, 0), true, null],
    ['one test that failed among passes', counts(3, 1), false, /red on clean code \(1 failed\)/],
    ['only a failure', counts(0, 2), false, /red on clean code \(2 failed\)/],
    ['nothing run at all', counts(0, 0), false, /no test ran on clean code/],
    ['no report', null, false, /no report/],
    ['counts that are not numbers', counts('3', '0'), false, /no counts/],
  ]
  it.each(table)('is read from %s', async (_name, report, clean, phrase) => {
    const { baselineOf } = await load()
    const found = baselineOf(report)
    expect(found.clean).toBe(clean)
    if (phrase === null) expect(found.why).toBe('')
    else expect(found.why).toMatch(phrase)
  })
})

describe('the command line', () => {
  // [the arguments, the mode, --only, or the phrase of the refusal]
  const table: [string[], string | undefined, string | undefined, RegExp | null][] = [
    [[], 'run', undefined, null],
    [['--check'], 'check', undefined, null],
    [['--only', 'obscured'], 'run', 'obscured', null],
    [['--chek'], undefined, undefined, /unknown arguments "--chek"/],
    [['--only'], undefined, undefined, /--only needs the text/],
    [['--only', ''], undefined, undefined, /--only needs the text/],
    [['--only', '  '], undefined, undefined, /--only needs the text/],
    [['--check', '--only', 'x'], undefined, undefined, /unknown arguments/],
    [['--only', 'x', '--check'], undefined, undefined, /unknown arguments/],
    [['--only', 'x', 'y'], undefined, undefined, /unknown arguments/],
    [['obscured'], undefined, undefined, /unknown arguments/],
  ]
  it.each(table)('reads %j', async (args, mode, only, refusal) => {
    const { parseArgs } = await load()
    const parsed = parseArgs(args)
    if (refusal === null) expect(parsed).toEqual({ mode, only })
    else expect(parsed.error).toMatch(refusal)
  })
})

describe('putting a file back', () => {
  const folder = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
    made.push(dir)
    return dir
  }
  const dirWith = (content: string | Buffer): string => {
    const dir = folder()
    writeFileSync(join(dir, 'f.txt'), content)
    return dir
  }
  const original = Buffer.from('one\r\ntwo \u00e9\n\0three')
  const mutated = Buffer.from('one\r\nMUTATED')

  it('writes the original bytes, whatever git holds or whether it holds the file at all', async () => {
    const { restoreFile } = await load()
    const dir = dirWith(mutated)
    restoreFile(dir, 'f.txt', original, mutated)
    expect(readFileSync(join(dir, 'f.txt')).equals(original)).toBe(true)
  })

  it('is content with a file that is already the original', async () => {
    const { restoreFile } = await load()
    const dir = dirWith(original)
    restoreFile(dir, 'f.txt', original, mutated)
    expect(readFileSync(join(dir, 'f.txt')).equals(original)).toBe(true)
  })

  it('leaves a file as a person saved it, keeps the original, and says so', async () => {
    const { restoreFile } = await load()
    const dir = dirWith('what the person saved\n')
    const keep = folder()
    expect(() => restoreFile(dir, 'f.txt', original, mutated, keep)).toThrow(
      /^f\.txt changed while its mutation was running, so it was left exactly as it is now; the original is kept at /,
    )
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('what the person saved\n')
    const [copy] = readdirSync(keep)
    expect(copy).toMatch(/^original-[0-9a-f]{8}-f\.txt$/)
    expect(readFileSync(join(keep, copy)).equals(original)).toBe(true)
  })

  it('still says the file changed where the copy of the original cannot be made, and where git has it', async () => {
    const { restoreFile } = await load()
    const dir = dirWith('what the person saved\n')
    const missing = join(folder(), 'no', 'such', 'folder')
    let message = ''
    try {
      restoreFile(dir, 'f.txt', original, mutated, missing)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^f\.txt changed while its mutation was running/)
    expect(message).toMatch(/a copy of the original could not be made \(.*\), but git holds it/)
    expect(message).toContain('git show HEAD:f.txt')
    expect(readFileSync(join(dir, 'f.txt'), 'utf8')).toBe('what the person saved\n')
  })

  it('names a copy by a short hash, so a deep path does not make a name too long', async () => {
    const { restoreFile } = await load()
    const deep = `${'a'.repeat(40)}/${'b'.repeat(40)}/${'c'.repeat(40)}/${'d'.repeat(40)}/f.txt`
    const dir = folder()
    mkdirSync(join(dir, dirname(deep)), { recursive: true })
    writeFileSync(join(dir, deep), 'saved')
    const keep = folder()
    expect(() => restoreFile(dir, deep, original, mutated, keep)).toThrow(/is kept at /)
    expect(readdirSync(keep)[0]).toMatch(/^original-[0-9a-f]{8}-f\.txt$/)
  })

  it('writes the original over a half-written mutation: the file is ours where the write did not finish', async () => {
    const { restoreFile } = await load()
    // A full disk leaves the start of the mutation: neither it nor the original.
    const dir = dirWith(mutated.subarray(0, 4))
    restoreFile(dir, 'f.txt', original, mutated, undefined, false)
    expect(readFileSync(join(dir, 'f.txt')).equals(original)).toBe(true)
  })

  it('does not take that file for ours where the write finished: a person saved it', async () => {
    const { restoreFile } = await load()
    const dir = dirWith(mutated.subarray(0, 4))
    expect(() => restoreFile(dir, 'f.txt', original, mutated, undefined, true)).toThrow(
      /^f\.txt changed while/,
    )
    expect(readFileSync(join(dir, 'f.txt')).equals(mutated.subarray(0, 4))).toBe(true)
  })

  it('stops, naming the file, where it is not a file that can be put back', async () => {
    const { restoreFile } = await load()
    const dir = folder()
    mkdirSync(join(dir, 'f.txt'))
    // A directory is neither the mutation nor the original: it was changed.
    expect(() => restoreFile(dir, 'f.txt', original, mutated)).toThrow(/^f\.txt changed while/)
  })

  it('stops, naming the file, where even the original cannot be written', async () => {
    const { restoreFile } = await load()
    const dir = folder()
    mkdirSync(join(dir, 'f.txt'))
    expect(() => restoreFile(dir, 'f.txt', original, mutated, undefined, false)).toThrow(
      /^f\.txt could not be put back as it was/,
    )
  })
})

describe('the dirty-tree refusal', () => {
  it('lets a clean tree through', async () => {
    const { dirtyTree } = await load()
    const { dir } = repository({ 'src/a.ts': 'x\n', 'tests/a.test.ts': 'y\n' })
    expect(dirtyTree(dir)).toEqual([])
  })

  it('names an edited file under src', async () => {
    const { dirtyTree } = await load()
    const { dir, put } = repository({ 'src/a.ts': 'x\n', 'tests/a.test.ts': 'y\n' })
    put('src/a.ts', 'edited\n')
    expect(dirtyTree(dir)).toEqual([' M src/a.ts'])
  })

  it('names an edited file under tests, and a new one nobody has committed', async () => {
    const { dirtyTree } = await load()
    const { dir, put } = repository({ 'src/a.ts': 'x\n', 'tests/a.test.ts': 'y\n' })
    put('tests/a.test.ts', 'edited\n')
    put('tests/unit/new.mutations.json', '[]\n')
    expect(dirtyTree(dir).sort()).toEqual([' M tests/a.test.ts', '?? tests/unit/'])
  })

  it('sees a change outside src and tests only where the path is named, as the job names each file an entry changes', async () => {
    const { dirtyTree } = await load()
    const { dir, put } = repository({ 'src/a.ts': 'x\n', 'lib/b.ts': 'r\n' })
    put('lib/b.ts', 'edited\n')
    expect(dirtyTree(dir)).toEqual([])
    expect(dirtyTree(dir, ['src', 'tests', 'lib/b.ts'])).toEqual([' M lib/b.ts'])
  })

  it('cannot say, and so refuses, where git cannot be run in the folder', async () => {
    const { dirtyTree } = await load()
    const root = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
    made.push(root)
    expect(() => dirtyTree(join(root, 'missing'))).toThrow(
      /git could not say whether the tree is clean/,
    )
  })

  it('says what to do and names what is dirty', async () => {
    const { dirtyRefusal } = await load()
    const text = dirtyRefusal([' M src/a.ts', '?? tests/b.ts'])
    expect(text).toContain('commit or stash these first')
    expect(text).toContain('  M src/a.ts')
    expect(text).toContain('  ?? tests/b.ts')
  })
})

describe("this repository's own mutations files", () => {
  it('are all well formed: every find once, every test and title present (--check)', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--check'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 60_000,
      env: env(),
    })
    expect(result.stdout + result.stderr).toMatch(/entries checked, all well formed/)
    expect(result.status, result.stdout + result.stderr).toBe(0)
  })
})

describe('--check over a repository', () => {
  const SOURCE = 'export const below = (a: number, b: number): boolean => a < b\n'
  const TEST = [
    "import { expect, it } from 'vitest'",
    "import { below } from '../../src/a'",
    "it('is below where lower', () => expect(below(1, 2)).toBe(true))",
    "it('is not below where equal', () => expect(below(2, 2)).toBe(false))",
    '// a ghost title that no test carries',
    '',
  ].join('\n')

  function checkout(list: unknown): {
    dir: string
    run(...args: string[]): ReturnType<typeof spawnSync>
  } {
    const { dir } = repository({
      'src/a.ts': SOURCE,
      'tests/unit/a.test.ts': TEST,
      'tests/unit/a.mutations.json': JSON.stringify(list),
    })
    mkdirSync(join(dir, 'scripts'))
    copyFileSync(SCRIPT, join(dir, 'scripts', 'mutations.mjs'))
    return {
      dir,
      run: (...args) =>
        spawnSync(process.execPath, ['scripts/mutations.mjs', ...args], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 60_000,
          env: env(),
        }),
    }
  }
  const good = {
    file: 'src/a.ts',
    find: 'a < b',
    replace: 'a <= b',
    test: 'tests/unit/a.test.ts',
    title: 'is not below where equal',
    why: 'the comparison widened',
  }

  it('passes an entry that is well formed', () => {
    const { run } = checkout([good])
    const result = run('--check')
    expect(result.stdout).toContain('ok       a.mutations.json#1')
    expect(result.status).toBe(0)
  })

  // [name, the entry, a phrase the refusal carries]
  const refused: [string, object, RegExp][] = [
    ['a find that is not in the file', { ...good, find: 'a > b' }, /"find" does not occur/],
    ['a find that occurs twice', { ...good, find: 'a' }, /"find" occurs \d+ times/],
    ['a title that is not in the test', { ...good, title: 'is above' }, /"title" does not appear/],
    [
      'a test that is not there',
      { ...good, test: 'tests/unit/b.test.ts' },
      /"test" tests\/unit\/b\.test\.ts does not exist/,
    ],
    ['a file that is not there', { ...good, file: 'src/b.ts' }, /"file" src\/b\.ts does not exist/],
    ['a browser test', { ...good, test: 'tests/unit/a.browser.test.tsx' }, /browser test/],
    ['a missing field', { ...good, why: undefined }, /has no "why"/],
  ]
  it.each(refused)('refuses %s', (_name, bad, phrase) => {
    const { run } = checkout([bad])
    const result = run('--check')
    expect(result.stdout).toMatch(phrase)
    expect(result.status).toBe(1)
  })

  it('refuses a mutations file that is not JSON', () => {
    const { dir, run } = checkout([good])
    writeFileSync(join(dir, 'tests/unit/a.mutations.json'), '[{')
    const result = run('--check')
    expect(result.stdout).toMatch(/a\.mutations\.json: not JSON/)
    expect(result.status).toBe(1)
  })

  it('changes nothing', () => {
    const { dir, run } = checkout([good])
    run('--check')
    expect(git(dir, 'status', '--porcelain')).toBe('?? scripts/')
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  })
})

describe('the job refuses before it runs anything', () => {
  it('refuses to start over an edit under src, and leaves the edit alone', () => {
    const { dir, put, run } = job([bites])
    put('src/a.ts', SOURCE + '// my edit\n')
    const result = run()
    expect(result.stdout).toMatch(
      /refused: the tree under src and tests, or a file an entry names, is not clean/,
    )
    expect(result.stdout).toContain(' M src/a.ts')
    expect(result.status).toBe(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE + '// my edit\n')
  })

  it('fails where --only matches no entry: nothing run is not a pass', () => {
    const { run } = job([bites])
    const result = run('--only', 'no such entry')
    expect(result.stdout).toMatch(/nothing was run, and that is a failure/)
    expect(result.status).toBe(1)
  })
  it('refuses a file outside src and tests that has an edit, and the edit survives', () => {
    const own = { ...bites, file: 'lib/b.ts' }
    const { dir, put, run } = job([own], { 'lib/b.ts': 'export const x = a < b\n' })
    put('lib/b.ts', 'export const x = a < b\n// my edit\n')
    const result = run()
    expect(result.stdout).toMatch(/refused: the tree under src and tests, or a file an entry names/)
    expect(result.stdout).toContain(' M lib/b.ts')
    expect(result.status).toBe(1)
    expect(readFileSync(join(dir, 'lib/b.ts'), 'utf8')).toBe('export const x = a < b\n// my edit\n')
  })

  it('refuses a file git does not track, untracked or ignored, and leaves it as it was', () => {
    const { dir, put, run } = job(
      [
        { ...bites, file: 'lib/new.ts' },
        { ...bites, file: 'lib/ignored.ts' },
      ],
      { '.gitignore': 'lib/ignored.ts\n', 'lib/keep.txt': 'k\n' },
    )
    put('lib/new.ts', 'export const x = a < b\n')
    put('lib/ignored.ts', 'export const x = a < b\n')
    const check = run('--check')
    expect(check.stdout.match(/is not tracked by git/g)).toHaveLength(2)
    expect(check.status).toBe(1)
    const result = run()
    expect(result.stdout).toContain('2 mutations: 2 refused - 2 did not go red')
    expect(readFileSync(join(dir, 'lib/new.ts'), 'utf8')).toBe('export const x = a < b\n')
    expect(readFileSync(join(dir, 'lib/ignored.ts'), 'utf8')).toBe('export const x = a < b\n')
  })

  it.skipIf(!POSIX)(
    'refuses a symbolic link, and a path that resolves outside the repository',
    () => {
      const outside = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
      made.push(outside)
      writeFileSync(join(outside, 'x.ts'), 'export const x = a < b\n')
      const { dir, run } = job([
        { ...bites, file: 'lib/link.ts' },
        { ...bites, file: 'linkdir/x.ts' },
      ])
      mkdirSync(join(dir, 'lib'))
      symlinkSync('../src/a.ts', join(dir, 'lib', 'link.ts'))
      symlinkSync(outside, join(dir, 'linkdir'))
      git(dir, 'add', 'lib', 'linkdir')
      git(dir, 'commit', '--quiet', '-m', 'links')
      const check = run('--check')
      expect(check.stdout).toMatch(/"file" lib\/link\.ts is a symbolic link/)
      expect(check.stdout).toMatch(
        /"file" linkdir\/x\.ts resolves to a path outside the repository/,
      )
      expect(check.status).toBe(1)
      const result = run()
      expect(result.stdout).toContain('2 mutations: 2 refused - 2 did not go red')
      expect(readFileSync(join(outside, 'x.ts'), 'utf8')).toBe('export const x = a < b\n')
      expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
    },
  )

  it('does not run the mutations for an argument it does not know, or for --only with nothing after it', () => {
    const { dir, run } = job([bites])
    for (const [args, phrase] of [
      [['--chek'], /unknown arguments "--chek"/],
      [['--only'], /--only needs the text/],
    ] as const) {
      const result = run(...args)
      expect(result.stdout, args.join(' ')).toMatch(phrase)
      expect(result.stdout).not.toContain('mutations:')
      expect(result.status).toBe(2)
    }
    expect(git(dir, 'status', '--porcelain', '--', 'src', 'tests')).toBe('')
  })

  it.skipIf(!POSIX)(
    'takes a path literally: a file called "*.ts" does not name its neighbours',
    () => {
      const { dir, put, run } = job([{ ...bites, file: 'lib/*.ts' }], {
        'lib/other.ts': 'export const x = a < b\n',
      })
      put('lib/*.ts', 'export const x = a < b\n')
      const check = run('--check')
      expect(check.stdout).toMatch(/"file" lib\/\*\.ts is not tracked by git/)
      expect(check.status).toBe(1)
      expect(readFileSync(join(dir, 'lib/*.ts'), 'utf8')).toBe('export const x = a < b\n')
    },
  )
})
