// The acceptance checklist (docs/acceptance.md, issue A6-04), driven through
// a release's real installed app: the bundled Python engine, LOOM and ffmpeg,
// a real Los Angeles layout, real exports. One test, one session of steps in
// the checklist's order, each a `test.step` that asserts what the checklist
// says a person should see, in the app's own words.
//
//   LEGIBLE_ACCEPTANCE_APP=<the installed app> npm run test:acceptance
//
// LEGIBLE_ACCEPTANCE_APP is the executable, or on a Mac the `.app` bundle.
// Without it the test is skipped. Optional:
//
//   LEGIBLE_ACCEPTANCE_OUT    where the record and failure screenshots go
//                             (default acceptance-results, which git ignores)
//   LEGIBLE_ACCEPTANCE_TEMP   where the profile and export folder are made
//                             (default the runner's or the system's temporary
//                             folder); failure screenshots show these paths
//   LEGIBLE_ACCEPTANCE_PINS   vendor/pins.json at the release's tag, for the
//                             versions the app must report (default: this
//                             checkout's)
//   LEGIBLE_ACCEPTANCE_PRIOR  JSON of what the workflow found before the spec
//                             ran: the installer, its checksum, steps 1 and 2
//   LEGIBLE_ACCEPTANCE_TAG    the release's tag, so a check of something that
//                             landed after it (FEATURES) is written as not
//                             checked rather than failed; without it such a
//                             check runs only if the build has the feature
//
// Steps 1, 2 and 21 (download, install, uninstall) are the workflow's
// (.github/workflows/acceptance.yml). What a machine cannot judge - a drag's
// feel, whether a window came to the front, whether a picture is the map - is
// written as not automated, never as passed.
//
// A failed step does not end the run: it is recorded, with the sentence the
// app showed and a screenshot, and the steps that do not need it go on. A step
// that needs a failed one is recorded as failed, not attempted. The test fails
// at the end if any step did.
//
// It launches the app, so never beside another launch on a developer machine.
// The profile is a temporary folder given with Chromium's `--user-data-dir`
// (LEGIBLE_USER_DATA is development-only); on macOS the logs still go to
// `~/Library/Logs/Legible Cities`, so the files this run creates there are
// removed afterwards and a file that was already there keeps this run's lines,
// as scripts/launch-packaged.mjs does. LEGIBLE_EXPORT_FOLDER is set to a
// temporary folder so nothing lands on a desktop. The clipboard is used, and
// left holding the last thing the app copied.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { arch, cpus, homedir, release, tmpdir, totalmem, version as osVersion } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import type { ProjectRecord } from '../../src/shared/project'
import { tagContains as gitTagContains, writtenSince } from './pure.mjs'
import { RunRecord, STEP_TITLES, redact, type Result } from './record'

const repoRoot = resolve(__dirname, '../..')
const APP = process.env.LEGIBLE_ACCEPTANCE_APP ?? ''
// Not under test-results/, which `npm run test:e2e` empties.
const OUT = resolve(process.env.LEGIBLE_ACCEPTANCE_OUT || join(repoRoot, 'acceptance-results'))
/**
 * Where the run's profile and export folder are made. Screenshots of a
 * failed step show Settings, and so these paths: a runner's temporary folder
 * is outside any home, and LEGIBLE_ACCEPTANCE_TEMP moves them out of a
 * person's home on their own machine (on Windows the default is inside it).
 */
const TEMP_ROOT =
  process.env.LEGIBLE_ACCEPTANCE_TEMP || (process.env.CI ? process.env.RUNNER_TEMP : '') || tmpdir()
const PINS_PATH = process.env.LEGIBLE_ACCEPTANCE_PINS || join(repoRoot, 'vendor', 'pins.json')
const PRODUCT = 'Legible Cities'
const PLATFORM =
  process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'

/** The checklist's own choice of feed to add by address (step 5). */
const CALTRAIN_URL = 'https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip'

const SECOND = 1_000
const MINUTE = 60 * SECOND
/** Every wait has a deadline; these are generous, because nothing here has been measured on Windows. */
const LAUNCH_MS = 2 * MINUTE
const READY_MS = 3 * MINUTE
const FIRST_RUN_MS = 2 * MINUTE
const FEED_READ_MS = 15 * MINUTE
const FEED_ADD_MS = 10 * MINUTE
const LAYOUT_MS = 45 * MINUTE
const REBUILD_MS = 20 * MINUTE
const EXPORT_MS = 45 * MINUTE
const STILL_MS = 20 * MINUTE
const QUIT_MS = 30 * SECOND
const SHORT_MS = 30 * SECOND

const LAYOUT_STAGES = [
  'gtfs2graph',
  'topo',
  'loom',
  'octi',
  'schedule',
  'render',
  'animate',
  'write',
]
const LOG_FILES = ['main.log', 'main.old.log', 'engine.log', 'engine.old.log']

/**
 * What landed on main after some release was tagged, by the commit that
 * brought it. A check of one runs only against a release whose tag contains
 * that commit; against an older one it is written into the record as not
 * checked, with the reason, and never passed. Add a row here whenever a
 * step of the checklist starts to rely on something newer than a release
 * that may still be accepted.
 */
interface Feature {
  name: string
  commit: string
  landed: string
}

const FEATURES = {
  skipPastMap: {
    name: 'Skip past the map',
    commit: '55e3b4aa12737cf579ac74ed9f3930dd674e654d',
    landed: 'pull request 122 (issue 106)',
  },
} satisfies Record<string, Feature>

/** The release under test, by its tag; the workflow names it. */
const TAG = process.env.LEGIBLE_ACCEPTANCE_TAG ?? ''

/**
 * Whether the tag under test contains a feature's commit: true or false, or
 * null when no tag was named or git cannot tell (tests/acceptance/pure.mjs).
 */
const tagContains = (feature: Feature): boolean | null =>
  gitTagContains({ tag: TAG, commit: feature.commit, cwd: repoRoot })

interface Pins {
  engine: { version: string }
  python: { version: string }
  loom: { commit: string }
}

// A person without an installed app skips; a runner without one has lost
// its install step, and says so.
if (APP === '' && process.env.CI) {
  throw new Error('LEGIBLE_ACCEPTANCE_APP is empty on a CI runner: the install step named no app')
}
test.skip(
  APP === '',
  'set LEGIBLE_ACCEPTANCE_APP to an installed Legible Cities to run the checklist',
)

// ---------------------------------------------------------------- the machine

/** The executable inside a Mac bundle, or the path as given. */
function executableOf(path: string): string {
  const absolute = resolve(path)
  return absolute.endsWith('.app') ? join(absolute, 'Contents', 'MacOS', PRODUCT) : absolute
}

/** The folder the app is installed as: the `.app` on a Mac, the executable's folder elsewhere. */
function installOf(executable: string): string {
  const at = executable.lastIndexOf('.app')
  return process.platform === 'darwin' && at >= 0
    ? executable.slice(0, at + 4)
    : dirname(executable)
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

const real = (path: string): string => {
  try {
    return realpathSync.native(path)
  } catch {
    return resolve(path)
  }
}

/** Whether `path` is `root` or inside it, after links, without regard to case on Windows. */
function inside(path: string, root: string): boolean {
  const fold = (p: string): string =>
    process.platform === 'win32' ? real(p).toLowerCase() : real(p)
  const rel = relative(fold(root), fold(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const samePath = (a: string, b: string): boolean => inside(a, b) && inside(b, a)

/** The environment a person's launch would have: no development switch, no engine pointer. */
function launchEnvironment(exportFolder: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SCHEMATIC_|LEGIBLE_|PYTHON)/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  env.LEGIBLE_EXPORT_FOLDER = exportFolder
  return env
}

/** Every process whose executable or command line is inside `dir`. */
function processesUnder(dir: string): string[] {
  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ' +
          '$_.ExecutablePath.StartsWith($env:LC_ACCEPTANCE_DIR, [System.StringComparison]::OrdinalIgnoreCase) } | ' +
          'ForEach-Object { "$($_.ProcessId) $($_.Name)" }',
      ],
      {
        encoding: 'utf8',
        // Shorter than the wait around it, so a quit is probed several times.
        timeout: 8 * SECOND,
        windowsHide: true,
        env: { ...process.env, LC_ACCEPTANCE_DIR: dir },
      },
    )
    return (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '')
  }
  const result = spawnSync('ps', ['-axww', '-o', 'pid=,command='], {
    encoding: 'utf8',
    timeout: 8 * SECOND,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line.includes(dir))
}

/** What the bundled ffprobe says about a file, as JSON. */
function ffprobe(resources: string, file: string, countPackets = false): FfprobeAnswer {
  const exe = join(resources, 'ffmpeg', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const result = spawnSync(
    exe,
    [
      '-v',
      'error',
      ...(countPackets ? ['-count_packets'] : []),
      '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name,width,height,nb_read_packets',
      '-of',
      'json',
      file,
    ],
    { encoding: 'utf8', timeout: 5 * MINUTE, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
  if (result.error !== undefined)
    throw new Error(`the bundled ffprobe did not run: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`the bundled ffprobe exited ${result.status}: ${(result.stderr ?? '').trim()}`)
  }
  return JSON.parse(result.stdout) as FfprobeAnswer
}

interface FfprobeAnswer {
  format?: { format_name?: string; duration?: string }
  streams?: {
    codec_type?: string
    codec_name?: string
    width?: number
    height?: number
    nb_read_packets?: string
  }[]
}

/** The macOS version by its marketing number, or the kernel's elsewhere. */
function operatingSystem(): string {
  if (process.platform === 'darwin') {
    const sw = spawnSync('sw_vers', ['-productVersion'], {
      encoding: 'utf8',
      timeout: 10 * SECOND,
    })
    return `macOS ${(sw.stdout ?? '').trim() || release()} (${arch()})`
  }
  return `${osVersion()} ${release()} (${arch()})`
}

const addDays = (day: string, n: number): string => {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + n)
  return date.toISOString().slice(0, 10)
}

/** A figure as the Settings screen writes a size, in bytes; null for anything else. */
function bytesOf(text: string): number | null {
  if (/^empty/.test(text)) return 0
  const match = /^([\d.]+) (bytes?|kB|MB|GB|TB)\b/.exec(text)
  if (match === null) return null
  const power = { byte: 0, bytes: 0, kB: 1, MB: 2, GB: 3, TB: 4 }[match[2]] ?? 0
  return Number(match[1]) * 1000 ** power
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
const oneLine = (text: string, max = 700): string => {
  const flat = text.replace(ANSI, '').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
const messageOf = (error: unknown): string =>
  oneLine(error instanceof Error ? error.message : String(error))

// ------------------------------------------------------------------ the page

/**
 * Every sentence a status or alert line has held, in order, from a
 * MutationObserver installed at launch: a transient sentence - "downloaded
 * 170 of 170 bytes" - is read here after it has gone from the screen.
 */
async function installRecorder(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    const holder = window as unknown as { __said?: string[] }
    if (holder.__said !== undefined) return
    const said: string[] = []
    holder.__said = said
    const last = new WeakMap<Element, string>()
    const scan = (): void => {
      for (const element of document.querySelectorAll('[role="status"], [role="alert"]')) {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text !== '' && last.get(element) !== text) said.push(text)
        last.set(element, text)
      }
    }
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scan()
  })
}

/**
 * The app's window shown, raised and focused, as a person using it has it.
 * Chromium stops a page's animation frames in a window macOS reports as
 * occluded, and throttles its tasks, so a window left behind others shows a
 * map that does not move and progress sentences that are never drawn. The
 * window is the app's; nothing is run inside the viewer's frame.
 */
async function bringToFront(app: ElectronApplication, page: Page): Promise<string> {
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.moveTop()
    window.focus()
    if (process.platform === 'darwin') electronApp.focus({ steal: true })
  })
  return page.evaluate(() => document.visibilityState)
}

const saidSoFar = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __said?: string[] }).__said ?? [])

/** Poll until `probe` answers something other than undefined, or throw `what` at the deadline. */
async function until<T>(
  probe: () => Promise<T | undefined>,
  deadline: number,
  what: () => string | Promise<string>,
  every = SECOND,
): Promise<T> {
  const end = Date.now() + deadline
  for (;;) {
    const answer = await probe().catch(() => undefined)
    if (answer !== undefined) return answer
    if (Date.now() > end)
      throw new Error(`${await what()} (after ${Math.round(deadline / SECOND)} s)`)
    await sleep(every)
  }
}

/** The <dd> after a <dt> of exactly this text, inside `scope`. */
const definition = (scope: Locator, term: string): Locator =>
  scope
    .locator('dt', { hasText: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .locator('xpath=following-sibling::dd[1]')

const text = async (locator: Locator): Promise<string> =>
  ((await locator.textContent({ timeout: SHORT_MS })) ?? '').replace(/\s+/g, ' ').trim()

const projectFields = (page: Page): Locator => page.locator('main.project > dl.fields')

async function projectsNow(
  page: Page,
): Promise<{ id: string; name: string; date: string | null }[]> {
  return page.evaluate(async () =>
    (await window.api.projects.list()).map((p) => ({ id: p.id, name: p.name, date: p.date })),
  )
}

async function recordOf(page: Page, name: string): Promise<ProjectRecord> {
  const id = (await projectsNow(page)).find((p) => p.name === name)?.id
  if (id === undefined) throw new Error(`no project named ${name}`)
  return page.evaluate(async (which) => await window.api.projects.get(which), id)
}

async function openProject(page: Page, name: string): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 })
  if ((await heading.textContent().catch(() => '')) === name) return
  if ((await heading.textContent().catch(() => '')) !== 'Library') {
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(heading).toHaveText('Library')
  }
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(heading).toHaveText(name)
}

async function toLibrary(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 })
  if ((await heading.textContent().catch(() => '')) !== 'Library') {
    await page.getByRole('button', { name: 'Back to Library' }).click()
  }
  await expect(heading).toHaveText('Library')
}

/**
 * A run on a region's progress line to its end: done when its closing
 * sentence (`.prose`) matches `done`, failed when the line says it stopped.
 * Answers the sentence, the engine's message beneath the line, and the time.
 */
async function runToEnd(
  region: Locator,
  done: RegExp,
  deadline: number,
  before = '',
): Promise<{ ok: boolean; sentence: string; message: string; seconds: number }> {
  const started = Date.now()
  const stopped = /Nothing was (saved|written)|was cancelled|was not drawn|engine stopped/
  return until(
    async () => {
      const prose = (await region.locator('p.prose').allTextContents())
        .map((t) => t.replace(/\s+/g, ' ').trim())
        .join(' ')
      if (prose === before) return undefined
      const message = oneLine(
        (await region.locator('p.progress-message').allTextContents()).join(' '),
      )
      const seconds = Math.round((Date.now() - started) / SECOND)
      if (done.test(prose)) return { ok: true, sentence: prose, message, seconds }
      if (stopped.test(prose)) return { ok: false, sentence: prose, message, seconds }
      return undefined
    },
    deadline,
    async () =>
      `the run did not end; its line last said "${oneLine((await region.innerText().catch(() => '')) || '')}"`,
  )
}

// ----------------------------------------------------------------- the steps

interface Session {
  exe: string
  install: string
  profile: string
  exportFolder: string
  pins: Pins
  app: ElectronApplication | null
  page: Page | null
  resources: string
  userData: string
  /** What earlier steps learned, for later ones. */
  caltrainFeed: string | null
  laDay: string | null
  laLayout: string | null
  laLayoutText: string | null
  exports: string[]
  appVersion: string | null
}

/** One step's notes and its problems: a soft check records a problem and the step goes on. */
class StepLog {
  readonly notes: string[] = []
  readonly problems: string[] = []
  readonly unautomated: string[] = []
  readonly unchecked: string[] = []
  title: string | undefined

  note(line: string): void {
    this.notes.push(line)
  }

  notAutomated(line: string): void {
    this.unautomated.push(line)
  }

  /** Something this build does not have, so it was not checked; said, never passed. */
  notChecked(line: string): void {
    this.unchecked.push(line)
  }

  async soft(what: string, check: () => Promise<unknown> | unknown): Promise<void> {
    try {
      await check()
    } catch (error) {
      this.problems.push(`${what}: ${messageOf(error)}`)
    }
  }
}

test('a release, installed, through docs/acceptance.md', async () => {
  mkdirSync(OUT, { recursive: true })
  const recordPath = join(OUT, `acceptance-${PLATFORM}.md`)
  const record = new RunRecord(recordPath)
  record.applyPrior(process.env.LEGIBLE_ACCEPTANCE_PRIOR)
  // What only the workflow knows, said as such in a local run.
  for (const name of [
    'Clean machine?',
    'Installer file name',
    'Its SHA-256',
    'Matches SHA256SUMS.txt?',
  ] as const) {
    record.fieldUnlessSet(name, 'set by the acceptance workflow; not known to a local run')
  }
  record.anythingElse(
    TAG === ''
      ? 'No release tag was named (LEGIBLE_ACCEPTANCE_TAG), so a check of something newer than some releases runs only if this build has it, and says so.'
      : `The release under test: ${TAG}.`,
  )
  const started = new Date()
  record.field('OS and version', operatingSystem())
  record.field(
    'Machine',
    `${cpus()[0]?.model ?? 'unknown processor'}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GB`,
  )
  record.field('Date', started.toISOString().slice(0, 10))
  record.field('Run by', 'the automated acceptance run (tests/acceptance/acceptance.spec.ts)')
  for (const n of [1, 2, 21]) {
    if (record.result(n) === 'not run') {
      record.step(
        n,
        'not run',
        "The workflow's, not the spec's (.github/workflows/acceptance.yml).",
      )
    }
  }
  record.anythingElse(
    "Automated: a Playwright driver launched the installed app with a temporary profile (--user-data-dir) and LEGIBLE_EXPORT_FOLDER set to a temporary folder. The stranger's timed run, the screen-reader walkthrough and the Gatekeeper or SmartScreen clicks are a person's.",
  )
  record.write()

  const pins = JSON.parse(readFileSync(PINS_PATH, 'utf8')) as Pins
  const exe = executableOf(APP)
  const session: Session = {
    exe,
    install: installOf(exe),
    profile: mkdtempSync(join(TEMP_ROOT, 'lc-acceptance-profile-')),
    exportFolder: join(mkdtempSync(join(TEMP_ROOT, 'lc-acceptance-exports-')), 'exports'),
    pins,
    app: null,
    page: null,
    resources: '',
    userData: '',
    caltrainFeed: null,
    laDay: null,
    laLayout: null,
    laLayoutText: null,
    exports: [],
    appVersion: null,
  }
  record.anythingElse(`The app launched: ${session.exe}`)

  // The macOS log folder as it was, so only what this run creates is removed.
  const since = Date.now() - SECOND
  const macLogs = process.platform === 'darwin' ? join(homedir(), 'Library', 'Logs', PRODUCT) : null
  const logsBefore =
    macLogs === null
      ? null
      : {
          folder: existsSync(macLogs),
          files: new Set(LOG_FILES.filter((name) => existsSync(join(macLogs, name)))),
        }

  // What the run made, written the moment it is made and again as more is,
  // so a run that dies still leaves step 21 a list to check. Its paths are
  // absolute and unredacted, for the check; the workflow does not upload it.
  const made = {
    profile: session.profile,
    exports: dirname(session.exportFolder),
    logs: macLogs,
    logsFolderMade: logsBefore !== null && !logsBefore.folder,
    logFilesMade: [] as string[],
    kept: [] as string[],
    notRemoved: [] as string[],
  }
  const writeMade = (): void => {
    try {
      writeFileSync(join(OUT, 'made.json'), `${JSON.stringify(made, null, 2)}\n`)
    } catch (error) {
      record.anythingElse(`made.json could not be written: ${messageOf(error)}`)
    }
  }
  /** The macOS log files this run has created so far: there now, and not before it. */
  const noteLogFiles = (): void => {
    if (macLogs === null || logsBefore === null) return
    for (const name of LOG_FILES) {
      const path = join(macLogs, name)
      if (!logsBefore.files.has(name) && existsSync(path) && !made.logFilesMade.includes(path)) {
        made.logFilesMade.push(path)
      }
    }
    writeMade()
  }
  writeMade()

  const page = (): Page => {
    if (session.page === null || session.app === null) throw new Error('the app is not running')
    return session.page
  }

  const launch = async (): Promise<Page> => {
    const app = await electron.launch({
      executablePath: session.exe,
      args: [`--user-data-dir=${session.profile}`],
      cwd: session.install,
      env: launchEnvironment(session.exportFolder),
      timeout: LAUNCH_MS,
    })
    session.app = app
    const window = await app.firstWindow({ timeout: LAUNCH_MS })
    session.page = window
    noteLogFiles()
    await installRecorder(window)
    await bringToFront(app, window)
    const where = await app.evaluate(({ app: electronApp }) => ({
      userData: electronApp.getPath('userData'),
      resources: process.resourcesPath,
      packaged: electronApp.isPackaged,
      version: electronApp.getVersion(),
    }))
    session.resources = where.resources
    session.userData = where.userData
    if (!where.packaged) throw new Error('the app launched does not know itself as packaged')
    if (!inside(where.userData, session.profile)) {
      throw new Error(`--user-data-dir was not honoured: the profile is ${where.userData}`)
    }
    return window
  }

  const quit = async (): Promise<void> => {
    const app = session.app
    if (app === null) return
    const child = app.process()
    session.app = null
    session.page = null
    await Promise.race([app.close().catch(() => undefined), sleep(QUIT_MS)])
    const end = Date.now() + QUIT_MS
    while (child.exitCode === null && child.signalCode === null && Date.now() < end)
      await sleep(200)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      throw new Error(`the app did not quit within ${QUIT_MS / SECOND} s of being asked`)
    }
  }

  const engineReady = async (window: Page): Promise<void> => {
    await expect(window.getByRole('status', { name: 'Engine' })).toHaveText(
      `Engine ready (${pins.engine.version}).`,
      { timeout: READY_MS },
    )
  }

  const firstRunFinished = (on: Page): Promise<unknown> =>
    until(
      async () => {
        const result = await on.evaluate(async () => await window.api.firstRun.get())
        return result.finished ? result : undefined
      },
      FIRST_RUN_MS,
      () => 'the first-run check did not finish',
    )

  const runStep = async (
    n: number,
    needs: number[],
    body: (log: StepLog) => Promise<void>,
  ): Promise<void> => {
    await test.step(`${n}. ${STEP_TITLES[n]}`, async () => {
      const log = new StepLog()
      const begun = Date.now()
      const blocked = needs.filter(
        (m) => record.result(m) === 'fail' || record.result(m) === 'not run',
      )
      if (blocked.length > 0) {
        record.step(
          n,
          'fail',
          `Not attempted: it needs step ${blocked.join(' and ')}, which did not pass.`,
        )
        record.write()
        return
      }
      let thrown: string | null = null
      try {
        await body(log)
      } catch (error) {
        thrown = messageOf(error)
      }
      const failed = thrown !== null || log.problems.length > 0
      if (failed && session.page !== null) {
        const shot = join(OUT, `acceptance-${PLATFORM}-step-${String(n).padStart(2, '0')}.png`)
        await session.page.screenshot({ path: shot, fullPage: true }).catch(() => undefined)
      }
      const result: Result = failed
        ? 'fail'
        : log.unchecked.length > 0
          ? 'pass, part not checked'
          : log.unautomated.length > 0
            ? 'pass, part not automated'
            : 'pass'
      const notes = [
        ...(thrown === null ? [] : [`Stopped: ${thrown}`]),
        ...log.problems.map((p) => `Failed: ${p}`),
        ...log.notes,
        ...log.unchecked.map((u) => `Not checked, not in this build: ${u}`),
        ...log.unautomated.map((u) => `Not automated: ${u}`),
        `(${Math.round((Date.now() - begun) / SECOND)} s)`,
      ]
      record.step(n, result, notes.join(' '), log.title)
      record.write()
    })
  }

  try {
    // ---------------------------------------------------------------- 3
    await runStep(3, [], async (log) => {
      const launchedAt = Date.now()
      const window = await launch()
      const status = window.getByRole('status', { name: 'Engine' })
      const first = await text(status).catch(() => '')
      log.note(`The status line first read "${first}".`)
      await engineReady(window)
      const early = (await saidSoFar(window)).filter((s) =>
        /^(Checking the engine…|Starting the engine\.)$/.test(s),
      )
      if (early.length > 0) {
        log.note(`Seen before ready: ${[...new Set(early)].map((s) => `"${s}"`).join(', ')}.`)
      } else {
        log.notAutomated(
          'that the status line started at "Checking the engine…" or "Starting the engine.": neither was caught before "Engine ready".',
        )
      }
      record.field('Engine version', pins.engine.version)
      // Step 2's last point, which the first window is: the header.
      await log.soft(
        'the header: the mark and name, the status line, Jobs and Settings',
        async () => {
          const header = window.locator('header.app-header')
          await expect(header.locator('.brand')).toHaveText('Legible Cities')
          await expect(header.getByRole('status', { name: 'Engine' })).toBeVisible()
          await expect(header.getByRole('button', { name: /^Jobs, / })).toBeVisible()
          await expect(header.getByRole('button', { name: 'Settings' })).toBeVisible()
        },
      )

      const heading = window.getByRole('heading', { level: 1 })
      await log.soft('the Library heading', () => expect(heading).toHaveText('Library'))
      const empty = window.locator('.empty')
      await log.soft('the empty state', async () => {
        await expect(empty.getByRole('status')).toHaveText(
          'No projects yet. Pick one of the feeds below, or add your own, and make a project from it.',
        )
        await expect(empty.getByRole('button', { name: 'New project' })).toBeVisible()
      })

      // About thirty seconds without pressing anything, and the first-run
      // check to its end, whichever is later.
      await firstRunFinished(window)
      const rest = 30 * SECOND - (Date.now() - launchedAt)
      if (rest > 0) await window.waitForTimeout(rest)
      await log.soft('no dialog opens', async () => {
        const open = window.locator('dialog[open]')
        if ((await open.count()) > 0) {
          throw new Error(`a dialog is open: "${oneLine(await open.first().innerText())}"`)
        }
      })

      await log.soft('the presets', async () => {
        await expect(window.getByRole('heading', { name: 'Feeds' })).toBeVisible({
          timeout: SHORT_MS,
        })
        const rows = window.getByRole('list', { name: 'Presets' }).getByRole('listitem')
        await expect(rows.first()).toBeVisible()
        const count = await rows.count()
        const wrong: string[] = []
        for (let i = 0; i < count; i += 1) {
          const row = rows.nth(i)
          const words = oneLine(await row.innerText())
          const name = (await row.getAttribute('aria-label')) ?? ''
          if (!words.includes('·') || !words.includes('not downloaded yet')) wrong.push(words)
          if (
            (await row.getByRole('button', { name: `Start a project on ${name}` }).count()) !== 1
          ) {
            wrong.push(`${name} has no Start a project`)
          }
        }
        log.note(`${count} presets listed.`)
        if (wrong.length > 0)
          throw new Error(
            `rows without a city and network, "not downloaded yet" or Start a project: ${wrong.join('; ')}`,
          )
      })

      await window.getByRole('button', { name: 'Settings' }).click()
      await expect(heading).toHaveText('Settings')

      const tools = window.getByRole('region', { name: 'Bundled tools' })
      await log.soft('Bundled tools', async () => {
        await expect(tools.getByRole('status')).toHaveText('The bundled LOOM and ffmpeg ran.', {
          timeout: FIRST_RUN_MS,
        })
        for (const term of ['LOOM tools', 'ffmpeg and ffprobe']) {
          const said = await text(definition(tools, term))
          expect(said, term).toMatch(/^ran \(\d+ ms\)\.$/)
          log.note(`${term}: ${said}`)
        }
      })

      const versions = window.getByRole('region', { name: 'Versions' })
      await log.soft('Versions', async () => {
        await expect(versions.locator('dl')).toBeVisible({ timeout: SHORT_MS })
        const read = async (term: string): Promise<string> => text(definition(versions, term))
        const six = {
          Engine: await read('Engine'),
          Protocol: await read('Protocol'),
          Python: await read('Python'),
          'LOOM backend': await read('LOOM backend'),
          'LOOM commit': await read('LOOM commit'),
          ffmpeg: await read('ffmpeg'),
        }
        record.versions(Object.entries(six).map(([term, value]) => `${term}: ${value}`))
        const wrong: string[] = []
        if (six.Engine !== pins.engine.version)
          wrong.push(`Engine is ${six.Engine}, not ${pins.engine.version}`)
        if (six.Protocol !== '1') wrong.push(`Protocol is ${six.Protocol}`)
        if (!six.Python.includes(pins.python.version))
          wrong.push(`Python is ${six.Python}, not ${pins.python.version}`)
        if (six['LOOM backend'] !== 'native') wrong.push(`LOOM backend is ${six['LOOM backend']}`)
        if (six['LOOM commit'] !== pins.loom.commit)
          wrong.push(`LOOM commit is ${six['LOOM commit']}`)
        if (
          six.ffmpeg === '' ||
          six.ffmpeg === 'none found' ||
          !inside(six.ffmpeg, session.resources)
        ) {
          wrong.push(`ffmpeg is "${six.ffmpeg}", not the bundled one`)
        }
        if (wrong.length > 0) throw new Error(wrong.join('; '))
      })

      await log.soft('Folders', async () => {
        const enginePath = await text(window.locator('#engine-folder-path'))
        if (!samePath(enginePath, join(session.userData, 'engine'))) {
          throw new Error(`the engine folder is ${enginePath}, not the profile's engine folder`)
        }
        await expect(window.locator('#engine-folder-source')).toHaveText('the default')
        const exportPath = await text(window.locator('#export-folder-path'))
        if (!samePath(exportPath, session.exportFolder)) {
          throw new Error(`the export folder is ${exportPath}, not the run's`)
        }
        const size = window.locator('#engine-folder-size')
        await expect(size).not.toHaveText('Measuring…', { timeout: SHORT_MS })
        const measured = await text(size)
        expect(measured).toMatch(
          /^(empty.*|[\d.]+ (bytes?|kB|MB|GB|TB) in \d+ files?( counted so far)?)$/,
        )
        log.note(`Engine folder size: "${measured}".`)
      })
      log.note(
        'The Export folder reads "set in the environment" rather than "the default": the run sets LEGIBLE_EXPORT_FOLDER so nothing lands on a desktop.',
      )
      log.notAutomated(
        "whether the folders are at install.md's places: the run's profile and export folder are temporary.",
      )
      await window.getByRole('button', { name: 'Back to Library' }).click()
      await expect(heading).toHaveText('Library')
    })

    // ---------------------------------------------------------------- 4
    await runStep(4, [3], async (log) => {
      const window = page()
      await toLibrary(window)
      await window.locator('.empty').getByRole('button', { name: 'New project' }).click()
      const dialog = window.getByRole('dialog', { name: 'New project' })
      await expect(dialog).toBeVisible()
      const feed = dialog.getByRole('combobox', { name: 'Feed' })
      await log.soft('the Feed select opens on LA Metro Rail', async () => {
        await expect(feed).toHaveValue('la-metro-rail', { timeout: SHORT_MS })
        const shown = await feed.evaluate(
          (select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
        )
        expect(shown).toBe('LA Metro Rail (Los Angeles · Metro Rail)')
      })
      await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
      await dialog.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(dialog).toBeHidden()
      const entry = window.getByRole('button', { name: 'Open Los Angeles' })
      await expect(entry).toBeVisible()
      await log.soft('the Library row', async () => {
        await expect(entry).toContainText('Feed la-metro-rail')
        await expect(entry).toContainText('Service day not yet chosen')
        await expect(
          window.getByRole('list', { name: 'Projects' }).getByRole('listitem'),
        ).toHaveCount(1)
      })
      const mark = (await saidSoFar(window)).length
      await entry.click()
      await expect(window.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
      const fields = projectFields(window)
      await log.soft('the fields', async () => {
        await expect(definition(fields, 'Feed')).toHaveText('la-metro-rail')
        await expect(definition(fields, 'Mode')).toHaveText('all')
        await expect(definition(fields, 'Agency')).toHaveText('none')
        await expect(definition(fields, 'Service day')).toHaveText('not yet chosen')
        await expect(definition(fields, 'Layout')).toHaveText('not laid out yet')
      })
      const inFeed = window.getByRole('region', { name: 'In the feed' })
      const readStarted = Date.now()
      await expect(inFeed.locator('dl.fields').or(inFeed.getByRole('alert')).first()).toBeVisible({
        timeout: FEED_READ_MS,
      })
      if ((await inFeed.locator('dl.fields').count()) === 0) {
        throw new Error(`the feed was not read: "${oneLine(await inFeed.innerText())}"`)
      }
      const reading = (await saidSoFar(window))
        .slice(mark)
        .includes('Reading the feed, and downloading it first if it is not on this machine yet…')
      log.note(
        reading
          ? `"Reading the feed, and downloading it first…" was shown; it filled in after ${Math.round((Date.now() - readStarted) / SECOND)} s.`
          : `The feed filled in after ${Math.round((Date.now() - readStarted) / SECOND)} s; "Reading the feed…" was not seen.`,
      )
      if (!reading)
        log.problems.push(
          '"Reading the feed, and downloading it first if it is not on this machine yet…" was never shown',
        )
    })

    // ---------------------------------------------------------------- 5
    await runStep(5, [3], async (log) => {
      const window = page()
      await toLibrary(window)
      await window.getByRole('main').getByRole('button', { name: 'Add feed', exact: true }).click()
      const dialog = window.getByRole('dialog', { name: 'Add a feed' })
      await expect(dialog).toBeVisible()
      await log.soft('the dialog', async () => {
        await expect(dialog.getByRole('button', { name: 'Choose a zip' })).toBeVisible()
        await expect(dialog.getByLabel('Or from an address')).toBeVisible()
      })
      await dialog.getByLabel('Or from an address').fill(CALTRAIN_URL)
      const mark = (await saidSoFar(window)).length
      const pressed = Date.now()
      await dialog.getByRole('button', { name: 'Add feed', exact: true }).click()

      // While it runs, if the check is quick enough to see it.
      const cancelSeen = await dialog
        .getByRole('button', { name: 'Cancel the add' })
        .isVisible()
        .catch(() => false)
      const runText = await dialog
        .getByRole('region', { name: 'Adding the feed' })
        .innerText({ timeout: 2 * SECOND })
        .catch(() => '')
      if (cancelSeen) log.note('"Cancel the add" was shown while the add ran.')
      else
        log.notAutomated(
          '"Cancel the add" while the add ran: it had ended, or not begun, at the one look.',
        )
      if (runText !== '') {
        await log.soft('the two stages', () => {
          expect(runText).toContain('download')
          expect(runText).toContain('check')
        })
      } else {
        log.notAutomated("the progress line's two stages: the add was not caught while it ran.")
      }

      const ended = await until(
        async () => {
          if (!(await dialog.isVisible())) return { refused: null }
          const refused = oneLine((await dialog.getByRole('alert').textContent()) ?? '')
          return refused === '' ? undefined : { refused }
        },
        FEED_ADD_MS,
        () => 'the Add a feed dialog did not close',
      )
      if (ended.refused !== null) throw new Error(`the add was refused: "${ended.refused}"`)
      log.note(`The add took ${Math.round((Date.now() - pressed) / SECOND)} s.`)
      const said = (await saidSoFar(window)).slice(mark)
      await log.soft('the download on the line', () =>
        expect(
          said.some((s) => /downloaded [\d,]+ (of [\d,]+ )?bytes/.test(s)),
          said.join(' / '),
        ).toBe(true),
      )
      await log.soft("the check's sentence", () =>
        expect(
          said.some((s) => s.includes("checked the feed's tables")),
          said.join(' / '),
        ).toBe(true),
      )

      const added = window.getByRole('list', { name: 'Added' })
      await expect(added).toBeVisible({ timeout: SHORT_MS })
      const row = added.getByRole('listitem').first()
      const name = (await row.getAttribute('aria-label')) ?? ''
      session.caltrainFeed = name
      await log.soft('the Added row', async () => {
        expect(name).toBe('Caltrain')
        await expect(added.getByRole('listitem')).toHaveCount(1)
        await expect(row).toContainText('downloaded')
        await expect(row.getByRole('button', { name: `Start a project on ${name}` })).toBeVisible()
        await expect(row.getByRole('button', { name: `Remove ${name}` })).toBeVisible()
      })

      await row.getByRole('button', { name: `Start a project on ${name}` }).click()
      const create = window.getByRole('dialog', { name: 'New project' })
      await log.soft('the create dialog opens on the added feed', async () => {
        // The dialog chooses its feed in an effect after it opens, which a
        // slow machine may not have run by the first look: poll, as a person
        // would read it once the dialog has settled.
        const shown = (): Promise<string> =>
          create
            .getByRole('combobox', { name: 'Feed' })
            .evaluate(
              (select) =>
                (select as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
            )
        await expect
          .poll(async () => (await shown()).startsWith(name), { timeout: SHORT_MS })
          .toBe(true)
      })
      await create.getByLabel('Name', { exact: true }).fill('Caltrain')
      await create.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(window.getByRole('button', { name: 'Open Caltrain' })).toBeVisible()

      await row.getByRole('button', { name: `Remove ${name}` }).click()
      const confirm = window.getByRole('dialog', { name: `Remove ${name}?` })
      await expect(confirm).toBeVisible()
      await log.soft('Cancel is focused', () =>
        expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused(),
      )
      await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
      await log.soft('the refusal', () =>
        expect(confirm.getByRole('alert')).toHaveText(
          'One project uses this feed; delete the project first.',
          { timeout: SHORT_MS },
        ),
      )
      await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(confirm).toBeHidden()
      await log.soft('the row is still there', () =>
        expect(window.getByRole('listitem', { name, exact: true })).toBeVisible(),
      )
    })

    // ---------------------------------------------------------------- 6
    await runStep(6, [4], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      const inFeed = window.getByRole('region', { name: 'In the feed' })
      const fields = inFeed.locator('dl.fields')
      await expect(fields).toBeVisible({ timeout: FEED_READ_MS })
      await log.soft('the feed figures', async () => {
        for (const term of ['Operators', 'Stops', 'Trips']) {
          expect(await text(definition(fields, term)), term).not.toBe('')
        }
        expect(await text(definition(fields, 'Service'))).toMatch(
          /^\S+ to \S+; the engine would draw \S+$/,
        )
      })
      await log.soft('the route types', async () => {
        const histogram = inFeed.locator('table.histogram')
        await expect(histogram.locator('caption')).toHaveText(
          'Route types, and what the chosen mode keeps',
        )
        const kept = await histogram.locator('tbody tr td:last-child').allTextContents()
        expect(kept.length).toBeGreaterThan(0)
        expect(
          kept.every((k) => k.trim() === 'kept'),
          kept.join(', '),
        ).toBe(true)
      })
      const routes = inFeed.locator('table.routes')
      await log.soft('the routes caption', () =>
        expect(routes.locator('caption')).toHaveText(/^Routes: [\d,.\s]+$/),
      )
      const header = (label: string): Locator =>
        routes.getByRole('columnheader', { name: new RegExp(`^${label}`) })
      const press = (label: string): Promise<void> => header(label).getByRole('button').click()
      await log.soft('the sort order', async () => {
        await expect(header('Label')).toHaveAttribute('aria-sort', 'ascending')
        await press('Label')
        await expect(header('Label')).toHaveAttribute('aria-sort', 'descending')
        await press('Trips')
        await expect(header('Trips')).toHaveAttribute('aria-sort', 'descending')
        const trips = (await routes.locator('tbody tr td:nth-child(4)').allTextContents()).map(
          (t) => Number(t.replace(/\D/g, '')),
        )
        expect(
          trips.every((t, i) => i === 0 || trips[i - 1] >= t),
          trips.join(','),
        ).toBe(true)
        await press('Type')
        await expect(header('Type')).toHaveAttribute('aria-sort', 'ascending')
        await press('Type')
        await expect(header('Type')).toHaveAttribute('aria-sort', 'descending')
      })
      await log.soft('the Mode select', async () => {
        const mode = inFeed.getByRole('combobox', { name: 'Mode' })
        const options = (await mode.locator('option').allTextContents()).map((o) => o.trim())
        expect(options[0]).toBe('all (every type)')
        expect(options[options.length - 1]).toBe('other…')
        await expect(mode).toHaveValue('all')
        log.note(`Mode offers: ${options.join(', ')}.`)
      })
      const operators = await inFeed.getByRole('combobox', { name: 'Operator' }).count()
      log.note(
        `check: Los Angeles shows ${operators === 0 ? 'no' : operators} Operator select; the feed names "${await text(definition(fields, 'Operators'))}".`,
      )

      await toLibrary(window)
      await window
        .getByRole('listitem', { name: 'Mexico City Metro', exact: true })
        .getByRole('button', { name: /Start a project/ })
        .click()
      const create = window.getByRole('dialog', { name: 'New project' })
      await log.soft('the create dialog opens on cdmx-metro', () =>
        expect(create.getByRole('combobox', { name: 'Feed' })).toHaveValue('cdmx-metro'),
      )
      await create.getByLabel('Name', { exact: true }).fill('Mexico City')
      await create.getByRole('button', { name: 'Create', exact: true }).click()
      await openProject(window, 'Mexico City')
      await log.soft('Agency METRO', () =>
        expect(definition(projectFields(window), 'Agency')).toHaveText('METRO'),
      )
      const cdmx = window.getByRole('region', { name: 'In the feed' })
      await expect(cdmx.locator('dl.fields').or(cdmx.getByRole('alert')).first()).toBeVisible({
        timeout: FEED_READ_MS,
      })
      await log.soft('the Operator select', async () => {
        const operator = cdmx.getByRole('combobox', { name: 'Operator' })
        await expect(operator).toBeVisible()
        expect((await operator.locator('option').first().textContent())?.trim()).toBe(
          'every operator',
        )
      })
      await log.soft('the routes caption for METRO', () =>
        expect(cdmx.locator('table.routes caption')).toHaveText(/^Routes of METRO: [\d,.\s]+$/),
      )
      await window.getByRole('button', { name: 'Delete project' }).click()
      const confirm = window.getByRole('dialog', { name: 'Delete Mexico City?' })
      await expect(confirm).toBeVisible()
      await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(window.getByRole('heading', { level: 1 })).toHaveText('Library')
      await log.soft('Mexico City is gone', () =>
        expect(window.getByRole('button', { name: 'Open Mexico City' })).toHaveCount(0),
      )
    })

    // ---------------------------------------------------------------- 7
    await runStep(7, [4], async (log) => {
      const window = page()
      const layOut = async (
        name: string,
      ): Promise<{ ok: boolean; seconds: number; sentence: string; message: string }> => {
        await openProject(window, name)
        await window.getByRole('main').getByRole('button', { name: 'Lay out', exact: true }).click()
        const region = window.getByRole('region', { name: 'Layout run' })
        await expect(region).toBeVisible({ timeout: SHORT_MS })
        await log.soft(`${name}: the eight stages in order`, async () => {
          const labels = (await region.locator('svg text').allTextContents()).map((l) => l.trim())
          expect(labels).toEqual(LAYOUT_STAGES)
        })
        const cancel = await region.getByRole('button', { name: 'Cancel', exact: true }).isVisible()
        if (!cancel) {
          log.notAutomated(`${name}: Cancel beside the line while it ran, which was not caught.`)
        }
        const end = await runToEnd(region, /Laid out/, LAYOUT_MS)
        if (end.ok) {
          await log.soft(`${name}: every stage ticked`, async () => {
            const marks = await region
              .locator('svg rect.mark')
              .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('class') ?? ''))
            expect(marks.map((m) => m.includes('mark-done'))).toEqual(LAYOUT_STAGES.map(() => true))
          })
        }
        return end
      }
      log.notAutomated(
        "that the sentence beside the line is the engine's for the last stage that finished: each is replaced by the next, and a short one can go before it is drawn.",
      )

      const la = await layOut('Los Angeles')
      if (!la.ok) throw new Error(`Los Angeles was not laid out: "${la.sentence}" "${la.message}"`)
      const region = window.getByRole('region', { name: 'Layout run' })
      await log.soft('"Laid out."', () => expect(la.sentence).toBe('Laid out.'))
      await log.soft('the two buttons', async () => {
        await expect(region.getByRole('button', { name: 'Lay out again' })).toBeVisible()
        await expect(region.getByRole('button', { name: 'Re-layout' })).toBeVisible()
      })
      const fields = projectFields(window)
      await expect(definition(fields, 'Service day')).toHaveText(/^\d{4}-\d{2}-\d{2}$/)
      await expect(definition(fields, 'Layout')).toHaveText(/^[0-9a-f]{8}, made .+$/)
      session.laDay = await text(definition(fields, 'Service day'))
      session.laLayoutText = await text(definition(fields, 'Layout'))
      session.laLayout = session.laLayoutText.slice(0, 8)
      log.note(
        `Los Angeles: ${la.seconds} s, drawn for ${session.laDay}, layout ${session.laLayoutText}.`,
      )

      let caltrain = 'not run'
      if ((await projectsNow(window)).some((p) => p.name === 'Caltrain')) {
        const run = await layOut('Caltrain')
        caltrain = String(run.seconds)
        if (run.ok) log.note(`Caltrain: ${run.seconds} s, "${run.sentence}".`)
        else {
          log.problems.push(
            `Caltrain was not laid out: "${run.sentence}"; the engine said "${run.message}"`,
          )
          caltrain = `${run.seconds} (refused)`
        }
      } else {
        log.problems.push('there is no Caltrain project to lay out (step 5)')
      }
      log.title = `Lay out (LA: ${la.seconds} s; Caltrain: ${caltrain} s)`
    })

    // ---------------------------------------------------------------- 8
    await runStep(8, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')

      const diagnostics = window.getByRole('region', { name: 'What the build had to fudge' })
      await log.soft('the diagnostics', async () => {
        await expect(diagnostics).toBeVisible()
        const sentence = await text(diagnostics.getByRole('status').first())
        expect(sentence).toMatch(
          /^(No caveats: nothing was fudged, and the issues score is [\d.]+\.|\S+ caveats?, and an issues score of [\d.]+, where 0 is clean\.)$/,
        )
        log.note(`"${sentence}"`)
        await expect(diagnostics.locator('caption')).toHaveText(
          /^What the engine measured drawing the map for \d{4}-\d{2}-\d{2}$/,
        )
      })
      await log.soft('an explanation on a press, gone on Escape', async () => {
        const trigger = diagnostics.getByRole('button', { name: /^What .+ means$/ }).first()
        const described = (await trigger.getAttribute('aria-describedby')) ?? ''
        await trigger.click()
        await expect(trigger).toHaveAttribute('aria-expanded', 'true')
        const tip = window.locator(`[id="${described}"]`)
        await expect(tip).toBeVisible()
        await window.keyboard.press('Escape')
        await expect(tip).toBeHidden()
      })
      await log.soft('Copy as text', async () => {
        await diagnostics.getByRole('button', { name: 'Copy as text' }).click()
        await expect(
          diagnostics.getByText('The figures and the caveats are on the clipboard.', {
            exact: true,
          }),
        ).toBeVisible()
      })

      const stages = window.getByRole('region', { name: 'Where the routes run' })
      const group = stages.getByRole('group', { name: 'Stage' })
      await expect(stages.locator('dl.counts')).toBeVisible({ timeout: FEED_READ_MS })
      await log.soft('gtfs2graph first', async () => {
        await expect(group.getByRole('button', { name: 'gtfs2graph' })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        await expect(group.locator('.hint')).toHaveText('as the feed draws its routes')
      })
      const frame = stages.locator('iframe.stage-frame')
      const before = (await frame.getAttribute('srcdoc')) ?? ''
      await group.getByRole('button', { name: 'gtfs2graph' }).click()
      await group.getByRole('button', { name: 'loom' }).click()
      let blank = false
      const sampleUntil = Date.now() + 3 * SECOND
      while (Date.now() < sampleUntil) {
        if ((await frame.count()) === 0) blank = true
        await sleep(100)
      }
      await log.soft('loom pressed, its description only, a new drawing', async () => {
        await expect(group.getByRole('button', { name: 'loom' })).toHaveAttribute(
          'aria-pressed',
          'true',
        )
        await expect(group.getByRole('button', { name: 'gtfs2graph' })).toHaveAttribute(
          'aria-pressed',
          'false',
        )
        await expect(group.locator('.hint')).toHaveText('lines sorted onto shared track')
        expect(await stages.innerText()).not.toContain('as the feed draws its routes')
        await expect
          .poll(async () => ((await frame.getAttribute('srcdoc')) ?? '') !== before, {
            timeout: FEED_READ_MS,
          })
          .toBe(true)
        expect(blank, 'the drawing went blank between the stages').toBe(false)
      })
      await log.soft('the counts', async () => {
        const dl = stages.locator('dl.counts')
        for (const term of ['Nodes', 'Stations', 'Junctions', 'Edges', 'Lines']) {
          expect(await text(definition(dl, term)), term).toMatch(/^[\d,.\s]+$/)
        }
      })
      await log.soft('zoom, pan and fit from the keyboard', async () => {
        const pane = stages.getByRole('group', { name: /^The loom stage/ })
        const transform = (): Promise<string> =>
          frame.evaluate((el) => (el as HTMLElement).style.transform)
        await pane.focus()
        await window.keyboard.type('0')
        const fitted = await transform()
        await window.keyboard.type('+')
        const zoomed = await transform()
        expect(zoomed, '+ zooms').not.toBe(fitted)
        await window.keyboard.type('-')
        const out = await transform()
        expect(out, '- zooms out').not.toBe(zoomed)
        await window.keyboard.press('ArrowLeft')
        const panned = await transform()
        expect(panned, 'an arrow pans').not.toBe(out)
        await window.keyboard.type('0')
        expect(await transform(), '0 fits again').toBe(fitted)
        await expect(stages.locator('#stage-keys')).toHaveText(
          'Zoom with the wheel or plus and minus, pan by dragging or with the arrows, 0 to fit.',
        )
      })
      // The control is checked whenever this build has it. Whether the tag
      // contains the commit that brought it decides only what its absence
      // is: a failure, not in this build, or - when a tag was named and git
      // cannot tell - a problem of its own, never a quiet pass.
      const skipExpected = tagContains(FEATURES.skipPastMap)
      const skipPresent = (await window.locator('button.skip-link').count()) > 0
      const { name: skipName, commit: skipCommit, landed: skipLanded } = FEATURES.skipPastMap
      const skipShort = skipCommit.slice(0, 7)
      if (TAG !== '' && skipExpected === null) {
        log.problems.push(
          `git could not tell whether ${TAG} contains ${skipShort} (${skipName}, ${skipLanded}): the tag or the commit is not in this clone, or the clone is shallow`,
        )
      }
      if (skipPresent) {
        if (skipExpected === false) {
          log.note(`${skipName} is on the screen though ${TAG} was tagged before ${skipLanded}.`)
        }
        await log.soft('Skip past the map, then Rename', async () => {
          await window.keyboard.press('Tab')
          const skip = window.getByRole('button', { name: 'Skip past the map', exact: true })
          await expect(skip).toBeFocused()
          await expect
            .poll(() => skip.evaluate((el) => el.getBoundingClientRect().width))
            .toBeGreaterThan(1)
          await window.keyboard.press('Enter')
          await expect(window.getByRole('button', { name: 'Rename', exact: true })).toBeFocused()
        })
      } else if (skipExpected === true) {
        log.problems.push(
          `${skipName} is not on the screen, and ${TAG} contains ${skipShort}, which brought it`,
        )
      } else if (skipExpected === false) {
        log.notChecked(`${skipName}: ${TAG} was tagged before ${skipLanded} (${skipShort}).`)
      } else if (TAG === '') {
        log.notChecked(
          `${skipName}: the control is not in this build, and no tag was named (LEGIBLE_ACCEPTANCE_TAG) to say whether it should be; it landed in ${skipLanded} (${skipShort}).`,
        )
      }

      await log.soft('the viewer', async () => {
        const viewer = window.getByRole('region', { name: 'Map' })
        await expect(viewer).toBeVisible()
        const map = window.frameLocator('iframe.viewer-frame')
        const clock = map.locator('#clock')
        await expect(clock).toHaveText(/\d/, { timeout: SHORT_MS })
        // As a person would watch it: the frame scrolled into view (it sits
        // below the panels), and the window in front. Chromium throttles
        // animation frames in a cross-origin frame outside the viewport, and
        // in a window it reports as hidden. Only the app's page is scrolled;
        // nothing runs inside the frame.
        const frameElement = window.locator('iframe.viewer-frame')
        await frameElement.scrollIntoViewIfNeeded()
        const visibility = await bringToFront(session.app as ElectronApplication, window)
        await window.waitForTimeout(SECOND)
        const readings: string[] = [await text(clock)]
        const first = readings[0]
        const moved = await until(
          async () => {
            const now = await text(clock)
            if (now !== readings[readings.length - 1]) readings.push(now)
            return now !== first ? true : undefined
          },
          SHORT_MS,
          () => 'the clock did not move',
          250,
        ).catch(() => false)
        const count = await text(map.locator('#count'))
        if (moved) {
          log.note(
            `With the map scrolled into view, the page's clock moved from ${first}; ${count}.`,
          )
        } else if (visibility !== 'visible') {
          log.notAutomated(
            `whether the trains move: the window was ${visibility} to Chromium even after it was brought to the front, which stops the page's animation frames, and the clock stayed at ${first} (${count}).`,
          )
        } else {
          const where = await frameElement.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return {
              frame: `${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)}`,
              viewport: `${document.documentElement.clientWidth}x${document.documentElement.clientHeight}`,
              focused: document.hasFocus(),
              visibility: document.visibilityState,
            }
          })
          throw new Error(
            `the page's clock stayed at ${first} for ${SHORT_MS / SECOND} s with the map scrolled into view and the window in front: readings ${readings.join(', ')}; the frame at ${where.frame} in a ${where.viewport} viewport; the page ${where.visibility}, focused ${where.focused}; ${count}`,
          )
        }
        const linear = map.getByRole('button', { name: 'Linear', exact: true })
        await linear.click()
        await expect(linear).toHaveAttribute('aria-pressed', 'true')
        const schematic = map.getByRole('button', { name: 'Schematic', exact: true })
        await schematic.click()
        await expect(schematic).toHaveAttribute('aria-pressed', 'true')
        await expect(
          window.getByText("This project's map is not there. Lay it out again."),
        ).toHaveCount(0)
        await viewer
          .screenshot({ path: join(OUT, `acceptance-${PLATFORM}-viewer.png`) })
          .catch(() => undefined)
      })
      log.notAutomated(
        "whether the drawings, the trains and the page's controls look right (a screenshot of the viewer is kept beside the record).",
      )
    })

    // ---------------------------------------------------------------- 9
    await runStep(9, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      const mark = (await saidSoFar(window)).length
      const panel = window.getByRole('region', { name: 'Line colours' })
      const rows = panel.getByRole('list', { name: 'Lines' }).getByRole('listitem')
      await expect(rows.first()).toBeVisible({ timeout: FEED_READ_MS })
      const line = ((await rows.first().locator('.line-name').textContent()) ?? '').trim()
      const source = rows.first().locator('.line-source')
      const feedWords = await text(source)
      log.note(`Line ${line}, "${feedWords}" to begin with.`)

      await panel
        .getByRole('button', { name: `Choose the colour of line ${line}`, exact: true })
        .click()
      const picker = panel.getByRole('group', { name: `Colour for line ${line}` })
      await expect(picker).toBeVisible()
      const sliders = picker.getByRole('slider')
      await log.soft('the picker stays open through a drag and its release', async () => {
        for (const slider of [sliders.first(), sliders.last()]) {
          const box = await slider.boundingBox()
          if (box === null) throw new Error('a slider has no box')
          await window.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
          await window.mouse.down()
          await window.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4, { steps: 12 })
          await expect(picker).toBeVisible()
          await window.mouse.move(box.x + box.width + 160, box.y + box.height + 160, { steps: 6 })
          await expect(picker).toBeVisible()
          await window.mouse.up()
          await expect(picker).toBeVisible()
        }
      })
      await log.soft('a click outside the row closes it', async () => {
        await panel.getByRole('heading', { name: 'Line colours' }).click()
        await expect(picker).toBeHidden()
      })
      await log.soft('the row says your colour', () =>
        expect(source).toHaveText(/^your colour, #[0-9a-f]{6}$/),
      )
      await until(
        async () =>
          (await recordOf(window, 'Los Angeles')).colors[line] !== undefined ? true : undefined,
        REBUILD_MS,
        () => 'the dragged colour was never written to the project',
      )
      await log.soft('the redraw sentence', async () => {
        const said = (await saidSoFar(window)).slice(mark)
        expect(said).toContain(
          'Drawn in the colours you chose, from the stored layout. The stations have not moved.',
        )
      })

      await panel.getByRole('button', { name: new RegExp(`^Reset line ${line} to`) }).click()
      await log.soft('Reset puts the row back', () => expect(source).toHaveText(feedWords))
      await until(
        async () =>
          (await recordOf(window, 'Los Angeles')).colors[line] === undefined ? true : undefined,
        REBUILD_MS,
        () => 'the reset colour was never written to the project',
      )

      await panel
        .getByRole('button', { name: 'Choose the colour of lines the feed leaves uncoloured' })
        .click()
      const fallback = panel.getByRole('group', {
        name: 'Colour for lines the feed leaves uncoloured',
      })
      await fallback.getByLabel('Hex value').fill('#123456')
      await fallback.getByRole('button', { name: 'Use this colour' }).click()
      await until(
        async () =>
          (await recordOf(window, 'Los Angeles')).defaultColor === '#123456' ? true : undefined,
        REBUILD_MS,
        () => 'the default colour was never written to the project',
      )
      await log.soft('the default row', () => expect(panel).toContainText('drawn in #123456'))

      const resetAll = panel.getByRole('button', { name: 'Reset every line' })
      await resetAll.click()
      await until(
        async () => {
          const now = await recordOf(window, 'Los Angeles')
          return Object.keys(now.colors).length === 0 && now.defaultColor === '#888888'
            ? true
            : undefined
        },
        REBUILD_MS,
        () => 'Reset every line was never written to the project',
      )
      await log.soft('Reset every line is then unavailable', () => expect(resetAll).toBeDisabled())
      await log.soft('nothing was laid out', async () => {
        const said = (await saidSoFar(window)).slice(mark)
        expect(said.filter((s) => s.startsWith('Laid out'))).toEqual([])
      })
      log.note(
        'Dragged with the mouse through the colour square and the hue slider, each released outside the picker.',
      )
      log.notAutomated(
        "the drag's feel, and whether the map, its chips and the time chart show the new colour.",
      )
    })

    // ---------------------------------------------------------------- 10
    await runStep(10, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      const mark = (await saidSoFar(window)).length
      const panel = window.getByRole('region', { name: 'Line order' })
      const list = panel.getByRole('list', { name: 'Lines in the order they are drawn' })
      await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: FEED_READ_MS })
      const labels = async (): Promise<string[]> =>
        (await list.locator('.line-name').allTextContents()).map((l) => l.trim())
      const start = await labels()
      const total = start.length
      if (total < 3) throw new Error(`the list has ${total} lines; the step needs three`)
      const button = (label: string, way: 'up' | 'down'): Locator =>
        panel.getByRole('button', { name: `Move line ${label} ${way}`, exact: true })
      const status = panel.locator('p.hint[role="status"]')
      await log.soft('the ends are unavailable', async () => {
        await expect(button(start[0], 'up')).toBeDisabled()
        await expect(button(start[total - 1], 'down')).toBeDisabled()
      })
      await button(start[0], 'down').click()
      await log.soft('the first move is said', () =>
        expect(status).toHaveText(`${start[0]} is now 2 of ${total}.`),
      )
      const other = start[total - 1]
      await button(other, 'up').click()
      await log.soft('the second move is said', () =>
        expect(status).toHaveText(`${other} is now ${total - 1} of ${total}.`),
      )
      const shown = await labels()
      await until(
        async () => {
          const order = (await recordOf(window, 'Los Angeles')).lineOrder
          return JSON.stringify(order) === JSON.stringify(shown) ? true : undefined
        },
        REBUILD_MS,
        async () =>
          `the order was never written: the project has ${JSON.stringify((await recordOf(window, 'Los Angeles')).lineOrder)}`,
      )
      await log.soft('the redraw sentence', async () => {
        const said = (await saidSoFar(window)).slice(mark)
        expect(said).toContain(
          'Drawn with the lines in the order you chose, from the stored layout. The stations have not moved.',
        )
      })
      log.note(`Moved ${start[0]} down and ${other} up: ${shown.join(', ')}.`)
      const back = panel.getByRole('button', { name: 'Back to alphabetical' })
      await back.click()
      await log.soft('Back to alphabetical', async () => {
        await expect(status).toHaveText('The lines are in alphabetical order again.')
        await expect(back).toBeDisabled()
      })
      await until(
        async () =>
          (await recordOf(window, 'Los Angeles')).lineOrder.length === 0 ? true : undefined,
        REBUILD_MS,
        () => 'the alphabetical order was never written',
      )
      log.notAutomated("whether the page's line rows follow the order.")
    })

    // ---------------------------------------------------------------- 11
    await runStep(11, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      const group = window
        .getByRole('region', { name: 'Theme' })
        .getByRole('group', { name: 'The theme this map is drawn in' })
      const warm = group.getByRole('button', { name: 'Warm dark' })
      const sepia = group.getByRole('button', { name: 'Sepia' })
      const viewer = window.locator('iframe.viewer-frame')
      // Both halves of each kit button: the host React renders, and the
      // button inside its shadow root, which is what the role resolves to.
      const pressedState = (): Promise<string> =>
        group
          .locator('fig-button')
          .evaluateAll((hosts) =>
            hosts
              .map(
                (host) =>
                  `${(host.textContent ?? '').trim()}: variant ${host.getAttribute('variant')}, disabled ${host.hasAttribute('disabled')}, aria-pressed on the host ${host.getAttribute('aria-pressed')} and on its inner button ${host.shadowRoot?.querySelector('button')?.getAttribute('aria-pressed') ?? null}`,
              )
              .join('; '),
          )
      log.note(`Before any press: ${await pressedState()}.`)
      await log.soft('two buttons, Warm dark pressed', async () => {
        await expect(group.getByRole('button')).toHaveCount(2)
        try {
          await expect(warm).toHaveAttribute('aria-pressed', 'true', { timeout: 5 * SECOND })
        } catch {
          throw new Error(`Warm dark is not announced as pressed: ${await pressedState()}`)
        }
      })
      const interfaceTheme = await window.locator('html').getAttribute('data-theme')
      const mark = (await saidSoFar(window)).length
      await sepia.click()
      await log.soft('sepia at once, with no run', async () => {
        await expect(viewer).toHaveAttribute('src', /theme=sepia/)
        await expect(sepia).toHaveAttribute('aria-pressed', 'true')
        await expect(window.frameLocator('iframe.viewer-frame').locator('html')).toHaveAttribute(
          'data-theme',
          'sepia',
          { timeout: SHORT_MS },
        )
        await expect.poll(async () => (await recordOf(window, 'Los Angeles')).theme).toBe('sepia')
        await expect(window.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
          'Jobs, none running',
        )
        const said = (await saidSoFar(window)).slice(mark)
        expect(said.filter((s) => /^(Laid out|Drawn )/.test(s))).toEqual([])
        expect(await window.locator('html').getAttribute('data-theme')).toBe(interfaceTheme)
      })
      await warm.click()
      await log.soft('Warm dark brings it back', async () => {
        await expect(viewer).toHaveAttribute('src', /theme=warm-dark/)
        await expect
          .poll(async () => (await recordOf(window, 'Los Angeles')).theme)
          .toBe('warm-dark')
      })
      log.notAutomated('whether the page looks sepia and then warm dark.')
    })

    // ---------------------------------------------------------------- 12
    await runStep(12, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      const section = window.getByRole('region', { name: 'Service day' })
      const sentence = await text(section.locator('p.prose[role="status"]'))
      const parsed =
        /^Drawn for (\d{4}-\d{2}-\d{2})\. The feed covers (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2}); the busiest weekday, counted from (\d{4}-\d{2}-\d{2}), is (\d{4}-\d{2}-\d{2})\.$/.exec(
          sentence,
        )
      if (parsed === null) throw new Error(`the section says "${sentence}"`)
      const [, drawn, startDay, endDay, anchor, busiest] = parsed
      log.note(`"${sentence}"`)
      const control = section.getByLabel('Draw for another day')
      await log.soft('the calendar is bounded by the window', async () => {
        await expect(control).toHaveAttribute('min', startDay)
        await expect(control).toHaveAttribute('max', endDay)
      })
      const fields = projectFields(window)
      const layoutBefore = await text(definition(fields, 'Layout'))
      const run = window.getByRole('region', { name: 'Layout run' })

      const drawFor = async (day: string): Promise<void> => {
        const before = oneLine((await run.locator('p.prose').allTextContents()).join(' '))
        await section.getByRole('button', { name: 'Draw for this day' }).click()
        const end = await runToEnd(
          run,
          new RegExp(`^Drawn for ${day} from the stored layout\\. The stations have not moved\\.$`),
          REBUILD_MS,
          before,
        )
        if (!end.ok)
          throw new Error(`the rebuild for ${day} stopped: "${end.sentence}" "${end.message}"`)
        log.note(`Drawn for ${day} in ${end.seconds} s.`)
        await expect(definition(fields, 'Service day')).toHaveText(day)
        await log.soft(`the Layout after ${day}`, () =>
          expect(definition(fields, 'Layout')).toHaveText(layoutBefore),
        )
      }

      const other = [addDays(busiest, 1), addDays(busiest, -1), addDays(busiest, 2)].find(
        (day) => day >= startDay && day <= endDay && day !== drawn && day !== busiest,
      )
      if (other === undefined) {
        log.problems.push(`no day other than ${busiest} in ${startDay} to ${endDay} to choose`)
      } else {
        await control.fill(other)
        await drawFor(other)
      }
      // The button is unavailable while the control already holds the busiest
      // weekday, which it does when no other day could be drawn.
      if (other !== undefined || drawn !== busiest) {
        await section.getByRole('button', { name: 'Use the busiest weekday' }).click()
        await log.soft('the busiest weekday is put in the control', () =>
          expect(control).toHaveValue(busiest),
        )
        await drawFor(busiest)
      }

      const outside = addDays(endDay, 1)
      await control.fill(outside)
      await section.getByRole('button', { name: 'Draw for this day' }).click()
      await log.soft('a day outside is refused', () =>
        expect(
          section.getByText(`The feed covers ${startDay} to ${endDay}.`, { exact: true }),
        ).toBeVisible(),
      )
      await log.soft('and nothing runs', async () => {
        await expect(window.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
          'Jobs, none running',
        )
        expect((await recordOf(window, 'Los Angeles')).date).toBe(busiest)
      })
      session.laDay = busiest
      log.note(`Ended on the busiest weekday, ${busiest}, counted from ${anchor}.`)
      log.notAutomated(
        "the calendar's own days: min and max were checked, not the platform's date picker.",
      )
    })

    // ---------------------------------------------------------------- 13
    const exportTo = async (
      log: StepLog,
      file: string,
      deadline: number,
    ): Promise<{ seconds: number; path: string }> => {
      const window = page()
      const panel = window.getByRole('tabpanel', { name: 'Export' })
      const region = panel.getByRole('region', { name: 'Export' })
      const before =
        (await region.count()) === 0
          ? ''
          : oneLine((await region.locator('p.prose').allTextContents()).join(' '))
      await panel.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(region).toBeVisible({ timeout: SHORT_MS })
      const end = await runToEnd(region, /^Exported /, deadline, before)
      if (!end.ok) throw new Error(`the export stopped: "${end.sentence}" "${end.message}"`)
      await log.soft(`"Exported ${file}."`, () => expect(end.sentence).toBe(`Exported ${file}.`))
      await log.soft('Reveal', () =>
        expect(region.getByRole('button', { name: 'Reveal' })).toBeVisible(),
      )
      await log.soft('no path on the screen', async () =>
        expect(await region.innerText()).not.toMatch(/[/\\]/),
      )
      const path = join(session.exportFolder, 'Los Angeles', file)
      if (!existsSync(path))
        throw new Error(`${file} is not in the export folder's Los Angeles folder`)
      await log.soft('its sidecar', () => expect(existsSync(`${path}.json`)).toBe(true))
      session.exports.push(path)
      return { seconds: end.seconds, path }
    }

    const frameParams = async (window: Page): Promise<URLSearchParams> =>
      new URL((await window.locator('iframe.viewer-frame').getAttribute('src')) ?? 'app://local/')
        .searchParams

    await runStep(13, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      await window.getByRole('tab', { name: 'Export' }).click()
      const panel = window.getByRole('tabpanel', { name: 'Export' })
      const preset = panel.getByRole('combobox', { name: 'Preset' })
      await expect(preset).toBeVisible({ timeout: 2 * MINUTE })
      await log.soft('the thirteen presets by platform', async () => {
        await expect(preset).toHaveValue('instagram-reel')
        const shown = await preset.evaluate(
          (select) => (select as HTMLSelectElement).selectedOptions[0]?.textContent?.trim() ?? '',
        )
        expect(shown).toBe('instagram-reel: 1080 by 1920, video, MP4')
        const options = (await preset.locator('option').allTextContents()).map((o) => o.trim())
        expect(options).toHaveLength(13)
        const odd = options.filter((o) => !/^\S+: \d+ by \d+, .+$/.test(o))
        expect(odd).toEqual([])
        expect(
          await preset
            .locator('optgroup')
            .evaluateAll((g) => g.map((e) => e.getAttribute('label'))),
        ).toEqual(['Instagram', 'LinkedIn', 'Bluesky', 'X'])
        await expect(panel.getByRole('combobox', { name: 'Storyboard' })).toBeVisible()
      })
      await log.soft("the viewer shows the export's tall frame with the safe zones", async () => {
        await expect
          .poll(async () => (await frameParams(window)).get('frame'), { timeout: 2 * MINUTE })
          .toBe('1080:1920')
        expect((await frameParams(window)).get('safe')).toBe('1')
      })
      const mark = (await saidSoFar(window)).length
      const pressed = Date.now()
      // Watched beside the export rather than after it: these hold only while
      // it runs. The outcome is kept, never left as a rejection nobody holds.
      // Which stage the line marked as current, sampled while it ran: the
      // capture takes most of the export and is always caught; the plan and
      // the encode can be over between two looks, and are only noted.
      const current = new Set<string>()
      // The page's visibility, sampled with it: in a visible page the
      // recorder sees every sentence React draws, and "Captured n of n"
      // counts up for most of the export.
      const visibilities = new Set<string>()
      await bringToFront(session.app as ElectronApplication, window)
      const watch = (async () => {
        const region = panel.getByRole('region', { name: 'Export' })
        const cancel = region.getByRole('button', { name: 'Cancel', exact: true })
        await expect(cancel).toBeVisible({ timeout: SHORT_MS })
        const labels = (await region.locator('svg text').allTextContents()).map((l) => l.trim())
        expect(labels).toEqual(['plan', 'capture', 'encode'])
        await expect(preset).toBeDisabled()
        await expect(
          panel.getByText(
            'The choices wait until the export that is going has finished: it was planned from them.',
          ),
        ).toBeVisible()
        const end = Date.now() + EXPORT_MS
        while (Date.now() < end && (await cancel.count()) > 0) {
          for (const label of await region.locator('svg text.label-current').allTextContents()) {
            current.add(label.trim())
          }
          visibilities.add(await window.evaluate(() => document.visibilityState))
          await sleep(200)
        }
      })().then(
        () => null,
        (error: unknown) => error,
      )
      const done = await exportTo(log, 'la-metro-rail-instagram-reel.mp4', EXPORT_MS)
      await log.soft('while it ran: the stages, Cancel, and the choices unavailable', async () => {
        const problem = await watch
        if (problem !== null) throw problem
      })
      log.title = `Export a reel (${done.seconds} s)`
      log.note(
        `${done.seconds} s from the press (${Math.round((Date.now() - pressed) / SECOND)} s with the checks).`,
      )
      await log.soft('the stages moved through to the end', async () => {
        expect(current.has('capture'), `current stages seen: ${[...current].join(', ')}`).toBe(true)
        const marks = await panel
          .getByRole('region', { name: 'Export' })
          .locator('svg rect.mark')
          .evaluateAll((rects) => rects.map((rect) => rect.getAttribute('class') ?? ''))
        expect(marks.map((m) => m.includes('mark-done'))).toEqual([true, true, true])
        log.note(`The line marked as current: ${[...current].join(', ')}.`)
      })
      // The sentences beside the line are the engine's and the app's progress
      // reports, each replaced by the next: a short one can be gone before it
      // is drawn, so each is recorded as seen or not, and none is required.
      const said = (await saidSoFar(window)).slice(mark)
      const sentences: [string, RegExp][] = [
        ['Planning the export.', /^Planning the export\.$/],
        [
          'Planned …',
          /^Planned la-metro-rail-instagram-reel\.mp4: \d+ frames at \d+ frames per second\.$/,
        ],
        ['Capturing …', /^Capturing \d+ frames\.$/],
        ['Captured … of …', /^Captured \d+ of \d+ frames\.$/],
        ['Encoding …', /^Encoding \d+ frames\.$/],
        ['Encoded … of …', /^Encoded \d+ of \d+ frames\.$/],
      ]
      const seen = sentences.filter(([, pattern]) => said.some((t) => pattern.test(t)))
      const missed = sentences.filter(([, pattern]) => !said.some((t) => pattern.test(t)))
      log.note(
        `Sentences seen beside the line: ${seen.map(([name]) => `"${name}"`).join(', ') || 'none'}; not caught: ${missed.map(([name]) => `"${name}"`).join(', ') || 'none'}.`,
      )
      const capturedSeen = said.some((t) => /^Captured \d+ of \d+ frames\.$/.test(t))
      if (visibilities.size === 1 && visibilities.has('visible')) {
        if (!capturedSeen) {
          log.problems.push(
            '"Captured <n> of <n> frames." was never drawn, though the page was visible throughout the export',
          )
        }
      } else if (!capturedSeen) {
        log.notAutomated(
          `"Captured <n> of <n> frames." counting up: the page was ${[...visibilities].join(' and ') || 'never sampled'} during the export, and a hidden page's drawing is throttled.`,
        )
      }
      await log.soft('the file is a valid MP4', () => {
        const probe = ffprobe(session.resources, done.path)
        const video = probe.streams?.find((s) => s.codec_type === 'video')
        expect(probe.format?.format_name ?? '').toContain('mp4')
        expect(video?.width).toBe(1080)
        expect(video?.height).toBe(1920)
        expect(Number(probe.format?.duration ?? 0)).toBeGreaterThan(0)
        log.note(
          `${statSync(done.path).size} bytes; the bundled ffprobe reads ${probe.format?.format_name}, ${video?.codec_name} ${video?.width}x${video?.height}, ${probe.format?.duration} s.`,
        )
      })
      log.notAutomated(
        'whether the parts Instagram covers look shaded (the address asks for the safe zones).',
      )
    })

    // ---------------------------------------------------------------- 14
    await runStep(14, [7], async (log) => {
      const window = page()
      await openProject(window, 'Los Angeles')
      await window.getByRole('tab', { name: 'Export' }).click()
      const panel = window.getByRole('tabpanel', { name: 'Export' })
      const preset = panel.getByRole('combobox', { name: 'Preset' })
      await expect(preset).toBeEnabled({ timeout: 2 * MINUTE })

      await preset.selectOption('instagram-post')
      await log.soft('a still: View and Start time, no Storyboard, no shading', async () => {
        await expect(panel.getByRole('combobox', { name: 'View' })).toBeVisible()
        await expect(panel.getByLabel('Start time')).toBeVisible()
        await expect(panel.getByRole('combobox', { name: 'Storyboard' })).toHaveCount(0)
        await expect
          .poll(async () => (await frameParams(window)).get('frame'), { timeout: 2 * MINUTE })
          .toBe('1080:1350')
        expect((await frameParams(window)).get('safe')).toBeNull()
      })
      await expect
        .poll(async () => (await recordOf(window, 'Los Angeles')).export.preset)
        .toBe('instagram-post')
      const post = await exportTo(log, 'la-metro-rail-instagram-post.png', STILL_MS)
      await log.soft('the post is a PNG', () => {
        expect(readFileSync(post.path).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
        const video = ffprobe(session.resources, post.path).streams?.[0]
        expect([video?.codec_name, video?.width, video?.height]).toEqual(['png', 1080, 1350])
        log.note(`Post: ${post.seconds} s, ${statSync(post.path).size} bytes, 1080x1350 PNG.`)
      })

      await preset.selectOption('instagram-reel-gif')
      await log.soft('Storyboard returns', () =>
        expect(panel.getByRole('combobox', { name: 'Storyboard' })).toBeVisible(),
      )
      await expect
        .poll(async () => (await recordOf(window, 'Los Angeles')).export.preset)
        .toBe('instagram-reel-gif')
      const gif = await exportTo(log, 'la-metro-rail-instagram-reel-gif.gif', EXPORT_MS)
      await log.soft('the GIF has frames', () => {
        expect(readFileSync(gif.path).subarray(0, 6).toString('latin1')).toMatch(/^GIF8[79]a$/)
        const video = ffprobe(session.resources, gif.path, true).streams?.[0]
        expect([video?.codec_name, video?.width, video?.height]).toEqual(['gif', 630, 1120])
        expect(Number(video?.nb_read_packets ?? 0)).toBeGreaterThan(1)
        log.note(
          `GIF: ${gif.seconds} s, ${statSync(gif.path).size} bytes, ${video?.nb_read_packets} frames.`,
        )
      })
      log.notAutomated(
        'whether the post is a still of the map and the GIF plays as one (structure checked with the bundled ffprobe).',
      )
    })

    // ---------------------------------------------------------------- 15
    await runStep(15, [14], async (log) => {
      const window = page()
      const app = session.app as ElectronApplication
      await app.evaluate(({ shell }) => {
        const shown: string[] = []
        ;(globalThis as { __revealed?: string[] }).__revealed = shown
        shell.showItemInFolder = (path: string) => {
          shown.push(path)
        }
      })
      const panel = window.getByRole('tabpanel', { name: 'Export' })
      await panel
        .getByRole('region', { name: 'Export' })
        .getByRole('button', { name: 'Reveal' })
        .click()
      const gif = session.exports[session.exports.length - 1]
      const revealed = await until(
        async () => {
          const shown = await app.evaluate(
            () => (globalThis as { __revealed?: string[] }).__revealed ?? [],
          )
          return shown.length > 0 ? shown : undefined
        },
        SHORT_MS,
        () => 'Reveal asked the platform to show nothing',
      )
      await log.soft('Reveal shows the last export', () => {
        expect(revealed).toHaveLength(1)
        expect(samePath(revealed[0], gif), `${revealed[0]} is not ${gif}`).toBe(true)
      })
      await log.soft('the folder holds the three files and their sidecars', () => {
        const names = readdirSync(dirname(gif)).sort()
        expect(names).toEqual(
          [
            'la-metro-rail-instagram-post.png',
            'la-metro-rail-instagram-post.png.json',
            'la-metro-rail-instagram-reel-gif.gif',
            'la-metro-rail-instagram-reel-gif.gif.json',
            'la-metro-rail-instagram-reel.mp4',
            'la-metro-rail-instagram-reel.mp4.json',
          ].sort(),
        )
        expect(basename(dirname(gif))).toBe('Los Angeles')
      })
      log.note(
        'shell.showItemInFolder was replaced in the main process to record what it was asked to show.',
      )
      log.notAutomated(
        "that the Finder or File Explorer opens, comes to the front and selects the file, and install.md's place for the folder (the run's export folder is temporary).",
      )
    })

    // ---------------------------------------------------------------- 16
    await runStep(16, [3], async (log) => {
      const window = page()
      const toggle = window.getByRole('button', { name: /^Jobs, / })
      await log.soft('the toggle', () =>
        expect(toggle).toHaveAccessibleName('Jobs, none running', { timeout: 2 * MINUTE }),
      )
      await toggle.click()
      const inspector = window.getByRole('complementary', { name: 'Inspector' })
      await expect(inspector).toBeVisible()
      await log.soft('the heading takes focus', () =>
        expect(inspector.getByRole('heading', { name: 'Jobs' })).toBeFocused(),
      )
      const items = inspector.getByRole('listitem')
      const jobs = await items.evaluateAll((all) =>
        all.map((item) => ({
          title: (item.querySelector('.job-title')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          meta: (item.querySelector('.job-meta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          state: item.getAttribute('data-state'),
        })),
      )
      log.note(`Listed: ${jobs.map((j) => `${j.title} (${j.state})`).join('; ')}.`)
      const titles = jobs.map((j) => j.title)
      await log.soft('the exports first, newest first', () =>
        expect(titles.slice(0, 3)).toEqual([
          'Los Angeles Export as instagram-reel-gif',
          'Los Angeles Export as instagram-post',
          'Los Angeles Export as instagram-reel',
        ]),
      )
      await log.soft('the rebuilds, the layout runs and the feed add', () => {
        const missing = [
          /^Los Angeles Rebuild for \d{4}-\d{2}-\d{2}$/,
          /^Los Angeles Redraw in new colours$/,
          /^Los Angeles Redraw in a new line order$/,
          /^Los Angeles Layout run$/,
          /^Caltrain Layout run$/,
          /^Feeds Feed add of Caltrain$/,
        ].filter((pattern) => !titles.some((t) => pattern.test(t)))
        expect(missing.map(String)).toEqual([])
        expect(
          titles.filter((t) => / Layout run$/.test(t)),
          'two layout runs and no more',
        ).toHaveLength(2)
        expect(titles[titles.length - 1]).toBe('Feeds Feed add of Caltrain')
        expect(jobs.length).toBeLessThanOrEqual(20)
      })
      await log.soft('each finished', () =>
        expect(
          jobs
            .filter((j) => !/^finished, started /.test(j.meta))
            .map((j) => `${j.title}: ${j.meta}`),
        ).toEqual([]),
      )
      const failed = jobs.filter((j) => j.state === 'failed').length
      await log.soft('Details only on a failed job', async () => {
        const details = await inspector.locator('details').count()
        if (failed === 0) expect(details).toBe(0)
        else expect(details).toBeLessThanOrEqual(failed)
      })
      const first = items.first()
      await first.getByRole('button', { name: /^Copy log: / }).click()
      await log.soft('Copy log', async () => {
        await expect(first.getByRole('status')).toHaveText(
          'The log is on the clipboard, with the keys in web addresses taken out and your home folder written as ~.',
        )
        const copied = await (session.app as ElectronApplication).evaluate(({ clipboard }) =>
          clipboard.readText(),
        )
        expect(copied.startsWith(`# ${titles[0].replace(/^Los Angeles /, '')}, Los Angeles`)).toBe(
          true,
        )
        const plain = (t: string): string => t.replace(/[\\/]+/g, '/').toLowerCase()
        expect(plain(copied)).not.toContain(plain(homedir()))
      })
      await window.keyboard.press('Escape')
      await log.soft('Escape closes it and puts focus back on Jobs', async () => {
        await expect(inspector).toHaveCount(0)
        await expect(toggle).toBeFocused()
      })
    })

    // ---------------------------------------------------------------- 17
    await runStep(17, [3], async (log) => {
      const window = page()
      const before = await projectsNow(window)
      const la = before.some((p) => p.name === 'Los Angeles')
        ? await recordOf(window, 'Los Angeles')
        : null
      await quit()
      log.note('Quit through Playwright, which asks the app to quit as its menu does.')
      await log.soft('no process of the app is left', async () => {
        const left = await until(
          async () => {
            const now = processesUnder(session.install)
            return now.length === 0 ? now : undefined
          },
          QUIT_MS,
          () => `still running from the install: ${processesUnder(session.install).join('; ')}`,
        )
        expect(left).toEqual([])
      })

      const reopened = await launch()
      await engineReady(reopened)
      await firstRunFinished(reopened)
      await log.soft('no first-run dialog', () =>
        expect(reopened.locator('dialog[open]')).toHaveCount(0),
      )
      await log.soft('the Library', async () => {
        for (const project of before) {
          const entry = reopened.getByRole('button', { name: `Open ${project.name}` })
          await expect(entry).toBeVisible()
          await expect(entry).toContainText(`Service day ${project.date ?? 'not yet chosen'}`)
        }
        if (session.caltrainFeed !== null) {
          await expect(
            reopened
              .getByRole('list', { name: 'Added' })
              .getByRole('listitem', { name: session.caltrainFeed, exact: true }),
          ).toBeVisible({ timeout: SHORT_MS })
        }
      })
      if (la === null) throw new Error('there is no Los Angeles project to reopen')
      await openProject(reopened, 'Los Angeles')
      await log.soft('the same day and layout, drawn from the store', async () => {
        await expect(
          reopened.getByText(`Drawn from layout ${la.layout?.slice(0, 8)} for ${session.laDay}.`, {
            exact: true,
          }),
        ).toBeVisible()
        await expect(definition(projectFields(reopened), 'Service day')).toHaveText(
          session.laDay ?? '',
        )
        if (session.laLayoutText !== null) {
          await expect(definition(projectFields(reopened), 'Layout')).toHaveText(
            session.laLayoutText,
          )
        }
        await expect(reopened.getByRole('region', { name: 'Map' })).toBeVisible()
      })
      await log.soft('nothing runs', async () => {
        const toggle = reopened.getByRole('button', { name: /^Jobs, / })
        const end = Date.now() + 5 * SECOND
        while (Date.now() < end) {
          await expect(toggle).toHaveAccessibleName('Jobs, none running')
          await sleep(500)
        }
        await expect(reopened.getByRole('region', { name: 'Layout run' })).toHaveCount(0)
        await expect(
          reopened.getByRole('region', { name: 'What the build had to fudge' }),
        ).toHaveCount(0)
        const now = await recordOf(reopened, 'Los Angeles')
        expect({
          colors: now.colors,
          lineOrder: now.lineOrder,
          date: now.date,
          layout: now.layout,
        }).toEqual({
          colors: la.colors,
          lineOrder: la.lineOrder,
          date: la.date,
          layout: la.layout,
        })
      })
      await log.soft('the Export tab keeps the GIF', async () => {
        await reopened.getByRole('tab', { name: 'Export' }).click()
        await expect(
          reopened
            .getByRole('tabpanel', { name: 'Export' })
            .getByRole('combobox', { name: 'Preset' }),
        ).toHaveValue('instagram-reel-gif', { timeout: 2 * MINUTE })
      })
      log.notAutomated(
        'that the quit showed no dialog (the app has none of its own; a native one would have held the quit past its deadline).',
      )
    })

    // ---------------------------------------------------------------- 18
    await runStep(18, [3], async (log) => {
      const window = page()
      await window.getByRole('button', { name: 'Settings' }).click()
      await expect(window.getByRole('heading', { level: 1 })).toHaveText('Settings')
      await window.getByRole('button', { name: 'Copy diagnostics' }).click()
      await log.soft('the sentence', () =>
        expect(
          window.getByText(
            'The diagnostics are on the clipboard, with your home folder written as ~. Nothing was sent anywhere.',
            { exact: true },
          ),
        ).toBeVisible(),
      )
      const copied = await (session.app as ElectronApplication).evaluate(({ clipboard }) =>
        clipboard.readText(),
      )
      const version = /^## App\s+Legible Cities (\S+)/m.exec(copied)?.[1] ?? null
      session.appVersion = version
      if (version !== null) record.field('App version', version)
      await log.soft('the sections, in order', () => {
        expect(copied.startsWith('# Legible Cities diagnostics')).toBe(true)
        const at = [
          '## App',
          '## Runtime',
          '## Operating system',
          '## Engine',
          '## Bundled tools',
          '## main.log, the last 200 lines',
          '## engine.log, the last 200 lines',
          '## Maps drawn this session',
        ].map((heading) => ({ heading, at: copied.indexOf(`\n${heading}\n`) }))
        expect(at.filter((h) => h.at < 0).map((h) => h.heading)).toEqual([])
        expect(at.map((h) => h.at)).toEqual([...at.map((h) => h.at)].sort((a, b) => a - b))
        expect(version).not.toBeNull()
      })
      await log.soft('no home folder in it', () => {
        const plain = (t: string): string => t.replace(/[\\/]+/g, '/').toLowerCase()
        expect(plain(copied)).not.toContain(plain(homedir()))
        const depth = homedir().split(/[\\/]+/).length
        for (const temp of [tmpdir(), real(tmpdir())]) {
          const prefix = temp
            .split(/[\\/]+/)
            .slice(0, depth)
            .join('/')
          const homeBearing =
            plain(prefix) === plain(homedir()) ||
            (process.platform === 'win32' && /~\d+$/.test(prefix))
          if (homeBearing) expect(plain(copied)).not.toContain(plain(prefix))
        }
      })
      log.note(
        `App ${version ?? 'unknown'}; ${copied.split('\n').length} lines, read from the clipboard in the main process.`,
      )
    })

    // ---------------------------------------------------------------- 19
    await runStep(19, [3], async (log) => {
      const window = page()
      const app = session.app as ElectronApplication
      if ((await window.getByRole('heading', { level: 1 }).textContent()) !== 'Settings') {
        await window.getByRole('button', { name: 'Settings' }).click()
      }
      const licences = window.getByRole('region', { name: 'Licences' })
      await log.soft('the section', async () => {
        await expect(licences).toContainText(
          'Legible Cities is free software under the GNU General Public License, version 3 or later (GPL-3.0-or-later).',
        )
        await expect(licences.locator('dt').first()).toHaveText('The legible-cities engine')
        await expect(licences.locator('dd').first()).toHaveText('GPL-3.0-or-later')
        const terms = (await licences.locator('dt').allTextContents()).map((t) => t.trim())
        for (const pattern of [/^LOOM$/, /^FFmpeg$/, /^Python/, /^Electron$/, /^Chromium/]) {
          expect(
            terms.some((t) => pattern.test(t)),
            `${pattern}`,
          ).toBe(true)
        }
        const blank = (await licences.locator('dd').allTextContents()).filter(
          (d) => d.trim() === '',
        )
        expect(blank).toEqual([])
      })
      // On Windows, which has no viewer for Markdown by default, the notices
      // do not open, and the app shows the file in File Explorer instead:
      // the stub answers the platform's refusal there, so that path is the
      // one exercised and recorded.
      const refuseNotices = process.platform === 'win32'
      await app.evaluate(({ shell }, refuse) => {
        const opened: string[] = []
        ;(globalThis as { __opened?: string[] }).__opened = opened
        shell.openPath = (async (path: string) => {
          opened.push(`open ${path}`)
          return refuse && path.endsWith('THIRD_PARTY_NOTICES.md')
            ? 'There is no application associated with the given file name extension.'
            : ''
        }) as typeof shell.openPath
        shell.showItemInFolder = (path: string) => {
          opened.push(`show ${path}`)
        }
      }, refuseNotices)
      const opened = (): Promise<string[]> =>
        app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])
      const pressFor = async (name: string): Promise<string> => {
        const count = (await opened()).length
        const button = licences.getByRole('button', { name, exact: true })
        await expect(button).not.toHaveAttribute('aria-disabled', 'true')
        await button.click()
        return until(
          async () => {
            const now = await opened()
            return now.length > count ? now[now.length - 1].replace(/^(open|show) /, '') : undefined
          },
          SHORT_MS,
          async () =>
            `${name} opened nothing; the section says "${oneLine(await licences.locator('[role="status"]').innerText())}"`,
        )
      }
      await log.soft('Open the notices', async () => {
        const path = await pressFor('Open the notices')
        expect(basename(path)).toBe('THIRD_PARTY_NOTICES.md')
        expect(existsSync(path)).toBe(true)
        if (refuseNotices) {
          const shown = await until(
            async () => (await opened()).find((entry) => entry === `show ${path}`),
            SHORT_MS,
            async () =>
              `the notices were not shown in File Explorer after they did not open: ${(await opened()).join('; ')}`,
          )
          log.note(
            `With no viewer for Markdown, the app fell back to showing the file (${shown.slice(0, 4)}).`,
          )
        }
      })
      await log.soft('Show the licence texts', async () => {
        const path = await pressFor('Show the licence texts')
        expect(basename(path)).toBe('licenses')
        const names = readdirSync(path)
        for (const name of [
          'CPython-Doc-license.rst',
          'LICENSE.openssl-3.txt',
          'LICENSE.libffi.txt',
          'LICENSE.zlib.txt',
        ]) {
          expect(names, name).toContain(name)
        }
        log.note(`The licence texts: ${names.length} files.`)
      })
      await log.soft("Open Chromium's licences", async () => {
        const path = await pressFor("Open Chromium's licences")
        expect(basename(path)).toBe('LICENSES.chromium.html')
        expect(statSync(path).size).toBeGreaterThan(100_000)
      })
      await log.soft('no button says it is not bundled or missing', async () => {
        const said = await licences.innerText()
        expect(said).not.toMatch(/not bundled|missing/i)
      })
      log.note(
        'shell.openPath and shell.showItemInFolder were replaced in the main process to record what they were asked to open.',
      )
      log.notAutomated('what the system opens each file in.')
    })

    // ---------------------------------------------------------------- 20
    await runStep(20, [3], async (log) => {
      let window = page()
      if ((await window.getByRole('heading', { level: 1 }).textContent()) !== 'Settings') {
        await window.getByRole('button', { name: 'Settings' }).click()
      }
      const size = window.locator('#engine-folder-size')
      await expect(size).not.toHaveText('Measuring…', { timeout: SHORT_MS })
      const sizeBefore = await text(size)
      const projects = (await projectsNow(window)).length
      const reset = window.getByRole('button', { name: 'Reset engine data' })
      await reset.click()
      const confirm = window.getByRole('dialog', { name: "Reset the engine's data?" })
      await expect(confirm).toBeVisible()
      await log.soft('Cancel is focused and changes nothing', async () => {
        await expect(confirm.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(confirm).toBeHidden()
        expect((await projectsNow(window)).length).toBe(projects)
      })
      if (await confirm.isVisible())
        await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
      await reset.click()
      await confirm.getByRole('button', { name: 'Reset', exact: true }).click()
      await expect(confirm).toBeHidden({ timeout: 2 * MINUTE })
      const notice = window.getByRole('status').filter({ hasText: /^The engine's data is gone/ })
      await expect(notice).toBeVisible()
      const said = await text(notice)
      log.note(`"${said}"`)
      await log.soft('the folders named', () => {
        const match =
          /^The engine's data is gone: (.+)\. Start the app again so the engine reads its folder afresh\.$/.exec(
            said,
          )
        expect(match).not.toBeNull()
        const folders = (match?.[1] ?? '').split(', ')
        expect(folders.filter((f) => !['data', 'out', 'projects', 'frames'].includes(f))).toEqual(
          [],
        )
      })
      await log.soft('the size goes down', async () => {
        await expect
          .poll(
            async () => {
              const now = await text(size)
              return now !== 'Measuring…' && now !== sizeBefore
            },
            { timeout: SHORT_MS },
          )
          .toBe(true)
        const after = await text(size)
        log.note(`Engine folder: "${sizeBefore}", then "${after}".`)
        expect((bytesOf(after) ?? Infinity) < (bytesOf(sizeBefore) ?? -Infinity)).toBe(true)
      })
      await window.getByRole('button', { name: 'Back to Library' }).click()
      await log.soft('the empty state again', () =>
        expect(window.locator('.empty').getByRole('status')).toContainText('No projects yet.'),
      )

      await quit()
      window = await launch()
      await engineReady(window)
      await log.soft('after a start: no Added list, presets not downloaded', async () => {
        await expect(window.getByRole('heading', { name: 'Feeds' })).toBeVisible({
          timeout: SHORT_MS,
        })
        await expect(window.getByRole('list', { name: 'Added' })).toHaveCount(0)
        const rows = await window
          .getByRole('list', { name: 'Presets' })
          .getByRole('listitem')
          .allInnerTexts()
        expect(rows.filter((r) => !r.includes('not downloaded yet'))).toEqual([])
      })
      await log.soft('the exports are still there', () =>
        expect(session.exports.filter((path) => !existsSync(path))).toEqual([]),
      )
    })
  } finally {
    await quit().catch(() => undefined)
    const finished = new Date()
    record.field('Started, finished', `${started.toISOString()}, ${finished.toISOString()}`)
    record.field(
      'Time taken',
      `${Math.round((finished.getTime() - started.getTime()) / MINUTE)} min`,
    )

    // What the run made, removed; the workflow checks it is gone (step 21).
    // A removal that fails is said, not thrown: the record must still be written.
    noteLogFiles()
    const remove = (path: string, options: Parameters<typeof rmSync>[1]): void => {
      try {
        rmSync(path, options)
      } catch (error) {
        made.notRemoved.push(path)
        record.anythingElse(`Could not remove ${path}: ${messageOf(error)}`)
      }
    }
    const folder = { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }
    remove(session.profile, folder)
    remove(dirname(session.exportFolder), folder)
    if (macLogs !== null && logsBefore !== null) {
      for (const path of [...made.logFilesMade]) {
        if (!existsSync(path)) continue
        if (writtenSince(path, since)) {
          remove(path, { force: true })
        } else {
          // A rotation turned a person's own log into a file that did not exist.
          made.logFilesMade.splice(made.logFilesMade.indexOf(path), 1)
          made.kept.push(path)
        }
      }
      for (const name of logsBefore.files) made.kept.push(join(macLogs, name))
      if (!logsBefore.folder) {
        try {
          rmdirSync(macLogs)
        } catch {
          // Not empty: something else wrote there, and it is not this run's to remove.
        }
      }
    }
    writeMade()
    if (made.kept.length > 0) {
      record.anythingElse(
        `Log files that were there before the run keep its lines: ${made.kept.join(', ')}`,
      )
    }
    record.write()
    process.stdout.write(`\n${redact(record.render())}\n`)
  }

  const failed = Object.keys(STEP_TITLES)
    .map(Number)
    .filter((n) => record.result(n) === 'fail')
  expect(failed, `the steps that failed; the record is ${recordPath}`).toEqual([])
})
