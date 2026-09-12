// The Line order panel against the stand-in engine: the lines in the order
// they are drawn, a move that redraws the map once and is stored, the way
// back to alphabetical, and the arrangement still there when the project is
// opened again (specs/020-line-order).
//
// The stand-in's LA feed publishes six routes, so a move can be read off one
// project, and `fake-engine.received` is where the `line_order` the engine
// was given is read back.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-order-'))
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
  return JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8'))
}

/** Every message of one method the stand-in read, in order. */
const received = (engineHome: string, method: string): string[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"${method}"`))

async function laidOutProject(page: Page, feedName: string, name: string): Promise<void> {
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
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
}

const panelOf = (page: Page) => page.getByRole('region', { name: 'Line order' })
const rowsOf = (page: Page) =>
  panelOf(page)
    .getByRole('list', { name: 'Lines in the order they are drawn' })
    .getByRole('listitem')

test('lists every line in the order it is drawn, alphabetical until someone says otherwise', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await expect(panelOf(page)).toBeVisible()
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('A')
    await expect(rows.nth(0)).toContainText('1 of 6')
    await expect(rows.nth(5)).toContainText('6 of 6')
    // Nothing to put back yet, and no line can leave the list it is at the
    // end of.
    await expect(panelOf(page).getByRole('button', { name: 'Back to alphabetical' })).toBeDisabled()
    await expect(rows.nth(0).getByRole('button', { name: 'Move line A up' })).toBeDisabled()
    await expect(rows.nth(5).getByRole('button', { name: /^Move line .* down/ })).toBeDisabled()
  })
})

test('a move redraws the map once, is stored, and is there on the next open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    const drawnBefore = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: 'Move line A down' }).click()
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })

    const maps = received(engineHome, 'map.build')
    expect(maps, 'one build, not one per press').toHaveLength(drawnBefore + 1)
    // The whole arrangement, not the one line that moved: what the record
    // holds is the list a person was looking at.
    expect(maps[maps.length - 1]).toContain('"B",')
    expect(maps[maps.length - 1], 'from the stored layout, never a fresh one').toContain('"layout"')
    expect(
      received(engineHome, 'graph.build'),
      'an order is a render: nothing was laid out again',
    ).toHaveLength(1)

    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['B', 'A', 'C', 'D', 'E', 'K'])
    await expect(rowsOf(page).nth(0)).toContainText('B')

    // Back to the Library and in again: the same order, and nothing built.
    const built = received(engineHome, 'map.build').length
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(rowsOf(page).nth(0)).toContainText('B')
    await expect(rowsOf(page).nth(1)).toContainText('A')
    expect(received(engineHome, 'map.build')).toHaveLength(built)
  })
})

test('four presses in a row are one build', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    const before = received(engineHome, 'map.build').length

    // The same line to the bottom, one press at a time: the debounce is
    // what makes this one map.
    for (let i = 0; i < 4; i += 1)
      await panel.getByRole('button', { name: 'Move line A down' }).click()
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    expect(received(engineHome, 'map.build')).toHaveLength(before + 1)
    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['B', 'C', 'D', 'E', 'A', 'K'])
  })
})

test('back to alphabetical empties the order and disables itself', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)

    await panel.getByRole('button', { name: 'Move line K up' }).click()
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['A', 'B', 'C', 'D', 'K', 'E'])

    const back = panel.getByRole('button', { name: 'Back to alphabetical' })
    await expect(back).toBeEnabled()
    await back.click()
    await expect.poll(() => readRecord(engineHome).lineOrder, { timeout: 30_000 }).toEqual([])
    await expect(back).toBeDisabled()
    await expect(rowsOf(page).nth(4)).toContainText('E')
    // The request that put it back carries no order at all, which is what
    // the engine's own alphabetical order is.
    const maps = received(engineHome, 'map.build')
    expect(maps[maps.length - 1]).not.toContain('line_order')
  })
})

test('every control is named for its line, and focus follows the line that moved', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    for (const line of ['A', 'B', 'C', 'D', 'E', 'K']) {
      await expect(panel.getByRole('button', { name: `Move line ${line} up` })).toBeVisible()
      await expect(panel.getByRole('button', { name: `Move line ${line} down` })).toBeVisible()
    }

    // From the keyboard alone, and the button that made the move keeps
    // focus so the next press moves the same line again.
    const down = panel.getByRole('button', { name: 'Move line A down' })
    await down.focus()
    await page.keyboard.press('Enter')
    await expect(rowsOf(page).nth(1)).toContainText('A')
    await expect(down).toBeFocused()

    // Back to the top, where that button disables itself. Chromium blurs a
    // disabled element, so focus goes to the one that can still move the
    // line rather than falling to the body.
    const up = panel.getByRole('button', { name: 'Move line A up' })
    await up.focus()
    await page.keyboard.press('Enter')
    await expect(rowsOf(page).nth(0)).toContainText('A')
    await expect(up).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Move line A down' })).toBeFocused()
  })
})
