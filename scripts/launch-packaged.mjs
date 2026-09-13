// Launch the unpacked build once, as a person would, then run every
// bundled executable from inside the bundle, and check that none of it
// wrote anything into the bundle (specs/002, A0-10, SC-003 in part). The
// packaging jobs in .github/workflows/build.yml run it before an installer
// is uploaded. It is for the runners: it launches Electron, so never run it
// beside another launch of the app on a developer machine.
//
//   node scripts/launch-packaged.mjs <darwin-arm64|darwin-x64|win-x64> [--release <dir>]
//
// What it checks, and no more:
//
// 1. The app starts from the bundle, with its working directory inside the
//    bundle (an NSIS shortcut starts in $INSTDIR, where a relative write
//    would land), knows itself as packaged, and takes the temporary profile.
// 2. The engine reaches ready from the bundled runtime. That is the one
//    bundled executable the session itself runs: the interpreter, the
//    engine and its dependencies, importing from the compiled bytecode.
// 3. `engine.info` reports the pinned engine and Python, the native LOOM
//    backend at the pinned commit, and the bundled ffmpeg's path. At the
//    pinned engine these are read from the environment and from
//    `shutil.which`: settings, not proof that anything runs.
// 4. The first-run check (A6-02, specs/026) finishes inside the app with
//    LOOM and ffmpeg both passed: `gtfs2graph` drew a line graph from the
//    GTFS folder the package carries, and ffmpeg and ffprobe answered
//    `-version`, each spawned by the app itself from its own resources.
// 5. The log shows the interpreter, LOOM and ffmpeg taken from the bundle,
//    the first-run check's passing line, and the engine ending when asked,
//    at quit.
// 6. After quit, each bundled LOOM tool (`--help`) and ffmpeg and ffprobe
//    (`-version`) is run from inside the bundle, with the bundle as its
//    working directory: a zero exit and the line each prints first. This
//    is what proves they execute from the packaged, signed app.
// 7. Every file and folder in the bundle is the same after all of that as
//    before the launch: same set, sizes and modification times.
//
// It does not run a layout or an export. The first-run check is the one
// piece of real LOOM work done inside the app here, over a three-stop feed;
// see ADR-035 for what a full session would take.
//
// The profile is a temporary folder, given with Chromium's own
// `--user-data-dir`: LEGIBLE_USER_DATA is development-only and a packaged
// app ignores it. On Windows and Linux the logs live inside the profile and
// go with it. **On macOS they do not**: a packaged app has no switch that
// moves them, and they are written to the real `~/Library/Logs/Legible
// Cities`. The script records which of the four log files existed there
// before the launch, reads only lines stamped after it, and removes a file
// that did not exist only if its first line is stamped after the launch
// (a rotation can turn a person's `main.log` into a new `main.old.log`),
// and the folder if the run created it; a file that was already there
// keeps the lines this run appended. The environment is emptied of
// every SCHEMATIC_*, LEGIBLE_* and PYTHON* key, so what is exercised is the
// app's own defaults.
//
// Electron is started by Playwright, which spawns it with an argument
// array; its standard error is kept for the failure output. Every wait has
// a deadline; past the whole run's, the app is killed, the profile and the
// run's log files removed, and what failed so far printed.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT = 'Legible Cities'

/** The whole run, launch to exit; past it the app is killed and the check fails. */
const DEADLINE_MS = 300_000
const LAUNCH_MS = 90_000
const READY_MS = 120_000
const EXIT_MS = 20_000
const TOOL_MS = 30_000
/** The first-run check: three spawns of 15 s at most each, after the engine settles. */
const FIRST_RUN_MS = 60_000

/**
 * The line the app logs when its first-run check passed for both tools
 * (`summaryLine` in src/main/first-run.ts, under the `first-run` tag).
 */
export const FIRST_RUN_PASSED =
  /\[first-run\] finished: LOOM passed \(\d+ ms\), ffmpeg passed \(\d+ ms\)$/

/** The log files the app writes (src/main/log-file.ts). */
const LOG_FILES = ['main.log', 'main.old.log', 'engine.log', 'engine.old.log']
const LOOM_TOOLS = ['gtfs2graph', 'topo', 'loom', 'octi']

const say = (line) => process.stdout.write(`${line}\n`)

/** Where electron-builder puts the unpacked app for each target. */
export function unpacked(target, release) {
  switch (target) {
    case 'darwin-arm64':
    case 'darwin-x64': {
      const bundle = join(
        release,
        target === 'darwin-arm64' ? 'mac-arm64' : 'mac',
        `${PRODUCT}.app`,
      )
      return {
        bundle,
        executable: join(bundle, 'Contents', 'MacOS', PRODUCT),
        resources: join(bundle, 'Contents', 'Resources'),
        exe: '',
      }
    }
    case 'win-x64': {
      const bundle = join(release, 'win-unpacked')
      return {
        bundle,
        executable: join(bundle, `${PRODUCT}.exe`),
        resources: join(bundle, 'resources'),
        exe: '.exe',
      }
    }
    default:
      return null
  }
}

/**
 * Every entry under `root`: a file or link with its size and modification
 * time, a folder by its existence (a trailing `/`). Links are recorded,
 * never followed. A folder's own time is left out: it moves when anything
 * is made and removed inside it, and a folder that appears is what counts.
 */
export function snapshot(root) {
  const entries = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const name = relative(root, path).split('\\').join('/')
      if (entry.isDirectory()) {
        entries.set(`${name}/`, 'folder')
        walk(path)
        continue
      }
      const stat = lstatSync(path)
      entries.set(name, `${stat.size} bytes, modified ${stat.mtimeMs}`)
    }
  }
  walk(root)
  return entries
}

/** What differs between two snapshots, one line per entry. */
export function differences(before, after) {
  const lines = []
  for (const [path, was] of before) {
    const now = after.get(path)
    if (now === undefined) lines.push(`removed ${path}`)
    else if (now !== was) lines.push(`changed ${path}: ${was} -> ${now}`)
  }
  for (const path of after.keys()) if (!before.has(path)) lines.push(`added ${path}`)
  return lines
}

const real = (path) => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** Whether `path` is `root` or inside it, after links, and without regard to case on Windows. */
function inside(path, root) {
  const fold = (p) => (process.platform === 'win32' ? real(p).toLowerCase() : real(p))
  const rel = relative(fold(root), fold(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** The lines of `<logs>/<name>.log` stamped at or after `since`. */
function linesSince(logs, name, since) {
  let text
  try {
    text = readFileSync(join(logs, `${name}.log`), 'utf8')
  } catch {
    return []
  }
  return text.split(/\r?\n/).filter((line) => {
    const stamp = Date.parse(line.slice(0, line.indexOf(' ')))
    return Number.isFinite(stamp) && stamp >= since
  })
}

/**
 * Whether a log file that was not there before the launch is this run's to
 * remove: its first stamped line is at or after `since`, or it holds none.
 * A file that did not exist can still be a person's history - a `main.log`
 * near its cap rotates during the run into a `main.old.log` that did not
 * exist - and its lines then begin before the launch.
 */
export function writtenSince(path, since) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  for (const line of text.split(/\r?\n/)) {
    const stamp = Date.parse(line.slice(0, line.indexOf(' ')))
    if (Number.isFinite(stamp)) return stamp >= since
  }
  return true
}

/**
 * The bundled executables to run after quit, each with the arguments that
 * make it print who it is and exit, and the first line that says so.
 */
export function bundledTools(resources, exe, pins, target) {
  const reports = pins.ffmpeg.targets[target]?.reports ?? ''
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    ...LOOM_TOOLS.map((tool) => ({
      name: tool,
      path: join(resources, 'loom', tool + exe),
      args: ['--help'],
      first: new RegExp(`^${tool} \\(part of LOOM\\)`),
    })),
    ...['ffmpeg', 'ffprobe'].map((tool) => ({
      name: tool,
      path: join(resources, 'ffmpeg', tool + exe),
      args: ['-version'],
      first: new RegExp(`^${tool} version ${escape(reports)} `),
    })),
  ]
}

/** Run one bundled executable from inside the bundle; a sentence on failure, or null. */
function runTool(tool, cwd) {
  const result = spawnSync(tool.path, tool.args, {
    cwd,
    encoding: 'utf8',
    timeout: TOOL_MS,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\r/g, '')
  const first = output.split('\n').find((line) => line.trim() !== '') ?? ''
  if (result.error !== undefined) return `${tool.name} did not run: ${result.error.message}`
  if (result.status !== 0) {
    return `${tool.name} ${tool.args.join(' ')} exited ${result.status ?? result.signal}: ${first}`
  }
  if (!tool.first.test(first)) return `${tool.name} printed "${first}", not ${tool.first}`
  say(`ran ${tool.name} ${tool.args.join(' ')} from the bundle: ${first}`)
  return null
}

/** The log folder a packaged app on macOS writes to whatever its profile. */
function predictedLogs() {
  return process.platform === 'darwin' ? join(homedir(), 'Library', 'Logs', PRODUCT) : null
}

async function run(target, release) {
  const app = unpacked(target, release)
  if (app === null) {
    process.stderr.write(
      `usage: launch-packaged.mjs <darwin-arm64|darwin-x64|win-x64> [--release <dir>]\n`,
    )
    return 2
  }
  if (!existsSync(app.executable)) {
    process.stderr.write(`${target}: no unpacked app at ${app.executable}; package it first\n`)
    return 1
  }
  const pins = JSON.parse(readFileSync(join(repoRoot, 'vendor', 'pins.json'), 'utf8'))
  const { _electron: electron } = await import('@playwright/test')

  const failures = []
  const fail = (message) => failures.push(message)
  let stderr = ''
  let electronApp = null
  let logs = null

  const before = snapshot(app.bundle)
  say(`${target}: ${before.size} files and folders in the bundle before launch`)

  const profile = mkdtempSync(join(tmpdir(), 'lc-launch-packaged-'))
  // Lines stamped from a second before launch count as this run's, for
  // reading the log and for removing what the run created; the clocks are
  // the same machine's.
  const since = Date.now() - 1_000
  // The macOS log folder, as it was: whether it existed and which files.
  const outsideLogs = predictedLogs()
  const logsBefore =
    outsideLogs === null
      ? null
      : {
          folder: existsSync(outsideLogs),
          files: new Set(LOG_FILES.filter((name) => existsSync(join(outsideLogs, name)))),
        }

  const cleanUp = () => {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (outsideLogs === null || logsBefore === null) return
    for (const name of LOG_FILES) {
      const path = join(outsideLogs, name)
      if (logsBefore.files.has(name) || !existsSync(path)) continue
      if (writtenSince(path, since)) rmSync(path, { force: true })
      else say(`${target}: kept ${path}, which holds lines from before this run`)
    }
    if (!logsBefore.folder) {
      try {
        rmdirSync(outsideLogs)
      } catch {
        // Not empty: something else wrote there, and it is not ours to remove.
      }
    }
    const kept = [...logsBefore.files]
    if (kept.length > 0) {
      say(
        `${target}: ${kept.join(', ')} in ${outsideLogs} existed before and keep this run's lines`,
      )
    }
  }

  const report = () => {
    if (failures.length === 0) return 0
    if (stderr.trim() !== '') {
      say(`--- the app's standard error (last 8 KB) ---\n${stderr.slice(-8192)}`)
    }
    process.stderr.write(`${target}: the packaged app failed its launch check:\n`)
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    return 1
  }

  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SCHEMATIC_|LEGIBLE_|PYTHON)/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }

  const killer = setTimeout(() => {
    fail(`the run did not finish within ${DEADLINE_MS} ms; the app was killed`)
    try {
      electronApp?.process().kill('SIGKILL')
    } catch {
      // Already gone.
    }
    cleanUp()
    process.exit(report())
  }, DEADLINE_MS)
  killer.unref()

  try {
    electronApp = await electron.launch({
      executablePath: app.executable,
      args: [`--user-data-dir=${profile}`],
      cwd: app.bundle,
      env,
      timeout: LAUNCH_MS,
    })
    electronApp.process().stderr?.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-65536)
    })
    const window = await electronApp.firstWindow({ timeout: LAUNCH_MS })
    const where = await electronApp.evaluate(({ app: electronAppModule }) => ({
      userData: electronAppModule.getPath('userData'),
      logs: electronAppModule.getPath('logs'),
      resources: process.resourcesPath,
      packaged: electronAppModule.isPackaged,
      cwd: process.cwd(),
    }))
    logs = where.logs
    say(
      `${target}: profile ${where.userData}; logs in ${where.logs}; working directory ${where.cwd}`,
    )
    if (!where.packaged) fail('the app does not know itself as packaged')
    if (!inside(where.userData, profile)) {
      fail(`--user-data-dir was not honoured: the profile is ${where.userData}`)
    }
    if (!inside(where.resources, app.bundle)) {
      fail(`the resources are ${where.resources}, outside the bundle launched`)
    }
    if (!inside(where.cwd, app.bundle)) fail(`the app runs in ${where.cwd}, not in the bundle`)
    if (outsideLogs !== null && real(where.logs) !== real(outsideLogs)) {
      fail(`the logs are in ${where.logs}, not ${outsideLogs}, so this run cannot clean them up`)
    }

    // The status line says ready, or says why not; either ends the wait.
    const status = window.getByRole('status', { name: 'Engine' })
    const ready = `Engine ready (${pins.engine.version}).`
    const waitUntil = Date.now() + READY_MS
    let text = ''
    for (;;) {
      text = ((await status.textContent({ timeout: 5_000 }).catch(() => '')) ?? '').trim()
      if (text === ready) break
      if (/unavailable|mismatch|stopped/i.test(text) || Date.now() > waitUntil) break
      await sleep(250)
    }
    say(`${target}: engine status "${text}"`)
    if (text !== ready) {
      fail(`the engine did not reach "${ready}"`)
    } else {
      const info = await window.evaluate(async () => {
        const request = globalThis.api.engine.request('engine.info')
        return await request.result
      })
      say(`${target}: engine.info ${JSON.stringify(info)}`)
      if (info.engine !== pins.engine.version) fail(`engine.info reports engine ${info.engine}`)
      if (typeof info.python !== 'string' || !info.python.includes(pins.python.version)) {
        fail(`engine.info reports Python ${info.python}, not ${pins.python.version}`)
      }
      if (info.loom?.backend !== 'native') {
        fail(`the engine's LOOM backend is ${info.loom?.backend}, not native`)
      }
      if (info.loom?.commit !== pins.loom.commit) {
        fail(`the engine reports LOOM ${info.loom?.commit}`)
      }
      const bundledFfmpeg = join(where.resources, 'ffmpeg', `ffmpeg${app.exe}`)
      if (typeof info.ffmpeg !== 'string' || real(info.ffmpeg) !== real(bundledFfmpeg)) {
        fail(`the engine's ffmpeg is ${info.ffmpeg}, not the bundled ${bundledFfmpeg}`)
      }
      if (typeof info.home !== 'string' || !inside(info.home, profile)) {
        fail(`the engine's home is ${info.home}, not under the profile`)
      }
    }

    // The first-run check runs once the engine's first start has settled,
    // whichever way; it is read from the page, as the Settings screen reads it.
    const checkUntil = Date.now() + FIRST_RUN_MS
    let firstRun = null
    for (;;) {
      firstRun = await window
        .evaluate(async () => await globalThis.api.firstRun.get())
        .catch(() => null)
      if (firstRun?.finished === true || Date.now() > checkUntil) break
      await sleep(250)
    }
    say(`${target}: first-run check ${JSON.stringify(firstRun)}`)
    if (firstRun?.finished !== true) {
      fail(`the first-run check did not finish within ${FIRST_RUN_MS} ms`)
    } else {
      for (const tool of ['loom', 'ffmpeg']) {
        if (firstRun[tool]?.outcome !== 'passed') {
          fail(`the first-run check did not pass ${tool}: ${JSON.stringify(firstRun[tool])}`)
        }
      }
    }
  } catch (error) {
    fail(`the launch failed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    if (electronApp !== null) {
      const child = electronApp.process()
      await Promise.race([electronApp.close().catch(() => {}), sleep(EXIT_MS)])
      const exitBy = Date.now() + EXIT_MS
      while (child.exitCode === null && child.signalCode === null && Date.now() < exitBy) {
        await sleep(100)
      }
      if (child.exitCode === null && child.signalCode === null) {
        fail(`the app did not quit within ${EXIT_MS} ms of being asked`)
        child.kill('SIGKILL')
      }
    }
  }

  // What the app logged about where each component came from, and how the
  // engine ended.
  if (logs !== null) {
    const main = linesSince(logs, 'main', since)
    const engine = linesSince(logs, 'engine', since)
    const needs = [
      [
        engine,
        /\[engine\] interpreter: .+ \(bundled runtime\)$/,
        'the interpreter from the bundled runtime',
      ],
      [main, /\[config\] SCHEMATIC_LOOM_BIN=.+ \(bundled\)$/, 'SCHEMATIC_LOOM_BIN from the bundle'],
      [main, /\[config\] SCHEMATIC_FFMPEG=.+ \(bundled\)$/, 'SCHEMATIC_FFMPEG from the bundle'],
      [
        main,
        new RegExp(`\\[config\\] SCHEMATIC_LOOM_COMMIT=${pins.loom.commit} \\(default\\)$`),
        'the pinned LOOM commit',
      ],
      [main, FIRST_RUN_PASSED, 'the first-run check passing for LOOM and ffmpeg'],
      [engine, /\[engine\] ended on request/, 'the engine ending when asked, at quit'],
    ]
    for (const [lines, pattern, what] of needs) {
      const line = lines.find((l) => pattern.test(l))
      if (line === undefined) fail(`the log does not show ${what}`)
      else say(`${target}: ${line.slice(line.indexOf(' ') + 1)}`)
    }
    if (failures.length > 0) {
      say(
        `--- main.log since launch ---\n${main.join('\n')}\n--- engine.log since launch ---\n${engine.join('\n')}`,
      )
    }
  } else {
    fail('the log folder was never learned from the app')
  }

  // Each bundled LOOM tool, ffmpeg and ffprobe, executed from inside the
  // packaged (and on macOS signed) bundle, with the bundle as its working
  // directory, before the bundle is compared.
  for (const tool of bundledTools(app.resources, app.exe, pins, target)) {
    const problem = runTool(tool, app.bundle)
    if (problem !== null) fail(problem)
  }

  const after = snapshot(app.bundle)
  const changed = differences(before, after)
  if (changed.length > 0) {
    fail(
      `the bundle changed during the session (${changed.length}):\n    ${changed.slice(0, 40).join('\n    ')}`,
    )
  } else {
    say(`${target}: the bundle is unchanged, ${after.size} files and folders`)
  }

  clearTimeout(killer)
  cleanUp()
  if (report() !== 0) return 1
  say(
    `${target}: the packaged app reached engine ready from the bundled runtime with LOOM and ffmpeg configured from the bundle; its first-run check passed for both; the four LOOM tools, ffmpeg and ffprobe each ran from inside the bundle; and the bundle is unchanged after launch, quit and those runs`,
  )
  return 0
}

function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  const args = process.argv.slice(2)
  let target = null
  let release = join(repoRoot, 'release')
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--release' && args[i + 1] !== undefined) {
      release = resolve(args[i + 1])
      i += 1
    } else if (target === null) {
      target = args[i]
    }
  }
  process.exitCode = await run(target, release)
}
