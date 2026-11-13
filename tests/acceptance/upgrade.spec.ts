// Step 22 of the acceptance checklist, the update over 0.1.0
// (docs/acceptance.md), in three phases with an install between each, run
// by .github/workflows/acceptance.yml after step 21 in the same job:
//
//   seed   the real 0.1.0 app, installed from its own Release: the LA Metro
//          Rail card laid out, Layout and Made read from cell 02, an
//          instagram-post exported, quit; what it made written down in
//          upgrade.json
//   after  the release under test, installed over it: the project redrawn
//          once from the stored layout, Layout and Made as written down, the
//          post listed and unchanged, the record now version 2, nothing run
//          on a second open, a new still exported
//   back   0.1.0 installed again: the Library marks the project read-only
//          and its record's bytes do not change, as install.md says
//
// Skipped unless LEGIBLE_UPGRADE_PHASE names a phase. Run one phase at a
// time, the file named so the checklist's own spec is not run again:
//
//   LEGIBLE_UPGRADE_PHASE=seed LEGIBLE_UPGRADE_APP=<the installed app> \
//     npm run test:acceptance -- tests/acceptance/upgrade.spec.ts
//
//   LEGIBLE_UPGRADE_APP      the executable, or on a Mac the `.app` bundle
//   LEGIBLE_UPGRADE_RECORD   upgrade.json (default: upgrade.json in
//                            LEGIBLE_ACCEPTANCE_OUT, or acceptance-results)
//   LEGIBLE_UPGRADE_EXPORTS  the export folder the seed makes (default: a
//                            new temporary folder); later phases use the one
//                            the seed wrote down
//   LEGIBLE_UPGRADE_VERSION  the version `after` must find (default: any but
//                            0.1.0)
//
// **Every phase uses the version's own default profile**: no
// `--user-data-dir`, so each version's own path resolution is what links
// them, as it does for a person. That is the machine's own profile, so a
// phase is never run on a machine where Legible Cities keeps anything of a
// person's: the seed refuses a profile that already holds a project. Only
// the export folder is a temporary one, through LEGIBLE_EXPORT_FOLDER, so
// nothing lands on a desktop.
//
// Two things the hosted-runner spike found, and the checks allow for:
// 0.1.0 and later versions write Made differently ("9/29/2026, 7:16:51 PM"
// and "29 September 2026 at 7:16 PM" for one moment), so Made is compared
// by the moment it names (upgrade.mjs, `sameMade`, `madeAt`), never by its
// words; and a layout's id is not the same from run to run (topo is not
// deterministic), so the seed writes its own down and nothing here names
// one.
//
// It launches the app, so never beside another launch of it.

import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { dayWords } from '../../src/renderer/src/dates'
import { outputName } from '../../src/renderer/src/notebook/outputWords'
import { cellHeading, expandHeading, openCell } from '../support/project'
import { MINUTE, SECOND, inside, launchApp, sleep, until, type LaunchSession } from './harness'
import {
  FROM_VERSION,
  UPGRADE_RECORD,
  madeAt,
  readUpgrade,
  sameMade,
  seedOf,
  type Phase,
  type PhaseResult,
  type Upgrade,
} from './upgrade.mjs'

const PHASE = (process.env.LEGIBLE_UPGRADE_PHASE ?? '') as Phase | ''
const APP = process.env.LEGIBLE_UPGRADE_APP ?? ''
const repoRoot = resolve(__dirname, '../..')
const OUT = resolve(process.env.LEGIBLE_ACCEPTANCE_OUT || join(repoRoot, 'acceptance-results'))
const RECORD = process.env.LEGIBLE_UPGRADE_RECORD || join(OUT, 'upgrade.json')
const TEMP_ROOT =
  process.env.LEGIBLE_ACCEPTANCE_TEMP || (process.env.CI ? process.env.RUNNER_TEMP : '') || tmpdir()
const EXPECTED_VERSION = process.env.LEGIBLE_UPGRADE_VERSION ?? ''

const PRODUCT = 'Legible Cities'
const LA = 'LA Metro Rail'
const POST = 'la-metro-rail-instagram-post.png'
/** The new still `after` makes: not the post, so the post 0.1.0 made stays as it was. */
const SQUARE_PRESET = 'instagram-square'
const SQUARE = 'la-metro-rail-instagram-square.png'
/** The sentence a redraw for the record's day ends on (LayoutRun.tsx, `drawnSentence`). */
const drawnFor = (day: string): string =>
  `Drawn for ${dayWords(day)} from the stored layout. The stations have not moved.`
/** What the project screen says under its heading once every cell is drawn (runAll.ts). */
const ALL_DRAWN = 'The map is drawn from every cell.'
const NONE_RUNNING = 'Jobs, none running'

const READY_MS = 5 * MINUTE
const LAYOUT_MS = 30 * MINUTE
const REDRAW_MS = 15 * MINUTE
const STILL_MS = 15 * MINUTE
const QUIT_MS = 30 * SECOND
const SHORT_MS = 30 * SECOND
/** How long nothing must run for "nothing runs" to be said. */
const QUIET_MS = 5 * SECOND

test.skip(PHASE === '', 'LEGIBLE_UPGRADE_PHASE names no phase of the update over 0.1.0')

// ---------------------------------------------------------------- the files

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

type StoredRecord = Record<string, unknown> & {
  name?: unknown
  version?: unknown
  layout?: unknown
  made?: unknown
  date?: unknown
  drawn?: Record<string, unknown> | null
  export?: { preset?: unknown } | null
}

/** Every project record under a profile's engine home, as the file holds it. */
function storedProjects(userData: string): { path: string; record: StoredRecord }[] {
  const root = join(userData, 'engine', 'projects')
  if (!existsSync(root)) return []
  const found: { path: string; record: StoredRecord }[] = []
  for (const id of readdirSync(root)) {
    const path = join(root, id, 'project.json')
    if (!existsSync(path)) continue
    found.push({ path, record: JSON.parse(readFileSync(path, 'utf8')) as StoredRecord })
  }
  return found
}

const readRecordFile = (path: string): StoredRecord =>
  JSON.parse(readFileSync(path, 'utf8')) as StoredRecord

function readUpgradeFile(): Upgrade {
  if (!existsSync(RECORD)) {
    throw new Error(`there is no ${basename(RECORD)}: the seed has not run`)
  }
  return readUpgrade(readFileSync(RECORD, 'utf8'))
}

function writeUpgrade(upgrade: Upgrade): void {
  mkdirSync(dirname(RECORD), { recursive: true })
  writeFileSync(RECORD, `${JSON.stringify(upgrade, null, 2)}\n`)
}

// --------------------------------------------------------------- the phase

/** One phase's findings: a soft check records its failure and the phase goes on. */
class PhaseLog {
  readonly problems: string[] = []
  readonly notes: string[] = []

  async soft(what: string, check: () => unknown | Promise<unknown>): Promise<boolean> {
    try {
      await check()
      return true
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error))
        .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
        .replace(/\s+/g, ' ')
        .trim()
      this.problems.push(`${what}: ${message.slice(0, 500)}`)
      return false
    }
  }

  note(line: string): void {
    this.notes.push(line)
  }

  result(thrown: string | null): PhaseResult {
    const problems = thrown === null ? this.problems : [...this.problems, thrown]
    return { ok: problems.length === 0, problems, notes: this.notes }
  }
}

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

const samePath = (a: string, b: string): boolean => inside(a, b) && inside(b, a)

/** The app on its default profile, and what it says it is. */
async function launch(
  session: LaunchSession,
): Promise<{ page: Page; app: ElectronApplication; version: string }> {
  const page = await launchApp(session, () => undefined)
  const app = session.app as ElectronApplication
  const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
  return { page, app, version }
}

async function quit(session: LaunchSession): Promise<void> {
  const app = session.app
  if (app === null) return
  const child = app.process()
  session.app = null
  session.page = null
  await Promise.race([app.close().catch(() => undefined), sleep(QUIT_MS)])
  const end = Date.now() + QUIT_MS
  while (child.exitCode === null && child.signalCode === null && Date.now() < end) await sleep(200)
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    throw new Error(`the app did not quit within ${QUIT_MS / SECOND} s of being asked`)
  }
}

/** The engine ready and the Library's sample cities drawn: true of 0.1.0 and of every later version. */
async function libraryReady(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Engine' })).toHaveText(/^Engine ready/, {
    timeout: READY_MS,
  })
  await expect(page.getByRole('heading', { name: 'Sample cities' })).toBeVisible({
    timeout: READY_MS,
  })
}

// ------------------------------------------------------- the page, any version

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/** The <dd> after a <dt> of exactly this text, inside `scope`. */
const definition = (scope: Locator, term: string): Locator =>
  scope
    .locator('dt', { hasText: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    .locator('xpath=following-sibling::dd[1]')

/** Cell 02's provenance strip, the same element in 0.1.0 and since (pull request 212). */
const processStrip = (page: Page): Locator =>
  page.locator('section.cell[data-cell="02"] .cell-footer > dl.cell-provenance')

const stripRow = async (page: Page, term: string): Promise<string> =>
  oneLine((await definition(processStrip(page), term).textContent({ timeout: SHORT_MS })) ?? '')

/**
 * A run on a region's progress line to its end: done when its closing
 * sentence (`.prose`) matches `done`, failed when the line says it stopped.
 */
async function runToEnd(
  region: Locator,
  done: RegExp,
  deadline: number,
  before = '',
): Promise<{ ok: boolean; sentence: string; seconds: number }> {
  const started = Date.now()
  const stopped = /Nothing was (saved|written)|was cancelled|was not drawn|engine stopped/
  return until(
    async () => {
      const prose = oneLine((await region.locator('p.prose').allTextContents()).join(' '))
      if (prose === before) return undefined
      const seconds = Math.round((Date.now() - started) / SECOND)
      if (done.test(prose)) return { ok: true, sentence: prose, seconds }
      if (stopped.test(prose)) return { ok: false, sentence: prose, seconds }
      return undefined
    },
    deadline,
    async () =>
      `the run did not end; its line last said "${oneLine((await region.innerText().catch(() => '')) || '')}"`,
  )
}

const saidSoFar = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __said?: string[] }).__said ?? [])

/** The Jobs button says none is running, and goes on saying so for `QUIET_MS`. */
async function nothingRuns(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /^Jobs, / })
  const end = Date.now() + QUIET_MS
  while (Date.now() < end) {
    await expect(toggle).toHaveAccessibleName(NONE_RUNNING)
    await sleep(500)
  }
}

/** Ask the platform to show nothing, and note what Reveal asked it to show. */
async function catchReveal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const shown: string[] = []
    ;(globalThis as { __revealed?: string[] }).__revealed = shown
    shell.showItemInFolder = (path: string) => {
      shown.push(path)
    }
  })
}

const revealed = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as { __revealed?: string[] }).__revealed ?? [])

// ----------------------------------------------------------------- 0.1.0

// The locators of the v0.1.0 tag's own spec, steps 4 and 12, with
// tests/support/project.ts at that tag; the hosted-runner spike drove the
// published 0.1.0 with them as they are.

/** 0.1.0's sample card: its accessible name begins with the network's. */
const sampleCard = (page: Page): Locator =>
  page
    .getByRole('list', { name: 'Presets' })
    .getByRole('listitem', { name: LA, exact: true })
    .getByRole('button')

/** 0.1.0's cell 06: its own group, opened by its heading row. */
async function openExportCell010(page: Page): Promise<Locator> {
  const heading = cellHeading(page, 'export')
  if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click()
  const group = page.getByRole('group', { name: '06 Export', exact: true })
  await expect(group).toBeVisible({ timeout: SHORT_MS })
  return group
}

async function seed(session: LaunchSession, log: PhaseLog): Promise<Upgrade> {
  const upgrade: Upgrade = { record: UPGRADE_RECORD, phases: {} }
  const { page, version } = await launch(session)
  if (version !== FROM_VERSION) {
    throw new Error(`the app launched is ${version}, not ${FROM_VERSION}`)
  }
  const userData = session.userData
  log.note(`${FROM_VERSION} ran on its default profile.`)
  const already = storedProjects(userData)
  if (already.length > 0) {
    throw new Error(
      `the default profile already holds ${already.length} project(s); the seed runs only on a machine with none`,
    )
  }
  await libraryReady(page)

  const card = sampleCard(page)
  const pressed = Date.now()
  await card.click({ timeout: SHORT_MS })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LA, { timeout: SHORT_MS })
  const run = page.getByRole('region', { name: 'Layout run' })
  await expect(run).toBeVisible({ timeout: SHORT_MS })
  const laidOut = await runToEnd(run, /Laid out/, LAYOUT_MS)
  if (!laidOut.ok) throw new Error(`${LA} was not laid out: "${laidOut.sentence}"`)
  const layoutSeconds = Math.round((Date.now() - pressed) / SECOND)
  const layout = await stripRow(page, 'Layout')
  const made = await stripRow(page, 'Made')

  const group = await openExportCell010(page)
  const preset = group.getByRole('combobox', { name: 'Preset' })
  await expect(preset).toBeEnabled({ timeout: 2 * MINUTE })
  await preset.selectOption('instagram-post')
  // The choice is written a moment after it is made; the export reads it.
  const project = await until(
    async () => {
      const found = storedProjects(userData).filter((p) => p.record.name === LA)
      return found.length === 1 && found[0].record.export?.preset === 'instagram-post'
        ? found[0]
        : undefined
    },
    SHORT_MS,
    () => `the choice of instagram-post never reached ${LA}'s record`,
  )
  const exportRegion = group.getByRole('region', { name: 'Export' })
  const before =
    (await exportRegion.count()) === 0
      ? ''
      : oneLine((await exportRegion.locator('p.prose').allTextContents()).join(' '))
  await group.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportRegion).toBeVisible({ timeout: SHORT_MS })
  const exported = await runToEnd(exportRegion, /^Exported /, STILL_MS, before)
  if (!exported.ok) throw new Error(`the post was not exported: "${exported.sentence}"`)
  await log.soft(`"Exported ${POST}."`, () => expect(exported.sentence).toBe(`Exported ${POST}.`))
  await quit(session)

  const exportFile = join(session.exportFolder, LA, POST)
  if (!existsSync(exportFile)) throw new Error(`${POST} is not in the export folder's ${LA} folder`)
  const stored = readRecordFile(project.path)
  if (typeof stored.version !== 'number') throw new Error("the record's version is not a number")
  if (typeof stored.made !== 'string')
    throw new Error('the record says no moment its layout was made')
  if (typeof stored.layout !== 'string') throw new Error('the record names no layout')
  const date = typeof stored.date === 'string' ? stored.date : null
  await log.soft('the record names a day', () => expect(date).not.toBeNull())
  await log.soft("the strip's Layout is the record's, shortened", () =>
    expect((stored.layout as string).slice(0, layout.length)).toBe(layout),
  )
  await log.soft(`the strip's Made, "${made}", is the record's moment`, () =>
    expect(madeAt(made, stored.made as string)).toBe(true),
  )
  upgrade.seed = {
    version,
    userData,
    exportFolder: session.exportFolder,
    projectFile: project.path,
    projectVersion: stored.version,
    layout,
    layoutId: stored.layout,
    made,
    madeIso: stored.made,
    date,
    projectSha256: sha256(project.path),
    exportFile,
    exportSha256: sha256(exportFile),
  }
  log.note(
    `${FROM_VERSION} laid out ${LA} in ${layoutSeconds} s (Layout ${layout}, Made "${made}"), exported ${POST}, and wrote record version ${stored.version}.`,
  )
  return upgrade
}

// ------------------------------------------------------------ the candidate

async function after(session: LaunchSession, log: PhaseLog, upgrade: Upgrade): Promise<void> {
  const was = seedOf(upgrade)
  await log.soft('the install over 0.1.0 left the project as it was', () =>
    expect(sha256(was.projectFile)).toBe(was.projectSha256),
  )
  await log.soft(`the install left ${POST} as it was`, () =>
    expect(sha256(was.exportFile)).toBe(was.exportSha256),
  )

  const first = await launch(session)
  let { page, app } = first
  const { version } = first
  if (version === FROM_VERSION) throw new Error(`the app launched is still ${FROM_VERSION}`)
  if (EXPECTED_VERSION !== '' && version !== EXPECTED_VERSION) {
    throw new Error(`the app launched is ${version}, not ${EXPECTED_VERSION}`)
  }
  if (!samePath(session.userData, was.userData)) {
    throw new Error(
      `${version}'s default profile is ${session.userData}, not ${FROM_VERSION}'s ${was.userData}`,
    )
  }
  await libraryReady(page)
  await catchReveal(app)

  // The first open: the map redrawn once, from the stored layout.
  await page.getByRole('button', { name: `Open ${LA}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LA, { timeout: SHORT_MS })
  await expandHeading(page, 'process')
  const expected = was.date === null ? null : drawnFor(was.date)
  const redraw = await runToEnd(
    page.getByRole('region', { name: 'Layout run' }),
    /^Drawn (for .+ )?from the stored layout\./,
    REDRAW_MS,
  )
  if (!redraw.ok)
    throw new Error(`the map was not redrawn as the project opened: "${redraw.sentence}"`)
  await log.soft('the redraw says the stations have not moved', () =>
    expect(redraw.sentence).toBe(expected),
  )
  await log.soft('and nothing runs after it', () => nothingRuns(page))
  const said = (await saidSoFar(page)).filter((line) => line === redraw.sentence).length
  await log.soft('cell 02 said so', () => expect(said).toBeGreaterThan(0))
  await log.soft(`"${ALL_DRAWN}"`, () =>
    expect(page.locator('p.project-run-state')).toHaveText(ALL_DRAWN),
  )
  await log.soft('Layout as 0.1.0 wrote it', async () =>
    expect(await stripRow(page, 'Layout')).toBe(was.layout),
  )
  const madeNow = await stripRow(page, 'Made').catch(() => '')
  await log.soft(`Made, "${madeNow}", the moment 0.1.0 wrote as "${was.made}"`, () => {
    expect(sameMade(madeNow, was.made)).toBe(true)
    expect(madeAt(madeNow, was.madeIso)).toBe(true)
  })

  const outputs = page.getByRole('region', { name: 'Outputs' })
  const reveals = outputs.getByRole('button', { name: /^Reveal / })
  await log.soft('Outputs lists one row, the post 0.1.0 made', async () => {
    await expect(reveals).toHaveCount(1)
    await expect(reveals.first()).toHaveAccessibleName(
      new RegExp(`^Reveal .+, ${POST.replace(/\./g, '\\.')}$`),
    )
  })
  log.note(
    `Outputs: "${oneLine(
      (await reveals
        .first()
        .getAttribute('aria-label')
        .catch(() => null)) ?? '',
    )}".`,
  )
  await log.soft(`Reveal shows ${POST}`, async () => {
    await reveals.first().click()
    const shown = await until(
      async () => {
        const now = await revealed(app)
        return now.length > 0 ? now : undefined
      },
      SHORT_MS,
      () => 'Reveal asked the platform to show nothing',
    )
    expect(shown).toHaveLength(1)
    expect(samePath(shown[0], was.exportFile), `${shown[0]} is not ${was.exportFile}`).toBe(true)
  })

  const record = await until(
    async () => {
      const now = readRecordFile(was.projectFile)
      return typeof now.drawn?.engine === 'string' ? now : undefined
    },
    SHORT_MS,
    () => "the redraw's write, naming the engine that drew it, never reached the record",
  )
  await log.soft('project.json is now version 2', () => expect(record.version).toBe(2))
  await log.soft('its layout and the moment it was made are as 0.1.0 wrote them', () => {
    expect(record.layout).toBe(was.layoutId)
    expect(record.made).toBe(was.madeIso)
  })
  log.note(
    `${version} opened it, redrew it once ("${redraw.sentence}", ${redraw.seconds} s), and wrote record version ${String(record.version)}, drawn by engine ${String(record.drawn?.engine)}; Made read "${madeNow}".`,
  )
  await page
    .locator('iframe.viewer-frame')
    .screenshot({ path: join(OUT, 'upgrade-after-map.png') })
    .then(
      () => log.note('The map after the update is kept as upgrade-after-map.png.'),
      (error: unknown) =>
        log.note(`The map could not be kept: ${error instanceof Error ? error.message : error}.`),
    )
  const drawnFirst = JSON.stringify(record.drawn)

  // The second open: nothing runs.
  await quit(session)
  ;({ page, app } = await launch(session))
  await libraryReady(page)
  await catchReveal(app)
  await page.getByRole('button', { name: `Open ${LA}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(LA, { timeout: SHORT_MS })
  await expandHeading(page, 'process')
  await log.soft('on a second open, nothing runs', async () => {
    await nothingRuns(page)
    await expect(page.locator('p.project-run-state')).toHaveText(ALL_DRAWN)
    await expect(page.getByRole('region', { name: 'Layout run' })).toHaveCount(0)
    expect(JSON.stringify(readRecordFile(was.projectFile).drawn)).toBe(drawnFirst)
  })

  // A new still, of another preset, so the post 0.1.0 made is kept.
  const exported = await log.soft(`a new still, ${SQUARE}`, async () => {
    const panel = await openCell(page, 'export')
    const preset = panel.getByRole('combobox', { name: 'Preset' })
    await expect(preset).toBeEnabled({ timeout: 2 * MINUTE })
    await preset.selectOption(SQUARE_PRESET)
    await until(
      async () =>
        readRecordFile(was.projectFile).export?.preset === SQUARE_PRESET ? true : undefined,
      SHORT_MS,
      () => `the choice of ${SQUARE_PRESET} never reached the record`,
    )
    const region = panel.getByRole('region', { name: /^Export( run)?$/ })
    const before =
      (await region.count()) === 0
        ? ''
        : oneLine((await region.locator('p.prose').allTextContents()).join(' '))
    await panel.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(region).toBeVisible({ timeout: SHORT_MS })
    const end = await runToEnd(region, /^Exported /, STILL_MS, before)
    expect(end.sentence).toBe(`Exported ${SQUARE}.`)
    const file = join(was.exportFolder, LA, SQUARE)
    expect(existsSync(file), `${SQUARE} is not beside the post`).toBe(true)
    expect(readFileSync(file).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    await expect(
      page
        .getByRole('region', { name: 'Outputs' })
        .getByRole('button', { name: `Reveal ${outputName(SQUARE_PRESET)}, ${SQUARE}` }),
    ).toBeVisible({ timeout: SHORT_MS })
  })
  if (exported) log.note(`${version} exported ${SQUARE} from the project 0.1.0 made.`)
  await log.soft(`${POST} is still as 0.1.0 wrote it`, () =>
    expect(sha256(was.exportFile)).toBe(was.exportSha256),
  )
  await quit(session)
  upgrade.after = { version, projectSha256: sha256(was.projectFile) }
}

// --------------------------------------------------------------------- back

async function back(session: LaunchSession, log: PhaseLog, upgrade: Upgrade): Promise<void> {
  const was = seedOf(upgrade)
  if (upgrade.after === undefined) throw new Error('after wrote nothing down to go back from')
  const left = upgrade.after
  await log.soft('going back left the record as the update left it', () =>
    expect(sha256(was.projectFile)).toBe(left.projectSha256),
  )
  const { page, version } = await launch(session)
  if (version !== FROM_VERSION)
    throw new Error(`the app launched is ${version}, not ${FROM_VERSION}`)
  if (!samePath(session.userData, was.userData)) {
    throw new Error(
      `${FROM_VERSION}'s default profile is now ${session.userData}, not ${was.userData}`,
    )
  }
  await libraryReady(page)
  const row = page
    .getByRole('list', { name: 'Projects' })
    .getByRole('button', { name: `Open ${LA}` })
  await log.soft(`the Library marks ${LA} read-only`, async () => {
    await expect(row).toBeVisible({ timeout: SHORT_MS })
    await expect(row.locator('.entry-meta').getByText('read-only', { exact: true })).toBeVisible()
    await expect(row).toHaveAccessibleDescription(/\bread-only\b/)
  })
  await quit(session)
  await log.soft("and its record's bytes do not change", () =>
    expect(sha256(was.projectFile)).toBe(left.projectSha256),
  )
  await log.soft(`${POST} is still as 0.1.0 wrote it`, () =>
    expect(sha256(was.exportFile)).toBe(was.exportSha256),
  )
  log.note(
    `${FROM_VERSION}, installed again, listed ${LA} read-only and left its record as ${left.version} wrote it.`,
  )
}

// ---------------------------------------------------------------------- run

test(`the update over ${FROM_VERSION}: ${PHASE}`, async () => {
  test.setTimeout(50 * MINUTE)
  if (APP === '') throw new Error('LEGIBLE_UPGRADE_APP names no installed app')
  const exe = executableOf(APP)
  if (!existsSync(exe)) throw new Error(`there is no app at ${exe}`)
  mkdirSync(OUT, { recursive: true })
  let upgrade: Upgrade
  let exportFolder: string
  if (PHASE === 'seed') {
    upgrade = { record: UPGRADE_RECORD, phases: {} }
    exportFolder =
      process.env.LEGIBLE_UPGRADE_EXPORTS ||
      join(mkdtempSync(join(TEMP_ROOT, 'lc-upgrade-exports-')), 'exports')
  } else {
    upgrade = readUpgradeFile()
    exportFolder = seedOf(upgrade).exportFolder
  }
  const session: LaunchSession = {
    exe,
    install: installOf(exe),
    profile: null,
    exportFolder,
    app: null,
    page: null,
    resources: '',
    userData: '',
  }
  const log = new PhaseLog()
  let thrown: string | null = null
  try {
    if (PHASE === 'seed') upgrade = await seed(session, log)
    else if (PHASE === 'after') await after(session, log, upgrade)
    else if (PHASE === 'back') await back(session, log, upgrade)
    else throw new Error(`${PHASE} is not a phase: seed, after or back`)
  } catch (error) {
    thrown = oneLine(error instanceof Error ? error.message : String(error)).slice(0, 500)
  } finally {
    await quit(session).catch(() => undefined)
  }
  const result = log.result(thrown)
  upgrade.phases = { ...upgrade.phases, [PHASE]: result }
  writeUpgrade(upgrade)
  for (const line of result.notes) console.log(line)
  expect(result.problems, `the ${PHASE} phase`).toEqual([])
})
