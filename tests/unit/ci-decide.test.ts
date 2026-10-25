// The decision step of `e2e (<os>)` (specs/038-test-pyramid, FR-003, R2 and
// R3): which pull requests skip the end-to-end suite and which run it. The
// table is the rule; the last block runs the script itself over a temporary
// repository, because the rule is only as good as the paths git hands it.
// Nothing here talks to GitHub or launches anything.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(__dirname, '../..')
const SCRIPT = join(repo, 'scripts', 'ci-decide.mjs')

interface Entry {
  name: string
  matches(path: string): boolean
}
interface Decision {
  event: string
  changed: string[]
  judged: { path: string; rule: string | null }[]
  run: boolean
  rule: string
}
interface Module {
  DENYLIST: Entry[]
  SKIP_NOTICE: string
  decide(input: { event: string; changed: string[] | null; denylist?: Entry[] }): Decision
  report(decision: Decision): string
}
// A URL built at run time, so the type checker does not look for
// declarations of a plain JavaScript module.
const load = (): Promise<Module> => import(pathToFileURL(SCRIPT).href) as Promise<Module>

describe('the documentation-only rule', () => {
  // [name, event, changed paths, does the suite run]
  const table: [string, string, string[] | null, boolean][] = [
    [
      'every path is documentation',
      'pull_request',
      ['README.md', 'docs/DESIGN.md', 'specs/038-test-pyramid/spec.md'],
      false,
    ],
    [
      'one src file among documentation',
      'pull_request',
      ['docs/DESIGN.md', 'src/main/export.ts', 'README.md'],
      true,
    ],
    ['an empty diff', 'pull_request', [], true],
    ['a new top-level file', 'pull_request', ['docs/DESIGN.md', 'Dockerfile'], true],
    ['a new top-level file alone', 'pull_request', ['Dockerfile'], true],
    [
      '.claude/** only',
      'pull_request',
      ['.claude/settings.json', '.claude/skills/adr/SKILL.md'],
      false,
    ],
    [
      'a hook under .claude/** with a workflow',
      'pull_request',
      ['.claude/hooks/guard-git.sh', '.github/workflows/ci.yml'],
      true,
    ],
    ['a workflow alone', 'pull_request', ['.github/workflows/ci.yml'], true],
    ['a test file', 'pull_request', ['tests/e2e/rail.spec.ts'], true],
    [
      'a markdown file deep in the tree',
      'pull_request',
      ['resources/first-run-gtfs/notes.md'],
      false,
    ],
    ['an upper-case extension is not markdown', 'pull_request', ['NOTES.MD'], true],
    ['the licence', 'pull_request', ['LICENSE', 'CONTRIBUTING.md'], false],
    ['a file named LICENSE below the top', 'pull_request', ['src/LICENSE'], true],
    [
      'a folder that only looks like docs',
      'pull_request',
      ['src/docs/x.ts', 'documents/a.txt'],
      true,
    ],
    ['an issue template', 'pull_request', ['.github/ISSUE_TEMPLATE/bug.yml'], false],
    ['the rest of .github', 'pull_request', ['.github/dependabot.yml'], true],
    ['the lock file', 'pull_request', ['package-lock.json'], true],
    ['a push with documentation only', 'push', ['README.md'], true],
    ['a push with nothing listed', 'push', [], true],
    ['an event the script does not know', 'workflow_dispatch', ['README.md'], true],
    ['paths that could not be listed', 'pull_request', null, true],
  ]

  it.each(table)('%s', async (_name, event, changed, runs) => {
    const { decide } = await load()
    expect(decide({ event, changed }).run).toBe(runs)
  })

  it('names the path that makes the suite run, and the entry that excused each other path', async () => {
    const { decide, report } = await load()
    const decision = decide({
      event: 'pull_request',
      changed: ['docs/DESIGN.md', 'src/main/export.ts'],
    })
    expect(decision.judged).toEqual([
      { path: 'docs/DESIGN.md', rule: '*.md anywhere' },
      { path: 'src/main/export.ts', rule: null },
    ])
    const text = report(decision)
    expect(text).toContain('src/main/export.ts  ->  not on the documentation list')
    expect(text).toContain('rule: src/main/export.ts is on no documentation entry')
    expect(text).toContain('ran: true')
    expect(text).not.toContain('::notice')
  })

  it('prints the notice, the paths and the verdict when it skips', async () => {
    const { decide, report, SKIP_NOTICE } = await load()
    const text = report(decide({ event: 'pull_request', changed: ['README.md'] }))
    expect(SKIP_NOTICE).toBe('documentation only; the end-to-end suite did not run')
    expect(text).toContain('README.md  ->  *.md anywhere')
    expect(text).toContain('docsOnly: true')
    expect(text).toContain('ran: false')
    expect(text).toContain(`::notice title=e2e::${SKIP_NOTICE}`)
  })

  // One path that only its own entry excuses, per entry. Taking the entry
  // away must turn the pull request into one that runs: otherwise the entry
  // is dead, or another entry is hiding it. The widest entry, `*.md`, is the
  // first row.
  const onlyThisEntry: Record<string, string> = {
    '*.md anywhere': 'notes/README.md',
    'docs/**': 'docs/diagram.svg',
    'specs/**': 'specs/038-test-pyramid/data.json',
    '.github/ISSUE_TEMPLATE/**': '.github/ISSUE_TEMPLATE/bug.yml',
    LICENSE: 'LICENSE',
    '.claude/**': '.claude/settings.json',
  }

  it('has a row for every entry of the list, and no other', async () => {
    const { DENYLIST } = await load()
    expect(DENYLIST.map((entry) => entry.name)).toEqual(Object.keys(onlyThisEntry))
  })

  it.each(Object.entries(onlyThisEntry))(
    'without %s, %s makes the suite run',
    async (name, path) => {
      const { DENYLIST, decide } = await load()
      const input = { event: 'pull_request', changed: [path] }
      const matching = DENYLIST.filter((entry) => entry.matches(path))
      expect(matching.map((entry) => entry.name)).toEqual([name])
      expect(decide(input).run).toBe(false)
      const without = DENYLIST.filter((entry) => entry.name !== name)
      const decision = decide({ ...input, denylist: without })
      expect(decision.run).toBe(true)
      expect(decision.rule).toContain(`${path} is on no documentation entry`)
    },
  )
})

describe('the script over a repository', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function git(cwd: string, ...args: string[]): string {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000 })
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
    return result.stdout.trim()
  }

  /** A repository with a base commit holding `files`, and a way to commit more. */
  function repository(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'lc-ci-decide-test-'))
    made.push(root)
    const dir = join(root, 'work')
    const hooks = join(root, 'no-hooks')
    mkdirSync(dir)
    mkdirSync(hooks)
    git(dir, 'init', '--quiet', '--initial-branch=main')
    git(dir, 'config', 'user.name', 'Test')
    git(dir, 'config', 'user.email', 'test@example.invalid')
    git(dir, 'config', 'commit.gpgsign', 'false')
    git(dir, 'config', 'core.hooksPath', hooks)
    const put = (name: string, content: string): void => {
      mkdirSync(dirname(join(dir, name)), { recursive: true })
      writeFileSync(join(dir, name), content)
    }
    for (const [name, content] of Object.entries(files)) put(name, content)
    git(dir, 'add', '-A')
    git(dir, 'commit', '--quiet', '-m', 'base')
    const base = git(dir, 'rev-parse', 'HEAD')
    return {
      dir,
      base,
      put,
      commit(): string {
        git(dir, 'add', '-A')
        git(dir, 'commit', '--quiet', '-m', 'change')
        return git(dir, 'rev-parse', 'HEAD')
      },
    }
  }

  function run(dir: string, args: string[]) {
    const output = join(dirname(dir), 'github-output')
    writeFileSync(output, '')
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, GITHUB_OUTPUT: output },
    })
    return { status: result.status, stdout: result.stdout, output: readFileSync(output, 'utf8') }
  }

  const BASE = { 'README.md': 'a\n', 'src/a.ts': 'export {}\n', 'docs/x.md': 'x\n' }

  it('skips a pull request that changes only documentation, and says so', () => {
    const r = repository(BASE)
    r.put('README.md', 'b\n')
    r.put('docs/new.md', 'n\n')
    const head = r.commit()
    const out = run(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head])
    expect(out.status).toBe(0)
    expect(out.output).toBe('run=false\n')
    expect(out.stdout).toContain('README.md  ->  *.md anywhere')
    expect(out.stdout).toContain('docs/new.md')
    expect(out.stdout).toContain(
      '::notice title=e2e::documentation only; the end-to-end suite did not run',
    )
  })

  it('runs for one source file among documentation', () => {
    const r = repository(BASE)
    r.put('README.md', 'b\n')
    r.put('src/a.ts', 'export const a = 1\n')
    const head = r.commit()
    const out = run(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head])
    expect(out.output).toBe('run=true\n')
    expect(out.stdout).toContain('src/a.ts  ->  not on the documentation list')
  })

  it('runs for an empty diff', () => {
    const r = repository(BASE)
    const out = run(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', r.base])
    expect(out.output).toBe('run=true\n')
    expect(out.stdout).toContain('no changed paths')
  })

  it('lists both names of a moved file, so a source moved into docs/ still runs', () => {
    const r = repository(BASE)
    git(r.dir, 'mv', 'src/a.ts', 'docs/a.md')
    const head = r.commit()
    const out = run(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head])
    expect(out.output).toBe('run=true\n')
    expect(out.stdout).toContain('src/a.ts  ->  not on the documentation list')
    expect(out.stdout).toContain('docs/a.md  ->  *.md anywhere')
  })

  it('reads a path with spaces and quotes whole', () => {
    const r = repository(BASE)
    r.put('docs/a "quoted" name.png', 'p\n')
    const head = r.commit()
    const out = run(r.dir, ['--event', 'pull_request', '--base', r.base, '--head', head])
    expect(out.output).toBe('run=false\n')
    expect(out.stdout).toContain('docs/a "quoted" name.png  ->  docs/**')
  })

  it('runs, with a warning, when git cannot list the paths', () => {
    const r = repository(BASE)
    const missing = 'f'.repeat(40)
    const out = run(r.dir, ['--event', 'pull_request', '--base', missing, '--head', r.base])
    expect(out.status).toBe(0)
    expect(out.output).toBe('run=true\n')
    expect(out.stdout).toContain('::warning::')
  })

  it('runs for a push without asking git anything', () => {
    const r = repository(BASE)
    const out = run(r.dir, ['--event', 'push'])
    expect(out.output).toBe('run=true\n')
    expect(out.stdout).toContain('push: the suite always runs')
  })
})
