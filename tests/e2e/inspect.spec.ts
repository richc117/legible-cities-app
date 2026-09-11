// The Inspect view against the stand-in engine: what the feed holds, the
// sort, the mode and the agency chosen with the histogram in view, the
// choice stored and passed to the layout, and the engine-away case.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-inspect-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

async function withApp(
  engineHome: string,
  run: (page: Page) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...env,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    await run(await app.firstWindow())
  } finally {
    await app.close()
  }
}

async function openProjectOn(page: Page, feedName: string, name: string): Promise<void> {
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
  await page
    .getByRole('listitem', { name: feedName, exact: true })
    .getByRole('button', { name: /Start a project/ })
    .click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'))
}

test('shows what is in the feed, sorts the routes, and marks what the mode keeps', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await expect(inspect).toContainText('Los Angeles County MTA')
    await expect(inspect).toContainText((1160).toLocaleString())
    await expect(inspect).toContainText('the engine would draw 2026-06-16')
    await expect(inspect.getByRole('list', { name: 'Warnings' }).getByRole('listitem')).toHaveCount(
      1,
    )

    const routes = inspect.getByRole('table', { name: /^Routes/ })
    await expect(routes.getByRole('row')).toHaveCount(7)
    await expect(routes.getByRole('row').nth(1)).toContainText('A')
    await expect(routes.getByRole('row').nth(1)).toContainText('Metro A Line')
    await expect(routes.getByRole('row').nth(1)).toContainText('tram')
    // By trips, most first; then by label again.
    await routes.getByRole('button', { name: 'Trips' }).click()
    await expect(routes.getByRole('row').nth(1)).toContainText('380')
    await expect(routes.getByRole('columnheader', { name: /Trips/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await routes.getByRole('button', { name: 'Label' }).click()
    await expect(routes.getByRole('row').nth(1)).toContainText('A')

    // The project began with the feed's entry: all. Choose subway: the tram
    // rows are left out, and the record holds the choice.
    const histogram = inspect.getByRole('table', { name: /^Route types/ })
    await expect(histogram.getByRole('row').nth(1)).toContainText('kept')
    await expect(histogram.getByRole('row').nth(2)).toContainText('kept')
    expect(readRecord(engineHome).mode).toBe('all')
    await inspect.getByRole('combobox', { name: 'Mode' }).selectOption('subway')
    await expect(histogram.getByRole('row').nth(1)).toContainText('left out')
    await expect(histogram.getByRole('row').nth(2)).toContainText('kept')
    await expect.poll(() => readRecord(engineHome).mode).toBe('subway')
    await expect(page.getByRole('definition').filter({ hasText: /^subway$/ })).toBeVisible()

    // Only one operator: no operator control.
    await expect(inspect.getByRole('combobox', { name: 'Operator' })).toHaveCount(0)

    // The layout is asked with the choice.
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const asked = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('graph.build'))
    expect(asked[0]).toContain('"mode": "subway"')
  })
})

test('a feed with several operators offers the choice, filters the routes, and stores it', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'Mexico City Metro', 'CDMX')
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await expect(inspect.getByRole('list', { name: 'Warnings' })).toContainText('headway-based')
    // The project began with the feed's entry: subway, METRO.
    const record = readRecord(engineHome)
    expect(record.mode).toBe('subway')
    expect(record.agency).toBe('METRO')
    const operator = inspect.getByRole('combobox', { name: 'Operator' })
    await expect(operator).toHaveValue('METRO')
    const routes = inspect.getByRole('table', { name: /^Routes/ })
    await expect(routes.getByRole('row')).toHaveCount(3)
    await operator.selectOption('')
    await expect(routes.getByRole('row')).toHaveCount(5)
    await expect.poll(() => readRecord(engineHome).agency).toBeNull()
    await operator.selectOption('SUB')
    await expect(routes.getByRole('row')).toHaveCount(2)
    await expect.poll(() => readRecord(engineHome).agency).toBe('SUB')
    await expect(inspect.getByRole('combobox', { name: 'Mode' })).toHaveValue('subway')
    await expect(inspect.getByRole('option', { name: /subway.*suggests/ })).toHaveCount(1)

    // Every operator: the engine is asked with an empty agency, which is
    // its word for none, and the histogram's kept types follow the mode.
    await operator.selectOption('')
    await expect.poll(() => readRecord(engineHome).agency).toBeNull()
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const asked = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((l) => l.includes('graph.build'))
    expect(asked[0]).toContain('"agency": ""')
    expect(asked[0]).toContain('"mode": "subway"')

    // A change after the layout is said, not drawn: the run's sentence
    // names what the layout was made with and what the record says now.
    await operator.selectOption('SUB')
    await expect(
      page.getByText(/the choice has changed since, so lay out to draw with subway, SUB/),
    ).toBeVisible()
  })
})

test('a typed mode is written only when submitted, and its aliases keep what the engine says', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'LA')
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await inspect.getByRole('combobox', { name: 'Mode' }).selectOption('other')
    const field = inspect.getByLabel('Modes, comma-joined, or route_type numbers')
    await field.fill('metro,streetcar')
    // Not yet submitted: the record holds what it held.
    expect(readRecord(engineHome).mode).toBe('all')
    await inspect.getByRole('button', { name: 'Use this mode' }).click()
    await expect.poll(() => readRecord(engineHome).mode).toBe('metro,streetcar')
    const histogram = inspect.getByRole('table', { name: /^Route types/ })
    await expect(histogram.getByRole('row').nth(1)).toContainText('kept')
    await expect(histogram.getByRole('row').nth(2)).toContainText('kept')
    await field.fill('99')
    await inspect.getByRole('button', { name: 'Use this mode' }).click()
    await expect(histogram.getByRole('row').nth(1)).toContainText('left out')
    await expect(histogram.getByRole('row').nth(2)).toContainText('left out')
  })
})

test("a record from before says what the feed's own entry draws, and takes it in one press", async () => {
  const engineHome = home()
  const id = 'olderinputs1'
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(engineHome, 'projects', id, 'project.json'),
    JSON.stringify({
      version: 1,
      id,
      name: 'Older',
      feed: 'cdmx-metro',
      mode: 'all',
      agency: null,
      created: now,
      modified: now,
    }),
  )
  await withApp(engineHome, async (page) => {
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Open Older' }).click()
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await expect(inspect).toContainText("The feed's own entry draws subway for METRO")
    await inspect.getByRole('button', { name: "Use the feed's entry" }).click()
    await expect.poll(() => readRecord(engineHome).mode).toBe('subway')
    expect(readRecord(engineHome).agency).toBe('METRO')
    await expect(inspect).not.toContainText("The feed's own entry draws")
  })
})

test('a refused inspection says so and leaves the rest of the screen working', async () => {
  const engineHome = home({ inspect_refuses: 'The feed has neither calendar table.' })
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await expect(inspect.getByRole('alert')).toHaveText('The feed has neither calendar table.')
    await expect(page.getByRole('button', { name: /lay out/i })).toBeEnabled()
  })
})

test('without the engine the section says so and the rest of the screen works', async () => {
  const engineHome = home()
  const id = 'inspectproj1'
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(engineHome, 'projects', id, 'project.json'),
    JSON.stringify({
      version: 1,
      id,
      name: 'Alone',
      feed: 'la-metro-rail',
      mode: 'all',
      agency: null,
      created: now,
      modified: now,
    }),
  )
  await withApp(
    engineHome,
    async (page) => {
      await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/unavailable/i, {
        timeout: 20_000,
      })
      await page.getByRole('button', { name: 'Open Alone' }).click()
      const inspect = page.getByRole('region', { name: 'In the feed' })
      await expect(inspect).toContainText('not ready')
      await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled()
    },
    { LEGIBLE_ENGINE_PYTHON: join(engineHome, 'no-such-python'), LEGIBLE_ENGINE_CHECKOUT: '' },
  )
})
