// The mutation job's own rules (spec 038, Part 3, FR-008): what makes an
// entry well formed, when a `find` is acceptable, what Vitest's report says
// about a mutation, and when the job refuses to start. A job that cannot
// tell a vacuous test from a biting one, or that mutates over someone's
// edit, is worse than none, so each decision has a row that passes through
// it and a row that would but for one thing.
//
// The last blocks run the script: `--check` over this repository's own
// mutations files, so an entry that has rotted fails `npm test`; and the
// whole job over a throwaway repository with its own tiny test, to see a
// mutation go red, one go green, a title match nothing, a refusal, and the
// file come back byte for byte after each.

import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const POSIX = process.platform !== 'win32'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'mutations.mjs')

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
  restoreFile(repo: string, file: string, original: Buffer): void
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
  it('writes the original bytes, whatever git holds or whether it holds the file at all', async () => {
    const { restoreFile } = await load()
    const dir = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
    made.push(dir)
    const original = Buffer.from('one\r\ntwo \u00e9\n\0three')
    writeFileSync(join(dir, 'f.txt'), 'something mutated')
    restoreFile(dir, 'f.txt', original)
    expect(readFileSync(join(dir, 'f.txt')).equals(original)).toBe(true)
  })

  it('stops, naming the file, where it cannot be written back', async () => {
    const { restoreFile } = await load()
    const dir = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
    made.push(dir)
    mkdirSync(join(dir, 'f.txt'))
    expect(() => restoreFile(dir, 'f.txt', Buffer.from('x'))).toThrow(
      /^f\.txt could not be put back as it was/,
    )
  })
})

// A temporary directory per test, removed after.
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * The environment of every git this file starts, and of the script: whatever
 * git exports to a hook (GIT_DIR, GIT_INDEX_FILE) is dropped, or the
 * throwaway repository would be the real one. The ceiling stops git looking
 * above the temporary folder.
 */
function env(): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('GIT_')) kept[name] = value
  }
  return { ...kept, GIT_CEILING_DIRECTORIES: tmpdir() }
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, env: env() })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** A repository with a base commit holding `files`. */
function repository(files: Record<string, string>): {
  dir: string
  put(n: string, c: string): void
} {
  const root = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
  made.push(root)
  const dir = join(root, 'work')
  const hooks = join(root, 'no-hooks')
  mkdirSync(dir)
  mkdirSync(hooks)
  git(dir, 'init', '--quiet', '--initial-branch=main')
  git(dir, 'config', 'user.name', 'Test')
  git(dir, 'config', 'user.email', 'test@example.invalid')
  git(dir, 'config', 'commit.gpgsign', 'false')
  // Git on Windows would otherwise rewrite line ends on the way in and out.
  git(dir, 'config', 'core.autocrlf', 'false')
  git(dir, 'config', 'core.hooksPath', hooks)
  const put = (name: string, content: string): void => {
    mkdirSync(dirname(join(dir, name)), { recursive: true })
    writeFileSync(join(dir, name), content)
  }
  for (const [name, content] of Object.entries(files)) put(name, content)
  git(dir, 'add', '-A')
  git(dir, 'commit', '--quiet', '-m', 'base')
  return { dir, put }
}

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

describe('the job over a repository', () => {
  const SOURCE = 'export const below = (a: number, b: number): boolean => a < b\n'
  const TEST = [
    "import { expect, it } from 'vitest'",
    "import { below } from '../../src/a'",
    "it('is below where lower', () => expect(below(1, 2)).toBe(true))",
    "it('is not below where equal', () => expect(below(2, 2)).toBe(false))",
    "it('is a test the mutation cannot reach', () => expect(1 + 1).toBe(2))",
    '// a ghost title that no test carries',
    '',
  ].join('\n')
  const bites = {
    file: 'src/a.ts',
    find: 'a < b',
    replace: 'a <= b',
    test: 'tests/unit/a.test.ts',
    title: 'is not below where equal',
    why: 'the comparison widened',
  }
  const vacuous = { ...bites, title: 'is a test the mutation cannot reach' }
  const ghost = { ...bites, title: 'a ghost title that no test carries' }
  const twice = { ...bites, find: 'a' }

  function job(list: unknown[], files: Record<string, string> = {}, extraEnv = {}) {
    const { dir, put } = repository({
      'src/a.ts': SOURCE,
      'tests/unit/a.test.ts': TEST,
      'tests/unit/a.mutations.json': JSON.stringify(list),
      ...files,
    })
    // The script and the repository's own Vitest, which the throwaway
    // repository reaches through a link; neither is committed.
    mkdirSync(join(dir, 'scripts'))
    copyFileSync(SCRIPT, join(dir, 'scripts', 'mutations.mjs'))
    symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'junction')
    appendExclude(dir)
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ['scripts/mutations.mjs', ...args], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 170_000,
        env: { ...env(), ...extraEnv },
      })
    return { dir, put, run }
  }
  function appendExclude(dir: string): void {
    writeFileSync(join(dir, '.git', 'info', 'exclude'), '/scripts/\n/node_modules\n', { flag: 'a' })
  }

  it('says red for the mutation that bites, and green, no test and refused for the three that do not, and puts every file back', () => {
    const { dir, run } = job([bites, vacuous, ghost, twice])
    const result = run()
    const out = result.stdout
    const verdictOf = (title: string): string =>
      out
        .split('\n')
        .find((line) => line.includes(title) && /\s(red|green|no test|refused)\s/.test(line)) ?? ''
    expect(verdictOf('is not below where equal')).toMatch(/\sred\s/)
    expect(verdictOf('is a test the mutation cannot reach')).toMatch(/\sgreen\s/)
    expect(verdictOf('a ghost title that no test carries')).toMatch(/\sno test\s/)
    expect(out).toMatch(/#4\s.*\srefused\s/)
    expect(out).toContain('4 mutations: 1 red, 1 green, 1 no test, 1 refused - 3 did not go red')
    expect(result.status).toBe(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
    expect(git(dir, 'status', '--porcelain', '--', 'src', 'tests')).toBe('')
  }, 180_000)

  it('exits 0 where every entry is red, and --only runs just the one asked for', () => {
    const { run } = job([bites, vacuous])
    const result = run('--only', 'not below')
    expect(result.stdout).toContain('1 mutations: 1 red')
    expect(result.status).toBe(0)
  }, 120_000)

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

  it('refuses every entry of a test that is red on clean code, since a mutation proves nothing', () => {
    const red = [
      "import { expect, it } from 'vitest'",
      "it('is red already', () => expect(1).toBe(2))",
      "it('passes', () => expect(1).toBe(1))",
      '',
    ].join('\n')
    const { dir, run } = job(
      [
        { ...bites, test: 'tests/unit/red.test.ts', title: 'is red already' },
        { ...bites, test: 'tests/unit/red.test.ts', title: 'passes' },
      ],
      { 'tests/unit/red.test.ts': red },
    )
    const result = run()
    expect(result.stdout).toContain('2 mutations: 2 refused - 2 did not go red')
    expect(result.stderr).toMatch(/mutations\.json#1: refused: the test is red on clean code/)
    expect(result.status).toBe(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  }, 120_000)

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

  it('says why a test file would not load with the mutation in', () => {
    const { run } = job([{ ...bites, replace: 'a <' }])
    const result = run()
    expect(result.stdout).toMatch(/\sno test\s/)
    expect(result.stderr).toMatch(/no test: the test file did not load with the mutation in: \S/)
  }, 120_000)

  it.skipIf(!POSIX)(
    'ends a mutation that never returns, and the worker it was running in',
    () => {
      const pidFile = join(mkdtempSync(join(tmpdir(), 'lc-mutations-test-')), 'pid')
      made.push(dirname(pidFile))
      const spin = `(process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)), (() => { for (;;) {} })(), a < b)`
      const { run } = job(
        [{ ...bites, replace: spin }],
        {},
        { LEGIBLE_MUTATIONS_TIMEOUT_MS: '8000' },
      )
      const result = run()
      const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0
      const alive = (): boolean => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      // Wait for the kill to land, then make sure nothing is left spinning
      // whatever the answer.
      const until = Date.now() + 3000
      while (alive() && Date.now() < until)
        spawnSync(process.execPath, ['-e', ''], { timeout: 5000 })
      const survived = pid > 0 && alive()
      if (survived) process.kill(pid, 'SIGKILL')
      expect(result.stdout).toMatch(/\stimed out\s/)
      expect(pid).toBeGreaterThan(0)
      expect(survived).toBe(false)
    },
    60_000,
  )

  it.skipIf(!POSIX)(
    'stops between entries on SIGINT, with every file put back and a non-zero exit',
    async () => {
      const slow = [
        "import { expect, it } from 'vitest'",
        "import { below } from '../../src/a'",
        "it('is slow', async () => {",
        '  await new Promise((done) => setTimeout(done, 2500))',
        '  expect(below(2, 2)).toBe(false)',
        '})',
        '',
      ].join('\n')
      const { dir } = job(
        [{ ...bites, test: 'tests/unit/slow.test.ts', title: 'is slow' }, bites],
        {
          'tests/unit/slow.test.ts': slow,
        },
      )
      const child = spawn(process.execPath, ['scripts/mutations.mjs'], {
        cwd: dir,
        env: env(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stdout = ''
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      const closed = new Promise<number | null>((done) => child.on('close', (code) => done(code)))
      // Wait until the first mutation is in the file, then interrupt.
      const until = Date.now() + 60_000
      while (readFileSync(join(dir, 'src/a.ts'), 'utf8') === SOURCE && Date.now() < until) {
        await new Promise((done) => setTimeout(done, 25))
      }
      expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).not.toBe(SOURCE)
      child.kill('SIGINT')
      const code = await closed
      expect(stdout).toMatch(
        /STOPPED: SIGINT received; 1 of 2 mutations ran, and every file is as it was/,
      )
      expect(stdout).not.toContain('mutations:')
      expect(code).toBe(130)
      expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
    },
    120_000,
  )
})
