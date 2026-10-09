// The layout run in the built app, against the stand-in engine: the stages
// on screen, what the run writes, and what a cancelled or refused run does
// not write. The stand-in reports the same eight stages the real engine
// does and writes the same three files, so this exercises the whole run
// without needing Docker or a feed.

import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import type { Api } from '../../src/shared/api'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { keepStandInPage, standInPage, type StandInPageOptions } from '../support/standInPage'
import {
  cell,
  cellHeading,
  cellLabel,
  closeCell,
  expandHeading,
  openCell,
  openProject,
  panel,
  withoutOpened,
} from '../support/project'

const repoRoot = resolve(__dirname, '../..')

/**
 * Open a cell by its row, without waiting for any one panel in it: a
 * laid-out project opens with cells 01 and 02 collapsed (ADR-046), and a
 * record from an older version may draw a cell without the panel
 * `openCell` waits for.
 */
async function expandCell(page: Page, id: 'data' | 'process'): Promise<void> {
  await expect(cellHeading(page, id)).toBeVisible()
  await expandHeading(page, id)
}
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-layout-'))
  // The pinned version, or the handshake refuses the stand-in and every
  // test here fails on a status line rather than on what it is about.
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, ...control }),
  )
  return dir
}

async function withApp(
  engineHome: string,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await run(page, app)
  } finally {
    await app.close()
  }
}

async function openNewProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible()
  await openProject(page, name)
}

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return withoutOpened(
    JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
}

/**
 * The words cell 02 draws over the engine's eight stages (A5.5-10,
 * `src/renderer/src/stages.ts`), in the order the engine runs them. The
 * engine's own names are asserted where they belong, against the real
 * engine, by `tests/unit/layout-real.test.ts`.
 */
const STAGE_WORDS = [
  'parse',
  'collapse',
  'order',
  'octilinear',
  'trips',
  'draw',
  'animate',
  'write',
]

test('lays a project out, reports every stage, and records what it was drawn from', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await expect(page.getByRole('button', { name: /lay out/i })).toBeVisible()
    const before = readRecord(engineHome)
    expect(before.layout).toBeNull()
    expect(before.date).toBeNull()

    // The eight stages are on the line before anything has run: the cell
    // says what the work is made of, not only what it is doing (A5.5-10).
    // The cell's own group, not `cell(page, 'process')`, which is the run's
    // region and exists only while a run does.
    const process = page.getByRole('group', { name: cellLabel('process'), exact: true })
    for (const stage of STAGE_WORDS) {
      await expect(process.getByText(stage, { exact: true })).toBeVisible()
    }
    expect(
      await process
        .locator('svg circle.mark')
        .evaluateAll((marks) => marks.map((mark) => mark.getAttribute('class') ?? '')),
      'every station waiting',
    ).toEqual(STAGE_WORDS.map(() => 'mark mark-pending'))

    await page.getByRole('button', { name: /lay out/i }).click()
    const run = cell(page, 'process')
    await expect(run).toBeVisible()
    // Every stage the engine reports is on the line, in the words a person
    // reads rather than the engine's own names.
    for (const stage of STAGE_WORDS) {
      await expect(run.getByText(stage, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    expect(
      await run
        .locator('svg circle.mark')
        .evaluateAll((marks) => marks.map((mark) => mark.getAttribute('class') ?? '')),
      'and every station finished',
    ).toEqual(STAGE_WORDS.map(() => 'mark mark-done'))

    const after = readRecord(engineHome)
    expect(after.layout, "the engine's id: a SHA-256, as hex").toMatch(/^[0-9a-f]{64}$/)
    expect(after.date, 'the service day is resolved once and stored').toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The page went where the app already serves a project's output.
    const out = join(engineHome, 'out', String(after.id))
    expect(existsSync(out)).toBe(true)
    expect(readdirSync(out).some((f) => f.endsWith('.html'))).toBe(true)

    // The stored layout is shown, and the run is not offered again.
    await expect(page.getByText(/Drawn from layout|^Laid out/)).toBeVisible()
  })
})

test('shows no path on the screen, whatever the engine says', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    // The engine's last progress message is the folder it wrote into. The
    // dates in the record carry slashes, so only the run's own region is read.
    const text = await cell(page, 'process').innerText()
    expect(text).not.toMatch(/[/\\]/)
    expect(text).toContain('Wrote the map')
  })
})

// The diagnostics panel (A3-03): the engine's numbers, its caveat
// sentences and its score, for the build that just ran. The stand-in
// answers a fudged network here and its clean default below, which are the
// two cases the panel has to get right.
const FUDGED = {
  map_draws: true,
  progress_delay_ms: 10,
  map_diagnostics: {
    stations: 114,
    junctions: 8,
    edges: 121,
    lines: ['A', 'B'],
    octilinear: 0.9938,
    stops: {
      matched: 112,
      total: 116,
      by: { station_id: 100, parent_station: 10, name: 2 },
      unmatched: ['80122', '80123'],
    },
    trips: { total: 135, paths: 40, unrouted: 3 },
    degraded: { skipped_calls: 12, borrowed_track: 26 },
    labels_dropped: 2,
    peak_concurrent: 19,
  },
  map_caveats: [
    '4 of 116 stops could not be placed on the map, so trains pass straight through them',
  ],
  map_issues: 0.2137,
}

test("shows what the build had to fudge, in the engine's own words and figures", async () => {
  const engineHome = home(FUDGED)
  await withApp(engineHome, async (page, app) => {
    await openNewProject(page, 'Los Angeles')
    const fudge = panel(page, 'What the build had to fudge')
    // Nothing to say about a build that has not happened.
    await expect(fudge).toHaveCount(0)

    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(fudge).toBeVisible()

    // The caveat is the engine's sentence, word for word, and the score is
    // the number it sent.
    await expect(
      fudge.getByText('4 of 116 stops could not be placed on the map', { exact: false }),
    ).toBeVisible()
    await expect(fudge).toContainText('issues score of 0.2137')
    // Every figure is the block's, formatted and never derived.
    await expect(fudge).toContainText('99.4%')
    await expect(fudge).toContainText('112 of 116 (97%)')
    await expect(fudge).toContainText('80122, 80123')
    for (const figure of ['114', '121', '135', '40', '26', '19']) {
      await expect(fudge).toContainText(figure)
    }

    // An explanation is reachable from the keyboard, and says what the
    // engine's word means.
    const trigger = fudge.getByRole('button', { name: 'What trips on borrowed track means' })
    await trigger.focus()
    await expect(fudge.getByText(/neighbouring line's track/)).toBeVisible()

    // And to a press, which is how a touch user asks; the control says
    // whether the explanation it controls is showing.
    const pressed = fudge.getByRole('button', { name: 'What labels dropped means' })
    await expect(pressed).toHaveAttribute('aria-expanded', 'false')
    await pressed.click()
    await expect(pressed).toHaveAttribute('aria-expanded', 'true')
    await expect(fudge.getByText(/nowhere to sit without overlapping/)).toBeVisible()
    await pressed.click()
    await expect(pressed).toHaveAttribute('aria-expanded', 'false')

    // "Copy as text" hands over what is on the screen.
    await fudge.getByRole('button', { name: 'Copy as text' }).click()
    await expect(fudge.getByText(/on the clipboard/)).toBeVisible()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Los Angeles — the map drawn for')
    expect(copied).toContain('Trips on borrowed track: 26')
    expect(copied).toContain('Issues score: 0.2137 (0 is clean)')
    expect(copied).toContain(
      '- 4 of 116 stops could not be placed on the map, so trains pass straight through them',
    )
    // The result's files are paths under the engine home; none reaches the
    // screen or the clipboard (constitution V).
    expect(await fudge.innerText()).not.toMatch(/[/\\]/)
  })
})

test('a clean network says there are no caveats and a score of 0', async () => {
  // One figure named, and the stand-in keeps the rest of its clean block:
  // a control that replaced a whole sub-block would answer a shape the
  // engine cannot produce.
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    map_diagnostics: { trips: { total: 9 } },
  })
  await withApp(engineHome, async (page, app) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const fudge = panel(page, 'What the build had to fudge')
    await expect(fudge).toContainText('No caveats')
    await expect(fudge).toContainText('the issues score is 0.')
    await expect(fudge).toContainText('100.0%')
    await expect(fudge).toContainText('3 of 3 (100%)')
    // The named figure, and the rest of its sub-block as the stand-in has
    // it: merged a level down rather than replaced, or the stand-in would
    // answer a shape the engine cannot produce. The copied block says
    // which figure is which without guessing at a row.
    await fudge.getByRole('button', { name: 'Copy as text' }).click()
    await expect(fudge.getByText(/on the clipboard/)).toBeVisible()
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('Trips: 9')
    expect(copied).toContain('Distinct paths: 1')
    expect(copied).toContain('Trips not traced: 0')
    expect(copied).toContain('Stops matched: 3 of 3 (100%)')
    expect(copied).toContain('No caveats.')
  })
})

test('a run that did not finish leaves no figures on the screen', async () => {
  const engineHome = home({ ...FUDGED, progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    await expect(panel(page, 'What the build had to fudge')).toHaveCount(0)
  })
})

test('a cancelled run writes nothing and says so', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    const before = JSON.stringify(readRecord(engineHome))
    await page.getByRole('button', { name: /lay out/i }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(JSON.stringify(readRecord(engineHome)), 'the record is untouched').toBe(before)
    // Stop returns the cell to what it was: a run a person stopped is not a
    // failure, and the cell says ready rather than failed (A5.5-10,
    // contracts/run-graph.md). The stations it stopped at are waiting again.
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/\bready\b/)
    const marks = await page
      .getByRole('group', { name: cellLabel('process'), exact: true })
      .locator('svg circle.mark')
      .evaluateAll((stations) => stations.map((s) => s.getAttribute('class') ?? ''))
    // The count first: everything below it is true of an empty list, which
    // is what a locator that has stopped matching anything hands back.
    expect(marks, 'the eight stations are all still drawn').toHaveLength(STAGE_WORDS.length)
    // How far the run got before the press is the engine's business and the
    // timing's, so which stations are done is not asserted - only that none
    // was left running or failed, which is what Stop promises.
    expect(
      marks.filter((mark) => mark !== 'mark mark-pending' && mark !== 'mark mark-done'),
      'no station was left running or failed',
    ).toEqual([])
    // A cancelled run has to be repeatable, or the project is stuck.
    await expect(page.getByRole('button', { name: /lay out/i })).toBeVisible()
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  })
})

test('a refused run shows the engine sentence and writes nothing', async () => {
  // The stand-in refuses to draw unless told to, with an error carrying the
  // hint a person reads.
  const engineHome = home({ progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    const before = JSON.stringify(readRecord(engineHome))
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/the stand-in draws nothing/)).toBeVisible({ timeout: 20_000 })
    expect(JSON.stringify(readRecord(engineHome))).toBe(before)
  })
})

test('quitting during a run leaves no process and an unchanged record', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 600, spawn_child: true })
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  const driver = app.process()
  const page = await app.firstWindow()
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
  await openNewProject(page, 'Los Angeles')
  const before = JSON.stringify(readRecord(engineHome))
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(cell(page, 'process')).toBeVisible()

  // Quit with the run still going.
  await app.close()
  await expect.poll(() => driver.exitCode, { timeout: 10_000 }).not.toBeNull()
  expect(JSON.stringify(readRecord(engineHome)), 'a run that never finished wrote nothing').toBe(
    before,
  )
  const enginePid = Number(readFileSync(join(engineHome, 'fake-engine.pid'), 'utf8'))
  expect(() => process.kill(enginePid, 0), 'the engine did not outlive the app').toThrow()
})

test('a re-layout runs every stage again behind its warning, and cancelling the warning changes nothing', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = readRecord(engineHome)

    // The warning first, and its cancel leaves everything as it was.
    await page.getByRole('button', { name: 'Re-layout' }).click()
    const dialog = page.getByRole('dialog', { name: 'Lay this project out from scratch?' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(/may place stations differently/)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden()
    expect(JSON.stringify(readRecord(engineHome))).toBe(JSON.stringify(before))

    await page.getByRole('button', { name: 'Re-layout' }).click()
    await page
      .getByRole('dialog', { name: 'Lay this project out from scratch?' })
      .getByRole('button', { name: 'Re-layout' })
      .click()
    const run = cell(page, 'process')
    await expect(run).toBeVisible()
    await expect(page.getByText(/^Laid out again from scratch/)).toBeVisible({ timeout: 30_000 })
    const after = readRecord(engineHome)
    expect(after.layout, 'the same inputs name the same layout').toBe(before.layout)
    expect(after.date).toBe(before.date)
    // The stand-in saw the force, and nothing on the screen is a path.
    const received = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('graph.build'))
    expect(received.some((l) => l.includes('"force": true'))).toBe(true)
    expect(await run.innerText()).not.toMatch(/[/\\]/)
  })
})

test('a cancelled re-layout leaves the project as it was', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = readRecord(engineHome)
    await page.getByRole('button', { name: 'Re-layout' }).click()
    await page
      .getByRole('dialog', { name: 'Lay this project out from scratch?' })
      .getByRole('button', { name: 'Re-layout' })
      .click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible()
    expect(JSON.stringify(readRecord(engineHome))).toBe(JSON.stringify(before))
    await expect(page.getByRole('button', { name: 'Re-layout' })).toBeVisible()
  })
})

test('two projects on one feed record the same layout', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'One')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /back to library/i }).click()
    await openNewProject(page, 'Two')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    const layouts = readdirSync(join(engineHome, 'projects')).map(
      (id) =>
        JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')).layout,
    )
    expect(layouts).toHaveLength(2)
    expect(layouts[0], 'the same inputs name the same layout').toBe(layouts[1])
  })
})

// The service day (specs/012): the engine's choice stored at the first
// layout, a day chosen inside the window, and the two things that must not
// happen: a day outside the window, and a rebuild that re-lays out.

const received = (engineHome: string, method: string): string[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"${method}"`))

test("a first layout stores the engine's day and the feed's window, and shows both", async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2026-03-01', '2026-11-30'],
    busiest: '2026-06-16',
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    const after = readRecord(engineHome)
    expect(after.date, "the engine's day, not the machine's").toBe('2026-06-16')
    expect(after.service).toMatchObject({
      start: '2026-03-01',
      end: '2026-11-30',
      busiest: '2026-06-16',
    })
    expect(String((after.service as { anchor: string }).anchor)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    // The engine was asked with the lines the layout drew.
    const asked = received(engineHome, 'feeds.service')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('"lines": ["A", "B"]')
    // The map was drawn for that day.
    const maps = received(engineHome, 'map.build')
    expect(maps[0]).toContain('"date": "2026-06-16"')

    const section = cell(page, 'frame')
    await expect(section).toContainText('Drawn for 2026-06-16')
    await expect(section).toContainText('2026-03-01 to 2026-11-30')
    const control = section.getByLabel('Draw for another day')
    await expect(control).toHaveValue('2026-06-16')
    await expect(control).toHaveAttribute('min', '2026-03-01')
    await expect(control).toHaveAttribute('max', '2026-11-30')
  })
})

test('a feed whose window has ended still gets a day inside it, never today', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2024-01-01', '2024-06-30'],
    busiest: '2024-04-02',
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Mexico City')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    expect(readRecord(engineHome).date).toBe('2024-04-02')
    const control = page
      .getByRole('region', { name: 'Service day' })
      .getByLabel('Draw for another day')
    await expect(control).toHaveAttribute('max', '2024-06-30')
  })
})

test('a chosen day is drawn from the stored layout alone, and written when the map is', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = readRecord(engineHome)
    expect(before.date).toBe('2026-06-16')

    const section = cell(page, 'frame')
    const control = section.getByLabel('Draw for another day')
    await control.fill('2026-06-20')
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await expect(page.getByText(/^Drawn for 2026-06-20 from the stored layout/)).toBeVisible({
      timeout: 30_000,
    })

    const after = readRecord(engineHome)
    expect(after.date).toBe('2026-06-20')
    expect(after.layout, 'the layout is untouched').toBe(before.layout)
    expect(after.service).toEqual(before.service)
    // One layout call in the whole session: the rebuild made none.
    expect(received(engineHome, 'graph.build')).toHaveLength(1)
    const maps = received(engineHome, 'map.build')
    expect(maps).toHaveLength(2)
    expect(maps[1]).toContain('"date": "2026-06-20"')
    expect(maps[1]).toContain(`"layout": "${before.layout}"`)
    await expect(control).toHaveValue('2026-06-20')
    // The stored day is nothing to draw again.
    await expect(section.getByRole('button', { name: 'Draw for this day' })).toBeDisabled()
  })
})

test('a day outside the window cannot be chosen, and nothing is built', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2026-03-01', '2026-11-30'],
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = JSON.stringify(readRecord(engineHome))

    const section = cell(page, 'frame')
    const control = section.getByLabel('Draw for another day')
    await control.fill('2026-12-25')
    // Refused as it is chosen (A5.5-15), before anything is pressed: a day
    // outside the window is never written, so it never reaches the record.
    await expect(section.getByText('The feed covers 2026-03-01 to 2026-11-30.')).toBeVisible()
    expect(JSON.stringify(readRecord(engineHome)), 'nothing was written').toBe(before)
    // And refused again on the press, with the same words: the button stays
    // available so a refusal is answered rather than silent.
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await expect(section.getByText('The feed covers 2026-03-01 to 2026-11-30.')).toBeVisible()
    await expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(received(engineHome, 'map.build'), 'nothing was asked for').toHaveLength(1)
    expect(JSON.stringify(readRecord(engineHome))).toBe(before)

    // The engine's day is one press away.
    await section.getByRole('button', { name: 'Use the busiest weekday' }).click()
    await expect(control).toHaveValue('2026-06-16')
  })
})

test('a cancelled rebuild keeps the chosen day, and leaves the map where it was', async () => {
  // Slow enough that the cancel lands inside the map call; the stand-in
  // reads its control file once, so the first layout is slow too.
  const engineHome = home({ map_draws: true, progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = readRecord(engineHome)
    const section = cell(page, 'frame')
    await section.getByLabel('Draw for another day').fill('2026-06-20')
    await expect.poll(() => readRecord(engineHome).date).toBe('2026-06-20')
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/The rebuild was cancelled/)).toBeVisible({ timeout: 20_000 })

    const after = readRecord(engineHome)
    // The choice was never the rebuild's to undo (A5.5-15): it was written
    // when it was made, and a run that drew nothing puts nothing back.
    expect(after.date, 'the day stays chosen').toBe('2026-06-20')
    expect(after.layout, 'and nothing was laid out').toEqual(before.layout)
    expect(
      (after.drawn as { date: string }).date,
      'and the map is still the one that was drawn',
    ).toBe('2026-06-16')
    await expect(section.getByLabel('Draw for another day')).toHaveValue('2026-06-20')
    // So the press that would close the gap is still offered.
    await expect(section.getByRole('button', { name: 'Draw for this day' })).toBeEnabled()
  })
})

// A5.5-15: choosing and drawing are two acts. The day reaches the record
// when it is chosen, which is the only way cell 03's staleness can exist -
// until this, `date` and `drawn.date` were written in one breath and could
// never differ (specs/028-the-notebook/contracts/run-graph.md).
test('a chosen day is written at once, starts nothing, and takes the cells below it to stale', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    expect(readRecord(engineHome).date).toBe('2026-06-16')
    // The engine's own day, on cell 03's collapsed row.
    await closeCell(page, 'frame')
    await expect(cellHeading(page, 'frame')).toHaveAccessibleName(
      '03 Frame and service day ready 2026-06-16',
    )
    const section = await openCell(page, 'frame')

    await section.getByLabel('Draw for another day').fill('2026-06-20')
    await expect
      .poll(() => readRecord(engineHome).date, { message: 'the choice reaches the record' })
      .toBe('2026-06-20')
    expect(
      (readRecord(engineHome).drawn as { date: string }).date,
      'and only a draw moves what the map was drawn from',
    ).toBe('2026-06-16')
    // Nothing was started by the choice: no engine call, no job.
    expect(received(engineHome, 'map.build'), 'nothing was asked for').toHaveLength(1)
    await expect(page.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
      'Jobs, none running',
    )
    await expect(section).toContainText('2026-06-20 is chosen; the map still shows 2026-06-16.')

    // Cell 03 holds the change, so it stays ready and says so on its own
    // row; 04, 05 and 06 are the ones drawn from a day that has moved.
    for (const id of ['data', 'process', 'frame'] as const)
      await expect(cellHeading(page, id)).toHaveAccessibleName(/ ready/)
    for (const id of ['style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id)).toHaveAccessibleName(/ not drawn yet/)
    await closeCell(page, 'frame')
    await expect(cellHeading(page, 'frame')).toHaveAccessibleName(
      '03 Frame and service day ready 2026-06-20, not drawn yet',
    )
    await openCell(page, 'frame')

    // And the one press that closes the gap, which is a rebuild and never a
    // re-layout: the stored layout is drawn again for the day now on record.
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await expect(page.getByText(/^Drawn for 2026-06-20 from the stored layout/)).toBeVisible({
      timeout: 30_000,
    })
    expect((readRecord(engineHome).drawn as { date: string }).date).toBe('2026-06-20')
    expect(received(engineHome, 'graph.build'), 'nothing was laid out').toHaveLength(1)
    for (const id of ['style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id)).toHaveAccessibleName(/ ready/)
    await expect(section.getByRole('button', { name: 'Draw for this day' })).toBeDisabled()
  })
})

// Revert (A5.5-12): back to the day the map shows. A choice like any
// other, so one write and nothing drawn, and the gap closes because the two
// days agree again. The pressed button goes with its press, so focus is
// handed to the control now holding the day.
test('Revert puts the day back to the one the map shows, and runs nothing', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const section = await openCell(page, 'frame')
    const revert = section.getByRole('button', { name: /^Revert/ })
    await expect(revert, 'nothing to go back to while the day is drawn').toHaveCount(0)

    const control = section.getByLabel('Draw for another day')
    await control.fill('2026-06-20')
    await expect
      .poll(() => readRecord(engineHome).date, { message: 'the choice reaches the record' })
      .toBe('2026-06-20')
    await expect(revert).toHaveAccessibleName('Revert to 2026-06-16')
    const modified = readRecord(engineHome).modified

    // A later day typed and not yet written - the debounce is still
    // waiting - is one the press goes back from, so it must never land.
    await control.fill('2026-06-21')
    await revert.focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => readRecord(engineHome).date, { message: 'the day goes back' })
      .toBe('2026-06-16')
    expect(readRecord(engineHome).modified, 'written').not.toBe(modified)
    // Longer than the choice's debounce: the typed day was dropped, not
    // merely overtaken.
    await page.waitForTimeout(600)
    expect(readRecord(engineHome).date, 'the waiting day never lands').toBe('2026-06-16')
    expect((readRecord(engineHome).drawn as { date: string }).date).toBe('2026-06-16')
    await expect(page.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
      'Jobs, none running',
    )
    await expect(section).toContainText('Drawn for 2026-06-16.')
    for (const id of ['style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id)).toHaveAccessibleName(/ ready/)
    await expect(revert, 'and the gap it closed takes it away').toHaveCount(0)
    await expect(control).toHaveValue('2026-06-16')
    await expect(control, 'focus is in the control holding the day').toBeFocused()
    // Counted last, after everything above has settled, so a request sent
    // late by a stray rebuild would be here too.
    expect(received(engineHome, 'map.build'), 'nothing was drawn').toHaveLength(1)
    expect(received(engineHome, 'graph.build'), 'nothing was laid out').toHaveLength(1)
  })
})

// The frame's other settings are engine work and are not drawn at all, not
// even disabled: a control with nowhere to send its value teaches a person
// a lie (ADR-045). One sentence says where the margin is and what the frame
// will not do (ADR-050, issue 350).
test('cell 03 offers no frame control it cannot honour, and says why', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const body = page.getByRole('group', { name: '03 Frame and service day', exact: true })
    await expect(body).toContainText(
      /margin is one of the sizes in cell 04; the frame is padded and never cropped or rotated, and a clip mask waits on a designer.s intent/,
    )
    // The cell's controls are the day's three and the Trip section's two
    // pickers (issue 272), and nothing else: no crop, no rotation, no
    // margin, no clip mask, not even greyed out. The Trip section's one
    // button, "Show the whole network", is drawn only while a trip is shown,
    // and none is shown here.
    // By name, not by text: these are kit buttons, whose label lives in a
    // shadow root, so innerText reads empty. Two, and exactly these two.
    await expect(body.getByRole('button')).toHaveCount(2)
    for (const name of ['Use the busiest weekday', 'Draw for this day'])
      await expect(body.getByRole('button', { name, exact: true })).toBeVisible()
    // Three fields, each by its name: the day's date and the trip's two.
    expect(await body.locator('input, select, textarea').count()).toBe(3)
    await expect(body.getByLabel('Draw for another day')).toBeEnabled()
    for (const name of ['Start', 'End'])
      await expect(body.getByRole('combobox', { name, exact: true })).toBeEnabled()
  })
})

test('reopening a laid-out project runs nothing and shows the same day and window', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2026-03-01', '2026-11-30'],
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const stored = JSON.stringify(readRecord(engineHome))
    const asked =
      received(engineHome, 'graph.build').length + received(engineHome, 'map.build').length

    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    const section = cell(page, 'frame')
    await expect(section).toContainText('Drawn for 2026-06-16')
    await expect(section).toContainText('2026-03-01 to 2026-11-30')
    await expect(section.getByLabel('Draw for another day')).toHaveValue('2026-06-16')
    expect(JSON.stringify(readRecord(engineHome)), 'nothing but the opening was rewritten').toBe(
      stored,
    )
    expect(
      received(engineHome, 'graph.build').length + received(engineHome, 'map.build').length,
      'nothing ran',
    ).toBe(asked)
  })
})

test('a project from before the window was stored keeps its day and gains the window at its next run', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  // A record as A3-01 wrote it: a layout and a day, no window.
  const id = 'oldproject01'
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(engineHome, 'projects', id, 'project.json'),
    JSON.stringify(
      {
        version: 1,
        id,
        name: 'Older',
        feed: 'la-metro-rail',
        mode: 'all',
        agency: null,
        date: '2026-05-04',
        layout: 'e'.repeat(64),
        created: now,
        modified: now,
      },
      null,
      2,
    ),
  )
  await withApp(engineHome, async (page) => {
    await page.getByRole('button', { name: 'Open Older' }).click()
    // A laid-out project opens with cell 02 collapsed (ADR-046).
    await expandCell(page, 'process')
    const section = cell(page, 'frame')
    await expect(section).toContainText('Drawn for 2026-05-04')
    await expect(section).toContainText(/Lay the project out again to learn which days/)
    await expect(section.getByLabel('Draw for another day')).toHaveCount(0)

    await page.getByRole('button', { name: 'Lay out again' }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const after = readRecord(engineHome)
    expect(after.date, 'the day it had (ADR-031)').toBe('2026-05-04')
    expect(after.service).toMatchObject({ busiest: '2026-06-16' })
    await expect(section.getByLabel('Draw for another day')).toHaveValue('2026-05-04')
    // The engine's day is offered, not imposed.
    await expect(section.getByRole('button', { name: 'Use the busiest weekday' })).toBeEnabled()
  })
})

test("a feed without a calendar fails the run with the engine's sentence and writes nothing", async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_refuses: 'The feed has neither calendar table.',
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    const before = JSON.stringify(readRecord(engineHome))
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText('The feed has neither calendar table.')).toBeVisible({
      timeout: 20_000,
    })
    expect(received(engineHome, 'map.build'), 'the map was never asked for').toHaveLength(0)
    expect(JSON.stringify(readRecord(engineHome))).toBe(before)
  })
})

test('the busiest-weekday button stays under the keyboard, and a refusal returns focus to the control', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2026-03-01', '2026-11-30'],
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const section = cell(page, 'frame')
    const control = section.getByLabel('Draw for another day')
    const suggest = section.getByRole('button', { name: 'Use the busiest weekday' })
    await expect(
      suggest,
      "the stored day is the engine's, so there is nothing to suggest",
    ).toBeDisabled()
    await control.fill('2026-06-20')
    await suggest.focus()
    await page.keyboard.press('Enter')
    await expect(control).toHaveValue('2026-06-16')
    await expect(control, 'focus moves to the control holding the day').toBeFocused()
    await expect(suggest, 'still there, nothing more to suggest').toBeDisabled()

    await control.fill('2026-12-25')
    await section.getByRole('button', { name: 'Draw for this day' }).focus()
    await page.keyboard.press('Enter')
    await expect(section.getByText('The feed covers 2026-03-01 to 2026-11-30.')).toBeVisible()
    await expect(control, 'the refusal is read with the control').toBeFocused()
  })
})

// A layout laid out again from another project (A3-06): two projects on one
// feed share the set, and the one that did not press Re-layout is told.

test('a project is told when another re-laid out the layout it draws from', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'One')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out\.$/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: /back to library/i }).click()
    await openNewProject(page, 'Two')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out\.$/)).toBeVisible({ timeout: 30_000 })
    const records = () =>
      Object.fromEntries(
        readdirSync(join(engineHome, 'projects')).map((id) => {
          const r = JSON.parse(
            readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'),
          )
          return [r.name, r]
        }),
      )
    const before = records()
    expect(before.One.layout).toBe(before.Two.layout)
    expect(before.One.made, 'the same set, made once').toBe(before.Two.made)
    // When the set was made is the strip's to say, under cell 02, and is
    // said nowhere above it (issue 209): the field list that read
    // "<id>, made <moment>" is gone, so the moment is read from the strip's
    // own `Made` row, scoped to the cell it belongs to.
    const shown = page
      .getByRole('group', { name: cellLabel('process'), exact: true })
      .locator('dl.cell-provenance dt', { hasText: /^Made$/ })
      .locator('xpath=following-sibling::dd[1]')
    await expect(shown).toBeVisible()
    await expect(shown.locator('time'), 'the exact time kept on the element').toHaveAttribute(
      'datetime',
      String(before.Two.made),
    )

    // Two, still open, re-lays out: the shared set is made again.
    await page.getByRole('button', { name: 'Re-layout' }).click()
    await page
      .getByRole('dialog', { name: 'Lay this project out from scratch?' })
      .getByRole('button', { name: 'Re-layout' })
      .click()
    await expect(page.getByText(/^Laid out again from scratch/)).toBeVisible({ timeout: 30_000 })
    const after = records()
    expect(after.Two.made).not.toBe(before.Two.made)
    expect(after.One.made, 'One has not run; its record is as it was').toBe(before.One.made)

    // One lays out again and is told.
    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open One' }).click()
    // A laid-out project opens with cell 02 collapsed (ADR-046).
    await expandCell(page, 'process')
    await page.getByRole('button', { name: 'Lay out again' }).click()
    await expect(page.getByText(/laid out again from another project/)).toBeVisible({
      timeout: 30_000,
    })
    expect(records().One.made).toBe(after.Two.made)

    // And once more: nothing has changed since.
    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open One' }).click()
    // A laid-out project opens with cell 02 collapsed (ADR-046).
    await expandCell(page, 'process')
    await page.getByRole('button', { name: 'Lay out again' }).click()
    await expect(page.getByText(/^Laid out\.$/)).toBeVisible({ timeout: 30_000 })
    expect(records().One.made, 'unchanged since').toBe(after.Two.made)
  })
})

// The stand-in names a layout by its inputs, as the engine does: this is
// its id for the default feed with the mode the run passes (the record's,
// all) and no agency.
const STAND_IN_LAYOUT = createHash('sha256')
  .update('{"agency": null, "feed": "la-metro-rail", "mode": "all"}')
  .digest('hex')

test('a record from before made was stored gains it and is told nothing changed', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  const id = 'oldproject02'
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(engineHome, 'projects', id, 'project.json'),
    JSON.stringify({
      version: 1,
      id,
      name: 'Older',
      feed: 'la-metro-rail',
      mode: 'all',
      agency: null,
      date: '2026-05-04',
      layout: STAND_IN_LAYOUT,
      created: now,
      modified: now,
    }),
  )
  await withApp(engineHome, async (page) => {
    await page.getByRole('button', { name: 'Open Older' }).click()
    // A laid-out project opens with cell 02 collapsed (ADR-046).
    await expandCell(page, 'process')
    await page.getByRole('button', { name: 'Lay out again' }).click()
    // The same id, and no time to compare: nothing changed, as the id's
    // own first comparison behaves.
    await expect(page.getByText(/^Laid out\.$/)).toBeVisible({ timeout: 30_000 })
    const once = readRecord(engineHome)
    expect(once.layout).toBe(STAND_IN_LAYOUT)
    expect(typeof once.made).toBe('string')
    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open Older' }).click()
    // A laid-out project opens with cell 02 collapsed (ADR-046).
    await expandCell(page, 'process')
    await page.getByRole('button', { name: 'Lay out again' }).click()
    await expect(page.getByText(/^Laid out\.$/)).toBeVisible({ timeout: 30_000 })
    expect(readRecord(engineHome).made).toBe(once.made)
  })
})

// The engine's log for the run that is going, in cell 02 (A5.5-13): the
// disclosure under the stages, the lines arriving while the run goes, the
// notebook's scroll left where it was, and the copy that goes through the
// main process.
//
// The stand-in sends `job/log` for every stage and, with
// `build_log_lines`, whatever else a test asks for first - which is how
// `tests/e2e/jobs.spec.ts` gives the inspector's copy a key and a home
// folder to hide. The same control gives this one its lines.

/** Cell 02's own group: the run's region exists only while a run does. */
const processCell = (page: Page): Locator =>
  page.getByRole('group', { name: cellLabel('process'), exact: true })

const logToggle = (page: Page): Locator =>
  processCell(page).getByRole('button', { name: /^Engine log/ })

/**
 * The box of lines, which is named for itself and not for the disclosure
 * that holds it: the two are nested, so one name for both would put the
 * same group name inside itself - unreadable for a screen reader, and two
 * matches for this locator.
 */
const logLines = (page: Page): Locator =>
  page.getByRole('group', { name: 'Log lines', exact: true })

test('the engine log is closed under the stages, fills while the run goes, and stops when it ends', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 200,
    build_log_lines: ['reading the feed'],
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    // Nothing before a run: there is no job to have a log.
    await expect(logToggle(page)).toBeHidden()

    await page.getByRole('button', { name: /lay out/i }).click()
    // It arrives closed, and its lines are in the document but hidden, as
    // every disclosure in this app keeps its contents.
    await expect(logToggle(page)).toBeVisible({ timeout: 20_000 })
    await expect(logToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(logLines(page)).toBeHidden()

    await logToggle(page).click()
    await expect(logToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(logLines(page)).toContainText('reading the feed')
    // Lines keep arriving while the run goes: the stages report as they
    // finish, and each is a line.
    await expect(logLines(page)).toContainText('gtfs2graph: running', { timeout: 20_000 })
    await expect(logLines(page)).toContainText('octi: running', { timeout: 20_000 })

    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    // They stop when it ends: what is on screen a second later is what was
    // on screen when it finished, and the disclosure a person opened for
    // this run is still open.
    const settled = await logLines(page).innerText()
    // A negative held over an interval, which is the one thing a poll
    // cannot do: `expect.poll(...).toBe(settled)` is satisfied by its first
    // read, taken before any late line could have arrived, so it passed
    // whatever the panel did. A fixed wait is right here because the
    // assertion is that nothing happens during it.
    await page.waitForTimeout(1_000)
    expect(await logLines(page).innerText(), 'no line arrives after the run ended').toBe(settled)
    await expect(logToggle(page)).toHaveAttribute('aria-expanded', 'true')
  })
})

test('opening the engine log leaves the notebook where it was', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    // Enough lines that the box has something to scroll, so the panel has
    // a reason to move a scroll position at all.
    build_log_lines: Array.from({ length: 60 }, (_, i) => `reading table ${i}`),
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    // The map has answered before any of this is measured.
    //
    // With the stand-in engine the page a run writes has no `__present`, so
    // the viewer probes it, fails, and says so in a line inside the
    // preview: 16px of message and the viewer grid's 8px gap, 24px exactly,
    // measured at three window sizes. The preview sits above the cells, so
    // when that line arrives everything below it moves by 24 and the
    // browser's scroll anchoring moves the page by the same 24 to keep what
    // is in view where it was. Read as this panel's doing, that is a 24px
    // jump across the click that this panel cannot cause.
    //
    // It is the map's business and not this panel's. It arrives late
    // because the frame is navigated rather than remounted after a run
    // (A5.5-20), which puts an extra round trip between the run ending and
    // the page answering; before that it arrived earlier and this test
    // happened not to overlap it.
    //
    // Waited for as the thing itself, not as the screen going quiet. A poll
    // for "the preview stopped changing height" is satisfied by two equal
    // readings taken before the line has arrived at all - measured, it
    // returned at 281ms for a line that came at 400 - which is the same
    // trap as an `expect.poll` whose first read passes. And waiting for the
    // *notebook* to be still would be worse than useless: a cell that gains
    // a row a beat after the record read has to stay catchable across the
    // click, which is what this test is for and what it caught this
    // morning, and a wait for the column to go quiet would wait past
    // exactly that.
    await expect(
      page.getByRole('region', { name: 'Map' }).getByRole('alert'),
      'the map has said it is not there, which is what moves the column',
    ).toBeVisible({ timeout: 30_000 })

    // The toggle is put somewhere a click can reach it first, and `before`
    // is read after that. Playwright scrolls a target into view as part of
    // clicking it, so a `before` read while the toggle was still below the
    // fold would count that scroll as this panel's: the first version of
    // this test did exactly that and reported a 1,868px jump the panel
    // cannot cause.
    //
    // "In the window" stopped being enough while the map was pinned
    // (A5.5-20 to ADR-046, issue 213): the band covered the top half of the
    // scrollport, and Playwright once scrolled the band's own height to
    // reach a toggle that was in the viewport and behind the map, which
    // this test read as the notebook moving. Nothing is pinned now but the
    // header, so the toggle is centred in what the header does not cover.
    await logToggle(page).evaluate((el) => {
      el.scrollIntoView({ block: 'center' })
      // Twice: moving the page can move what is above, and the second pass
      // settles against where it ended up.
      for (let pass = 0; pass < 2; pass += 1) {
        const box = el.getBoundingClientRect()
        const covered = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0
        const middle = covered + (window.innerHeight - covered) / 2 - box.height / 2
        window.scrollBy(0, box.top - middle)
      }
    })
    expect(
      await page.evaluate(() => window.scrollY),
      'the notebook is long enough to scroll',
    ).toBeGreaterThan(0)
    // Where the control a person is about to press is, on the screen. This
    // and not `window.scrollY`, which this test asserted until issue 216
    // (A5.5-16): the title states a **visual** property - the notebook does
    // not move under the person - and `scrollY` is a proxy for it that comes
    // apart from it in exactly the case this test lives in. Chromium's
    // scroll anchoring *changes* `scrollY` in order to hold content
    // visually still when something above the viewport grows, so an exact
    // `scrollY` assertion can go red while the browser is behaving
    // correctly and a person sees nothing move.
    //
    // No tolerance is added for that, and none may be: this assertion
    // caught three separate defects in one wave (issue 216 names them), the
    // largest of which was 24px, and a window of slack wide enough to
    // absorb anchoring would pass every one of them. The rect is compared
    // to a twentieth of a pixel, which is sub-pixel layout noise and
    // nothing else.
    //
    // What `scrollY` was accidentally guarding - a cell drawing its final
    // height on its first paint - is held where it belongs, by
    // `tests/unit/cell-footer.test.tsx`'s "draws its whole self from what
    // the screen already holds, asking the engine nothing".
    const box = (): Promise<{ top: number; left: number; width: number; height: number }> =>
      logToggle(page).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
      })
    const before = await box()
    // Stated rather than assumed, so this test can never go back to
    // measuring Playwright's own scrolling without saying so - and both
    // halves are stated, because one of them held while the other did not.
    expect(
      await logToggle(page).evaluate((el) => {
        const box = el.getBoundingClientRect()
        const covered = document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0
        return {
          inTheWindow: box.top >= 0 && box.bottom <= window.innerHeight,
          clearOfTheMap: box.top >= covered,
        }
      }),
      'the toggle is in view and clear of the header, so clicking it cannot scroll the page',
    ).toEqual({ inTheWindow: true, clearOfTheMap: true })

    await logToggle(page).click()
    await expect(logLines(page)).toBeVisible()
    // The newest line is in view inside the box, and the control the person
    // pressed is exactly where it was: the panel sets the box's own
    // scrollTop and never asks the platform to bring a line into view.
    const after = await box()
    for (const edge of ['top', 'left', 'width', 'height'] as const) {
      // A twentieth of a pixel: `toBeCloseTo(x, 1)` is |difference| < 0.05,
      // which is the sub-pixel slack a fractional rect needs and no more.
      expect(after[edge], `the toggle's ${edge} did not move`).toBeCloseTo(before[edge], 1)
    }
    expect(
      await logLines(page).evaluate(
        (box) => box.scrollHeight - box.scrollTop - box.clientHeight <= 2,
      ),
      'the newest line is in view inside the box',
    ).toBe(true)
  })
})

test("cell 02 draws the engine's lines with the keys out, and its Copy log writes the home folder as ~", async () => {
  const key = ['s3cr3t', 'cell', 'two'].join('-')
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    build_log_lines: [
      `fetching https://agency.example/gtfs.zip?api_key=${key}`,
      'reading {home}/feeds/gtfs.zip',
    ],
  })
  await withApp(engineHome, async (page, app) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await logToggle(page).click()
    // On screen first: the line is redacted before it ever reaches the page
    // (`src/main/engine-ipc.ts`), so the panel can draw it without being
    // the thing that leaks it.
    await expect(logLines(page)).toContainText('https://agency.example/gtfs.zip?api_key=<redacted>')
    expect(await logLines(page).innerText()).not.toContain(key)

    await processCell(page)
      .getByRole('button', { name: "Copy log: the engine's log for this run" })
      .click()
    await expect(
      processCell(page)
        .getByRole('status')
        .filter({ hasText: /clipboard/ }),
    ).toHaveText(/^The log is on the clipboard/)
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('# Layout run, Los Angeles')
    expect(copied).toContain('https://agency.example/gtfs.zip?api_key=')
    expect(copied).not.toContain(key)
    expect(copied).not.toContain(homedir())
    expect(copied).toMatch(/reading ~[\\/]feeds[\\/]gtfs\.zip/)
    // Nothing the renderer writes: the lines live in the session's runs and
    // in the main process's own engine.log, and nothing under the engine
    // home gained them. Asserted over the files rather than over the
    // record, because a `ProjectRecord` has no field that could hold a log
    // line and `not.toContain` over one passes however the renderer
    // behaves - which is what the first version of this did.
    const everythingUnder = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? everythingUnder(join(dir, entry.name))
          : [readFileSync(join(dir, entry.name), 'utf8')],
      )
    const written = everythingUnder(join(engineHome, 'projects'))
    expect(written.length, 'there are files to look in').toBeGreaterThan(0)
    expect(
      written.filter((text) => text.includes('agency.example')),
      'no file the app wrote holds an engine log line',
    ).toEqual([])
  })
})

// The provenance footer (A5.5-11): the strip under a cell's controls saying
// where what the cell holds came from. Three cells have one; the other three
// have nothing true to put in it and draw no strip at all.
test('the three cells with provenance carry it, the other three carry none, and none carries a path', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_window: ['2026-03-01', '2026-11-30'],
    busiest: '2026-06-16',
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    const group = (id: Parameters<typeof cellLabel>[0]): Locator =>
      page.getByRole('group', { name: cellLabel(id), exact: true })

    // Before the run there is no layout and no window, so neither cell has
    // provenance: no strip, rather than a strip of empty terms.
    await expect(group('process').locator('.cell-footer')).toHaveCount(0)
    await expect(group('frame').locator('.cell-footer')).toHaveCount(0)
    // That is the one thing a strip cannot say, so cell 02 says it in a
    // line of its own (issue 209), and neither cell draws a list to say it
    // in: a sentence each, and no term anywhere in either.
    const notLaidOut = group('process').getByText('This project is not laid out yet.', {
      exact: true,
    })
    await expect(notLaidOut).toBeVisible()
    await expect(
      group('frame').getByText(/^The service day is the engine’s own choice/),
    ).toBeVisible()
    await expect(group('process').locator('dl')).toHaveCount(0)
    await expect(group('frame').locator('dl')).toHaveCount(0)

    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const record = readRecord(engineHome)

    // A fact the strip states is not stated again above it (issue 209,
    // DESIGN.md 8.2). Each of the two cells drew a field list over its
    // strip - "Layout: <id>, made <moment>" and "Service day: <day>" - so
    // after the run each holds exactly one list, which is the strip, and
    // the layout's moment is on the screen of cell 02 exactly once. The
    // line that said there was no layout went when there was one.
    await expect(notLaidOut).toHaveCount(0)
    for (const id of ['process', 'frame'] as const) {
      await expect(group(id).locator('.cell-footer dl.cell-provenance'), id).toHaveCount(1)
      await expect(group(id).locator('dl'), id).toHaveCount(1)
    }
    await expect(group('process').locator('time')).toHaveCount(1)

    // Cell 02: the layout's eight characters, when the engine made it, what
    // it was made with, and - said as this moment's, in the term itself -
    // the engine and LOOM the app is running.
    const process = group('process').locator('.cell-footer')
    await expect(process).toBeVisible()
    await expect(process).toContainText(String(record.layout).slice(0, 8))
    await expect(process).toContainText('Built with')
    // The exact moment on the element; the text beside it is the person's
    // own locale, which is the machine's business and not this test's.
    await expect(process.locator('time')).toHaveAttribute('datetime', String(record.made))
    // The engine the app is running, from the supervisor's own state: the
    // strip asks the engine nothing, so it has its whole height the moment
    // it appears and the notebook does not reflow a beat after a run (#212).
    await expect(process).toContainText('Engine now')
    await expect(process).toContainText(PINNED_ENGINE)
    await expect(process).not.toContainText('LOOM now')
    // And A2-02's moved-inputs sentence is the panel's, not the strip's: it
    // ends in a prompt to act, and it sits beside the button that acts.
    await expect(process).not.toContainText('lay out to draw with')

    // Cell 03: the day, and the engine's own three answers beside it, so a
    // person can compare them. Whose choice the day was is not said: it
    // cannot be read off the record once a second run has moved the
    // window's busiest weekday off a day that was kept.
    const frame = group('frame').locator('.cell-footer')
    await expect(frame).toContainText('2026-06-16')
    await expect(frame).toContainText('2026-03-01 to 2026-11-30')
    await expect(frame).toContainText('busiest weekday')
    await expect(frame).toContainText(String((record.service as { anchor: string }).anchor))
    await expect(frame).not.toContainText('by you')
    await expect(frame).not.toContainText('by the engine')
    // And not the panel's own sentence, whose words those terms share.
    await expect(frame).not.toContainText('busiest weekday, counted from')

    // Cells 01, 04 and 05 have nothing true to report and say nothing.
    for (const id of ['data', 'style', 'lines'] as const) {
      await expect(group(id).locator('.cell-footer'), id).toHaveCount(0)
    }

    // No path on any of it, whatever the engine answered: `engine.info`
    // carries the home, and a footer is the newest place it could land.
    for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const) {
      const strip = group(id).locator('.cell-footer')
      if ((await strip.count()) === 0) continue
      const text = await strip.innerText()
      expect(text, id).not.toContain(engineHome)
      // A day carries hyphens and a locale's date carries slashes, so what
      // is looked for is something path-shaped: a token that begins with a
      // separator or a drive letter.
      expect(text, id).not.toMatch(/(^|\s)(\/|~\/|[A-Za-z]:\\)/)
    }
  })
})

// Cell 03's transport (A5.5-16): the scrub, Play day and the speed, driving
// the engine's page through the seam the app already has.
//
// The stand-in engine's own page has no seam, so the page is written over
// with one that records what it was asked (`tests/support/standInPage.ts`),
// the same device `tests/e2e/viewer.spec.ts` uses to drive the five methods
// from the bridge. What this adds is the controls a person actually
// presses, and what the app remembers on their behalf across a navigation.

/**
 * What the page in the frame was asked, in order, from the only side that
 * can reach it.
 *
 * Every way of answering nothing answers an empty list, because this is
 * read from `expect.poll` across a navigation and each of them is a moment
 * to retry rather than a failure - the same treatment
 * `notebook-a11y.spec.ts` gives the same moment. A document that has just
 * arrived has not run its own script yet, so `__seen` is undefined for a
 * beat after every navigation, and `toContainEqual` on undefined throws
 * where an empty list simply does not match and is asked again.
 */
async function seenByPage(app: ElectronApplication): Promise<[string, unknown][]> {
  const read = await readPage(app)
  return read.seen ?? []
}

/**
 * What the page recorded, from a read that answered: a read can meet its
 * deadline and say nothing (issue 232), and a check made on one single
 * read would take that silence for an empty record. Asked again until one
 * answers, for up to ten seconds.
 */
async function seenSettled(app: ElectronApplication): Promise<[string, unknown][]> {
  const until = Date.now() + 10_000
  for (;;) {
    const read = await readPage(app)
    if (read.seen !== null || Date.now() > until) return read.seen ?? []
  }
}

/**
 * What the viewer's frame holds, and why when it holds nothing (issue 232):
 * no frame, a read that threw, or a page that simply was not told. The
 * three used to be one empty list, so a CI failure said only that a call
 * never arrived.
 */
interface PageRead {
  /** Every child frame's address, the stage view's `about:srcdoc` included. */
  frames: string[]
  /** The frame read, or null when there was none that is not `srcdoc`. */
  frame: string | null
  /** What the page recorded, or null when it could not be read. */
  seen: [string, unknown][] | null
  /** How long ago the document in the frame began, in milliseconds. */
  age: number | null
  error: string | null
}

async function readPage(app: ElectronApplication): Promise<PageRead> {
  // The whole read has a deadline too, in case what hangs is the call into
  // the main process rather than the frame's own answer.
  const late = new Promise<PageRead>((resolve) =>
    setTimeout(
      () =>
        resolve({
          frames: [],
          frame: null,
          seen: null,
          age: null,
          error: 'evaluate: no answer within 2s',
        }),
      2000,
    ),
  )
  return Promise.race([readPageNow(app), late])
}

async function readPageNow(app: ElectronApplication): Promise<PageRead> {
  try {
    return (await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const main = win.webContents.mainFrame
      const frames = main.frames.filter((f) => f !== main).map((f) => f.url)
      // The viewer's frame, not merely the first child: once a layout has
      // run, cell 01's stage view draws an iframe of its own from `srcdoc`,
      // and which of the two comes first is a matter of timing - a read of
      // the stage frame answered [] and failed this on Windows (PR 225).
      const frame = main.frames.find((f) => f !== main && f.url !== 'about:srcdoc')
      if (frame === undefined) return { frames, frame: null, seen: null, age: null, error: null }
      try {
        // Raced against a deadline (issue 232). A frame being replaced can
        // take the read and never answer it: macOS CI's diagnosis showed the
        // page restored at once, with setSpeed in what it recorded, while
        // the poll sat twenty seconds on its first read and never asked
        // again. A read that does not answer in a second is "not yet", and
        // the poll asks once more.
        const read = frame.executeJavaScript(
          '({ seen: window.__seen || [], age: Math.round(performance.now()) })',
        ) as Promise<{ seen: [string, unknown][]; age: number }>
        const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
        const answer = await Promise.race([read, late])
        if (answer === null)
          return { frames, frame: frame.url, seen: null, age: null, error: 'no answer within 1s' }
        return { frames, frame: frame.url, seen: answer.seen, age: answer.age, error: null }
      } catch (error) {
        return { frames, frame: frame.url, seen: null, age: null, error: String(error) }
      }
    })) as PageRead
  } catch (error) {
    return { frames: [], frame: null, seen: null, age: null, error: `evaluate: ${String(error)}` }
  }
}

/**
 * Everything a failed wait on the page can be told apart by, as one block
 * for the failure's message (issue 232): what the frame held, what the
 * screen said, and the end of the app's own log.
 */
async function pageDiagnosis(app: ElectronApplication, page: Page): Promise<string> {
  const read = await readPage(app)
  const src = await page
    .locator('iframe.viewer-frame')
    .getAttribute('src')
    .catch((error: unknown) => `unreadable: ${String(error)}`)
  const alerts = await page
    .getByRole('alert')
    .allInnerTexts()
    .catch(() => [])
  // By accessible name: a kit button's label is slotted, and neither its
  // innerText nor, on a CI runner, its textContent carried it.
  const buttons = transport(page).getByRole('button')
  const controls: string[] = []
  for (let i = 0; i < (await buttons.count().catch(() => 0)); i += 1)
    controls.push(
      (await buttons
        .nth(i)
        .evaluate((b) => b.getAttribute('aria-label') ?? (b as HTMLElement).innerText)
        .catch(() => '')) ?? '',
    )
  const speedNow = await speed(page)
    .inputValue()
    .catch(() => 'unreadable')
  const logs = process.env.LEGIBLE_LOGS
  let tail = '(no log folder)'
  if (logs !== undefined && logs !== '') {
    try {
      const lines = readFileSync(join(logs, 'main.log'), 'utf8').trimEnd().split('\n')
      tail = lines.slice(-40).join('\n')
    } catch (error) {
      tail = `(main.log unreadable: ${String(error)})`
    }
  }
  return [
    `frames: ${JSON.stringify(read.frames)}`,
    `read from: ${read.frame ?? 'no viewer frame'}; document age ${read.age ?? '?'} ms`,
    `seen: ${read.seen === null ? `unreadable (${read.error ?? 'no error'})` : JSON.stringify(read.seen)}`,
    `iframe src: ${src}`,
    `transport buttons: ${JSON.stringify(controls)}; speed ${speedNow}`,
    `alerts: ${JSON.stringify(alerts)}`,
    `main.log, last lines:\n${tail}`,
  ].join('\n')
}

/**
 * How long one of the four tests below is allowed, in milliseconds.
 *
 * The suite's default is 60s (`playwright.config.ts`), and these do not fit
 * in it on a Windows runner: "a theme change gives the map back the speed
 * and the pause it had" (a press then reloaded the frame; since issue 349 it
 * is "a redraw gives the map back the speed and the pause it had, in the
 * theme chosen") timed out there while every assertion in it passed on this
 * machine. The time is not one slow step. It is the sum, and the
 * sum is declared in the test's own deadlines:
 *
 *   30s  `electron.launch`
 *   20s  the engine's status line reaching "ready"
 *   30s  the layout run
 *   20s  the transport appearing once the page has answered `bounds()`
 *   20s  the restore reaching the page after the redraw's navigation
 *        and a dozen 10s `expect` defaults for the clicks, the create
 *        dialog, the reopen and the cell toggles
 *
 * That is over 120s of declared budget for a test allowed 60, so the
 * default was never enough for it; this machine hides that by being fast.
 *
 * Raising the envelope does **not** make a hang slower to report, which is
 * the usual objection and the reason to say so here: every step above
 * carries its own deadline and fails on it, with its own message, long
 * before this one is reached. The envelope only stops the *sum* being the
 * failure. It is half again the declared budget, which covers the steps
 * that have no deadline of their own - a click's actionability, a record
 * write - without holding the suite for minutes on a run that is stuck.
 */
const TRANSPORT_TIMEOUT = 180_000

/** The transport's own section inside cell 03. */
const transport = (page: Page): Locator =>
  page.getByRole('region', { name: 'Transport', exact: true })

const scrub = (page: Page): Locator => transport(page).getByLabel('Time of day')

const speed = (page: Page): Locator =>
  transport(page).getByRole('combobox', { name: 'Speed', exact: true })

/** A laid-out project whose page carries the seam, open, with cell 03 disclosed. */
async function projectWithASeam(
  page: Page,
  engineHome: string,
  options: StandInPageOptions = {},
): Promise<void> {
  await openNewProject(page, 'Los Angeles')
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  standInPage(engineHome, options)
  // Reopened so the frame loads what was just written: the viewer navigates
  // on a redraw and on nothing else, and nothing has redrawn.
  await page.getByRole('button', { name: /back to library/i }).click()
  await openProject(page, 'Los Angeles')
  await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
  await openCell(page, 'frame')
}

test('cell 03 drives the page and changes nothing the project keeps', async () => {
  test.setTimeout(TRANSPORT_TIMEOUT)
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page, app) => {
    await projectWithASeam(page, engineHome)

    // It appears only once the page has said what day it has, so its
    // presence is itself the assertion that `bounds()` was asked and
    // answered.
    await expect(transport(page)).toBeVisible({ timeout: 20_000 })
    await expect(scrub(page)).toHaveAttribute('min', '21600')
    await expect(scrub(page)).toHaveAttribute('max', '93600')

    // The clock is the page's own, read back rather than counted here: the
    // page starts at 06:00 of its service day and says so in its own words.
    await expect(scrub(page)).toHaveAttribute('aria-valuetext', '06:00')
    await expect(transport(page)).toContainText('06:00')

    // The page plays from load, so the control offers the other one.
    const playPause = transport(page).getByRole('button', { name: /^(Play day|Pause)$/ })
    await expect(playPause).toHaveAccessibleName('Pause')
    await playPause.click()
    await expect(playPause).toHaveAccessibleName('Play day')
    expect(await seenSettled(app)).toContainEqual(['setPlaying', false])

    // The speed is the kit's select over the platform's own.
    await speed(page).selectOption('300')
    await expect.poll(() => seenByPage(app)).toContainEqual(['setSpeed', 300])

    // The scrub is keyboard-operable, and the clock that comes back is the
    // page's: End is the last second of its day, which the page words as
    // 02:00 of the next one.
    await scrub(page).press('End')
    await expect(scrub(page)).toHaveAttribute('aria-valuetext', '02:00 +1d', { timeout: 20_000 })
    expect(await seenSettled(app)).toContainEqual(['seek', 93600])

    // And none of it touched the project or the engine. `map.build` was
    // asked once, by the layout; no job ran; every cell is still ready; the
    // record's `drawn` is where the layout left it.
    expect(received(engineHome, 'map.build'), 'nothing was drawn again').toHaveLength(1)
    expect(received(engineHome, 'graph.build'), 'nothing was laid out').toHaveLength(1)
    await expect(page.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
      'Jobs, none running',
    )
    for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).toHaveAccessibleName(/ ready/)
    const record = readRecord(engineHome)
    expect((record.drawn as { date: string }).date).toBe(record.date)
  })
})

// A theme is taken in place by a page that has `setTheme` (engine v0.11.0,
// issue 349), so a press is not a navigation and there is no restore for it
// to lose anything in. A navigation is what a redraw is, and that is where
// the app gives a page back the speed and the pause only it remembers.
test('a theme change leaves the map’s speed and its pause as they were', async () => {
  test.setTimeout(TRANSPORT_TIMEOUT)
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page, app) => {
    await projectWithASeam(page, engineHome, { setTheme: true })
    await expect(transport(page)).toBeVisible({ timeout: 20_000 })

    await transport(page).getByRole('button', { name: 'Pause' }).click()
    await speed(page).selectOption('30')
    await expect(speed(page)).toHaveValue('30')
    // The page took both, and has been given the theme its load began with:
    // the restore's first call, whatever else it has to give back.
    await expect
      .poll(() => seenByPage(app), { timeout: 20_000, message: 'the page took the speed' })
      .toContainEqual(['setSpeed', 30])
    const before = await seenSettled(app)
    expect(before, 'and the pause').toContainEqual(['setPlaying', false])
    expect(before, 'and the theme its load began with').toContainEqual(['setTheme', 'warm-dark'])
    const frame = page.locator('iframe.viewer-frame')
    const address = await frame.getAttribute('src')
    expect(address, 'the project was opened in warm dark').toContain('theme=warm-dark')

    await openCell(page, 'style')
    await page.locator('label.theme-card', { hasText: 'Sepia' }).click()
    await expect
      .poll(() => seenByPage(app), { timeout: 20_000, message: 'the page was told, in place' })
      .toContainEqual(['setTheme', 'sepia'])

    // A reload, were one coming, is a state read, a navigation and a load
    // away from the press; the pause is longer than that, so what is absent
    // below is the page's doing and not the clock's.
    await page.waitForTimeout(1500)
    await expect(frame, 'the frame’s address did not change').toHaveAttribute('src', address ?? '')
    expect(
      await seenSettled(app),
      'the page was asked the theme and nothing else: no restore ran, so nothing could lose them',
    ).toEqual([...before, ['setTheme', 'sepia']])
    // The control says the same, so the screen and the page agree.
    await expect(
      transport(page).getByRole('button', { name: 'Play day' }),
      'still paused',
    ).toBeVisible()
    await expect(speed(page), 'still at 30 seconds a second').toHaveValue('30')
  })
})

test('a redraw gives the map back the speed and the pause it had, in the theme chosen', async () => {
  test.setTimeout(TRANSPORT_TIMEOUT)
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page, app) => {
    await projectWithASeam(page, engineHome, { setTheme: true })
    await expect(transport(page)).toBeVisible({ timeout: 20_000 })

    await transport(page).getByRole('button', { name: 'Pause' }).click()
    await speed(page).selectOption('30')
    // The page is deliberately not waited for here. That the select reaches
    // it is the test above's assertion, and what this test turns on is the
    // app's own memory, which `choose` writes before the call it sends - so
    // waiting would be a second set of round trips into a frame that is
    // about to be replaced anyway.
    await expect(speed(page)).toHaveValue('30')

    // The theme goes in place, and costs the page nothing it had.
    await openCell(page, 'style')
    await page.locator('label.theme-card', { hasText: 'Sepia' }).click()
    await expect
      .poll(() => seenByPage(app), { timeout: 20_000, message: 'the page was told, in place' })
      .toContainEqual(['setTheme', 'sepia'])

    // A redraw is a navigation: the page that arrives is a new document at
    // the address's own defaults, playing, at a minute a second. `state()`
    // answers neither of those (engine issue 29), so the app is the only
    // thing that knows what they were - and this is the whole reason cell 03
    // remembers them. The stand-in engine writes `{}` as the page, so the
    // page with the seam is kept written over it while the run draws.
    const stop = keepStandInPage(engineHome, { setTheme: true })
    try {
      await openCell(page, 'frame')
      await cell(page, 'frame').getByLabel('Draw for another day').fill('2026-06-20')
      await cell(page, 'frame').getByRole('button', { name: 'Draw for this day' }).click()
      const frame = page.locator('iframe.viewer-frame')
      await expect(frame, 'the run sent the frame to the page it wrote').toHaveAttribute(
        'src',
        /redraw=1/,
        { timeout: 30_000 },
      )
      await expect(frame, 'in the theme chosen before it').toHaveAttribute('src', /theme=sepia/)

      // The old document's record is not the new one's: the new document
      // is the one whose record begins with the theme the project has now,
      // where the old one's began with the theme it was opened in. What is
      // read after that was asked of the page that arrived.
      await expect
        .poll(async () => (await seenByPage(app))[0] ?? null, {
          timeout: 20_000,
          message: 'the page that arrived was given the project’s theme first',
        })
        .toEqual(['setTheme', 'sepia'])

      // Issue 232: this wait fails on CI runners and never here. Said with
      // everything that tells its causes apart, so the next failure explains
      // itself rather than only timing out.
      //
      // What the poll read is kept and checked below, rather than read again:
      // a second read can meet the one-second deadline and answer [], which
      // failed this on Windows (PR 233) with the page already restored.
      let asked: [string, unknown][] = []
      try {
        await expect
          .poll(
            async () => {
              asked = await seenByPage(app)
              return asked
            },
            { timeout: 20_000 },
          )
          .toContainEqual(['setSpeed', 30])
      } catch (error) {
        throw new Error(
          `the page that arrived was never given its speed back:\n${await pageDiagnosis(app, page)}`,
          { cause: error },
        )
      }
      expect(asked, 'and it was not left running').toContainEqual(['setPlaying', false])
      expect(
        asked.filter(([method]) => method === 'setPlaying').pop(),
        'the last word on playing is the pause, not a restart',
      ).toEqual(['setPlaying', false])
    } finally {
      stop()
    }
    // The control says the same, so the screen and the page agree.
    await expect(
      transport(page).getByRole('button', { name: 'Play day' }),
      'the control still says paused',
    ).toBeVisible()
    await expect(speed(page), 'and 30 seconds a second').toHaveValue('30')
  })
})

test('a scrub while a run holds the page is refused with a sentence', async () => {
  test.setTimeout(TRANSPORT_TIMEOUT)
  // Slow enough that the rebuild is still going while the press is made:
  // eight stages at 400ms is over three seconds.
  const engineHome = home({ map_draws: true, progress_delay_ms: 400 })
  await withApp(engineHome, async (page, app) => {
    await projectWithASeam(page, engineHome)
    await expect(transport(page)).toBeVisible({ timeout: 20_000 })
    const before = (await seenSettled(app)).length

    // A rebuild: the one press that draws the map again from the stored
    // layout, which rewrites the page this scrub would be scrubbing.
    await cell(page, 'frame').getByLabel('Draw for another day').fill('2026-06-20')
    await cell(page, 'frame').getByRole('button', { name: 'Draw for this day' }).click()

    await transport(page)
      .getByRole('button', { name: /^(Play day|Pause)$/ })
      .click()
    await expect(transport(page).getByRole('alert')).toContainText('The map is being drawn')
    // Refused and not queued: the page was asked nothing, and the control
    // still says what the page is actually doing.
    expect(await seenSettled(app), 'the page was not asked').toHaveLength(before)
    await expect(transport(page).getByRole('button', { name: 'Pause' })).toBeVisible()

    // The sentence goes when the reason does, rather than sitting there
    // reading as a control that is broken. The run's own sentence is in
    // cell 02, which a laid-out project opens collapsed (ADR-046).
    await expandCell(page, 'process')
    await expect(page.getByText(/^Drawn for 2026-06-20 from the stored layout/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(transport(page).getByRole('alert')).toHaveCount(0)
  })
})

// The project's header (A5.5-22): the project's name, the notebook's one
// sentence, and Run all, which brings the map up to date with cells 01 to
// 05 through the runs those cells already have and never runs the export.

const header = (page: Page): Locator => page.locator('.project-run')
const runAllButton = (page: Page): Locator => page.getByRole('button', { name: 'Run all' })

test('Run all lays out a new project and draws its day, then says the map is current', async () => {
  // Slow at `feeds.service`, so the running state is still there to be read.
  const engineHome = home({ map_draws: true, progress_delay_ms: 10, service_delay_ms: 1500 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    const said = header(page).getByRole('status')
    await expect(said).toHaveText('Nothing has been laid out yet.')
    // Nothing about exporting under the button (issue 276): it never
    // exports, and `export.plan` below is what holds that, not a sentence.
    await expect(header(page)).not.toContainText('never exports')

    await runAllButton(page).focus()
    await page.keyboard.press('Enter')
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop, 'Run all gives way to Stop, and focus goes with it').toBeFocused()
    await expect(said).toHaveText('02 Process is running.')
    await expect(page.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
      'Jobs, 1 running',
    )

    await expect(said).toHaveText('The map is drawn from every cell.', { timeout: 30_000 })
    await expect(runAllButton(page), 'nothing left to run, so no button').toHaveCount(0)
    await expect(said, 'focus lands on the sentence saying why').toBeFocused()
    expect(received(engineHome, 'graph.build')).toHaveLength(1)
    expect(received(engineHome, 'map.build')).toHaveLength(1)
    expect((readRecord(engineHome).drawn as { date: string }).date).toBe('2026-06-16')
    expect(received(engineHome, 'export.plan'), 'never the export').toHaveLength(0)
  })
})

test('Run all draws a chosen day from the stored layout, and lays nothing out', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await runAllButton(page).click()
    const said = header(page).getByRole('status')
    await expect(said).toHaveText('The map is drawn from every cell.', { timeout: 30_000 })

    await cell(page, 'frame').getByLabel('Draw for another day').fill('2026-06-20')
    await expect(said).toHaveText('04 Style to 06 Export are not drawn yet.')
    await expect(runAllButton(page)).toBeEnabled()
    await runAllButton(page).click()
    await expect(said).toHaveText('The map is drawn from every cell.', { timeout: 30_000 })
    // The rebuild it started is the job cell 03 would have started.
    await page.getByRole('button', { name: /^Jobs, / }).click()
    await expect(
      page
        .getByRole('complementary', { name: 'Inspector' })
        .getByRole('listitem', { name: 'Los Angeles Rebuild for 2026-06-20' }),
    ).toBeVisible()
    expect((readRecord(engineHome).drawn as { date: string }).date).toBe('2026-06-20')
    expect(received(engineHome, 'graph.build'), 'nothing was laid out').toHaveLength(1)
    expect(received(engineHome, 'map.build')).toHaveLength(2)
    expect(received(engineHome, 'export.plan')).toHaveLength(0)
  })
})

test('Run all stops at the first failure and leaves that cell in error', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_refuses: 'This feed has no calendar.',
  })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await runAllButton(page).click()
    await expect(header(page).getByRole('status')).toHaveText('02 Process failed.', {
      timeout: 30_000,
    })
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/ failed/)
    // Said assertively as well, by an alert of the header's own, and the
    // polite line stops speaking so the failure is not heard twice (FR-017).
    await expect(header(page).getByRole('alert')).toHaveText('02 Process failed.')
    await expect(header(page).getByRole('status')).toHaveAttribute('aria-live', 'off')
    expect(received(engineHome, 'map.build'), 'nothing after the failure ran').toHaveLength(0)
    await expect(runAllButton(page), 'and it can be run again').toBeEnabled()
  })
})

test('Stop cancels the stage in flight and runs nothing after it', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10, service_delay_ms: 3000 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await runAllButton(page).focus()
    await page.keyboard.press('Enter')
    const stop = page.getByRole('button', { name: 'Stop', exact: true })
    await expect(stop).toBeFocused()
    await expect.poll(() => received(engineHome, 'feeds.service').length).toBe(1)
    await page.keyboard.press('Enter')
    await expect(runAllButton(page), 'focus is handed back to Run all').toBeFocused({
      timeout: 10_000,
    })
    await expect(header(page).getByRole('status')).toHaveText('Nothing has been laid out yet.')
    expect(received(engineHome, 'map.build'), 'the draw never ran').toHaveLength(0)
    expect(readRecord(engineHome).layout, 'nothing was written').toBeNull()
  })
})

// The second half is a guard rather than a proof: nothing in the header
// scrolls, and the screen focuses its heading on opening, which scrolls to
// the top. It is here so that whatever later keeps a project's scroll
// position across a visit has to meet the issue's words on the way.
test('the way back is in the window header, and a returning person starts at the top', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    // Absent on the Library, which is where it goes.
    const back = page.locator('.app-header').getByRole('button', { name: 'Back to Library' })
    await expect(back).toHaveCount(0)

    await openNewProject(page, 'Los Angeles')
    // The project's name is the screen's heading, with no breadcrumb around
    // it, and the way back is in the header between the status and Jobs
    // (issue 275): "Library" on screen, "Back to Library" by name.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
    await expect(page.locator('.app-header fig-button', { hasText: 'Library' })).toHaveText(
      'Library',
    )
    const order = await page
      .locator('.app-header')
      .evaluate((el) =>
        [...el.children].map(
          (c) => c.getAttribute('aria-label') ?? c.getAttribute('role') ?? c.className,
        ),
      )
    expect(order.indexOf('Back to Library')).toBeGreaterThan(order.indexOf('status'))
    expect(order.indexOf('Back to Library')).toBeLessThan(
      order.findIndex((name) => name.startsWith('Jobs')),
    )
    await runAllButton(page).click()
    await expect(header(page).getByRole('status')).toHaveText('The map is drawn from every cell.', {
      timeout: 30_000,
    })
    await cellHeading(page, 'export').scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)

    await back.click()
    await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
    await openProject(page, 'Los Angeles')
    await expect(page.getByRole('heading', { level: 1, name: 'Los Angeles' })).toBeFocused()
    expect(await page.evaluate(() => window.scrollY), 'the top of the notebook').toBe(0)
  })
})

test('below 900px with the inspector open, the way back closes it and lands on the Library', async () => {
  const engineHome = home({})
  await withApp(engineHome, async (page) => {
    await page.setViewportSize({ width: 800, height: 800 })
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: /^Jobs/ }).click()
    // The inspector covers the main region, which is inert; the header is not.
    await expect(page.locator('.app-main')).toHaveAttribute('inert', '')
    await page.locator('.app-header').getByRole('button', { name: 'Back to Library' }).click()
    await expect(page.locator('.app-main')).not.toHaveAttribute('inert', '')
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeFocused()
  })
})

test('Settings has the one way back, in the header, and it lands on the Library', async () => {
  const engineHome = home({})
  await withApp(engineHome, async (page) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
    // Exactly one, in the header: the toolbar that was under the heading
    // is gone (issue 275), and strict mode fails on a second.
    const back = page.getByRole('button', { name: 'Back to Library' })
    await expect(back).toHaveCount(1)
    await expect(
      page.locator('.app-header').getByRole('button', { name: 'Back to Library' }),
    ).toHaveCount(1)
    await back.click()
    // The Library's own heading takes focus on arrival.
    await expect(page.getByRole('heading', { level: 1, name: 'Library' })).toBeFocused()
  })
})

// The projects list (A5.6-04): newest opened first, written when a project
// opens and not when it is edited, and each card saying how far its project
// has got in words, from the notebook's own run graph. The New project card
// is first whatever the order of the projects after it (ADR-047).
test('the projects list is newest opened first, and says how far each project has got', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    const list = page.getByRole('list', { name: 'Projects' })
    const names = (): Promise<string[]> =>
      list
        .getByRole('button')
        .evaluateAll((cards) =>
          cards.map((card) => card.querySelector('.card-name')?.textContent ?? ''),
        )

    await openNewProject(page, 'First')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(page.getByRole('button', { name: 'Open First' })).toContainText(
      'finished up to 05 Lines',
    )

    // A second project, made and never opened, comes first: it is newer.
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Second')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Second' })).toContainText(
      'finished up to 01 Data; not laid out yet',
    )
    await expect.poll(names).toEqual(['New project', 'Second', 'First'])

    // Opening First puts it back on top; nothing about it was edited.
    const modified = readRecordNamed(engineHome, 'First').modified
    await openProject(page, 'First')
    await expect
      .poll(() => readRecordNamed(engineHome, 'First').opened, { message: 'written on opening' })
      .not.toBeNull()
    expect(readRecordNamed(engineHome, 'First').modified, 'an opening is not an edit').toBe(
      modified,
    )
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect.poll(names).toEqual(['New project', 'First', 'Second'])
    // A card says less than a row did (ADR-047): where it runs and how far
    // it has got, and not its service day or when it was opened, which the
    // notebook says and the order shows.
    const first = page.getByRole('button', { name: 'Open First' })
    await expect(first).toContainText('Los Angeles · Metro Rail')
    await expect(first).not.toContainText(/Opened |Service day/)
  })
})

// The front door's two galleries (ADR-047, issue 287): "Your projects" and
// "Sample cities" are one grid of one card at `--card-min-width`, the New
// project card first among the cards and the only New project there is -
// the toolbar's and the empty state's went with the rows - and first in the
// Tab order after the screen's own heading, with projects or without.
test('the projects and the sample cities are one grid of one card, New project first', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    const main = page.getByRole('main')
    const projects = page.getByRole('list', { name: 'Projects' })
    const presets = page.getByRole('list', { name: 'Presets' })
    const library = page.getByRole('heading', { level: 1, name: 'Library' })
    const newProject = main.getByRole('button', { name: 'New project' })

    const firstAfterHeading = async (): Promise<void> => {
      // The heading takes focus when the screen appears; Tab from there.
      await expect(library).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(newProject, 'New project is the first card in the Tab order').toBeFocused()
    }

    // With no projects: New project alone under "Your projects".
    await expect(presets.getByRole('button')).toHaveCount(2)
    await expect(projects.getByRole('button')).toHaveCount(1)
    await expect(newProject).toHaveCount(1)
    await firstAfterHeading()

    // With one: still the one New project, still first, then the project.
    await page.evaluate(() =>
      (globalThis as unknown as { api: Api }).api.projects.create({
        name: 'Measured',
        feed: 'la-metro-rail',
      }),
    )
    await page.reload()
    await expect(projects.getByRole('button')).toHaveCount(2)
    await expect(presets.getByRole('button')).toHaveCount(2)
    await expect(newProject).toHaveCount(1)
    await expect(projects.getByRole('button').first()).toHaveAccessibleName('New project')
    await firstAfterHeading()
    await page.keyboard.press('Tab')
    await expect(projects.getByRole('button', { name: 'Open Measured' })).toBeFocused()
    // It opens the sheet.
    await newProject.click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    // One card in both grids: the same class, the same grid, the same width.
    const shape = async (
      list: Locator,
    ): Promise<{ grid: string; cards: string[]; widths: number[] }> =>
      list.evaluate((ul) => ({
        grid: getComputedStyle(ul).gridTemplateColumns,
        cards: [...ul.querySelectorAll(':scope > li > button')].map((b) => b.className),
        widths: [...ul.querySelectorAll(':scope > li > button')].map(
          (b) => b.getBoundingClientRect().width,
        ),
      }))
    const mine = await shape(projects)
    const samples = await shape(presets)
    expect(mine.cards).toEqual(['card card-new', 'card'])
    expect(samples.cards).toEqual(['card', 'card'])
    expect(mine.grid, 'the same tracks in both grids').toBe(samples.grid)
    const minimum = await page.evaluate(
      () =>
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue('--card-min-width'),
        ) * parseFloat(getComputedStyle(document.documentElement).fontSize),
    )
    for (const width of [...mine.widths, ...samples.widths]) {
      expect(width, 'as wide as every other card').toBeCloseTo(samples.widths[0], 0)
      expect(width, 'at --card-min-width at least').toBeGreaterThanOrEqual(minimum - 0.5)
    }
    // A project's card reads where it runs and how far it has got; a
    // sample's, where it runs and, in a chip, whether it is downloaded.
    await expect(
      projects.getByRole('button', { name: 'Open Measured' }),
    ).toHaveAccessibleDescription(
      'Los Angeles · Metro Rail finished up to 01 Data; not laid out yet',
    )
    const la = sampleCard(page, 'LA Metro Rail')
    await expect(la.locator('.card-fact')).toHaveText(['Los Angeles · Metro Rail'])
    await expect(la.locator('.card-chip')).toHaveText(/^(not )?downloaded( yet)?$/)
  })
})

function readRecordNamed(engineHome: string, name: string): Record<string, unknown> {
  for (const id of readdirSync(join(engineHome, 'projects'))) {
    const record = JSON.parse(
      readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'),
    ) as Record<string, unknown>
    if (record.name === name) return record
  }
  throw new Error(`no project named ${name}`)
}

// Opening a sample (A5.6-03): one press on a city's card makes the project
// from the registry's entry, opens its notebook at once, and starts the
// layout, whose stages report in cell 02; whatever goes wrong is said in
// the cell it happened in, never in a dialog over an empty screen.
const sampleCard = (page: Page, name: string): Locator =>
  page
    .getByRole('list', { name: 'Presets' })
    .getByRole('listitem', { name, exact: true })
    .getByRole('button')

test('a sample city opens in one press, its notebook already laying it out', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(page.getByRole('heading', { level: 1, name: 'LA Metro Rail' })).toBeVisible()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const record = readRecord(engineHome)
    expect(record).toMatchObject({ name: 'LA Metro Rail', feed: 'la-metro-rail', mode: 'all' })
    expect(record.layout, 'laid out, and recorded').not.toBeNull()
    expect(received(engineHome, 'graph.build')).toHaveLength(1)
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(page.getByRole('button', { name: 'Open LA Metro Rail' })).toBeVisible()
  })
})

test('a sample whose layout the engine refuses says so in cell 02, not in a dialog', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    service_refuses: 'This feed has no calendar.',
  })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/ failed/, { timeout: 30_000 })
    await expect(cell(page, 'process')).toContainText('This feed has no calendar.')
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    // The project is there, with its feed, to be laid out again.
    expect(readRecord(engineHome)).toMatchObject({ feed: 'la-metro-rail', layout: null })
  })
})

test('cancelling a sample’s layout keeps the project and its feed, ready to lay out', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10, service_delay_ms: 3000 })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    // At once: the notebook is up while the layout is still going.
    await expect(page.getByRole('heading', { level: 1, name: 'LA Metro Rail' })).toBeVisible()
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/ running/)
    await cell(page, 'process').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cellHeading(page, 'process')).not.toHaveAccessibleName(/ running/, {
      timeout: 20_000,
    })
    expect(readRecord(engineHome)).toMatchObject({ feed: 'la-metro-rail', layout: null })
    await expect(cell(page, 'process').getByRole('button', { name: 'Lay out' })).toBeVisible()
    expect(received(engineHome, 'map.build'), 'nothing was drawn').toHaveLength(0)
    // Opened again the ordinary way, it starts nothing: laying out on
    // arrival is the card's, once, and not a property of a project with no
    // layout.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'LA Metro Rail')
    await expect(cell(page, 'process').getByRole('button', { name: 'Lay out' })).toBeVisible()
    expect(received(engineHome, 'graph.build'), 'no second layout').toHaveLength(1)
  })
})

// A second project from the same city is named for it with a number, the
// first staying bare ("LA Metro Rail 2"): an export goes to a folder named
// after the project, and the front door names each row by it.
test('a second project from one city is named "2", from its card and in the sheet', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(page.getByRole('heading', { level: 1, name: 'LA Metro Rail 2' })).toBeVisible()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(
      page.getByRole('button', { name: 'Open LA Metro Rail', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open LA Metro Rail 2' })).toBeVisible()
    // The sheet fills the next free one; a name typed is left as typed.
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('LA Metro Rail 3')
  })
})

// A sample whose feed is not on disk (issue 178, engine v0.10.0): the layout
// downloads it first and reports the bytes as stage download, which the app
// draws in cell 01 while cell 02 waits; cell 01's inspection is held until
// the download is behind the layout, so the bytes are the layout's to report
// and a cancel of it stops the only download there is.
/** Cell 01 as a whole: its download line sits beside "In the feed", not in it. */
const cellOne = (page: Page): Locator => page.locator('section.cell[data-cell="01"]')

test('a sample’s download reports in cell 01, and its inspection waits for it', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    presets_cached: [],
    preset_download_delay_ms: 150,
  })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(page.getByRole('heading', { level: 1, name: 'LA Metro Rail' })).toBeVisible()
    const download = cellOne(page).getByRole('region', { name: 'Download' })
    await expect(download.getByRole('status')).toHaveText(/^downloaded [\d,]+ of 20,480 bytes$/)
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(/ running/)
    await expect(cellHeading(page, 'process')).not.toHaveAccessibleName(/ running/)
    await expect(cell(page, 'process')).toContainText('Waiting for the feed to download (cell 01).')
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(download, 'gone once the layout is past it').toHaveCount(0)
    expect(
      existsSync(join(engineHome, 'fake-engine.inspect-downloaded')),
      'the inspection did not race the layout for the download',
    ).toBe(false)
    expect(received(engineHome, 'feeds.inspect').length).toBeGreaterThan(0)
    await expect(cell(page, 'data')).toBeVisible()
  })
})

test('cancelling a sample during its download keeps no project, and says so', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    presets_cached: [],
    preset_download_delay_ms: 400,
  })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    const download = cellOne(page).getByRole('region', { name: 'Download' })
    await expect(download.getByRole('status')).toHaveText(/^downloaded /)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Library', {
      timeout: 20_000,
    })
    await expect(page.getByRole('alert')).toHaveText(
      'Opening LA Metro Rail was cancelled while its feed downloaded, so the project was not kept.',
    )
    await expect(page.getByRole('button', { name: 'Open LA Metro Rail' })).toHaveCount(0)
    expect(readdirSync(join(engineHome, 'projects'))).toEqual([])
    expect(existsSync(join(engineHome, 'fake-engine.inspect-downloaded'))).toBe(false)
    await expect(sampleCard(page, 'LA Metro Rail')).toHaveAccessibleName(/not downloaded yet$/)
    expect(received(engineHome, 'feeds.inspect'), 'held, so never asked').toHaveLength(0)
  })
})

test('a sample whose download the engine refuses says so in cell 01, not in a dialog', async () => {
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    presets_cached: [],
    preset_download_refuses: 'https://example.test/la.zip did not return a zip (21 bytes)',
  })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(/ failed/, { timeout: 30_000 })
    await expect(
      cellOne(page).getByRole('region', { name: 'Download' }).getByRole('alert'),
    ).toHaveText('https://example.test/la.zip did not return a zip (21 bytes)')
    await expect(cell(page, 'process')).toContainText(
      'Nothing was laid out: the feed did not download. Cell 01 says why.',
    )
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    // Kept, with its feed, to try again: a refusal is not a cancel.
    expect(readRecord(engineHome)).toMatchObject({ feed: 'la-metro-rail', layout: null })
    await expect(page.getByRole('button', { name: 'Run all' })).toBeEnabled()
  })
})

test('a sample whose download fails before its first byte says so in cell 01 too', async () => {
  // Offline, or a 404: the engine fails before any byte is reported, so the
  // run has no download to draw. The registry's answer that the feed is
  // not on disk is what puts the failure in cell 01 (issue 178).
  const engineHome = home({
    map_draws: true,
    progress_delay_ms: 10,
    presets_cached: [],
    preset_download_fails_early: 'https://example.test/la.zip could not be fetched: 404',
  })
  await withApp(engineHome, async (page) => {
    await sampleCard(page, 'LA Metro Rail').click()
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(/ failed/, { timeout: 30_000 })
    await expect(
      cellOne(page).getByRole('region', { name: 'Download' }).getByRole('alert'),
    ).toHaveText('https://example.test/la.zip could not be fetched: 404')
    await expect(cell(page, 'process')).toContainText(
      'Nothing was laid out: the feed did not download. Cell 01 says why.',
    )
    expect(readRecord(engineHome)).toMatchObject({ feed: 'la-metro-rail', layout: null })
  })
})
