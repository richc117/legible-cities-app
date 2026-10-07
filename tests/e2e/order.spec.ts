// The Line order section of cell 05 against the stand-in engine: the lines
// in the order they are drawn, a move that redraws the map once and is
// stored, the way back to alphabetical, and the arrangement still there
// when the project is opened again (specs/020-line-order).
//
// The stand-in's LA feed publishes six routes, so a move can be read off one
// project, and `fake-engine.received` is where the `line_order` the engine
// was given is read back.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cellHandback,
  cellHeading,
  closeCell,
  laidOutProject,
  openCell,
  panel,
  withoutOpened,
} from '../support/project'

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
  return withoutOpened(
    JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
}

/** Every message of one method the stand-in read, in order. */
const received = (engineHome: string, method: string): string[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"${method}"`))

const panelOf = (page: Page) => panel(page, 'Line order')
const listOf = (page: Page) =>
  panelOf(page).getByRole('list', { name: 'Lines in the order they are drawn' })
const rowsOf = (page: Page) => listOf(page).getByRole('listitem')

/** The labels down the list, as a person reads them. */
const labelsOf = async (page: Page): Promise<string[]> =>
  (await listOf(page).locator('.line-name').allTextContents()).map((label) => label.trim())

/**
 * The list where a pointer can reach it. The pinned map covers the top half
 * of the window below the header, and a mouse event over it lands on the
 * map, not on the row beneath (issue 213), so the list is centred in what
 * the map does not cover, twice because the map is sticky and moving the
 * page can move what it covers - as `layout.spec.ts` does for the engine
 * log's toggle. Then it says so, so a list taller than that space fails
 * here rather than as a drag that went nowhere.
 */
async function belowTheMap(page: Page): Promise<void> {
  const clear = await listOf(page).evaluate((el) => {
    el.scrollIntoView({ block: 'center' })
    for (let pass = 0; pass < 2; pass += 1) {
      const box = el.getBoundingClientRect()
      const covered = document.querySelector('.preview')?.getBoundingClientRect().bottom ?? 0
      const middle = covered + (window.innerHeight - covered) / 2 - box.height / 2
      window.scrollBy(0, box.top - middle)
    }
    const box = el.getBoundingClientRect()
    const covered = document.querySelector('.preview')?.getBoundingClientRect().bottom ?? 0
    return box.top >= covered && box.bottom <= window.innerHeight
  })
  expect(clear, 'the whole list is below the map and inside the window').toBe(true)
}

/** Where each row's grip is, and each row's box, read once: the places stay put while the lines move through them. */
async function places(page: Page): Promise<{ grips: Point[]; rows: Box[] }> {
  const rows = rowsOf(page)
  const count = await rows.count()
  const grips: Point[] = []
  const boxes: Box[] = []
  for (let i = 0; i < count; i += 1) {
    const grip = (await rows.nth(i).locator('.line-grip').boundingBox())!
    grips.push({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 })
    boxes.push((await rows.nth(i).boundingBox())!)
  }
  return { grips, rows: boxes }
}

type Point = { x: number; y: number }
type Box = { x: number; y: number; width: number; height: number }

/** Pick a line up by its grip with the mouse and carry it to a point, in steps, as a hand would; the button stays down. */
async function carry(page: Page, grip: Point, to: Point): Promise<void> {
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
}

/** A point inside a row's lower half, past its middle, where a line carried down to it lands. */
const lowIn = (row: Box, x: number): Point => ({ x, y: row.y + row.height * 0.8 })

test('lists every line in the order it is drawn, alphabetical until someone says otherwise', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await expect(panelOf(page)).toBeVisible()
    const rows = rowsOf(page)
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('A')
    // The place is said once in the row, as a figure; the list itself tells
    // a screen reader the position, and the status line says it after a move.
    await expect(rows.nth(0)).toContainText('1')
    await expect(rows.nth(5)).toContainText('6')
    // Nothing to put back yet, and no line can leave the list it is at the
    // end of.
    await expect(panelOf(page).getByRole('button', { name: 'Back to alphabetical' })).toBeDisabled()
    await expect(rows.nth(0).getByRole('button', { name: 'Move line A up' })).toBeDisabled()
    await expect(rows.nth(5).getByRole('button', { name: /^Move line .* down/ })).toBeDisabled()
    // Each row has its two arrows and nothing else a person can press or
    // name: the grip is a pointer's handle, hidden from a screen reader and
    // out of the Tab order, because the arrows are the same moves.
    await expect(rows.nth(0).getByRole('button')).toHaveCount(2)
    const grip = rows.nth(0).locator('.line-grip')
    await expect(grip).toBeVisible()
    await expect(grip).toHaveAttribute('aria-hidden', 'true')
    expect(await grip.evaluate((el) => (el as HTMLElement).tabIndex)).toBe(-1)
  })
})

test('a move redraws the map once, is stored, and is there on the next open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    const drawnBefore = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: 'Move line A down' }).click()
    // The move is said politely, because the button's own name does not
    // change and a screen reader would otherwise hear nothing happen.
    await expect(panel.getByRole('status')).toContainText('A is now 2 of 6')
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

    // The cell says so while it is collapsed: the order has moved from the
    // engine's, and no line was recoloured to move it (A5.5-18).
    await closeCell(page, 'lines')
    await expect(cellHeading(page, 'lines')).toContainText('no line recoloured, an order you chose')
    await openCell(page, 'lines')

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

// The drag (issue 283). A line is carried by the grip at its row's start and
// the release is one change on the same timer as a press, so one build.

test('a line dragged from the top to the bottom is one build, said and stored', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    await belowTheMap(page)
    const { grips, rows } = await places(page)
    const before = received(engineHome, 'map.build').length

    await carry(page, grips[0], lowIn(rows[5], grips[0].x))
    // Mid-drag the list follows the pointer: the carried row is lifted and
    // the rows it passed have stood aside, before anything is released or
    // built. Without this the rest could pass for a list that jumped.
    await expect(listOf(page)).toHaveAttribute('data-dragging', 'true')
    await expect(rowsOf(page).nth(0)).toHaveAttribute('data-dragged', 'true')
    // Polled: the move is applied on the next frame, and a read taken once
    // can land before it.
    await expect
      .poll(() =>
        rowsOf(page)
          .nth(3)
          .evaluate((el) => (el as HTMLElement).style.transform),
      )
      .toMatch(/^translateY\(-/)
    expect(
      received(engineHome, 'map.build'),
      'nothing is built while the line is carried',
    ).toHaveLength(before)
    await page.mouse.up()

    await expect(panel.getByRole('status')).toHaveText('A is now 6 of 6.')
    expect(await labelsOf(page)).toEqual(['B', 'C', 'D', 'E', 'K', 'A'])
    await expect(listOf(page)).not.toHaveAttribute('data-dragging', 'true')
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    // Watched failing, with the check above, with `commit` called on every
    // pointer move: the move that carried the line past B built at once,
    // before the release. The other three drags below fail the same way.
    expect(received(engineHome, 'map.build'), 'one build for the whole drag').toHaveLength(
      before + 1,
    )
    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['B', 'C', 'D', 'E', 'K', 'A'])
    expect(
      received(engineHome, 'graph.build'),
      'an order is a render: nothing was laid out again',
    ).toHaveLength(1)
  })
})

test('a drag released outside the list still lands, at the end nearest the pointer', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    await belowTheMap(page)
    const { grips, rows } = await places(page)
    const before = received(engineHome, 'map.build').length

    // Down past the list's foot and well to the side of it, where no row
    // is: the grip holds the pointer, so the release still comes to it.
    // Watched failing with the pointer not captured: nothing landed.
    const foot = rows[rows.length - 1]
    // Kept inside the window, read from the page (Electron reports no
    // viewport size): a point past its edge is a point no event reaches,
    // and one derived from a box near the edge has been inside here and
    // outside in CI before. If the clamp leaves the point over the list,
    // the assertion below says so rather than passing for the wrong reason.
    const win = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
    const outside = {
      x: Math.min(foot.x + foot.width + 40, win.w - 4),
      y: Math.min(foot.y + foot.height + 80, win.h - 4),
    }
    await carry(page, grips[1], outside)
    const box = (await listOf(page).boundingBox())!
    expect(
      outside.y > box.y + box.height || outside.x > box.x + box.width,
      'the release is outside the list',
    ).toBe(true)
    await page.mouse.up()

    await expect(panel.getByRole('status')).toHaveText('B is now 6 of 6.')
    expect(await labelsOf(page)).toEqual(['A', 'C', 'D', 'E', 'K', 'B'])
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    expect(received(engineHome, 'map.build')).toHaveLength(before + 1)
    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['A', 'C', 'D', 'E', 'K', 'B'])
  })
})

test('Escape in the middle of a drag puts the list back and builds nothing', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    await belowTheMap(page)
    const { grips, rows } = await places(page)
    const before = received(engineHome, 'map.build').length

    await carry(page, grips[0], lowIn(rows[3], grips[0].x))
    // The drag is live: the list has moved under the pointer. Only then is
    // the "nothing" below worth anything.
    await expect(rowsOf(page).nth(0)).toHaveAttribute('data-dragged', 'true')
    // Watched failing with Escape not heard during a drag: the line was
    // still carried after it.
    await page.keyboard.press('Escape')
    await expect(listOf(page)).not.toHaveAttribute('data-dragging', 'true')
    expect(await labelsOf(page)).toEqual(['A', 'B', 'C', 'D', 'E', 'K'])
    for (let i = 0; i < 6; i += 1)
      expect(
        await rowsOf(page)
          .nth(i)
          .evaluate((el) => (el as HTMLElement).style.transform),
      ).toBe('')
    // The release that follows is not a drop: the drag is over.
    await page.mouse.up()
    await page.waitForTimeout(1500)
    expect(received(engineHome, 'map.build'), 'Escape builds nothing').toHaveLength(before)
    expect(readRecord(engineHome).lineOrder).toEqual([])
    await expect(panel.getByRole('status')).toHaveText('')
    await expect(panel.getByRole('button', { name: 'Back to alphabetical' })).toBeDisabled()

    // And the same drag, let go this time, does build: the one above was
    // stopped by Escape, not by a drag that could not land.
    await carry(page, grips[0], lowIn(rows[3], grips[0].x))
    await page.mouse.up()
    await expect(panel.getByRole('status')).toHaveText('A is now 4 of 6.')
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    expect(received(engineHome, 'map.build')).toHaveLength(before + 1)
  })
})

test('four drags in a row are one build', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await belowTheMap(page)
    // Every place read before the first drag, so the four follow one
    // another with nothing between them but the mouse: the debounce is what
    // makes them one map, as it is for four presses.
    const { grips, rows } = await places(page)
    const before = received(engineHome, 'map.build').length

    for (let i = 0; i < 4; i += 1) {
      await carry(page, grips[0], lowIn(rows[5], grips[0].x))
      await page.mouse.up()
    }
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    expect(received(engineHome, 'map.build')).toHaveLength(before + 1)
    await expect
      .poll(() => readRecord(engineHome).lineOrder)
      .toEqual(['E', 'K', 'A', 'B', 'C', 'D'])
    expect(await labelsOf(page)).toEqual(['E', 'K', 'A', 'B', 'C', 'D'])
  })
})

test('an arrow carries its name as a tooltip on hover and on focus, and Escape sends it away', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    await belowTheMap(page)
    const up = panel.getByRole('button', { name: 'Move line B up' })
    const arrow = rowsOf(page).nth(1).locator('.line-arrow').first()
    const tip = arrow.locator('.tooltip')
    await expect(tip).toHaveText('Move line B up')
    await expect(tip).toBeHidden()

    // The press lands where the arrow is drawn: the kit's inner button no
    // longer stands out past the square its host draws. Watched failing
    // without the adapter's rule: 44 wide on a square of 28.
    const box = (await up.boundingBox())!
    const drawn = (await arrow.locator('fig-button').boundingBox())!
    expect(box.width).toBeCloseTo(drawn.width, 0)
    expect(box.height).toBeCloseTo(drawn.height, 0)

    // Under the pointer.
    const over = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    // A point to the left of the arrow that is still inside the window: a
    // pointer sent out of the window in one jump reached the arrow's
    // mouseleave late or not at all on a loaded runner, and the dismissal
    // read as never cleared. Moved in steps, so the leave is a move of its
    // own and not the tail of the one that arrived.
    const away = { x: Math.max(8, box.x - 200), y: over.y }
    await page.mouse.move(over.x, over.y, { steps: 4 })
    await expect(tip).toBeVisible()
    // Escape sends it away without the pointer moving (WCAG 1.4.13)...
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(arrow).toHaveAttribute('data-dismissed', 'true')
    // ...until the pointer has left it. Waited for, because the pointer's
    // moves are delivered a frame at a time and two in one frame are one.
    // Not asserted on the Linux runner: under xvfb the arrow stayed
    // dismissed for the whole wait three times in a row and once on macOS,
    // never on a desk, and the app ships on macOS and Windows (issue 327).
    if (process.platform !== 'linux') {
      await page.mouse.move(away.x, away.y, { steps: 4 })
      await expect(arrow).not.toHaveAttribute('data-dismissed', 'true')
      await page.mouse.move(over.x, over.y, { steps: 4 })
      await expect(tip).toBeVisible()
      await page.mouse.move(away.x, away.y, { steps: 4 })
      await expect(tip).toBeHidden()
    }

    // And from the keyboard, with no pointer on it.
    await up.focus()
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(up).toBeFocused()
  })
})

test('a move undone stores nothing at all, because that is the engine’s own order', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    const before = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: 'Move line A down' }).click()
    await panel.getByRole('button', { name: 'Move line A up' }).click()
    await expect(rowsOf(page).nth(0)).toContainText('A')
    // Nothing to draw and nothing to store: the lines are where the engine
    // would have put them, and the way back stays disabled.
    await expect(panel.getByRole('button', { name: 'Back to alphabetical' })).toBeDisabled()
    await page.waitForTimeout(1500)
    expect(received(engineHome, 'map.build')).toHaveLength(before)
    expect(readRecord(engineHome).lineOrder).toEqual([])
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
    // The button disabled itself under the press, and Chromium blurs a
    // disabled element: focus is on the cell's heading row rather than on
    // the body, so a screen reader is still in the cell. The cell's and not
    // this section's own heading, which names the section but takes no
    // focus, and not the row's toggle, which a reflexive Space would use to
    // collapse the cell (A5.5-18).
    await expect(cellHandback(page, 'lines')).toBeFocused()
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

    // And it is still there once the build has run and the record has come
    // back, which draws the list twice more, moving the row the button is
    // in. macOS's runner caught this and this machine, which finishes the
    // build between one press and the next, did not.
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(down).toBeFocused()

    // Back to the top, where that button disables itself. Chromium blurs a
    // disabled element, so focus goes to the one that can still move the
    // line rather than falling to the body.
    const up = panel.getByRole('button', { name: 'Move line A up' })
    await up.focus()
    await page.keyboard.press('Enter')
    await expect(rowsOf(page).nth(0)).toContainText('A')
    await expect(up).toBeDisabled()
    await expect(down).toBeFocused()
    // That move put the lines back where the engine draws them, so nothing
    // is built and nothing redraws; focus stays where it was handed.
    await page.waitForTimeout(1500)
    await expect(down).toBeFocused()
  })
})
