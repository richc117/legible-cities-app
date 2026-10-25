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
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
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
import {
  appRedrawDelay,
  boxNumbers,
  buildsFor,
  gapsBetween,
  heardApart,
  notebookSettled,
  pointerSeenBy,
  showIfHidden,
  steady,
  watchPointer,
} from '../support/steady'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/**
 * The quiet interval a line-order move waits for before it builds: the
 * app's own `REDRAW_DELAY` (`src/renderer/src/colours.ts`), read from its
 * source, because a spec does not import that module (it reaches
 * components) and a copy of the number is one that drifts (issue 380).
 */
const REDRAW_DELAY_MS = appRedrawDelay(repoRoot)

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-order-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
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
    await run(await app.firstWindow(), app)
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
async function carry(page: Page, grip: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
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

/** How long a press may take to land before the test says which press it was. */
const PRESS_MS = 10_000

/** How long the project may take to be laid out, before the test says it was that. */
const LAY_OUT_MS = 30_000

/**
 * A wait with a deadline of its own and a name, for a call that has none
 * (issue 380): the test's 60 s timeout names nothing, so a wait that hangs
 * says only that the test ran out. The work is left to finish or fail
 * behind the deadline; the app closes under it.
 */
async function within<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms`)), ms)
  })
  try {
    return await Promise.race([work, late])
  } finally {
    clearTimeout(timer)
    work.catch(() => undefined)
  }
}

/** A press with a deadline of its own, so a press that never lands says which one it was. */
async function pressed(button: Locator, what: string): Promise<void> {
  try {
    await button.click({ timeout: PRESS_MS })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new Error(`${what} did not land within ${PRESS_MS} ms: ${why}`, { cause: error })
  }
}

test('four presses in a row are one build', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await within(
      'the project being laid out',
      LAY_OUT_MS,
      laidOutProject(page, 'LA Metro Rail', 'Los Angeles'),
    )
    const panel = panelOf(page)
    const before = received(engineHome, 'map.build').length

    // The debounce is a time, and the time four presses take is the
    // runner's: each press is stamped by the page as it hears it, and what
    // the builds are held to is read from those stamps below (issue 380, as
    // for the drags, issue 373).
    await watchPointer(page)
    // The same line to the bottom, one press at a time: the debounce is
    // what makes this one map.
    for (let i = 0; i < 4; i += 1)
      await pressed(
        panel.getByRole('button', { name: 'Move line A down' }),
        `press ${i + 1} of 4 on "Move line A down"`,
      )
    await expect
      .poll(async () => (await pointerSeenBy(page)).released.length, {
        timeout: 10_000,
        message: 'the page heard four presses',
      })
      .toBe(4)
    const gaps = gapsBetween((await pointerSeenBy(page)).released)

    // The last build is the one that writes the order the four presses
    // ended on, so it is waited for by the record, not by the first
    // sentence that says a map was drawn: a build that fell between two
    // presses says it too, and the count below must be taken after the last.
    await expect
      .poll(() => readRecord(engineHome).lineOrder, {
        timeout: 30_000,
        message: 'the last build wrote the order the four presses ended on',
      })
      .toEqual(['B', 'C', 'D', 'E', 'A', 'K'])
    await expect(
      page.getByText(/Drawn with the lines in the order you chose/),
      'the map says it was drawn with the order chosen',
    ).toBeVisible({ timeout: 30_000 })
    // And nothing more is coming: the count holds through a pause longer
    // than the interval.
    await page.waitForTimeout(REDRAW_DELAY_MS + 200)
    const made = received(engineHome, 'map.build').length - before
    const held = buildsFor(gaps, REDRAW_DELAY_MS)
    const said = heardApart('the presses were', gaps)
    if (held.exactlyOne) {
      expect(made, `${said}, each inside the ${REDRAW_DELAY_MS} ms debounce: one build`).toBe(1)
      return
    }
    // As for the drags: a gap of the interval or more is a gap a build may
    // have fallen in, so the runner could not make the four presses one
    // gesture, which is not the debounce failing. What still holds is
    // checked, and then the test says it did not prove its title.
    expect(made, `${said}: at least one build`).toBeGreaterThanOrEqual(1)
    expect(made, `${said}: at most ${held.most} builds`).toBeLessThanOrEqual(held.most)
    const unproved = `${said}; the ${REDRAW_DELAY_MS} ms debounce could fit between two of them, so four presses in a row were not one gesture here, and the ${made} build(s) made do not test the debounce`
    console.log(`four presses in a row: ${unproved}`)
    test.info().annotations.push({ type: 'slow runner', description: unproved })
    test.skip(true, unproved)
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
  await withApp(engineHome, async (page, app) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    // The places are read once, below, so the column is let settle first.
    await notebookSettled(page)
    await showIfHidden(app, page, 'four drags in a row')
    await belowTheMap(page)
    await steady(
      page,
      async () => boxNumbers((await rowsOf(page).nth(0).locator('.line-grip').boundingBox())!),
      "the first row's grip",
    )
    // Every place read before the first drag, so the four follow one
    // another with nothing between them but the mouse: the debounce is what
    // makes them one map, as it is for four presses.
    const { grips, rows } = await places(page)
    const before = received(engineHome, 'map.build').length

    // The debounce is a time, and the time the four drags take is the
    // runner's: each release is stamped by the page as it hears it, and what
    // the builds are held to is read from those stamps below (issue 373).
    // Two steps a drag, not eight: the fewer calls between two releases, the
    // fewer chances for a starved runner to put the quiet interval between them.
    await watchPointer(page)
    for (let i = 0; i < 4; i += 1) {
      await carry(page, grips[0], lowIn(rows[5], grips[0].x), 2)
      await page.mouse.up()
    }
    await expect
      .poll(async () => (await pointerSeenBy(page)).released.length, {
        timeout: 30_000,
        message: 'the page heard four releases',
      })
      .toBe(4)
    const gaps = gapsBetween((await pointerSeenBy(page)).released)

    // The last build is the one that writes the order the four drags ended
    // on, so it is waited for by the record, not by the first sentence that
    // says a map was drawn: a build that fell between two releases says it
    // too, and the count below must be taken after the last one.
    await expect
      .poll(() => readRecord(engineHome).lineOrder, {
        timeout: 30_000,
        message: 'the last build wrote the order the four drags ended on',
      })
      .toEqual(['E', 'K', 'A', 'B', 'C', 'D'])
    await expect(page.getByText(/Drawn with the lines in the order you chose/)).toBeVisible({
      timeout: 30_000,
    })
    expect(await labelsOf(page)).toEqual(['E', 'K', 'A', 'B', 'C', 'D'])
    // And nothing more is coming: the count holds through a pause longer
    // than the interval.
    await page.waitForTimeout(REDRAW_DELAY_MS + 200)
    const made = received(engineHome, 'map.build').length - before
    const held = buildsFor(gaps, REDRAW_DELAY_MS)
    const said = `releases heard ${gaps.map((gap) => Math.round(gap)).join(', ')} ms apart`
    if (held.exactlyOne) {
      expect(made, `${said}, each inside the ${REDRAW_DELAY_MS} ms debounce: one build`).toBe(1)
      return
    }
    // A gap of the interval or more is a gap a build may have fallen in: the
    // runner could not make the four drags one gesture, which is not the
    // debounce failing. What still holds is checked - a build, and at most
    // one for each such gap - and then the test says it did not prove its
    // title: recorded as skipped, not passed, and written to the log, since
    // an annotation is not printed by the reporters CI uses.
    expect(made, `${said}: at least one build`).toBeGreaterThanOrEqual(1)
    expect(made, `${said}: at most ${held.most} builds`).toBeLessThanOrEqual(held.most)
    const unproved = `${said}; the ${REDRAW_DELAY_MS} ms debounce could fit between two of them, so four drags in a row were not one gesture here, and the ${made} build(s) made do not test the debounce`
    console.log(`four drags in a row: ${unproved}`)
    test.info().annotations.push({ type: 'slow runner', description: unproved })
    test.skip(true, unproved)
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
    // Nothing holds focus inside the arrow while the pointer is on it: the
    // dismissal below is then the pointer's alone, and the pointer's leave
    // clears it. An arrow that held focus would be dismissed as focused and
    // keep its mark until the focus left as well; a failure says who holds
    // it, read again where it fails and not only here (issue 327).
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    // What the arrow was told about the pointer, kept in the page so that a
    // failure can print it: the mark once stayed after a leave, and whether
    // the leave arrived at all is what nothing recorded.
    await arrow.evaluate((element) => {
      const seen: string[] = []
      ;(window as unknown as { arrowPointerEvents: string[] }).arrowPointerEvents = seen
      const started = performance.now()
      for (const type of ['pointerover', 'pointerout', 'mouseout']) {
        element.addEventListener(
          type,
          (event) => {
            const to = (event as MouseEvent).relatedTarget as Element | null
            seen.push(
              `${type}@${Math.round(performance.now() - started)}ms->${to?.tagName ?? 'nothing'}`,
            )
          },
          true,
        )
      }
    })
    const focusNow = (): Promise<string> =>
      page.evaluate(() => {
        const active = document.activeElement
        if (active === null || active === document.body) return 'nothing'
        const name =
          active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 40) ?? ''
        return `${active.tagName.toLowerCase()} "${name}"${active.closest('[data-arrow]') ? ' inside an arrow' : ''}`
      })
    const eventsNow = (): Promise<string> =>
      page.evaluate(
        () =>
          (window as unknown as { arrowPointerEvents?: string[] }).arrowPointerEvents?.join(', ') ??
          'none recorded',
      )
    await page.mouse.move(over.x, over.y, { steps: 4 })
    await expect(tip).toBeVisible()
    const holder = await focusNow()
    expect(holder, 'what held focus while the pointer was over the arrow').not.toContain(
      'inside an arrow',
    )
    // Escape sends it away without the pointer moving (WCAG 1.4.13)...
    await page.keyboard.press('Escape')
    await expect(tip).toBeHidden()
    await expect(arrow).toHaveAttribute('data-dismissed', 'true')
    const afterEscape = await focusNow()
    // A blur while the pointer is still over the arrow does not end the
    // mark: both must have left (issue 327). Two frames are waited for, so
    // that a clear on the blur would have drawn by the time it is read.
    await up.focus()
    await expect(up).toBeFocused()
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await expect(up).not.toBeFocused()
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    await expect(arrow, 'a blur with the pointer still over the arrow').toHaveAttribute(
      'data-dismissed',
      'true',
    )
    // ...until the pointer has left it. Waited for, because the pointer's
    // moves are delivered a frame at a time and two in one frame are one.
    await page.mouse.move(away.x, away.y, { steps: 4 })
    try {
      await expect(arrow).not.toHaveAttribute('data-dismissed', 'true')
    } catch (error) {
      throw new Error(
        `${(error as Error).message}\nfocus before Escape: ${holder}; after Escape: ${afterEscape}; at the failure: ${await focusNow()}\nthe arrow's pointer events: ${await eventsNow()}`,
        { cause: error },
      )
    }

    // The same again with the leave lost, as it was on the runners that
    // failed: a listener on the window runs in the capture phase before the
    // interface's own and the document's, and stops the boundary events
    // there, while the pointer's moves still arrive. The mark must then be
    // cleared by the next move, which only the document's watcher sees.
    await page.mouse.move(over.x, over.y, { steps: 4 })
    await expect(tip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(arrow).toHaveAttribute('data-dismissed', 'true')
    const loseLeaves = (on: boolean): Promise<void> =>
      page.evaluate((lose) => {
        const w = window as unknown as {
          lostLeaves?: { types: string[]; stop: (event: Event) => void }
        }
        if (w.lostLeaves === undefined) {
          w.lostLeaves = {
            types: ['pointerout', 'pointerover', 'mouseout', 'mouseover'],
            stop: (event) => event.stopImmediatePropagation(),
          }
        }
        for (const type of w.lostLeaves.types) {
          if (lose) window.addEventListener(type, w.lostLeaves.stop, true)
          else window.removeEventListener(type, w.lostLeaves.stop, true)
        }
      }, on)
    await loseLeaves(true)
    try {
      await page.mouse.move(away.x, away.y, { steps: 4 })
      await expect(
        arrow,
        'the leave was lost, so only the document watcher can have cleared the mark',
      ).not.toHaveAttribute('data-dismissed', 'true')
    } finally {
      await loseLeaves(false)
    }
    await page.mouse.move(over.x, over.y, { steps: 4 })
    await expect(tip).toBeVisible()
    await page.mouse.move(away.x, away.y, { steps: 4 })
    await expect(tip).toBeHidden()

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

test('a move undone while its build runs is drawn once that build has written', async () => {
  // Issue 399. A moved down, and moved back up while the build of the move
  // runs: the move back equals the record still on disk, which that build
  // is about to change. It waits, and is drawn once the build has written.
  // Written, not run in the lane; the coordinator's mutation: `useCheapEdit.ts`
  // `attempt` comparing before it waits - the move back is dropped, the
  // build writes B first, and the list follows the record back to it.
  const engineHome = home({ progress_delay_ms: 300 })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = panelOf(page)
    const before = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: 'Move line A down' }).click()
    await expect
      .poll(() => received(engineHome, 'map.build').length, { timeout: 15_000 })
      .toBe(before + 1)

    // The build of the move is running: A goes back to the top, which is
    // the engine's own order, and the move back says it is waiting.
    await panel.getByRole('button', { name: 'Move line A up' }).click()
    await expect(rowsOf(page).nth(0)).toContainText('A')
    await expect(panel.getByRole('status')).toContainText('Waiting for the map to be free')

    await expect
      .poll(() => received(engineHome, 'map.build').length, { timeout: 30_000 })
      .toBe(before + 2)
    expect(
      received(engineHome, 'map.build')[before + 1],
      'the second build is the engine’s own order',
    ).not.toContain('line_order')
    await expect.poll(() => readRecord(engineHome).lineOrder, { timeout: 30_000 }).toEqual([])
    await expect(rowsOf(page).nth(0)).toContainText('A')
    await expect(rowsOf(page).nth(1)).toContainText('B')
  })
})
