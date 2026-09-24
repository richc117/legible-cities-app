// The Inspect view against the stand-in engine: what the feed holds, the
// sort, the mode and the agency chosen with the histogram in view, the
// choice stored and passed to the layout, and the engine-away case.
//
// It is cell 01's spec since the notebook (A5.5-08, A5.5-09), so the two
// things the cell adds to the panel are here too: the sentence the row
// carries while it is collapsed, and what a change of mode or operator does
// to the five cells below it.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cell,
  cellHeading,
  closeCell,
  createProject,
  layOut,
  openCell,
  openProject,
  panel,
} from '../support/project'
import { withWhatTheScreenSaid } from '../support/store-lines'

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

/** Where the current launch logs, and when it started. */
let launched = { folder: '', since: new Date() }

async function withApp(
  engineHome: string,
  run: (page: Page) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  // Every launch here logs to the suite's shared folder, so a failed wait
  // reads only the lines stamped since this one started.
  launched = { folder: process.env.LEGIBLE_LOGS ?? '', since: new Date() }
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
  await createProject(page, feedName, name)
  await openProject(page, name)
}

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'))
}

test('shows what is in the feed, sorts the routes, and marks what the mode keeps', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    const inspect = cell(page, 'data')
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
    const inspect = cell(page, 'data')
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
    await withWhatTheScreenSaid(page, launched, () =>
      expect.poll(() => readRecord(engineHome).agency).toBeNull(),
    )
    await operator.selectOption('SUB')
    await expect(routes.getByRole('row')).toHaveCount(2)
    await withWhatTheScreenSaid(page, launched, () =>
      expect.poll(() => readRecord(engineHome).agency).toBe('SUB'),
    )
    await expect(inspect.getByRole('combobox', { name: 'Mode' })).toHaveValue('subway')
    await expect(inspect.getByRole('option', { name: /subway.*suggests/ })).toHaveCount(1)

    // Every operator: the engine is asked with an empty agency, which is
    // its word for none, and the histogram's kept types follow the mode.
    await operator.selectOption('')
    await withWhatTheScreenSaid(page, launched, () =>
      expect.poll(() => readRecord(engineHome).agency).toBeNull(),
    )
    // The record is on disk before the screen holds it, and the run starts
    // from the screen's copy: pressed in between, it asks with SUB (#147).
    await expect(page.getByRole('definition').filter({ hasText: /^none$/ })).toBeVisible()
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
    const inspect = cell(page, 'data')
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
    const inspect = cell(page, 'data')
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
    const inspect = cell(page, 'data')
    await expect(inspect.getByRole('alert')).toHaveText('The feed has neither calendar table.')
    await expect(page.getByRole('button', { name: /lay out/i })).toBeEnabled()
  })
})

// The row's accessible name is its own contents - the number, the name, the
// state and, while it is collapsed, the summary - so the sentence is read
// from the name rather than from a span, which is how a screen reader gets
// it (DESIGN.md 8.2, A5.5-09).
test('the collapsed cell says the feed, the mode, the operator and the stop count', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    // Wait for the inspection: before it there is no stop count and no
    // feed name, and the row deliberately says nothing at all.
    await expect(cell(page, 'data')).toContainText('Los Angeles County MTA')
    await closeCell(page, 'data')
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(
      /^01 Data ready LA Metro Rail, every type, every operator, 3 stops$/,
    )

    // The sentence follows the choice, because it is the record's.
    await openCell(page, 'data')
    await cell(page, 'data').getByRole('combobox', { name: 'Mode' }).selectOption('subway')
    await closeCell(page, 'data')
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(
      /LA Metro Rail, subway, every operator, 3 stops$/,
    )
  })
})

test('a refused inspection leaves the row with nothing to say rather than half a sentence', async () => {
  const engineHome = home({ inspect_refuses: 'The feed has neither calendar table.' })
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await expect(cell(page, 'data').getByRole('alert')).toBeVisible()
    await closeCell(page, 'data')
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(/^01 Data ready$/)
  })
})

test('a change of mode marks 02 to 06 stale, starts nothing, and leaves the map and its controls', async () => {
  const engineHome = home()
  const builds = (): number =>
    readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('graph.build')).length
  const below = ['process', 'frame', 'style', 'lines', 'export'] as const

  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await layOut(page)
    expect(builds()).toBe(1)
    for (const id of below) await expect(cellHeading(page, id)).toHaveAccessibleName(/ ready\b/)

    const inspect = await openCell(page, 'data')
    await inspect.getByRole('combobox', { name: 'Mode' }).selectOption('subway')

    // The expensive edit ADR-045 names: the stored layout is of something
    // else now, so everything drawn from it says so and nothing runs.
    for (const id of below)
      await expect(cellHeading(page, id)).toHaveAccessibleName(/not drawn yet/, { timeout: 10_000 })
    // Cell 01 holds the change, so it is not stale itself: a cell shows
    // what it holds, and what is behind it is what was drawn from it.
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(/^01 Data ready\b/)

    // Nothing started, and the old map is still on screen with its controls
    // live: a stale map is not a wrong map (ADR-045).
    expect(builds()).toBe(1)
    await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
    await expect(
      panel(page, 'Theme').getByRole('button', { name: 'Sepia', exact: true }),
    ).toBeEnabled()
    await expect(page.getByRole('button', { name: /lay out/i })).toBeEnabled()
  })
})

test('a change of operator marks 02 to 06 stale and starts nothing', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'Mexico City Metro', 'CDMX')
    await layOut(page)
    const before = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('graph.build')).length

    const inspect = await openCell(page, 'data')
    await inspect.getByRole('combobox', { name: 'Operator' }).selectOption('SUB')
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/not drawn yet/, {
      timeout: 10_000,
    })
    await expect(cellHeading(page, 'export')).toHaveAccessibleName(/not drawn yet/)
    expect(
      readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
        .split('\n')
        .filter((line) => line.includes('graph.build')).length,
    ).toBe(before)
    await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
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
      const inspect = cell(page, 'data')
      await expect(inspect).toContainText('not ready')
      await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled()
    },
    { LEGIBLE_ENGINE_PYTHON: join(engineHome, 'no-such-python'), LEGIBLE_ENGINE_CHECKOUT: '' },
  )
})
