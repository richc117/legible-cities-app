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
import { FAKE_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-layout-'))
  writeFileSync(join(dir, 'fake-engine.json'), JSON.stringify(control))
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
    expect(after.layout, 'the identifier is a SHA-256, as hex').toMatch(/^[0-9a-f]{64}$/)
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
    expect(layouts[0], 'drawn from the same four stage graphs').toBe(layouts[1])
  })
})
