// The layout run in the built app, against the stand-in engine: the stages
// on screen, what the run writes, and what a cancelled or refused run does
// not write. The stand-in reports the same eight stages the real engine
// does and writes the same three files, so this exercises the whole run
// without needing Docker or a feed.

import { mkdtempSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
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
  const entry = page.getByRole('button', { name: `Open ${name}` })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'))
}

test('lays a project out, reports every stage, and records what it was drawn from', async () => {
  const engineHome = home({ map_draws: true, progress_delay_ms: 10 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await expect(page.getByRole('button', { name: /lay out/i })).toBeVisible()
    const before = readRecord(engineHome)
    expect(before.layout).toBeNull()
    expect(before.date).toBeNull()

    await page.getByRole('button', { name: /lay out/i }).click()
    const run = page.getByRole('region', { name: 'Layout run' })
    await expect(run).toBeVisible()
    // Every stage the engine reports is on the line, named.
    for (const stage of [
      'gtfs2graph',
      'topo',
      'loom',
      'octi',
      'schedule',
      'render',
      'animate',
      'write',
    ]) {
      await expect(run.getByText(stage, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

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
    const text = await page.getByRole('region', { name: 'Layout run' }).innerText()
    expect(text).not.toMatch(/[/\\]/)
    expect(text).toContain('Wrote the map')
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
  await expect(page.getByRole('region', { name: 'Layout run' })).toBeVisible()

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
    const run = page.getByRole('region', { name: 'Layout run' })
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
    expect(asked[0]).toContain('"lines": ["A"]')
    // The map was drawn for that day.
    const maps = received(engineHome, 'map.build')
    expect(maps[0]).toContain('"date": "2026-06-16"')

    const section = page.getByRole('region', { name: 'Service day' })
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

    const section = page.getByRole('region', { name: 'Service day' })
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

    const section = page.getByRole('region', { name: 'Service day' })
    const control = section.getByLabel('Draw for another day')
    await control.fill('2026-12-25')
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

test('a cancelled rebuild keeps the day and says so', async () => {
  // Slow enough that the cancel lands inside the map call; the stand-in
  // reads its control file once, so the first layout is slow too.
  const engineHome = home({ map_draws: true, progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const before = JSON.stringify(readRecord(engineHome))
    const section = page.getByRole('region', { name: 'Service day' })
    await section.getByLabel('Draw for another day').fill('2026-06-20')
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByText(/The rebuild was cancelled/)).toBeVisible({ timeout: 20_000 })
    expect(JSON.stringify(readRecord(engineHome)), 'the record is untouched').toBe(before)
    await expect(section.getByLabel('Draw for another day')).toHaveValue('2026-06-16')
  })
})
