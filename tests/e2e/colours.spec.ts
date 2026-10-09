// The Line colours section of cell 05 against the stand-in engine: the
// feed's colours beside the lines, an override that redraws the map once
// and is stored, the resets, the default for a line the feed leaves
// uncoloured, the sentence the collapsed cell carries, and the colours
// still there when the project is opened again (specs/018-colours).
//
// The stand-in's LA feed publishes a colour for each of its six routes, so
// the feed's own colours, an override over them and the default a line
// without one would take can all be read off one project. What a build that
// fails leaves behind is the run's unit test: the stand-in reads its control
// file once, at start, and cannot be turned round mid-session.

import { copyFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  cell,
  cellHeading,
  closeCell,
  laidOutProject,
  openCell,
  openProject,
  withoutOpened,
} from '../support/project'
import {
  afterFrames,
  notebookSettled,
  pointerHasReached,
  showIfHidden,
  steady,
  watchPointer,
} from '../support/steady'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-colours-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

async function withApp(
  engineHome: string,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
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

test('lists the feed lines with the colours the feed publishes', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    await expect(panel).toBeVisible()
    // `exact`, because cell 05's other section lists "Lines in the order
    // they are drawn" and Playwright matches an accessible name by
    // substring: without it this counts both lists (A5.5-18).
    const rows = panel.getByRole('list', { name: 'Lines', exact: true }).getByRole('listitem')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('A')
    // The engine's route_color, hashed and lower-cased, and where the
    // colour came from said in words.
    await expect(rows.nth(0)).toContainText('#0072bc')
    await expect(rows.nth(0)).toContainText('the colour in the feed')
    // Nothing to reset yet: Reset is in the chip's panel (issue 284), and
    // disabled there until the line has a colour of its own.
    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    await expect(
      panel.getByRole('group', { name: 'Colour for line A' }).getByRole('button', {
        name: /^Reset line A/,
      }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(panel.getByRole('button', { name: 'Reset every line' })).toBeDisabled()
    // Cell 05 is one cell of two sections, each named by a heading of its
    // own a level below the cell's: the cell is called Lines, and one
    // heading cannot say where the colours end and the order begins
    // (A5.5-18).
    await expect(panel.getByRole('heading', { name: 'Line colours' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Line order' })).toBeVisible()
  })
})

test('the collapsed cell says what its lines carry', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const row = cellHeading(page, 'lines')

    // Nothing chosen yet: the record's own colours and the engine's own
    // order, said as what they are rather than left blank.
    await closeCell(page, 'lines')
    await expect(row).toContainText('no line recoloured')

    await openCell(page, 'lines')
    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    // The summary is of the record, so it waits for the record: the build
    // writes it and the screen reads it back.
    await expect
      .poll(() => readRecord(engineHome).colors, { timeout: 30_000 })
      .toEqual({
        A: '#ff0000',
      })

    await closeCell(page, 'lines')
    await expect(row).toContainText('1 line recoloured')
  })
})

test('an override redraws the map once, is stored, and is there on the next open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const drawnBefore = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await expect(picker).toBeVisible()
    // Typed, not dragged: the path that needs no pointing device.
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()

    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    const maps = received(engineHome, 'map.build')
    expect(maps, 'one build, not one per keystroke').toHaveLength(drawnBefore + 1)
    expect(maps[maps.length - 1]).toContain('"#ff0000"')
    expect(maps[maps.length - 1], 'from the stored layout, never a fresh one').toContain('"layout"')
    expect(
      received(engineHome, 'graph.build'),
      'a colour is a render: nothing was laid out again',
    ).toHaveLength(1)

    const record = readRecord(engineHome)
    expect(record.colors).toEqual({ A: '#ff0000' })

    // Back to the Library and in again: the same colours, and nothing built.
    const built = received(engineHome, 'map.build').length
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    const again = cell(page, 'lines')
    await expect(
      again.getByRole('list', { name: 'Lines' }).getByRole('listitem').nth(0),
    ).toContainText('your colour, #ff0000')
    expect(received(engineHome, 'map.build')).toHaveLength(built)
  })
})

test('reset puts a line back to the feed, and reset for all clears everything', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')

    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readRecord(engineHome).colors).toEqual({ A: '#ff0000' })

    // Reset is inside the panel, which is where the colour was chosen.
    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    await picker.getByRole('button', { name: /^Reset line A/ }).click()
    await expect(picker, 'Reset closes the panel').toBeHidden()
    await expect.poll(() => readRecord(engineHome).colors, { timeout: 30_000 }).toEqual({})
    await expect(
      panel.getByRole('list', { name: 'Lines' }).getByRole('listitem').nth(0),
    ).toContainText('the colour in the feed, #0072bc')

    // Two overrides, then one reset for all.
    for (const [line, hex] of [
      ['A', '#ff0000'],
      ['B', '#00ff00'],
    ] as const) {
      await panel
        .getByRole('button', { name: new RegExp(`^Choose the colour of line ${line}`) })
        .click()
      const one = panel.getByRole('group', { name: `Colour for line ${line}` })
      await one.getByLabel('Hex value').fill(hex)
      await one.getByRole('button', { name: 'Use this colour' }).click()
      await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({
        timeout: 30_000,
      })
    }
    await expect.poll(() => readRecord(engineHome).colors).toEqual({ A: '#ff0000', B: '#00ff00' })

    await panel.getByRole('button', { name: 'Reset every line' }).click()
    await expect.poll(() => readRecord(engineHome).colors, { timeout: 30_000 }).toEqual({})
    expect(readRecord(engineHome).defaultColor).toBe('#888888')
    await expect(panel.getByRole('button', { name: 'Reset every line' })).toBeDisabled()
  })
})

test('the default colour is offered and reaches the engine as default_color', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')

    // The row is in the panel whatever the feed publishes: it is what a
    // line the feed leaves uncoloured is drawn in.
    await expect(panel).toContainText('Lines with no colour in the feed')
    await panel
      .getByRole('button', { name: 'Choose the colour of lines the feed leaves uncoloured' })
      .click()
    const picker = panel.getByRole('group', {
      name: 'Colour for lines the feed leaves uncoloured',
    })
    await picker.getByLabel('Hex value').fill('#123456')
    await picker.getByRole('button', { name: 'Use this colour' }).click()

    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    const maps = received(engineHome, 'map.build')
    expect(maps[maps.length - 1]).toContain('"default_color": "#123456"')
    await expect.poll(() => readRecord(engineHome).defaultColor).toBe('#123456')

    // A line the feed does colour is untouched by the default.
    await expect(
      panel.getByRole('list', { name: 'Lines' }).getByRole('listitem').nth(0),
    ).toContainText('the colour in the feed, #0072bc')
  })
})

// Issue 262. A colour is a commit, not a preview: the swatch and the hex
// field follow every colour of a gesture, and the map follows its end - the
// pointer's release, an arrow key's release, or the hex field's own button.
// There is no interval in it, so none of the counts below depends on how
// fast the runner moves the mouse. Every count is of `map.build` requests
// the stand-in read, which is what a build is.

/** Longer than any quiet interval this panel ever had (400 ms). */
const LONGER_THAN_ANY_INTERVAL = 600

const buildsOf = (engineHome: string): number => received(engineHome, 'map.build').length

/**
 * The value of the hex field once it has stopped changing. The picker and
 * the field settle a frame or two after the last pointer or key event, and
 * the colour a gesture ended on is the one they settle on.
 */
async function settledValue(field: Locator): Promise<string> {
  let last = await field.inputValue()
  for (let i = 0; i < 40; i++) {
    await field.page().waitForTimeout(50)
    const now = await field.inputValue()
    if (now === last) return now
    last = now
  }
  throw new Error(`the hex field never settled; it last read ${last}`)
}

/**
 * The map has been drawn in `hex` for `line`, from exactly `builds` builds
 * in all since the page was laid out: the count is reached, the last build
 * carries the colour, the record holds it (it is written only once the map
 * does) and the section is no longer busy.
 */
async function drawnIn(
  page: Page,
  engineHome: string,
  line: string,
  hex: string,
  builds: number,
  what: string,
): Promise<void> {
  await expect
    .poll(() => buildsOf(engineHome), {
      message: `${what}: ${builds} build(s) in all`,
      timeout: 30_000,
    })
    .toBe(builds)
  await expect
    .poll(() => (readRecord(engineHome).colors as Record<string, string>)[line], {
      message: `${what}: the record holds the colour it ended on`,
      timeout: 30_000,
    })
    .toBe(hex)
  await expect(
    cell(page, 'lines').getByRole('region', { name: 'Line colours' }),
    `${what}: no build is left in flight`,
  ).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 })
  const maps = received(engineHome, 'map.build')
  expect(maps[maps.length - 1], `${what}: the build carries the colour it ended on`).toContain(
    `"${line}": "${hex}"`,
  )
}

/** Nothing is building and nothing more will: the count holds through a pause longer than any interval. */
async function quietAt(
  page: Page,
  engineHome: string,
  builds: number,
  what: string,
): Promise<void> {
  await page.waitForTimeout(LONGER_THAN_ANY_INTERVAL)
  expect(buildsOf(engineHome), `${what}: still ${builds} build(s) after a pause`).toBe(builds)
  await expect(
    cell(page, 'lines').getByRole('region', { name: 'Line colours' }),
    `${what}: no build in flight at the end`,
  ).toHaveAttribute('aria-busy', 'false')
}

test('the picker stays open through a drag, and closes when it is dismissed', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const choose = panel.getByRole('button', { name: 'Choose the colour of line A' })
    const drawnBefore = buildsOf(engineHome)
    await choose.click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await expect(picker).toBeVisible()
    const field = picker.getByLabel('Hex value')

    // A press inside the picker is a colour, not a dismissal. It used to be
    // both, so a drag through a hue ended on the pointer event that began
    // it (issue 87). Each press, like the drag after it, is a gesture of
    // its own and so a build of its own: the test waits for each to be
    // drawn before the next begins, so none is folded into another by
    // arriving while a build holds the page (that is the wait, and
    // `nextStep`'s unit test holds it).
    const [saturation, hue] = [
      picker.getByRole('slider').first(),
      picker.getByRole('slider').last(),
    ]
    await saturation.click({ position: { x: 20, y: 20 } })
    await expect(picker).toBeVisible()
    // That was a colour: the field beside it follows the picker, so it no
    // longer reads what the feed published.
    await expect(field).not.toHaveValue('#0072bc')
    const firstPress = await settledValue(field)
    await drawnIn(page, engineHome, 'A', firstPress, drawnBefore + 1, 'a single press is one build')

    await hue.click({ position: { x: 10, y: 5 } })
    await expect(picker).toBeVisible()
    const secondPress = await settledValue(field)
    expect(secondPress, 'the second press moved the colour').not.toBe(firstPress)
    await drawnIn(page, engineHome, 'A', secondPress, drawnBefore + 2, 'the second press')

    // A real drag, which is the gesture the panel is built around: down in
    // the square, across it, and up well outside the row. The release
    // outside is part of the colour, not a dismissal - without that the
    // picker would close mid-drag, which is issue 87 in its narrower form.
    const square = (await saturation.boundingBox())!
    await page.mouse.move(square.x + 20, square.y + 20)
    await page.mouse.down()
    await page.mouse.move(square.x + 120, square.y + 60, { steps: 10 })
    await page.mouse.move(square.x + square.width + 120, square.y + square.height + 160)
    expect(buildsOf(engineHome), 'the drag builds nothing while the pointer is down').toBe(
      drawnBefore + 2,
    )
    await page.mouse.up()
    await expect(picker).toBeVisible()
    const dragged = await settledValue(field)
    expect(dragged, 'the drag moved the colour').not.toBe(secondPress)

    // Two presses and a drag are three gestures and three builds.
    await drawnIn(
      page,
      engineHome,
      'A',
      dragged,
      drawnBefore + 3,
      'two presses and then a drag are three builds',
    )
    await quietAt(page, engineHome, drawnBefore + 3, 'the drag')

    // A press outside the row dismisses it. The panel's own prose, not the
    // cell's heading row, which would collapse the cell and hide the picker
    // for the wrong reason (A5.5-08).
    await panel.getByText(/^A line is drawn in the colour its feed publishes/).click()
    await expect(picker).toBeHidden()
  })
})

test('a drag is one build, made on its release, however slowly the hand moves', async () => {
  // Slowed, so that a build is a stretch with something to be in flight.
  const engineHome = home({ progress_delay_ms: 50 })
  await withApp(engineHome, async (page, app) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    // The square is measured below, so the column is let settle first: the
    // header holds its sentence while a finished run's record is read back,
    // and on a runner slow to settle the field did not follow a press for
    // the whole of its wait (issue 373).
    await notebookSettled(page)
    await showIfHidden(app, page, 'a drag is one build')
    const panel = cell(page, 'lines')
    const drawnBefore = buildsOf(engineHome)
    await panel.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    const saturation = picker.getByRole('slider').first()
    const field = picker.getByLabel('Hex value')
    await expect(picker).toBeVisible()
    await watchPointer(page)

    // The pointer goes to the square through Playwright's own checks that it
    // is still and that the square is what receives a press there, and the
    // square is measured after, not the moment the panel opened.
    await saturation.hover({ position: { x: 20, y: 20 } })
    const square = (await saturation.boundingBox())!
    await page.mouse.down()
    // A press is a colour (issue 87), so this is the press landing and
    // nothing yet about the moves.
    await expect(field, 'the press landed on the square').not.toHaveValue('#0072bc')
    // The pace is the page's: a drag is followed once the page has heard the
    // pointer arrive, then two frames for the field to draw it, however many
    // of the fifty moves a slow runner delivered one by one.
    const first = { x: square.x + 120, y: square.y + 60 }
    await page.mouse.move(first.x, first.y, { steps: 50 })
    await pointerHasReached(page, first, 'the drag to its first stop')
    await afterFrames(page)
    const midDrag = await field.inputValue()
    await expect(field, 'the field follows the drag').not.toHaveValue('#0072bc')
    expect(buildsOf(engineHome), 'nothing is built while the pointer moves').toBe(drawnBefore)

    // The pause, pointer down, longer than any interval the app ever had.
    await page.waitForTimeout(LONGER_THAN_ANY_INTERVAL)
    expect(
      buildsOf(engineHome),
      `a pause of ${LONGER_THAN_ANY_INTERVAL} ms with the pointer down builds nothing`,
    ).toBe(drawnBefore)

    // And the drag goes on to somewhere else, so the colour at release is
    // not the one at the pause.
    const second = { x: square.x + 60, y: square.y + 100 }
    await page.mouse.move(second.x, second.y, { steps: 50 })
    await pointerHasReached(page, second, 'the drag to its second stop')
    await afterFrames(page)
    const atRelease = await field.inputValue()
    expect(atRelease, 'the drag went on after the pause').not.toBe(midDrag)
    expect(buildsOf(engineHome), 'still nothing built with the pointer down').toBe(drawnBefore)

    await page.mouse.up()
    await drawnIn(page, engineHome, 'A', atRelease, drawnBefore + 1, 'the drag is one build')
    await quietAt(page, engineHome, drawnBefore + 1, 'the drag')
    await expect(field, 'the field still shows the colour it ended on').toHaveValue(atRelease)
  })
})

test('the hex field builds on its button and never on a keystroke', async () => {
  const engineHome = home({ progress_delay_ms: 50 })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const drawnBefore = buildsOf(engineHome)
    await panel.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    const field = picker.getByLabel('Hex value')

    // Typed a key at a time, slowly enough that the whole of it takes longer
    // than any interval the app ever had.
    await field.fill('')
    await field.pressSequentially('#ff0000', { delay: 120 })
    await expect(field).toHaveValue('#ff0000')
    await page.waitForTimeout(LONGER_THAN_ANY_INTERVAL)
    expect(buildsOf(engineHome), 'no build for any keystroke, typed or paused').toBe(drawnBefore)
    expect(readRecord(engineHome).colors, 'and nothing stored').toEqual({})

    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await drawnIn(page, engineHome, 'A', '#ff0000', drawnBefore + 1, 'the button is one build')
    await quietAt(page, engineHome, drawnBefore + 1, 'the hex field')
  })
})

test('a held arrow key is one gesture and one build, and each tap is a build of its own', async () => {
  // react-colorful sends one change per keydown, repeats included, and its
  // end - the one that builds - on the key's keyup. A held key is therefore
  // many colours and one build on its release; three taps are three.
  const engineHome = home({ progress_delay_ms: 50 })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const drawnBefore = buildsOf(engineHome)
    await panel.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    const hue = picker.getByRole('slider').last()
    const field = picker.getByLabel('Hex value')

    // Held: the key goes down and repeats, and nothing has come up.
    await hue.focus()
    for (let i = 0; i < 4; i++) await page.keyboard.down('ArrowRight')
    await expect(field, 'the field follows the held key').not.toHaveValue('#0072bc')
    const held = await settledValue(field)
    await page.waitForTimeout(LONGER_THAN_ANY_INTERVAL)
    expect(buildsOf(engineHome), 'a key held down builds nothing, however long it is held').toBe(
      drawnBefore,
    )
    await page.keyboard.up('ArrowRight')
    await drawnIn(
      page,
      engineHome,
      'A',
      held,
      drawnBefore + 1,
      'a held arrow key is one build, on its release',
    )

    // Three taps, each drawn before the next: three gestures, three builds.
    let colour = held
    for (const tap of [1, 2, 3]) {
      await hue.focus()
      await page.keyboard.press('ArrowLeft')
      await expect(field, `tap ${tap} moved the colour`).not.toHaveValue(colour)
      colour = await settledValue(field)
      await drawnIn(
        page,
        engineHome,
        'A',
        colour,
        drawnBefore + 1 + tap,
        `tap ${tap} of 3 is a build of its own`,
      )
    }
    await quietAt(page, engineHome, drawnBefore + 4, 'the taps')

    // A panel that closes under a held key has not lost the colour the
    // person saw: the swatch is what they chose, and the map follows it.
    await hue.focus()
    for (let i = 0; i < 2; i++) await page.keyboard.down('ArrowRight')
    const seen = await settledValue(field)
    expect(seen, 'the held key moved the colour').not.toBe(colour)
    await panel.getByText(/^A line is drawn in the colour its feed publishes/).click()
    await expect(picker).toBeHidden()
    await page.keyboard.up('ArrowRight')
    await drawnIn(
      page,
      engineHome,
      'A',
      seen,
      drawnBefore + 5,
      'a panel closed under a held key still builds what was seen',
    )
    await quietAt(page, engineHome, drawnBefore + 5, 'the closed panel')
  })
})

/** Opens line A's panel, changes its colour with the panel left open, and checks nothing above it moved. */
async function holdsStillThroughARedraw(page: Page): Promise<void> {
  const panel = cell(page, 'lines')
  const chip = panel.getByRole('button', { name: 'Choose the colour of line A' })
  await chip.click()
  const picker = panel.getByRole('group', { name: 'Colour for line A' })
  await expect(picker).toBeVisible()
  const where = (): Promise<{ chip: number; above: number[] }> =>
    page.evaluate(() => {
      const open = document.querySelector('.colour-chip[aria-expanded="true"]')!
      const heights = [...document.querySelectorAll('section.cell')].map(
        (c) => c.getBoundingClientRect().height,
      )
      return { chip: open.getBoundingClientRect().top, above: heights }
    })
  const before = await where()

  await picker
    .getByRole('slider')
    .first()
    .click({ position: { x: 20, y: 20 } })
  await expect(picker).toBeVisible()
  // Watch until the build has been asked for and answered; the sentence
  // says the map is drawn, and the picker is still open when it does.
  const seen: Array<{ chip: number; above: number[] }> = []
  const done = page.getByText(/Drawn in the colours you chose/)
  // The settled state is left out of what is judged: its sentence is longer
  // than the one it replaces and wraps to a second line in a narrower
  // window, a single line of difference once the redraw is over.
  for (let i = 0; i < 400; i++) {
    const now = await where()
    if ((await done.count()) > 0) break
    seen.push(now)
    await page.waitForTimeout(25)
  }
  await expect(picker).toBeVisible()
  expect(seen.length, 'the redraw was watched, not skipped').toBeGreaterThan(5)
  for (const now of seen) {
    expect(Math.abs(now.chip - before.chip), 'the chip never moved').toBeLessThan(1.5)
    now.above.forEach((height, i) =>
      expect(
        Math.abs(height - before.above[i]),
        `cell ${i + 1} kept its height: ${before.above[i]} then ${height}`,
      ).toBeLessThan(1),
    )
  }
}

test('the page stays where it is while a colour is being drawn, and the picker with it', async () => {
  // The redraw is slowed so there is a stretch to watch, and the picker is
  // left open throughout: the colour shows on the map before the panel is
  // closed, which is why this matters (issue 304). Everything above the
  // chip used to change height for the length of the redraw - the
  // diagnostics went, the run's sentence and buttons went, a sentence
  // arrived under the theme - and the panel, anchored to its chip, went up
  // the page and back with them.
  const engineHome = home({ progress_delay_ms: 200 })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await holdsStillThroughARedraw(page)
  })
})

test('and so does the first redraw after the app was closed and opened again', async () => {
  // Nothing has run in this session, so the run cell is idle and the
  // diagnostics are absent: the redraw must neither shrink the one nor add
  // the other.
  const engineHome = home({ progress_delay_ms: 200 })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
  })
  await withApp(engineHome, async (page) => {
    await openProject(page, 'Los Angeles')
    await holdsStillThroughARedraw(page)
  })
})

test('one press opens another row’s picker while one is already open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')

    // The default row is the first, so its picker sits above every line.
    await panel
      .getByRole('button', { name: 'Choose the colour of lines the feed leaves uncoloured' })
      .click()
    await expect(
      panel.getByRole('group', { name: 'Colour for lines the feed leaves uncoloured' }),
    ).toBeVisible()

    // One press, not two. Dismissing on the press would take the open
    // picker out of the flow before this button was released, everything
    // below would move up by its height, and the click would land on the
    // nearest common ancestor of the two rather than on the button.
    await panel.getByRole('button', { name: 'Choose the colour of line A' }).click()
    await expect(panel.getByRole('group', { name: 'Colour for line A' })).toBeVisible()
    await expect(
      panel.getByRole('group', { name: 'Colour for lines the feed leaves uncoloured' }),
    ).toBeHidden()
  })
})

test('Escape dismisses the picker and hands focus back, and so does the toggle', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const choose = panel.getByRole('button', { name: 'Choose the colour of line A' })
    const picker = panel.getByRole('group', { name: 'Colour for line A' })

    await choose.click()
    await expect(picker).toBeVisible()
    await picker.getByRole('slider').first().focus()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    // Focus was inside the row, so it goes back to the control that
    // revealed the picker rather than falling to the body.
    await expect(choose).toBeFocused()

    // The toggle closes what it opened, as a disclosure does.
    await choose.click()
    await expect(picker).toBeVisible()
    await choose.click()
    await expect(picker).toBeHidden()
  })
})

test('a colour that is not one is refused beside the field, and nothing is built', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    const before = received(engineHome, 'map.build').length

    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('teal')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect(picker.getByText(/six hexadecimal digits/)).toBeVisible()
    expect(received(engineHome, 'map.build')).toHaveLength(before)
    expect(readRecord(engineHome).colors).toEqual({})
  })
})

test('a chip opens its picker in a floating panel that moves no row, and the last row flips it above', async () => {
  // Issue 284. The picker used to unfold under its row and push every row
  // below it down, and could be pushed behind the pinned map.
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    // Rows are measured before and after the picker opens, so the column has
    // to be still before the first read: the header holds its sentence while
    // a finished run's record is read back, and on a runner slow to settle
    // row 0 was read 24px from where it had been a moment before (issue 373).
    await notebookSettled(page)
    await showIfHidden(app, page, 'a chip opens its picker in a floating panel')
    const panel = cell(page, 'lines')
    const rows = panel.getByRole('list', { name: 'Lines', exact: true }).getByRole('listitem')
    const chipOf = (line: string): Locator =>
      panel.getByRole('button', { name: `Choose the colour of line ${line}`, exact: true })
    const tops = (): Promise<number[]> =>
      rows.evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().top + window.scrollY),
      )

    // A chip: 24px square, the row's first control, in the line's colour.
    const chip = await chipOf('A').boundingBox()
    expect(chip?.width).toBeCloseTo(24, 0)
    expect(chip?.height).toBeCloseTo(24, 0)
    expect(
      await rows
        .nth(0)
        .evaluate((row) => row.querySelector('.line-row')?.firstElementChild?.className),
    ).toBe('colour-chip')
    expect(await chipOf('A').evaluate((el) => (el as HTMLElement).style.background)).toMatch(
      /rgb\(0, 114, 188\)/,
    )

    // Opening it moves no row.
    const before = await steady(page, tops, 'the rows of cell 05')
    await chipOf('A').click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await expect(picker).toBeVisible()
    // Read once the panel has been drawn, not the instant it is shown. A row
    // moved by the panel moves for as long as the panel is open.
    await afterFrames(page)
    // Within a pixel, not equal and not rounded: a position is a fraction
    // that wobbles by a ten-thousandth between reads, and a number that
    // sits near a half rounds to either side. A row that moved moved by the
    // panel's height.
    const after = await tops()
    expect(after).toHaveLength(before.length)
    after.forEach((top, i) =>
      expect(
        Math.abs(top - before[i]),
        `row ${i} moved from ${before[i]} to ${top} (rows before: ${JSON.stringify(before)})`,
      ).toBeLessThanOrEqual(1),
    )
    // It is a popover, in the top layer, and it never covers its chip:
    // below it where there is room, above it where there is not.
    expect(await picker.evaluate((el) => el.matches(':popover-open'))).toBe(true)
    const floating = (await picker.boundingBox())!
    const chipBox = (await chipOf('A').boundingBox())!
    const clear =
      floating.y >= chipBox.y + chipBox.height - 1 || floating.y + floating.height <= chipBox.y + 1
    expect(clear, `covers its chip: ${JSON.stringify({ floating, chipBox })}`).toBe(true)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()

    // The last row, at the foot of the window, has no room below it: the
    // panel flips above the chip and stays inside the window.
    await chipOf('K').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    const last = (await chipOf('K').boundingBox())!
    await chipOf('K').click()
    const flipped = panel.getByRole('group', { name: 'Colour for line K' })
    await expect(flipped).toBeVisible()
    const box = (await flipped.boundingBox())!
    const height = await page.evaluate(() => window.innerHeight)
    expect(box.y, 'inside the window at the top').toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, 'inside the window at the foot').toBeLessThanOrEqual(height)
    expect(box.y + box.height, 'above its chip').toBeLessThanOrEqual(last.y + 1)
    // And it touches its chip: flipped above is not pinned to the top of the
    // area the browser tried.
    expect(last.y - (box.y + box.height), 'beside its chip, not far above it').toBeLessThan(8)
    await page.keyboard.press('Escape')
    await expect(flipped).toBeHidden()

    // Reset every line from the keyboard, with a panel open: no pointer
    // event light-dismisses it, so the panels are closed through the
    // elements, and no empty box is left in the top layer.
    await chipOf('A').click()
    const one = panel.getByRole('group', { name: 'Colour for line A' })
    await one.getByLabel('Hex value').fill('#ff0000')
    await one.getByRole('button', { name: 'Use this colour' }).click()
    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    await chipOf('A').click()
    await expect(one).toBeVisible()
    const resetAll = panel.getByRole('button', { name: 'Reset every line' })
    await resetAll.focus()
    await page.keyboard.press('Enter')
    await expect(one).toBeHidden()
    expect(
      await panel.evaluate((el) => el.querySelectorAll('.colour-popover:popover-open').length),
      'no panel left open',
    ).toBe(0)
    await expect(chipOf('A')).toHaveAttribute('aria-expanded', 'false')
  })
})

test('every control is reachable by keyboard and named for its line', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = cell(page, 'lines')
    for (const line of ['A', 'B', 'C', 'D', 'E', 'K']) {
      await expect(
        panel.getByRole('button', { name: `Choose the colour of line ${line}` }),
      ).toBeVisible()
    }
    // Reset is not in the row: it is in the panel the chip opens (issue 284).
    await expect(panel.getByRole('button', { name: /^Reset line / })).toHaveCount(0)
    // The disclosure takes focus and opens from the keyboard alone.
    const choose = panel.getByRole('button', { name: 'Choose the colour of line A' })
    await choose.focus()
    await expect(choose).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('group', { name: 'Colour for line A' })).toBeVisible()
    await expect(choose).toHaveAttribute('aria-expanded', 'true')
    await expect(
      panel.getByRole('group', { name: 'Colour for line A' }).getByRole('button', {
        name: /^Reset line A to/,
      }),
    ).toBeVisible()
    // The picker's own areas are sliders, so a colour can be moved by arrow
    // keys as well as typed.
    await expect(
      panel.getByRole('group', { name: 'Colour for line A' }).getByRole('slider'),
    ).toHaveCount(2)
    // Committing takes the picker away, so the focus it held goes back to
    // the control that revealed it rather than falling to the body.
    const group = panel.getByRole('group', { name: 'Colour for line A' })
    await group.getByLabel('Hex value').fill('#123456')
    await group.getByRole('button', { name: 'Use this colour' }).click()
    await expect(group).toBeHidden()
    await expect(choose).toHaveAttribute('aria-expanded', 'false')
    await expect(choose).toBeFocused()
  })
})

// Issue 360. A build that is cancelled leaves the run `cancelled` until the
// next run starts, and a record written for any other reason - a rename, a
// theme press, an export option, a chosen day - reaches the screen as a new
// record while it does. The panel used to go back to the record on each of
// those, so a colour chosen after the cancel and held for an export to let
// go of the page was dropped by a rename: the swatch snapped back to the
// feed's colour and the colour was never drawn.
//
// Staged with what the stand-in can do from its start. A redraw slow enough
// to cancel; an encode slow enough to hold the page while the colour is
// chosen and the project renamed; and the export cancelled at the end, which
// is what lets the held colour through.
const CAPTURE_PAGE = resolve(__dirname, '../fixtures/capture-page.html')

test('a colour chosen after a cancelled redraw waits for an export, and a rename does not take it back', async () => {
  test.setTimeout(180_000)
  const exportFolder = mkdtempSync(join(tmpdir(), 'legible-cities-colours-exports-'))
  const engineHome = home({ progress_delay_ms: 500, encode_delay_ms: 3000 })
  await withApp(
    engineHome,
    async (page) => {
      await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
      // The export captures an animated page; the stand-in's own is a placeholder.
      const [id] = readdirSync(join(engineHome, 'projects'))
      copyFileSync(CAPTURE_PAGE, join(engineHome, 'out', id, 'la-metro-rail.html'))

      const panel = cell(page, 'lines')
      const lineA = panel
        .getByRole('list', { name: 'Lines', exact: true })
        .getByRole('listitem')
        .nth(0)
      const picker = panel.getByRole('group', { name: 'Colour for line A' })
      const choose = async (hex: string): Promise<void> => {
        await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
        await picker.getByLabel('Hex value').fill(hex)
        await picker.getByRole('button', { name: 'Use this colour' }).click()
        await expect(picker).toBeHidden()
      }

      // A redraw in a new colour, cancelled while it draws: nothing was
      // written, and the swatch goes back to the colour the feed publishes.
      await choose('#ff0000')
      const layoutRun = await openCell(page, 'process')
      await layoutRun.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(page.getByText(/^The redraw was cancelled\./)).toBeVisible({ timeout: 30_000 })
      await expect(lineA).toContainText('the colour in the feed, #0072bc')
      expect(readRecord(engineHome).colors).toEqual({})

      // An export now holds the page.
      await openCell(page, 'export')
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await expect(page.getByText(/^Encod/)).toBeVisible({ timeout: 30_000 })

      // A colour chosen while it does waits, and the swatch shows it.
      const builds = buildsOf(engineHome)
      await choose('#00ff00')
      await expect(lineA).toContainText('your colour, #00ff00')

      // A record written for another reason arrives with the run still
      // cancelled. The colour is not taken back, and it is not dropped.
      await page.getByRole('button', { name: 'Rename', exact: true }).click()
      await page.getByLabel('New name').fill('LA Metro')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('LA Metro')
      await page.waitForTimeout(LONGER_THAN_ANY_INTERVAL)
      await expect(lineA).toContainText('your colour, #00ff00')
      expect(buildsOf(engineHome), 'nothing is drawn while the export holds the page').toBe(builds)

      // The export ends, and the colour that waited for it is drawn, once.
      await page
        .getByRole('region', { name: 'Export run', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await expect(page.getByText('The export was cancelled. Nothing was written.')).toBeVisible({
        timeout: 30_000,
      })
      await expect
        .poll(() => (readRecord(engineHome).colors as Record<string, string>).A, {
          message: 'the colour that waited was drawn and stored',
          timeout: 30_000,
        })
        .toBe('#00ff00')
      expect(buildsOf(engineHome), 'one build, for the colour that waited').toBe(builds + 1)
      await expect(lineA).toContainText('your colour, #00ff00')
    },
    { LEGIBLE_EXPORT_FOLDER: exportFolder },
  )
})
