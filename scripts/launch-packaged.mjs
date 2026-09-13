// Launch the unpacked build once, as a person would, and prove the three
// things only a packaged app can show (specs/002, A0-10): the engine starts
// from the bundled runtime and reaches ready; it runs the bundled LOOM and
// ffmpeg, which the engine itself reports; and nothing is written inside
// the bundle, by the app or by anything it starts (SC-003). The packaging
// jobs in .github/workflows/build.yml run it before an installer is
// uploaded. It is for the runners: it launches Electron, so never run it
// beside another launch of the app on a developer machine.
//
//   node scripts/launch-packaged.mjs <darwin-arm64|darwin-x64|win-x64> [--release <dir>]
//
// The profile is a temporary folder, given to the packaged app with
// Chromium's own `--user-data-dir`: LEGIBLE_USER_DATA is development-only,
// and a packaged app ignores it. The logs do not follow that switch on
// macOS (A6-03), so they are read from wherever `app.getPath('logs')`
// answers inside the running app, and only the lines stamped after this
// launch began count. The environment is emptied of every SCHEMATIC_* and
// LEGIBLE_* key, so what is exercised is the app's own defaults.
//
// Electron is started by Playwright, which spawns it with an argument
// array; every wait below has a deadline, and a launch that does not end
// in time is killed and fails.

import { _electron as electron } from '@playwright/test'
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PRODUCT = 'Legible Cities'

/** The whole run, launch to exit; past it the app is killed and the check fails. */
const DEADLINE_MS = 240_000
const LAUNCH_MS = 90_000
const READY_MS = 120_000
const EXIT_MS = 20_000

const say = (line) => process.stdout.write(`${line}\n`)

/** Where electron-builder puts the unpacked app for each target. */
function unpacked(target, release) {
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

/** Every file under `root`, with its size and modification time; links are recorded, never followed. */
function snapshot(root) {
  const files = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      const stat = lstatSync(path)
      files.set(relative(root, path), `${stat.size} bytes, modified ${stat.mtimeMs}`)
    }
  }
  walk(root)
  return files
}

function differences(before, after) {
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

async function run(target, release) {
  const failures = []
  const fail = (message) => failures.push(message)
  const app = unpacked(target, release)
  if (app === null) {
    process.stderr.write(
      `usage: launch-packaged.mjs <darwin-arm64|darwin-x64|win-x64> [--release <dir>]\n`,
    )
    return 2
  }
  const pins = JSON.parse(readFileSync(join(repoRoot, 'vendor', 'pins.json'), 'utf8'))
  try {
    lstatSync(app.executable)
  } catch {
    process.stderr.write(`${target}: no unpacked app at ${app.executable}; package it first\n`)
    return 1
  }

  const before = snapshot(app.bundle)
  say(`${target}: ${before.size} files in the bundle before launch`)

  const profile = mkdtempSync(join(tmpdir(), 'lc-launch-packaged-'))
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SCHEMATIC_|LEGIBLE_|PYTHON)/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }

  // Lines stamped from a second before launch; the clocks are the same machine's.
  const since = Date.now() - 1_000
  let electronApp = null
  let logs = null
  const killer = setTimeout(() => {
    process.stderr.write(
      `${target}: the launch did not finish within ${DEADLINE_MS} ms; killing it\n`,
    )
    electronApp?.process().kill('SIGKILL')
    process.exit(1)
  }, DEADLINE_MS)
  killer.unref()

  try {
    electronApp = await electron.launch({
      executablePath: app.executable,
      args: [`--user-data-dir=${profile}`],
      env,
      timeout: LAUNCH_MS,
    })
    const window = await electronApp.firstWindow({ timeout: LAUNCH_MS })
    const where = await electronApp.evaluate(({ app: electronAppModule }) => ({
      userData: electronAppModule.getPath('userData'),
      logs: electronAppModule.getPath('logs'),
      resources: process.resourcesPath,
      packaged: electronAppModule.isPackaged,
    }))
    logs = where.logs
    say(`${target}: profile ${where.userData}; logs in ${where.logs}`)
    if (!where.packaged) fail('the app does not know itself as packaged')
    if (!inside(where.userData, profile)) {
      fail(`--user-data-dir was not honoured: the profile is ${where.userData}`)
    }
    if (!inside(where.resources, app.bundle)) {
      fail(`the resources are ${where.resources}, outside the bundle launched`)
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
      if (info.loom?.backend !== 'native')
        fail(`the engine's LOOM backend is ${info.loom?.backend}, not native`)
      if (info.loom?.commit !== pins.loom.commit)
        fail(`the engine reports LOOM ${info.loom?.commit}`)
      const bundledFfmpeg = join(where.resources, 'ffmpeg', `ffmpeg${app.exe}`)
      if (typeof info.ffmpeg !== 'string' || real(info.ffmpeg) !== real(bundledFfmpeg)) {
        fail(`the engine's ffmpeg is ${info.ffmpeg}, not the bundled ${bundledFfmpeg}`)
      }
      if (typeof info.home !== 'string' || !inside(info.home, profile)) {
        fail(`the engine's home is ${info.home}, not under the profile`)
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
    clearTimeout(killer)
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

  const after = snapshot(app.bundle)
  const changed = differences(before, after)
  if (changed.length > 0) {
    fail(
      `the bundle changed during the session (${changed.length}):\n    ${changed.slice(0, 40).join('\n    ')}`,
    )
  } else {
    say(`${target}: the bundle is unchanged, ${after.size} files`)
  }

  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })

  if (failures.length > 0) {
    process.stderr.write(`${target}: the packaged app failed its launch check:\n`)
    for (const failure of failures) process.stderr.write(`  ${failure}\n`)
    return 1
  }
  say(
    `${target}: the packaged app starts the bundled engine, runs the bundled LOOM and ffmpeg, and writes nothing inside itself`,
  )
  return 0
}

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
