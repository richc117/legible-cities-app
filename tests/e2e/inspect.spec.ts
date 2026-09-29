// The Inspect view against the stand-in engine: what the feed holds, the
// sort, the mode and the agency chosen with the histogram in view, the
// choice stored and passed to the layout, and the engine-away case.
//
// It is cell 01's spec since the notebook (A5.5-08, A5.5-09), so the
// things the cell adds to the panel are here too: the sentence the row
// carries while it is collapsed, what a change of mode or operator does to
// the five cells below it, and where focus goes when a run disables the
// control a person is on (issue 221).

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cell,
  cellHandback,
  cellHeading,
  closeCell,
  createProject,
  engineReady,
  layOut,
  openCell,
  openProject,
  panel,
  withoutOpened,
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
  return withoutOpened(
    JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
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
      /^01 Data ready LA Metro Rail, every type, every operator, 3 stops in the feed$/,
    )

    // The sentence follows the choice, because it is the record's.
    await openCell(page, 'data')
    await cell(page, 'data').getByRole('combobox', { name: 'Mode' }).selectOption('subway')
    await closeCell(page, 'data')
    await expect(cellHeading(page, 'data')).toHaveAccessibleName(
      /LA Metro Rail, subway, every operator, 3 stops in the feed$/,
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
  // Every build the engine was asked for, not `graph.build` alone: a
  // rebuild from the stored layout is `map.build`, and a count that cannot
  // see one proves nothing about "starts nothing".
  const builds = (): number =>
    readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((line) => /"(graph|map)\.build"/.test(line)).length
  const below = ['process', 'frame', 'style', 'lines', 'export'] as const

  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await layOut(page)
    // One layout: a graph and the map built from it.
    const laid = builds()
    expect(laid).toBe(2)
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
    expect(builds()).toBe(laid)
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
    const builds = (): number =>
      readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
        .split('\n')
        .filter((line) => /"(graph|map)\.build"/.test(line)).length
    const before = builds()

    const inspect = await openCell(page, 'data')
    await inspect.getByRole('combobox', { name: 'Operator' }).selectOption('SUB')
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/not drawn yet/, {
      timeout: 10_000,
    })
    await expect(cellHeading(page, 'export')).toHaveAccessibleName(/not drawn yet/)
    expect(builds()).toBe(before)
    await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
  })
})

// Cell 01's handback (issue 221). The mode, the operator and the two buttons
// beside them are disabled while a run or an export is going, and Chromium
// blurs a disabled element, so the one a person is on would take focus to
// the body with it.
//
// A run that starts under a person who is in cell 01 starts from a timer: a
// colour change is debounced, so its rebuild begins with nobody pressing
// anything, which is how `theme.spec.ts` closes the way on cell 04. The
// stand-in is slow from its first call, because it reads its control file
// once and the rebuild has to be going still when focus is read.

/**
 * Give a line a colour of its own: a rebuild starts when the debounce runs
 * out. The label is followed by a word's end, so that line 1 is not line 10.
 */
async function recolour(page: Page, line = 'A'): Promise<void> {
  const colours = cell(page, 'lines')
  await colours
    .getByRole('button', { name: new RegExp(`^Choose the colour of line ${line}\\b`) })
    .click()
  const picker = colours.getByRole('group', { name: `Colour for line ${line}`, exact: true })
  await picker.getByLabel('Hex value').fill('#ff0000')
  await picker.getByRole('button', { name: 'Use this colour' }).click()
}

test("focus on the mode is handed to cell 01's heading when a run disables it", async () => {
  const engineHome = home({ progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await layOut(page)
    const mode = cell(page, 'data').getByRole('combobox', { name: 'Mode' })
    await expect(mode).toBeEnabled()

    await recolour(page)
    // Inside the debounce, with focus moved onto the mode.
    await mode.focus()
    await expect(mode).toBeFocused()

    await expect(mode).toBeDisabled({ timeout: 30_000 })
    // The heading the row sits in, not the row's button: a reflexive Space
    // there would collapse the cell the person is working in.
    await expect(cellHandback(page, 'data')).toBeFocused()
  })
})

// The same, from a kit button. The mode is a native select in the kit
// dropdown's own children, so the document reports the select itself; a kit
// button's own button is inside a shadow root that delegates focus, so the
// document reports the host, and the host is what the wrapper's ref holds.
// The unit test takes both on trust, through objects of its own making.
test("focus on the feed's entry is handed to cell 01's heading when a run disables it", async () => {
  const engineHome = home({ progress_delay_ms: 400 })
  // A record from before the choice was stored holds the app's defaults,
  // which are not Mexico City's entry, so the button is drawn with nothing
  // chosen: a press that made it appear would be a press on the mode.
  const id = 'olderinputs2'
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
    await engineReady(page)
    await openProject(page, 'Older')
    await layOut(page)
    const entry = cell(page, 'data').getByRole('button', { name: "Use the feed's entry" })
    await expect(entry).toBeEnabled()

    // Every route of every operator is kept, so the lines are 1, 2 and 10.
    await recolour(page, '2')
    // Inside the debounce, with focus moved onto the button.
    await entry.focus()
    await expect(entry).toBeFocused()

    await expect(entry).toBeDisabled({ timeout: 30_000 })
    await expect(cellHandback(page, 'data')).toBeFocused()
  })
})

test('focus on a control the run leaves alone in cell 01 stays where it is', async () => {
  const engineHome = home({ progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await layOut(page)
    const inspect = cell(page, 'data')
    const mode = inspect.getByRole('combobox', { name: 'Mode' })
    await expect(mode).toBeEnabled()
    // A sortable header is inside the same panel as the mode and is never
    // disabled, so focus on it has lost nothing and is the person's own:
    // "inside the panel" would be too wide a reason to move it.
    const header = inspect
      .getByRole('table', { name: /^Routes/ })
      .getByRole('button', { name: 'Label' })

    await recolour(page)
    await header.focus()
    await expect(header).toBeFocused()
    // Read at once, not waited for: the header takes focus whether or not
    // the run has begun, so this is what says focus was there first.
    expect(await mode.isEnabled(), 'the rebuild began before focus was placed').toBe(true)

    await expect(mode).toBeDisabled({ timeout: 30_000 })
    await expect(header).toBeFocused()
    // And through the whole of the run, not only at its start.
    await expect(mode).toBeEnabled({ timeout: 30_000 })
    await expect(header).toBeFocused()
  })
})

test('a collapsed cell 01 hands nothing over, and focus on its row stays on its row', async () => {
  const engineHome = home({ progress_delay_ms: 400 })
  await withApp(engineHome, async (page) => {
    await openProjectOn(page, 'LA Metro Rail', 'Los Angeles')
    await layOut(page)
    await expect(cell(page, 'data').getByRole('combobox', { name: 'Mode' })).toBeEnabled()
    // Collapsed, the panel stays in the document with its controls, hidden.
    // Nothing hidden holds focus, and the press that collapses a cell leaves
    // focus on the row's button - which is inside the heading a handback
    // would go to, so a move of any kind shows here as the button losing it.
    await closeCell(page, 'data')
    const row = cellHeading(page, 'data')
    // The mode where it is now: in the document, and out of the tree a role
    // is looked up in unless the lookup is told to look there.
    const hidden = page.getByRole('combobox', {
      name: 'Mode',
      exact: true,
      includeHidden: true,
    })

    await recolour(page)
    await row.focus()
    await expect(row).toBeFocused()
    expect(await hidden.isEnabled(), 'the rebuild began before focus was placed').toBe(true)

    // The run is going, and the collapsed panel was told so: its mode went
    // with every control that waits for a run, as cell 04's theme did.
    await expect(hidden).toBeDisabled({ timeout: 30_000 })
    await expect(
      panel(page, 'Theme').getByRole('button', { name: 'Sepia', exact: true }),
    ).toBeDisabled()
    await expect(row).toBeFocused()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
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
