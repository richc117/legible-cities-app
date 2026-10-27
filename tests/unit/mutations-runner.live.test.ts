// The mutation job over throwaway repositories, with a real Vitest and real
// signals (spec 038, Part 3). These are the tests that start a Vitest of
// their own per run, wait for a test to be inside it, or kill a process
// group, so they take most of a minute and are a step of their own:
// `npm run test:live`, with its own configuration (vitest.live.config.ts).
// The rules that need none of that are in mutations-runner.test.ts.
//
// POSIX only: they rely on process groups, SIGINT and SIGHUP, which Windows
// does not send or deliver as the job needs; the job's own refusals are
// tested on every platform in the other file.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bites, cleanup, env, ghost, git, job, made, SOURCE, twice, vacuous } from './mutations-lab'

afterEach(cleanup)

const nap = (ms: number) => new Promise((done) => setTimeout(done, ms))

describe.skipIf(process.platform === 'win32')('the job over a repository', () => {
  it('says red for the mutation that bites, and green and refused (twice) for those that do not, and puts every file back', () => {
    const { dir, run } = job([bites, vacuous, ghost, twice])
    const result = run()
    const out = result.stdout
    const verdictOf = (title: string): string =>
      out
        .split('\n')
        .find((line) => line.includes(title) && /\s(red|green|no test|refused)\s/.test(line)) ?? ''
    expect(verdictOf('is not below where equal')).toMatch(/\sred\s/)
    expect(verdictOf('is a test the mutation cannot reach')).toMatch(/\sgreen\s/)
    expect(verdictOf('a ghost title that no test carries')).toMatch(/\srefused\s/)
    expect(result.stderr).toMatch(/#3: refused: no test ran on clean code/)
    expect(out).toMatch(/#4\s.*\srefused\s/)
    expect(out).toContain('4 mutations: 1 red, 1 green, 2 refused - 3 did not go red')
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

  it('refuses an entry whose test is red on clean code, since a mutation proves nothing', () => {
    const red = [
      "import { expect, it } from 'vitest'",
      "it('is red already', () => expect(1).toBe(2))",
      "it('passes', () => expect(1).toBe(1))",
      '',
    ].join('\n')
    const { dir, run } = job(
      [{ ...bites, test: 'tests/unit/red.test.ts', title: 'is red already' }],
      { 'tests/unit/red.test.ts': red },
    )
    const result = run()
    expect(result.stdout).toContain('1 mutations: 1 refused - 1 did not go red')
    expect(result.stderr).toMatch(/mutations\.json#1: refused: the test is red on clean code/)
    expect(result.status).toBe(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  }, 120_000)

  it('says why a test file would not load with the mutation in', () => {
    const { run } = job([{ ...bites, replace: 'a <' }])
    const result = run()
    expect(result.stdout).toMatch(/\sno test\s/)
    expect(result.stderr).toMatch(/no test: the test file did not load with the mutation in: \S/)
  }, 120_000)

  it('ends a mutation that never returns, and the worker it was running in', () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'lc-mutations-test-')), 'pid')
    made.push(dirname(pidFile))
    const spin = `(process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)), (() => { for (;;) {} })(), a < b)`
    const { run } = job([{ ...bites, replace: spin }], {}, { LEGIBLE_MUTATIONS_TIMEOUT_MS: '8000' })
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
    while (alive() && Date.now() < until) spawnSync(process.execPath, ['-e', ''], { timeout: 5000 })
    const survived = pid > 0 && alive()
    if (survived) process.kill(pid, 'SIGKILL')
    expect(result.stdout).toMatch(/\stimed out\s/)
    expect(pid).toBeGreaterThan(0)
    expect(survived).toBe(false)
  }, 60_000)

  // ---- a run that is watched while it goes -------------------------------

  // The slow test says when it has started, so that a signal is sent only
  // once Vitest is inside the run and not when it was merely spawned.
  const slowTest = (marker: string): string =>
    [
      "import { appendFileSync } from 'node:fs'",
      "import { expect, it } from 'vitest'",
      "import { below } from '../../src/a'",
      "it('is slow', async () => {",
      `  appendFileSync(${JSON.stringify(marker)}, 'started\\n')`,
      '  await new Promise((done) => setTimeout(done, 1500))',
      '  expect(below(2, 2)).toBe(false)',
      '})',
      '',
    ].join('\n')
  /** `job` with the slow test in it, and the marker file it writes to. */
  function slowJob(list: unknown[], files: Record<string, string> = {}) {
    const folder = mkdtempSync(join(tmpdir(), 'lc-mutations-test-'))
    made.push(folder)
    const marker = join(folder, 'started')
    return { marker, ...job(list, { 'tests/unit/slow.test.ts': slowTest(marker), ...files }) }
  }
  /** How many times the slow test has started: the baseline's run, then the mutated one. */
  const startedRuns = (marker: string): number =>
    existsSync(marker) ? readFileSync(marker, 'utf8').split('\n').filter(Boolean).length : 0
  const slowEntry = { ...bites, test: 'tests/unit/slow.test.ts', title: 'is slow' }

  /** The script started to run for real, with what it prints and when it ends. */
  function watch(dir: string, marker: string, detached = false) {
    const child = spawn(process.execPath, ['scripts/mutations.mjs'], {
      cwd: dir,
      env: env(),
      detached,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const seen = { stdout: '', stderr: '' }
    child.stdout.on('data', (chunk: Buffer) => (seen.stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (seen.stderr += chunk.toString()))
    const closed = new Promise<number | null>((done) => child.on('close', (code) => done(code)))
    /** Until the slow test has started `n` times: Vitest is inside the n-th run. */
    const inRun = async (n: number): Promise<void> => {
      const until = Date.now() + 60_000
      while (startedRuns(marker) < n && Date.now() < until) await nap(25)
      expect(startedRuns(marker)).toBeGreaterThanOrEqual(n)
    }
    /** Inside the mutated run, and `src/a.ts` holds the mutation. */
    const mutated = async (): Promise<void> => {
      await inRun(2)
      expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).not.toBe(SOURCE)
    }
    return { child, seen, closed, inRun, mutated }
  }

  // [name, the signal, the exit code, whether the signal goes to the script's whole
  // group, as a terminal's does, or to the script alone]
  const signals: [string, NodeJS.Signals, number, boolean][] = [
    ['SIGINT to the script', 'SIGINT', 130, false],
    ['SIGINT to its whole group, as a terminal sends it', 'SIGINT', 130, true],
    ['SIGHUP to the script', 'SIGHUP', 129, false],
  ]
  it('ends what a finished run left spinning in its group', () => {
    const pidFile = join(mkdtempSync(join(tmpdir(), 'lc-mutations-test-')), 'pid')
    made.push(dirname(pidFile))
    const orphan =
      `(() => { const c = process.getBuiltinModule('node:child_process').spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore' }); ` +
      `c.unref(); process.getBuiltinModule('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); return a < b })()`
    const { run } = job([{ ...bites, replace: orphan }])
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
    const until = Date.now() + 3000
    while (pid > 0 && alive() && Date.now() < until) {
      spawnSync(process.execPath, ['-e', ''], { timeout: 5000 })
    }
    const survived = pid > 0 && alive()
    if (survived) process.kill(pid, 'SIGKILL')
    expect(result.stdout).toMatch(/\sgreen\s/)
    expect(pid).toBeGreaterThan(0)
    expect(survived).toBe(false)
  }, 60_000)

  it.each(signals)(
    'stops between entries on %s, with every file put back and a non-zero exit',
    async (_name, signal, exitCode, group) => {
      const { dir, marker } = slowJob([slowEntry, bites])
      const { child, seen, closed, mutated } = watch(dir, marker, group)
      await mutated()
      // In its own group, Vitest does not receive a terminal's SIGINT: it
      // finishes the run it is in, and that run is counted.
      if (group) process.kill(-(child.pid as number), signal)
      else child.kill(signal)
      const code = await closed
      expect(seen.stdout).toMatch(
        new RegExp(
          `STOPPED: ${signal} received; 1 of 2 mutations ran, and every file is as it was`,
        ),
      )
      expect(seen.stdout).toMatch(/is slow\s+red\s/)
      expect(seen.stdout).not.toContain('mutations:')
      expect(code).toBe(exitCode)
      expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
    },
    120_000,
  )

  it('stops, and says so, for a signal that came during the last entry', async () => {
    const { dir, marker } = slowJob([slowEntry])
    const { child, seen, closed, mutated } = watch(dir, marker)
    await mutated()
    child.kill('SIGINT')
    const code = await closed
    expect(seen.stdout).toMatch(/STOPPED: SIGINT received; 1 of 1 mutations ran/)
    expect(code).toBe(130)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  }, 120_000)

  it('stops before writing a mutation when the signal came during its baseline', async () => {
    const { dir, marker } = slowJob([slowEntry])
    const { child, seen, closed, inRun } = watch(dir, marker)
    // Inside the baseline's run, with nothing mutated yet.
    await inRun(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
    child.kill('SIGINT')
    let everMutated = false
    let ended = false
    void closed.then(() => (ended = true))
    const watching = (async () => {
      while (!ended) {
        if (readFileSync(join(dir, 'src/a.ts'), 'utf8') !== SOURCE) everMutated = true
        await nap(20)
      }
    })()
    const code = await closed
    await watching
    expect(seen.stdout).toMatch(/STOPPED: SIGINT received; 0 of 1 mutations ran/)
    expect(everMutated).toBe(false)
    expect(code).toBe(130)
  }, 120_000)

  it('leaves a file as a person saved it during its mutation, names it, and keeps the original', async () => {
    const { dir, marker } = slowJob([slowEntry])
    const { seen, closed, mutated } = watch(dir, marker)
    await mutated()
    writeFileSync(join(dir, 'src/a.ts'), 'export const below = 1 // saved by a person\n')
    const code = await closed
    expect(seen.stdout).toMatch(/STOPPED: src\/a\.ts changed while its mutation was running/)
    expect(code).toBe(1)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(
      'export const below = 1 // saved by a person\n',
    )
    const kept = /the original is kept at (\S+?): /.exec(seen.stdout)?.[1]
    expect(kept).toBeDefined()
    made.push(dirname(kept as string))
    expect(readFileSync(kept as string, 'utf8')).toBe(SOURCE)
  }, 120_000)

  it('refuses an entry whose file was edited between entries, and keeps the edit', async () => {
    const second = { ...bites, file: 'lib/b.ts' }
    const { dir, marker } = slowJob([slowEntry, second], {
      'lib/b.ts': 'export const x = a < b\n',
    })
    const { seen, closed, mutated } = watch(dir, marker)
    await mutated()
    writeFileSync(join(dir, 'lib/b.ts'), 'export const x = a < b\n// my edit\n')
    const code = await closed
    expect(seen.stderr).toMatch(/lib\/b\.ts was edited since the run began/)
    expect(seen.stdout).toMatch(/#2\s.*\srefused\s/)
    expect(code).toBe(1)
    expect(readFileSync(join(dir, 'lib/b.ts'), 'utf8')).toBe('export const x = a < b\n// my edit\n')
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  }, 120_000)

  it("measures with the baseline's own command: a test that needs an earlier one is refused", () => {
    const needy = [
      "import { expect, it } from 'vitest'",
      'let ready = false',
      "it('first', () => { ready = true })",
      "it('second needs the first', () => expect(ready).toBe(true))",
      '',
    ].join('\n')
    const { dir, run } = job(
      [{ ...bites, test: 'tests/unit/needy.test.ts', title: 'second needs the first' }],
      { 'tests/unit/needy.test.ts': needy },
    )
    const result = run()
    expect(result.stdout).toContain('1 mutations: 1 refused - 1 did not go red')
    expect(result.stderr).toMatch(/refused: the test is red on clean code/)
    expect(readFileSync(join(dir, 'src/a.ts'), 'utf8')).toBe(SOURCE)
  }, 120_000)

  it('refuses a verdict when the mutation changed which tests ran', () => {
    const many = [
      "import { it } from 'vitest'",
      "import { count } from '../../src/c'",
      'for (let i = 0; i < count; i++) it(`counted ${i}`, () => {})',
      '',
    ].join('\n')
    const { run } = job(
      [
        {
          file: 'src/c.ts',
          find: 'count = 1',
          replace: 'count = 2',
          test: 'tests/unit/many.test.ts',
          title: 'counted',
          why: 'the number of tests depends on the source',
        },
      ],
      { 'src/c.ts': 'export const count = 1\n', 'tests/unit/many.test.ts': many },
    )
    const result = run()
    expect(result.stdout).toContain('1 mutations: 1 refused - 1 did not go red')
    expect(result.stderr).toMatch(
      /the mutation changed which tests ran \(1 on clean code, 2 mutated\)/,
    )
  }, 120_000)
})
