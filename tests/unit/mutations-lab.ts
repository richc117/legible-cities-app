// What the mutation job's two test files share: a throwaway git repository
// that carries the script, a way to run it, and the fixtures (not a test:
// the name has no `.test.`). Everything here is cleaned up by `cleanup()`,
// which each file calls after each test.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const repo = resolve(__dirname, '../..')
export const SCRIPT = join(repo, 'scripts', 'mutations.mjs')

// A temporary directory per test, removed after.
export const made: string[] = []
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
}

/**
 * The environment of every git this file starts, and of the script: whatever
 * git exports to a hook (GIT_DIR, GIT_INDEX_FILE) is dropped, or the
 * throwaway repository would be the real one. The ceiling stops git looking
 * above the temporary folder.
 */
export function env(): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (!name.startsWith('GIT_')) kept[name] = value
  }
  return { ...kept, GIT_CEILING_DIRECTORIES: tmpdir() }
}

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 30_000, env: env() })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** A repository with a base commit holding `files`. */
export function repository(files: Record<string, string>): {
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

export const SOURCE = 'export const below = (a: number, b: number): boolean => a < b\n'
export const TEST = [
  "import { expect, it } from 'vitest'",
  "import { below } from '../../src/a'",
  "it('is below where lower', () => expect(below(1, 2)).toBe(true))",
  "it('is not below where equal', () => expect(below(2, 2)).toBe(false))",
  "it('is a test the mutation cannot reach', () => expect(1 + 1).toBe(2))",
  '// a ghost title that no test carries',
  '',
].join('\n')
export const bites = {
  file: 'src/a.ts',
  find: 'a < b',
  replace: 'a <= b',
  test: 'tests/unit/a.test.ts',
  title: 'is not below where equal',
  why: 'the comparison widened',
}
export const vacuous = { ...bites, title: 'is a test the mutation cannot reach' }
export const ghost = { ...bites, title: 'a ghost title that no test carries' }
export const twice = { ...bites, find: 'a' }

/**
 * A throwaway repository holding the fixtures above and `files`, the script
 * copied in, and this repository's Vitest reached through a link; neither
 * the script nor the link is committed. `run` starts the script and waits.
 */
export function job(list: unknown[], files: Record<string, string> = {}, extraEnv = {}) {
  const { dir, put } = repository({
    'src/a.ts': SOURCE,
    'tests/unit/a.test.ts': TEST,
    'tests/unit/a.mutations.json': JSON.stringify(list),
    ...files,
  })
  mkdirSync(join(dir, 'scripts'))
  copyFileSync(SCRIPT, join(dir, 'scripts', 'mutations.mjs'))
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'), 'junction')
  writeFileSync(join(dir, '.git', 'info', 'exclude'), '/scripts/\n/node_modules\n', { flag: 'a' })
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['scripts/mutations.mjs', ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 170_000,
      env: { ...env(), ...extraEnv },
    })
  return { dir, put, run }
}

export { dirname }
