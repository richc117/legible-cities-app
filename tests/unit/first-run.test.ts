// The first-run check of the bundled tools (A6-02, specs/026): which tools
// are judged where, each outcome of each spawn over a stand-in spawner, the
// sentences, the paths taken out of what a person is shown, and a real
// child for the timeout, the output cap and the kill at quit.

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { firstRunTargets, resolveConfig, type Source } from '../../src/main/config'
import {
  ffprobeBeside,
  FirstRunCheck,
  FIXTURE_TABLES,
  lineGraph,
  runProcess,
  summaryLine,
  withoutPaths,
  type FirstRunDeps,
  type Spawner,
  type ToolProcess,
} from '../../src/main/first-run'
import {
  describeCheck,
  failedTools,
  failureSentence,
  needsTelling,
  summarize,
  type FirstRunResult,
} from '../../src/shared/first-run'

const repo = resolve(__dirname, '../..')

// ---------------------------------------------------------------- targets

describe('firstRunTargets', () => {
  const sources = (loom: Source, ffmpeg: Source): Record<string, Source> =>
    ({ SCHEMATIC_LOOM_BIN: loom, SCHEMATIC_FFMPEG: ffmpeg }) as Record<string, Source>
  const config = (
    loomBin: string | null,
    ffmpeg: string | null,
    loom: Source,
    ff: Source,
  ): Parameters<typeof firstRunTargets>[0]['config'] =>
    ({ loomBin, ffmpeg, sources: sources(loom, ff) }) as never

  it('judges a packaged app’s own resources, whether or not the folders are there', () => {
    // A package with no loom/ resolves loomBin to null (the development
    // default); the check still looks where the package should have it.
    const targets = firstRunTargets({
      config: config(null, null, 'default', 'default'),
      packaged: true,
      resourcesPath: join('/app', 'Resources'),
      platform: 'darwin',
    })
    expect(targets.loom).toEqual({
      kind: 'check',
      path: join('/app', 'Resources', 'loom'),
      named: false,
    })
    expect(targets.ffmpeg).toEqual({
      kind: 'check',
      path: join('/app', 'Resources', 'ffmpeg', 'ffmpeg'),
      named: false,
    })
  })

  it('adds .exe to the bundled ffmpeg on Windows', () => {
    const targets = firstRunTargets({
      config: config(null, null, 'bundled', 'bundled'),
      packaged: true,
      resourcesPath: join('C:', 'app', 'resources'),
      platform: 'win32',
    })
    expect(targets.ffmpeg).toMatchObject({
      path: join('C:', 'app', 'resources', 'ffmpeg', 'ffmpeg.exe'),
    })
  })

  it('judges what the environment names in a package, and says a person named it', () => {
    const targets = firstRunTargets({
      config: config('/elsewhere/loom', '/elsewhere/ffmpeg', 'environment', 'bundled'),
      packaged: true,
      resourcesPath: '/r',
      platform: 'linux',
    })
    expect(targets.loom).toEqual({ kind: 'check', path: '/elsewhere/loom', named: true })
    expect(targets.ffmpeg).toEqual({
      kind: 'check',
      path: join('/r', 'ffmpeg', 'ffmpeg'),
      named: false,
    })
  })

  it('checks in development only what the environment or .env.local names', () => {
    const none = firstRunTargets({
      config: config(null, null, 'default', 'default'),
      packaged: false,
      resourcesPath: '/r',
      platform: 'darwin',
    })
    expect(none.loom).toEqual({
      kind: 'skip',
      reason: 'development: SCHEMATIC_LOOM_BIN is not named',
    })
    expect(none.ffmpeg).toEqual({
      kind: 'skip',
      reason: 'development: SCHEMATIC_FFMPEG is not named',
    })

    const one = firstRunTargets({
      config: config('/l', '/f/ffmpeg', '.env.local', 'default'),
      packaged: false,
      resourcesPath: '/r',
      platform: 'darwin',
    })
    expect(one.loom).toEqual({ kind: 'check', path: '/l', named: true })
    expect(one.ffmpeg.kind).toBe('skip')
  })

  it('agrees with resolveConfig: a package with no folders is judged there, an environment name wins', () => {
    const resolved = resolveConfig({
      env: { SCHEMATIC_FFMPEG: '/named/ffmpeg' },
      userData: '/ud',
      desktop: '/desk',
      loomPin: 'pin',
      baseDir: '/base',
      bundled: { resourcesPath: '/r', platform: 'linux', exists: () => false },
    })
    expect(resolved.loomBin).toBeNull()
    const targets = firstRunTargets({
      config: resolved,
      packaged: true,
      resourcesPath: '/r',
      platform: 'linux',
    })
    expect(targets.loom).toEqual({ kind: 'check', path: join('/r', 'loom'), named: false })
    // An absolute value is kept verbatim, a rooted one on Windows too (config.test.ts).
    expect(targets.ffmpeg).toEqual({ kind: 'check', path: '/named/ffmpeg', named: true })
  })
})

// ---------------------------------------------------------------- the fixture

describe('the fixture', () => {
  it('is committed with every table the check asks for, and names one subway route', () => {
    const folder = join(repo, 'resources', 'first-run-gtfs')
    for (const table of FIXTURE_TABLES) {
      expect(readFileSync(join(folder, table), 'utf8').length).toBeGreaterThan(0)
    }
    const routes = readFileSync(join(folder, 'routes.txt'), 'utf8').trim().split('\n')
    expect(routes).toHaveLength(2)
    // route_type 1 is subway, which the check asks gtfs2graph for.
    expect(routes[1].split(',')[4]).toBe('1')
  })

  it('is carried into every package beside the licence', () => {
    const builder = readFileSync(join(repo, 'electron-builder.yml'), 'utf8')
    expect(builder).toMatch(/- from: resources\/first-run-gtfs\n\s+to: first-run-gtfs\n/)
  })
})

// ---------------------------------------------------------------- output

/** What the real gtfs2graph printed over the fixture (research.md), shortened. */
const LINE_GRAPH = JSON.stringify({
  type: 'FeatureCollection',
  properties: {},
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.01, 0],
          [0.02, 0.01],
        ],
      },
      properties: { lines: [{ id: '0x1', label: '1', color: '336699' }] },
    },
  ],
})
const EMPTY_GRAPH =
  '{\n  "type": "FeatureCollection",\n  "properties": {\n  },\n  "features": []\n}'

describe('lineGraph', () => {
  it('passes a collection with a line in it', () => {
    expect(lineGraph(LINE_GRAPH)).toEqual({ ok: true, lines: 1 })
  })
  it('refuses the empty collection gtfs2graph prints, with a zero exit, for a mode with nothing in it', () => {
    expect(lineGraph(EMPTY_GRAPH).ok).toBe(false)
  })
  it('refuses points alone, JSON of another shape, and text', () => {
    const points = JSON.stringify({
      type: 'FeatureCollection',
      features: [{ geometry: { type: 'Point' } }],
    })
    expect(lineGraph(points).ok).toBe(false)
    expect(lineGraph('[]').ok).toBe(false)
    expect(lineGraph('{"type":"Feature"}').ok).toBe(false)
    expect(lineGraph('gtfs2graph (part of LOOM)').ok).toBe(false)
  })
})

describe('ffprobeBeside', () => {
  it('replaces ffmpeg in the file name, as the engine does', () => {
    expect(ffprobeBeside(join('/r', 'ffmpeg', 'ffmpeg'))).toBe(join('/r', 'ffmpeg', 'ffprobe'))
    expect(ffprobeBeside(join('/r', 'ffmpeg', 'ffmpeg.exe'))).toBe(
      join('/r', 'ffmpeg', 'ffprobe.exe'),
    )
    expect(ffprobeBeside(join('/opt', 'ffmpeg-9', 'ffmpeg-9'))).toBe(
      join('/opt', 'ffmpeg-9', 'ffprobe-9'),
    )
  })
  it('finds none for a name without ffmpeg in it', () => {
    expect(ffprobeBeside(join('/opt', 'ffmpeg', 'encoder'))).toBeNull()
  })
})

describe('withoutPaths', () => {
  it('writes each known path as its last folder name, in either separator', () => {
    const fixture = join(tmpdir(), 'x', 'first-run-gtfs')
    const said = `ERROR: Could not parse input GTFS feed, reason was: ${fixture}/agency.txt: File not found`
    expect(withoutPaths(said, [fixture])).toBe(
      'ERROR: Could not parse input GTFS feed, reason was: …/first-run-gtfs/agency.txt: File not found',
    )
  })
  it('takes out absolute paths it does not know, POSIX and Windows, and keeps the words', () => {
    const drive = ['C:', 'Program Files', 'x'].join('\\')
    expect(withoutPaths('could not open /var/folders/ab/T/thing: denied', [])).toBe(
      'could not open …: denied',
    )
    // A drive-rooted path may hold spaces and colons, so it goes to the end of its line.
    expect(withoutPaths(`loading "${['D:', 'a', 'b.dll'].join('\\')}" failed`, [])).toBe(
      'loading "…',
    )
    expect(withoutPaths(`at ${drive}\nnext line`, [])).toBe('at …\nnext line')
    expect(withoutPaths('exited with code 3 after 1/2 of the work', [])).toBe(
      'exited with code 3 after 1/2 of the work',
    )
  })
  // Every home below is assembled from pieces, so no literal path of that
  // shape is committed (bin/preflight refuses one).
  const spaced = ['C:', 'Users', 'Jane Doe'].join('\\')

  it('never leaves part of a Windows user name that has a space in it', () => {
    const where = `${spaced}\\AppData\\Local\\Temp\\x: Access is denied`
    // Unknown and with no home given: cut from the drive to the end of the line.
    expect(withoutPaths(`could not open ${where}`, [], [], 'win32')).toBe('could not open …')
    // With the home: written as ~, the rest kept.
    expect(withoutPaths(`could not open ${where}`, [], [spaced], 'win32')).toBe(
      'could not open ~\\AppData\\Local\\Temp\\x: Access is denied',
    )
  })

  it('takes out a device path and a share, and the home in its 8.3 short form', () => {
    const device = `\\\\?\\${spaced}\\AppData\\thing.dll`
    expect(withoutPaths(`LoadLibrary ${device}: 126`, [], [], 'win32')).toBe('LoadLibrary …')
    expect(withoutPaths(`at ${['\\\\server', 'share', 'Jane Doe'].join('\\')}`, [])).toBe('at …')
    const short = ['C:', 'Users', 'JANEDO~1'].join('\\')
    expect(withoutPaths(`in ${short}\\AppData\\x`, [], [spaced, short], 'win32')).toBe(
      'in ~\\AppData\\x',
    )
  })

  it('writes the resources folder as its name before anything else is cut', () => {
    const resources = [
      'C:',
      'Users',
      'Jane Doe',
      'AppData',
      'Local',
      'Programs',
      'Legible Cities',
      'resources',
    ].join('\\')
    expect(
      withoutPaths(`no file ${resources}\\loom\\octi.exe`, [resources], [spaced], 'win32'),
    ).toBe('no file …/resources\\loom\\octi.exe')
  })

  it('is bounded', () => {
    expect(withoutPaths('x'.repeat(10_000), []).length).toBeLessThanOrEqual(400)
  })
})

// ---------------------------------------------------------------- the check, with a stand-in spawner

interface Script {
  code?: number | null
  signal?: NodeJS.Signals | null
  stdout?: string
  stderr?: string
  error?: string
  /** Never ends on its own. */
  hang?: boolean
}

function fakeSpawner(scripts: Record<string, Script>): {
  spawner: Spawner
  calls: { command: string; args: string[]; options: Record<string, unknown> }[]
  killed: string[]
} {
  const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
  const killed: string[] = []
  const spawner: Spawner = (command, args, options) => {
    calls.push({ command, args, options })
    const name = (command.split(/[\\/]/).pop() as string).replace(/\.exe$/, '')
    const script = scripts[name] ?? { code: 0 }
    const child = new EventEmitter() as EventEmitter & ToolProcess
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    Object.assign(child, {
      stdout,
      stderr,
      kill: () => {
        killed.push(name)
        setImmediate(() => child.emit('close', null, 'SIGKILL'))
        return true
      },
    })
    setImmediate(() => {
      if (script.error !== undefined) {
        child.emit('error', Object.assign(new Error(script.error), { code: script.error }))
        return
      }
      if (script.stdout) stdout.write(script.stdout)
      if (script.stderr) stderr.write(script.stderr)
      if (script.hang) return
      setImmediate(() => child.emit('close', script.code ?? 0, script.signal ?? null))
    })
    return child
  }
  return { spawner, calls, killed }
}

const LOOM = join('/bundle', 'loom')
const FFMPEG = join('/bundle', 'ffmpeg', 'ffmpeg')
const FIXTURE = join('/bundle', 'first-run-gtfs')

/** Every file and folder a healthy package has. */
function tree(missing: string[] = []): FirstRunDeps['kind'] {
  const folders = new Set([LOOM, FIXTURE])
  const files = new Set([
    join(LOOM, 'gtfs2graph'),
    FFMPEG,
    join('/bundle', 'ffmpeg', 'ffprobe'),
    ...FIXTURE_TABLES.map((t) => join(FIXTURE, t)),
  ])
  return async (path) => {
    if (missing.includes(path)) return null
    return folders.has(path) ? 'folder' : files.has(path) ? 'file' : null
  }
}

const FFMPEG_OK: Script = { stdout: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026\nbuilt with…\n' }
const FFPROBE_OK: Script = { stdout: 'ffprobe version 9.0.1 Copyright (c) 2007-2026\n' }
const GTFS_OK: Script = { stdout: LINE_GRAPH }

function check(
  over: Partial<FirstRunDeps> & { scripts?: Record<string, Script>; missing?: string[] } = {},
) {
  const fake = fakeSpawner({
    gtfs2graph: GTFS_OK,
    ffmpeg: FFMPEG_OK,
    ffprobe: FFPROBE_OK,
    ...over.scripts,
  })
  const lines: string[] = []
  const temps = { made: 0, removed: [] as string[] }
  let clock = 1_000
  const deps: FirstRunDeps = {
    targets: {
      loom: { kind: 'check', path: LOOM, named: false },
      ffmpeg: { kind: 'check', path: FFMPEG, named: false },
    },
    fixture: FIXTURE,
    spawn: fake.spawner,
    kind: tree(over.missing),
    makeTemp: async () => {
      temps.made += 1
      return join(tmpdir(), 'first-run-test-cwd')
    },
    removeTemp: async (dir) => {
      temps.removed.push(dir)
    },
    now: () => (clock += 7),
    timeoutMs: 50,
    log: {
      info: (m) => lines.push(`info ${m}`),
      warn: (m) => lines.push(`warn ${m}`),
    },
    ...over,
  }
  const subject = new FirstRunCheck(deps)
  const seen: FirstRunResult[] = []
  subject.onChange((r) => seen.push(r))
  return { subject, fake, lines, temps, seen }
}

describe('FirstRunCheck', () => {
  it('passes a healthy package quietly, with each tool’s time in one log line', async () => {
    const { subject, fake, lines, temps, seen } = check()
    expect(subject.result.finished).toBe(false)
    expect(subject.result.loom.outcome).toBe('running')
    const result = await subject.run()
    expect(result.finished).toBe(true)
    expect(result.loom.outcome).toBe('passed')
    expect(result.ffmpeg.outcome).toBe('passed')
    expect(needsTelling(result)).toBe(false)
    expect(summarize(result)).toBe('The bundled LOOM and ffmpeg ran.')
    expect(lines.filter((l) => l.startsWith('info finished: '))).toEqual([
      `info finished: ${summaryLine(result)}`,
    ])
    expect(summaryLine(result)).toMatch(/^LOOM passed \(\d+ ms\), ffmpeg passed \(\d+ ms\)$/)
    // The last change published is the finished result.
    expect(seen.at(-1)).toEqual(result)
    // Argument arrays, no shell, hidden windows, the temporary folder as the working directory.
    expect(fake.calls.map((c) => [c.command, c.args])).toEqual(
      expect.arrayContaining([
        [join(LOOM, 'gtfs2graph'), ['-m', 'subway', FIXTURE]],
        [FFMPEG, ['-version']],
        [join('/bundle', 'ffmpeg', 'ffprobe'), ['-version']],
      ]),
    )
    for (const call of fake.calls) {
      expect(call.options).toMatchObject({
        cwd: join(tmpdir(), 'first-run-test-cwd'),
        windowsHide: true,
        shell: false,
      })
    }
    expect(temps).toEqual({ made: 1, removed: [join(tmpdir(), 'first-run-test-cwd')] })
  })

  it('is one run however often it is started', async () => {
    const { subject, fake } = check()
    const [a, b] = [subject.run(), subject.run()]
    expect(a).toBe(b)
    await a
    await subject.run()
    expect(fake.calls).toHaveLength(3)
  })

  it('finds gtfs2graph.exe in a Windows folder', async () => {
    const kind: FirstRunDeps['kind'] = async (path) =>
      path === join(LOOM, 'gtfs2graph')
        ? null
        : path === join(LOOM, 'gtfs2graph.exe')
          ? 'file'
          : tree()!(path)
    const { subject, fake } = check({ kind })
    expect((await subject.run()).loom.outcome).toBe('passed')
    expect(fake.calls.some((c) => c.command === join(LOOM, 'gtfs2graph.exe'))).toBe(true)
  })

  it('names LOOM missing when the folder is not there, and runs nothing for it', async () => {
    const { subject, fake, lines } = check({ missing: [LOOM] })
    const result = await subject.run()
    expect(result.loom).toMatchObject({
      outcome: 'failed',
      kind: 'missing',
      sentence: 'The bundled LOOM tools are missing, so maps cannot be laid out.',
      detail: 'There is no LOOM folder at …/loom.',
    })
    expect(fake.calls.some((c) => c.command.includes('gtfs2graph'))).toBe(false)
    expect(result.ffmpeg.outcome).toBe('passed')
    expect(failedTools(result)).toEqual(['loom'])
    expect(needsTelling(result)).toBe(true)
    // The log keeps the path.
    expect(lines.some((l) => l.startsWith('warn LOOM failed') && l.includes(LOOM))).toBe(true)
  })

  it('names LOOM missing when the folder has no gtfs2graph', async () => {
    const { subject } = check({ missing: [join(LOOM, 'gtfs2graph')] })
    expect((await subject.run()).loom).toMatchObject({
      kind: 'missing',
      detail: '…/loom has no gtfs2graph.',
    })
  })

  it('names the install, not LOOM, when the fixture is gone', async () => {
    const { subject, fake } = check({ missing: [join(FIXTURE, 'stops.txt')] })
    const result = await subject.run()
    expect(result.loom).toMatchObject({ outcome: 'failed', kind: 'install' })
    expect(result.loom.outcome === 'failed' && result.loom.sentence).toMatch(
      /^This installation is incomplete/,
    )
    expect(result.loom.outcome === 'failed' && result.loom.detail).toBe(
      "The app's test feed has no stops.txt (…/first-run-gtfs).",
    )
    expect(fake.calls.some((c) => c.command.includes('gtfs2graph'))).toBe(false)
  })

  it('fails LOOM on a non-zero exit, with the code and what it said, paths taken out', async () => {
    const { subject, lines } = check({
      scripts: {
        gtfs2graph: {
          code: 1,
          stderr: `[2026-09-13] ERROR: Could not parse input GTFS feed, reason was:\n${FIXTURE}/agency.txt: File not found\n`,
        },
      },
    })
    const result = await subject.run()
    expect(result.loom).toMatchObject({
      outcome: 'failed',
      kind: 'not-running',
      sentence: 'The bundled LOOM tools did not run, so maps cannot be laid out.',
      detail:
        'gtfs2graph exited with code 1. It said: [2026-09-13] ERROR: Could not parse input GTFS feed, reason was:',
    })
    // Standard error reaches the log, a line each.
    expect(lines).toContain(`info gtfs2graph stderr: ${FIXTURE}/agency.txt: File not found`)
  })

  it('carries a Windows loader’s exit code as it is, in hexadecimal too, and guesses nothing', async () => {
    const { subject } = check({ scripts: { gtfs2graph: { code: 3221225781 } } })
    expect((await subject.run()).loom).toMatchObject({
      detail: 'gtfs2graph exited with code 3221225781 (0xC0000135).',
    })
  })

  it('fails LOOM when it exits 0 with no line graph', async () => {
    const { subject } = check({ scripts: { gtfs2graph: { stdout: EMPTY_GRAPH } } })
    expect((await subject.run()).loom).toMatchObject({
      kind: 'not-running',
      detail: 'gtfs2graph exited 0, but it printed a feature collection with no line in it.',
    })
  })

  it('fails LOOM on a signal, a spawn error and a timeout, each said', async () => {
    const signalled = check({ scripts: { gtfs2graph: { code: null, signal: 'SIGSEGV' } } })
    expect((await signalled.subject.run()).loom).toMatchObject({
      detail: 'gtfs2graph was ended by SIGSEGV.',
    })

    const refused = check({ scripts: { gtfs2graph: { error: 'EACCES' } } })
    expect((await refused.subject.run()).loom).toMatchObject({
      kind: 'not-running',
      detail: 'gtfs2graph could not be started (EACCES).',
    })

    const hung = check({ scripts: { gtfs2graph: { hang: true } } })
    const result = await hung.subject.run()
    expect(result.loom).toMatchObject({
      kind: 'timeout',
      sentence: 'The bundled LOOM tools did not answer in time, so maps cannot be laid out.',
      detail: 'gtfs2graph gave no answer within 0.05 s and was ended.',
    })
    expect(hung.fake.killed).toEqual(['gtfs2graph'])
  })

  it('fails LOOM when it prints more than the cap', async () => {
    const { subject, fake } = check({
      scripts: { gtfs2graph: { stdout: 'x'.repeat(1024 * 1024 + 1), hang: true } },
    })
    expect((await subject.run()).loom).toMatchObject({
      kind: 'not-running',
      detail: 'gtfs2graph printed more than 1024 KB and was ended.',
    })
    expect(fake.killed).toEqual(['gtfs2graph'])
  })

  it('names ffmpeg missing, and ffprobe missing beside it, and says exports stop', async () => {
    const noFfmpeg = check({ missing: [FFMPEG] })
    expect((await noFfmpeg.subject.run()).ffmpeg).toMatchObject({
      kind: 'missing',
      sentence: 'The bundled ffmpeg is missing, so exports cannot be made.',
      detail: 'There is no ffmpeg at …/ffmpeg.',
    })
    const noFfprobe = check({ missing: [join('/bundle', 'ffmpeg', 'ffprobe')] })
    expect((await noFfprobe.subject.run()).ffmpeg).toMatchObject({ kind: 'missing' })
  })

  it('fails ffmpeg when either tool does not introduce itself, or exits non-zero', async () => {
    const wrong = check({ scripts: { ffprobe: { stdout: 'something else\n' } } })
    expect((await wrong.subject.run()).ffmpeg).toMatchObject({
      kind: 'not-running',
      detail: 'ffprobe -version exited 0, but printed "something else" first.',
    })
    const failing = check({ scripts: { ffmpeg: { code: 69, stdout: FFMPEG_OK.stdout } } })
    expect((await failing.subject.run()).ffmpeg).toMatchObject({
      detail: 'ffmpeg exited with code 69.',
    })
  })

  it('keeps a home folder with a space in it out of the detail when ffprobe is missing', async () => {
    const folder = join(tmpdir(), 'Jane Doe', 'Programs', 'Legible Cities', 'ffmpeg')
    const ffmpeg = join(folder, 'ffmpeg.exe')
    const ffprobe = join(folder, 'ffprobe.exe')
    const { subject } = check({
      targets: {
        loom: { kind: 'skip', reason: 'development: SCHEMATIC_LOOM_BIN is not named' },
        ffmpeg: { kind: 'check', path: ffmpeg, named: false },
      },
      kind: async (path) => (path === ffmpeg ? 'file' : null),
    })
    const result = await subject.run()
    expect(result.ffmpeg).toMatchObject({ kind: 'missing' })
    const detail = result.ffmpeg.outcome === 'failed' ? result.ffmpeg.detail : ''
    expect(detail).toBe(`There is no ffprobe at …/ffmpeg${ffprobe.slice(folder.length)}.`)
    expect(detail).not.toContain('Doe')
  })

  it('starts nothing when a quit came before the engine settled', async () => {
    const { subject, fake, temps } = check()
    subject.abort()
    const result = await subject.run()
    expect(result.finished).toBe(false)
    expect(fake.calls).toEqual([])
    expect(temps.made).toBe(0)
  })

  it('logs a passing tool’s standard error too', async () => {
    const { subject, lines } = check({
      scripts: { ffmpeg: { ...FFMPEG_OK, stderr: 'a warning\n' } },
    })
    expect((await subject.run()).ffmpeg.outcome).toBe('passed')
    expect(lines).toContain('info ffmpeg stderr: a warning')
  })

  it('does not blame development when a package could not check anything', () => {
    expect(
      summarize({
        finished: true,
        loom: { outcome: 'skipped', reason: 'the temporary folder could not be made (ENOSPC)' },
        ffmpeg: { outcome: 'skipped', reason: 'the temporary folder could not be made (ENOSPC)' },
      }),
    ).toBe('The check did not run (the temporary folder could not be made (ENOSPC)).')
  })

  it('names both in one result when both fail', async () => {
    const { subject } = check({ missing: [LOOM, FFMPEG] })
    const result = await subject.run()
    expect(failedTools(result)).toEqual(['loom', 'ffmpeg'])
    expect(summarize(result)).toBe('Not every tool the app needs ran.')
  })

  it('says a named tool is the one a person named', async () => {
    const { subject } = check({
      targets: {
        loom: { kind: 'check', path: LOOM, named: true },
        ffmpeg: { kind: 'check', path: FFMPEG, named: true },
      },
      missing: [LOOM, FFMPEG],
    })
    const result = await subject.run()
    expect(result.loom).toMatchObject({
      sentence: 'The LOOM tools SCHEMATIC_LOOM_BIN names are missing, so maps cannot be laid out.',
    })
    expect(result.ffmpeg).toMatchObject({
      sentence: 'The ffmpeg SCHEMATIC_FFMPEG names is missing, so exports cannot be made.',
    })
  })

  it('reports skipped tools at once, spawns nothing and makes no folder for them', async () => {
    const { subject, fake, temps, lines } = check({
      targets: {
        loom: { kind: 'skip', reason: 'development: SCHEMATIC_LOOM_BIN is not named' },
        ffmpeg: { kind: 'skip', reason: 'development: SCHEMATIC_FFMPEG is not named' },
      },
    })
    expect(subject.result.finished).toBe(true)
    const result = await subject.run()
    expect(result.loom).toEqual({
      outcome: 'skipped',
      reason: 'development: SCHEMATIC_LOOM_BIN is not named',
    })
    expect(summarize(result)).toBe('The check did not run (development: no bundled tools named).')
    expect(fake.calls).toEqual([])
    expect(temps.made).toBe(0)
    expect(lines).toContain('info finished: LOOM skipped, ffmpeg skipped')
  })

  it('runs only the named tool in development', async () => {
    const { subject, fake } = check({
      targets: {
        loom: { kind: 'skip', reason: 'development: SCHEMATIC_LOOM_BIN is not named' },
        ffmpeg: { kind: 'check', path: FFMPEG, named: true },
      },
    })
    const result = await subject.run()
    expect(result.ffmpeg.outcome).toBe('passed')
    expect(fake.calls.every((c) => !c.command.includes('gtfs2graph'))).toBe(true)
    expect(summarize(result)).toBe('The tools this run names ran; the others were not checked.')
  })

  it('logs the summary and removes its folder before it publishes finished', async () => {
    const order: string[] = []
    const { subject } = check({
      log: {
        info: (m) => {
          if (m.startsWith('finished: ')) order.push('summary logged')
        },
        warn: () => undefined,
      },
      removeTemp: async () => {
        order.push('folder removed')
      },
    })
    subject.onChange((r) => {
      if (r.finished) order.push('finished published')
    })
    await subject.run()
    expect(order).toEqual(['folder removed', 'summary logged', 'finished published'])
  })

  it('a quit while the folder is being removed publishes nothing, so the launch check never quits past the summary', async () => {
    let release = (): void => undefined
    const { subject, seen, lines } = check({
      removeTemp: () =>
        new Promise<void>((r) => {
          release = r
        }),
    })
    const running = subject.run()
    await new Promise((r) => setTimeout(r, 20))
    subject.abort()
    release()
    await running
    expect(seen).toEqual([])
    expect(subject.result.finished).toBe(false)
    expect(lines.some((l) => l.startsWith('info finished'))).toBe(false)
  })

  it('spawns nothing when a quit lands during the file checks, and still removes its folder', async () => {
    let answer = (): void => undefined
    const gate = new Promise<void>((r) => {
      answer = r
    })
    const healthy = tree()!
    const { subject, fake, temps, seen } = check({
      kind: async (path) => {
        await gate
        return healthy(path)
      },
    })
    const running = subject.run()
    await new Promise((r) => setTimeout(r, 20))
    subject.abort()
    answer()
    await running
    expect(fake.calls).toEqual([])
    expect(temps.removed).toHaveLength(1)
    expect(seen).toEqual([])
  })

  it('spawns nothing when a quit lands while the temporary folder is being made', async () => {
    let made = (): void => undefined
    const { subject, fake, temps } = check({
      makeTemp: () =>
        new Promise<string>((r) => {
          made = () => r(join(tmpdir(), 'first-run-test-cwd'))
        }),
    })
    const running = subject.run()
    await new Promise((r) => setTimeout(r, 20))
    subject.abort()
    made()
    await running
    expect(fake.calls).toEqual([])
    expect(temps.removed).toEqual([join(tmpdir(), 'first-run-test-cwd')])
  })

  it('ends every child at quit and publishes nothing after', async () => {
    const { subject, fake, seen, lines } = check({
      scripts: { gtfs2graph: { hang: true }, ffmpeg: { hang: true }, ffprobe: { hang: true } },
      timeoutMs: 60_000,
    })
    const running = subject.run()
    await new Promise((r) => setTimeout(r, 20))
    subject.abort()
    await running
    expect(fake.killed.sort()).toEqual(['ffmpeg', 'ffprobe', 'gtfs2graph'])
    expect(seen).toEqual([])
    expect(lines).toContain('info ended 3 running check(s) at quit')
    expect(lines.some((l) => l.startsWith('info finished'))).toBe(false)
  })

  it('removes its temporary folder even when a tool fails', async () => {
    const { subject, temps } = check({ scripts: { gtfs2graph: { code: 2 } } })
    await subject.run()
    expect(temps.removed).toHaveLength(1)
  })

  it('checks nothing, and says why, when no temporary folder can be made', async () => {
    const { subject, fake } = check({
      makeTemp: async () => {
        throw Object.assign(new Error('full'), { code: 'ENOSPC' })
      },
    })
    const result = await subject.run()
    expect(result.finished).toBe(true)
    expect(result.loom).toEqual({
      outcome: 'skipped',
      reason: 'the temporary folder could not be made (ENOSPC)',
    })
    expect(fake.calls).toEqual([])
  })
})

describe('the sentences', () => {
  it('say each outcome in one line', () => {
    expect(describeCheck('loom', { outcome: 'running' })).toBe('LOOM: checking…')
    expect(describeCheck('ffmpeg', { outcome: 'passed', ms: 12 })).toBe('ffmpeg: ran (12 ms).')
    expect(describeCheck('loom', { outcome: 'skipped', reason: 'why' })).toBe(
      'LOOM: not checked (why).',
    )
    expect(
      describeCheck('ffmpeg', {
        outcome: 'failed',
        kind: 'timeout',
        sentence: failureSentence('ffmpeg', 'timeout', false),
        detail: 'ffmpeg gave no answer.',
        ms: 15_000,
      }),
    ).toBe(
      'ffmpeg: The bundled ffmpeg did not answer in time, so exports cannot be made. ffmpeg gave no answer.',
    )
    expect(
      summarize({ finished: false, loom: { outcome: 'running' }, ffmpeg: { outcome: 'running' } }),
    ).toBe('Checking the bundled LOOM and ffmpeg…')
  })
})

// ---------------------------------------------------------------- a real child

describe('runProcess after a kill', () => {
  /** A child that closes `closesAfterMs` after it is killed, or never. */
  function stubborn(closesAfterMs: number | null): { spawner: Spawner; killedAt: number[] } {
    const killedAt: number[] = []
    const spawner: Spawner = () => {
      const child = new EventEmitter() as EventEmitter & ToolProcess
      Object.assign(child, {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: () => {
          killedAt.push(Date.now())
          if (closesAfterMs !== null) {
            setTimeout(() => child.emit('close', null, 'SIGKILL'), closesAfterMs)
          }
          return true
        },
      })
      return child
    }
    return { spawner, killedAt }
  }
  const options = { cwd: '.', maxStdout: 1024, track: () => () => undefined }

  it('waits for a killed child to close before it resolves, so its folder can be removed', async () => {
    const { spawner, killedAt } = stubborn(150)
    const end = await runProcess(spawner, 'tool', [], {
      ...options,
      timeoutMs: 20,
      closeGraceMs: 5_000,
    })
    expect(end.kind).toBe('timeout')
    expect(Date.now() - killedAt[0]).toBeGreaterThanOrEqual(140)
  })

  it('gives up waiting after the grace, for a child that ignores the kill', async () => {
    const { spawner, killedAt } = stubborn(null)
    const end = await runProcess(spawner, 'tool', [], {
      ...options,
      timeoutMs: 20,
      closeGraceMs: 100,
    })
    expect(end.kind).toBe('timeout')
    const waited = Date.now() - killedAt[0]
    expect(waited).toBeGreaterThanOrEqual(90)
    expect(waited).toBeLessThan(2_000)
  })
})

describe('runProcess with a real child', () => {
  const made: string[] = []
  afterEach(() => {
    // Retried: a child killed on Windows can hold its working folder for a moment.
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })
  const cwd = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'legible-cities-first-run-unit-'))
    made.push(dir)
    return dir
  }
  const node = (script: string): [string, string[]] => [process.execPath, ['-e', script]]
  const spawner = (): Spawner => spawn as unknown as Spawner

  it('collects standard output and error and the exit', async () => {
    const [command, args] = node(
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    )
    const end = await runProcess(spawner(), command, args, {
      cwd: cwd(),
      timeoutMs: 10_000,
      maxStdout: 1024,
      track: () => () => undefined,
    })
    expect(end).toEqual({ kind: 'exit', code: 3, signal: null, stdout: 'out', stderr: 'err' })
  })

  it('kills a child past its deadline, and a quit can kill one sooner', async () => {
    const [command, args] = node('setInterval(() => {}, 1000)')
    const kills: (() => void)[] = []
    const started = Date.now()
    const end = await runProcess(spawner(), command, args, {
      cwd: cwd(),
      timeoutMs: 300,
      maxStdout: 1024,
      track: (kill) => {
        kills.push(kill)
        return () => undefined
      },
    })
    expect(end.kind).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(5_000)

    const quitting = runProcess(spawner(), command, args, {
      cwd: cwd(),
      timeoutMs: 30_000,
      maxStdout: 1024,
      track: (kill) => {
        setTimeout(kill, 100)
        return () => undefined
      },
    })
    const ended = await quitting
    expect(ended.kind).toBe('exit')
    expect(ended.kind === 'exit' && (ended.signal !== null || ended.code !== 0)).toBe(true)
  })

  it('ends a child that prints more than the cap', async () => {
    const [command, args] = node("setInterval(() => process.stdout.write('x'.repeat(4096)), 1)")
    const end = await runProcess(spawner(), command, args, {
      cwd: cwd(),
      timeoutMs: 10_000,
      maxStdout: 16 * 1024,
      track: () => () => undefined,
    })
    expect(end.kind).toBe('overflow')
  })

  it('says a command that is not there could not be started', async () => {
    const end = await runProcess(spawner(), join(cwd(), 'no-such-tool'), [], {
      cwd: cwd(),
      timeoutMs: 10_000,
      maxStdout: 1024,
      track: () => () => undefined,
    })
    expect(end).toMatchObject({ kind: 'error', code: 'ENOENT' })
  })
})
