// Cell 02's Layout tuning (issue 385, spec 033), against the stand-in engine:
// LOOM's grid, merge distance, grid size and bend penalties, written to the
// record the moment they are committed, sent to `graph.build` by the next
// layout run and by nothing else, and reported as a layout of another tuning
// until that run.
//
// The stand-in takes a `tuning` as engine v0.14.0 does: it refuses what the
// engine refuses, names a different layout for a different tuning and the
// untuned one for none, and keeps every message it read in
// `fake-engine.received`, so what these assert is what the app *sent*. What
// LOOM then lays out on a hexalinear grid is the engine's and LOOM's own.
//
// Waits are deadlines on what the page shows or the record holds, never a
// sleep. Mutations the coordinator runs this file under, each of which must
// turn at least the named test red:
// - `tuningParams` dropped from the `graph.build` call (`engine/layoutRun.ts`):
//   'Lay out again sends the tuning'.
// - the `asked` spread dropped from the completion (`engine/layoutRun.ts`):
//   'Lay out again sends the tuning' (the staleness never clears).
// - the `tuning` source removed from `stalenessOf` (`runGraph.ts`): 'a grid
//   and a penalty are written at once'.
// - `LayoutTuning`'s `write` made a no-op: 'a grid and a penalty are written
//   at once', 'Reset clears', 'a reopened project shows its tuning'.
// - `commitTuningField` loses its range check (`tuningRules.ts`): 'a number
//   outside its range is refused'.
// - Reset's `heading.current?.focus()` removed (`LayoutTuning.tsx`): 'Reset
//   clears' (focus falls to the page as the button disables itself).
// - the stand-in's flags left out of its layout id: 'Lay out again sends the
//   tuning' (the layout does not change).
// - `askedWith` taken from the record at the run's end rather than its start:
//   no test here can hold it (the stand-in answers too fast to commit between
//   the request and the answer); `tests/unit/layout-run.test.ts` does.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cellHeading,
  createProject,
  expandHeading,
  laidOutProject,
  openProject,
  withoutOpened,
} from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** The engine's own sentences (`serve._tuned` at v0.14.0), word for word. */
const MERGE_RANGE = 'tuning.merge_distance must be from 5 to 500, in metres'
const GRID_SIZE_RANGE =
  'tuning.grid_size must be from 25 to 400, as a percentage of the distance between adjacent stations'

/** What cell 02 says under its run while the layout is of another tuning. */
const STALE_FROM_DEFAULTS =
  'Lay out again to use this tuning: the map on screen was laid out with LOOM’s defaults.'

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-tuning-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

async function withApp(engineHome: string, run: (page: Page) => Promise<void>): Promise<void> {
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
    await run(await app.firstWindow())
  } finally {
    await app.close()
  }
}

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return withoutOpened(
    JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
}

/** Every request of one method the stand-in read, in order, parsed. */
const requests = (engineHome: string, method: string): { params: Record<string, unknown> }[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`))
    .map((line) => JSON.parse(line) as { params: Record<string, unknown> })

const toggle = (page: Page): Locator => page.getByRole('button', { name: /^Layout tuning\b/ })
const section = (page: Page): Locator =>
  page.getByRole('group', { name: 'Layout tuning', exact: true })
const field = (page: Page, name: string): Locator => section(page).getByLabel(name, { exact: true })
const grid = (page: Page): Locator => section(page).getByRole('combobox', { name: 'Grid' })
const reset = (page: Page): Locator =>
  section(page).getByRole('button', { name: 'Reset to LOOM’s defaults', exact: true })
/** Where Reset hands focus: the heading the toggle sits in, not the toggle. */
const handback = (page: Page): Locator =>
  page.locator('h3.disclosure-heading').filter({ has: toggle(page) })
const mapFrame = (page: Page): Locator => page.locator('iframe.viewer-frame')
const said = (page: Page): Locator => page.locator('.project-run').getByRole('status')

/** Type a figure and commit it with Enter, as a person does. */
async function set(page: Page, name: string, figure: string): Promise<void> {
  await field(page, name).fill(figure)
  await field(page, name).press('Enter')
}

/** A project laid out on the stand-in, with its Layout tuning opened. */
async function laidOutAndOpen(page: Page): Promise<void> {
  await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await toggle(page).click()
  await expect(section(page)).toBeVisible()
}

test('the section starts closed and says LOOM’s defaults, and a project never tuned sends no tuning', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')

    // Closed, under the run's controls, its toggle in a level-3 heading.
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(page)).toHaveAccessibleName('Layout tuning LOOM’s defaults')
    await expect(section(page)).toBeHidden()
    await expect(page.getByRole('heading', { level: 3, name: /^Layout tuning\b/ })).toBeVisible()

    // The one layout run sent what an untuned project always sent.
    const builds = requests(engineHome, 'graph.build')
    expect(builds).toHaveLength(1)
    expect(builds[0].params, 'no tuning key at all').not.toHaveProperty('tuning')
    const record = readRecord(engineHome)
    expect(record, 'nothing written for a tuning nobody chose').not.toHaveProperty('tuning')
    expect(record).not.toHaveProperty('laidOutWith')

    // Opened: the grid, the seven numbers at LOOM's own, each with its range.
    await toggle(page).click()
    await expect(section(page)).toBeVisible()
    await expect(grid(page)).toHaveValue('octilinear')
    const options = await grid(page).locator('option').allTextContents()
    expect(options).toEqual([
      'octilinear (eight directions; LOOM’s own)',
      'ortholinear (four directions)',
      'orthoradial (rings and spokes)',
      'hexalinear (six directions)',
    ])
    const shown: [string, string, string][] = [
      ['Merge distance', '50', '5 to 500 metres. LOOM’s own is 50.'],
      [
        'Grid size',
        '100',
        '25 to 400 percent of the distance between adjacent stations. LOOM’s own is 100.',
      ],
      ['45°', '2', '0 to 10. LOOM’s own is 2.'],
      ['90°', '1.5', '0 to 10. LOOM’s own is 1.5.'],
      ['135°', '1', '0 to 10. LOOM’s own is 1.'],
      ['180°', '0', '0 to 10. LOOM’s own is 0.'],
      ['Diagonal', '0.5', '0 to 10. LOOM’s own is 0.5.'],
    ]
    for (const [name, value, description] of shown) {
      await expect(field(page, name), name).toHaveValue(value)
      await expect(field(page, name), name).toHaveAccessibleDescription(description)
    }
    await expect(section(page).getByRole('group', { name: 'Bend penalties' })).toBeVisible()
    await expect(section(page).getByRole('slider')).toHaveCount(0)
    await expect(reset(page), 'nothing to reset').toBeDisabled()
  })
})

test('a grid and a penalty are written at once, the cells below read not drawn yet, and the map stays', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutAndOpen(page)
    const before = readRecord(engineHome)
    const map = await mapFrame(page).getAttribute('src')

    await grid(page).selectOption('orthoradial')
    await expect
      .poll(() => readRecord(engineHome).tuning, { message: 'the grid is written at once' })
      .toEqual({ grid: 'orthoradial' })
    await set(page, '45°', '3')
    await expect
      .poll(() => readRecord(engineHome).tuning, { message: 'and the penalty' })
      .toEqual({ grid: 'orthoradial', deg45: 3 })
    await expect(toggle(page)).toHaveAccessibleName('Layout tuning tuned')

    // The layout is of another tuning now: cell 02 says so under its run,
    // the cells below it are not drawn yet, and Run all is offered.
    await expect(page.getByText(STALE_FROM_DEFAULTS, { exact: true })).toBeVisible()
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).toContainText('not drawn yet')
    await expect(cellHeading(page, 'process')).toContainText('ready')
    await expect(said(page)).toHaveText('03 Frame and service day to 06 Export are not drawn yet.')
    await expect(page.getByRole('button', { name: 'Run all' })).toBeEnabled()

    // And nothing ran for it: the map is the one it was, from the same layout.
    expect(requests(engineHome, 'graph.build'), 'nothing was laid out').toHaveLength(1)
    expect(requests(engineHome, 'map.build'), 'nothing was drawn').toHaveLength(1)
    expect(await mapFrame(page).getAttribute('src'), 'the map stays').toBe(map)
    const after = readRecord(engineHome)
    expect(after.layout).toBe(before.layout)
    expect(after.drawn).toEqual(before.drawn)
    expect(after).not.toHaveProperty('laidOutWith')
  })
})

test('Lay out again sends the tuning, the layout is its own, and the staleness clears; Run all does the same', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutAndOpen(page)
    const untuned = readRecord(engineHome).layout

    await grid(page).selectOption('orthoradial')
    await expect.poll(() => readRecord(engineHome).tuning).toEqual({ grid: 'orthoradial' })
    await expect(page.getByText(STALE_FROM_DEFAULTS, { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Lay out again', exact: true }).click()
    // A tuned layout is a layout of its own, so the run lands on another id.
    await expect(
      page.getByText(
        'Laid out. The layout differs from the one the project had recorded, so the project now names this one.',
      ),
    ).toBeVisible({ timeout: 30_000 })
    const builds = requests(engineHome, 'graph.build')
    expect(builds).toHaveLength(2)
    expect(builds[1].params.tuning, 'in the engine’s names').toEqual({ grid: 'orthoradial' })
    await expect.poll(() => readRecord(engineHome).laidOutWith).toEqual({ grid: 'orthoradial' })
    const tuned = readRecord(engineHome)
    expect(tuned.layout).not.toBe(untuned)
    expect(tuned.tuning).toEqual({ grid: 'orthoradial' })

    await expect(page.getByText(STALE_FROM_DEFAULTS, { exact: true })).toHaveCount(0)
    await expect(said(page)).toHaveText('The map is drawn from every cell.')
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).not.toContainText('not drawn yet')

    // The next change, and Run all, which lays the project out with it.
    await set(page, 'Merge distance', '80')
    await expect
      .poll(() => readRecord(engineHome).tuning)
      .toEqual({ mergeDistance: 80, grid: 'orthoradial' })
    await expect(
      page.getByText(
        'Lay out again to use this tuning: the map on screen was laid out with another tuning.',
        { exact: true },
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Run all' }).click()
    await expect(said(page)).toHaveText('The map is drawn from every cell.', { timeout: 30_000 })
    const again = requests(engineHome, 'graph.build')
    expect(again).toHaveLength(3)
    expect(again[2].params.tuning).toEqual({ merge_distance: 80, grid: 'orthoradial' })
    expect(again[2].params, 'Run all never re-lays out by force').not.toHaveProperty('force')
    await expect
      .poll(() => readRecord(engineHome).laidOutWith)
      .toEqual({ mergeDistance: 80, grid: 'orthoradial' })
  })
})

test('a number outside its range is refused beside the field in the engine’s sentence, and nothing is written', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutAndOpen(page)

    await set(page, 'Merge distance', '600')
    const alert = section(page).getByRole('alert').filter({ hasText: MERGE_RANGE })
    await expect(alert).toHaveText(MERGE_RANGE)
    await expect(field(page, 'Merge distance')).toHaveAttribute('aria-invalid', 'true')
    await expect(field(page, 'Merge distance'), 'left as typed').toHaveValue('600')
    await expect(field(page, 'Merge distance')).toHaveAccessibleDescription(
      new RegExp(MERGE_RANGE.slice(0, 30)),
    )
    // Not a number is the same sentence, for its own field.
    await set(page, 'Grid size', 'wide')
    await expect(section(page).getByRole('alert').filter({ hasText: GRID_SIZE_RANGE })).toHaveText(
      GRID_SIZE_RANGE,
    )

    // Nothing was written, and the row still says so.
    await expect(toggle(page)).toHaveAccessibleName('Layout tuning LOOM’s defaults')
    expect(readRecord(engineHome)).not.toHaveProperty('tuning')
    expect(requests(engineHome, 'graph.build')).toHaveLength(1)

    // Mending one writes it; the other waits as typed, with its sentence.
    await set(page, 'Merge distance', '80')
    await expect.poll(() => readRecord(engineHome).tuning).toEqual({ mergeDistance: 80 })
    await expect(section(page).getByRole('alert').filter({ hasText: MERGE_RANGE })).toHaveCount(0)
    await expect(field(page, 'Grid size')).toHaveValue('wide')
    await expect(field(page, 'Grid size')).toHaveAttribute('aria-invalid', 'true')
  })
})

test('Reset clears the record’s tuning, says LOOM’s defaults, and hands focus to the section’s heading', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutAndOpen(page)
    await grid(page).selectOption('hexalinear')
    await set(page, '90°', '4')
    await expect.poll(() => readRecord(engineHome).tuning).toEqual({ grid: 'hexalinear', deg90: 4 })
    await expect(reset(page)).toBeEnabled()

    await reset(page).click()
    // The button disables itself with nothing left to reset, so focus went
    // to the section's heading first and not to the page (A6-07).
    await expect(handback(page)).toBeFocused()
    await expect
      .poll(() => readRecord(engineHome), { message: 'the key itself is gone' })
      .not.toHaveProperty('tuning')
    await expect(toggle(page)).toHaveAccessibleName('Layout tuning LOOM’s defaults')
    await expect(grid(page)).toHaveValue('octilinear')
    await expect(field(page, '90°')).toHaveValue('1.5')
    await expect(reset(page)).toBeDisabled()
    // Back to what the layout was asked with: nothing is behind.
    await expect(page.getByText(/^Lay out again to use/)).toHaveCount(0)
    await expect(said(page)).toHaveText('The map is drawn from every cell.')
  })
})

test('a reopened project shows its tuning, and its layout still reads as of another tuning', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutAndOpen(page)
    await grid(page).selectOption('ortholinear')
    await set(page, 'Diagonal', '1')
    await expect
      .poll(() => readRecord(engineHome).tuning)
      .toEqual({ grid: 'ortholinear', diagonal: 1 })

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    // A laid-out project opens with cells 01 and 02 collapsed (spec 029, FR-010).
    await expandHeading(page, 'process')
    // Closed again, as a project always opens, and saying what it holds.
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle(page)).toHaveAccessibleName('Layout tuning tuned')
    await expect(page.getByText(STALE_FROM_DEFAULTS, { exact: true })).toBeVisible()
    await toggle(page).click()
    await expect(grid(page)).toHaveValue('ortholinear')
    await expect(field(page, 'Diagonal')).toHaveValue('1')
    await expect(field(page, '45°')).toHaveValue('2')
  })
})

test('a tuning chosen before the first layout is the one it is laid out with', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await createProject(page, 'LA Metro Rail', 'Los Angeles')
    await openProject(page, 'Los Angeles')
    await toggle(page).click()
    await set(page, 'Grid size', '50')
    await expect.poll(() => readRecord(engineHome).tuning).toEqual({ gridSize: 50 })
    // Nothing is behind before there is a layout to be behind.
    await expect(page.getByText(/^Lay out again to use/)).toHaveCount(0)

    await page.getByRole('button', { name: 'Lay out', exact: true }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    expect(requests(engineHome, 'graph.build')[0].params.tuning).toEqual({ grid_size: 50 })
    await expect.poll(() => readRecord(engineHome).laidOutWith).toEqual({ gridSize: 50 })
    await expect(said(page)).toHaveText('The map is drawn from every cell.')
  })
})
