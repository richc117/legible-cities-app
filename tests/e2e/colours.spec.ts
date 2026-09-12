// The Line colours panel against the stand-in engine: the feed's colours
// beside the lines, an override that redraws the map once and is stored,
// the resets, the default for a line the feed leaves uncoloured, and the
// colours still there when the project is opened again (specs/018-colours).
//
// The stand-in's LA feed publishes a colour for each of its six routes, so
// the feed's own colours, an override over them and the default a line
// without one would take can all be read off one project. What a build that
// fails leaves behind is the run's unit test: the stand-in reads its control
// file once, at start, and cannot be turned round mid-session.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

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

test('lists the feed lines with the colours the feed publishes', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = page.getByRole('region', { name: 'Line colours' })
    await expect(panel).toBeVisible()
    const rows = panel.getByRole('list', { name: 'Lines' }).getByRole('listitem')
    await expect(rows).toHaveCount(6)
    await expect(rows.nth(0)).toContainText('A')
    // The engine's route_color, hashed and lower-cased, and where the
    // colour came from said in words.
    await expect(rows.nth(0)).toContainText('#0072bc')
    await expect(rows.nth(0)).toContainText('the colour in the feed')
    // Nothing to reset yet.
    await expect(panel.getByRole('button', { name: /^Reset line A/ })).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Reset every line' })).toBeDisabled()
  })
})

test('an override redraws the map once, is stored, and is there on the next open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = page.getByRole('region', { name: 'Line colours' })
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
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    const again = page.getByRole('region', { name: 'Line colours' })
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
    const panel = page.getByRole('region', { name: 'Line colours' })

    await panel.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readRecord(engineHome).colors).toEqual({ A: '#ff0000' })

    await panel.getByRole('button', { name: /^Reset line A/ }).click()
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
    const panel = page.getByRole('region', { name: 'Line colours' })

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

test('the picker stays open through a drag, and closes when it is dismissed', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = page.getByRole('region', { name: 'Line colours' })
    const choose = panel.getByRole('button', { name: 'Choose the colour of line A' })
    const drawnBefore = received(engineHome, 'map.build').length
    await choose.click()
    const picker = panel.getByRole('group', { name: 'Colour for line A' })
    await expect(picker).toBeVisible()

    // A press inside the picker is a colour, not a dismissal. It used to be
    // both, so a drag through a hue ended on the pointer event that began
    // it (issue 87).
    const [saturation, hue] = [
      picker.getByRole('slider').first(),
      picker.getByRole('slider').last(),
    ]
    await saturation.click({ position: { x: 20, y: 20 } })
    await expect(picker).toBeVisible()
    await hue.click({ position: { x: 10, y: 5 } })
    await expect(picker).toBeVisible()
    // And each of those was a colour: the field beside it follows the
    // picker, so it no longer reads what the feed published.
    await expect(picker.getByLabel('Hex value')).not.toHaveValue('#0072bc')
    // A real drag, which is the gesture the panel is built around: down in
    // the square, across it, and up well outside the row. The release
    // outside is part of the colour, not a dismissal - without that the
    // picker would close mid-drag, which is issue 87 in its narrower form.
    const square = (await saturation.boundingBox())!
    await page.mouse.move(square.x + 20, square.y + 20)
    await page.mouse.down()
    await page.mouse.move(square.x + 120, square.y + 60, { steps: 10 })
    await page.mouse.move(square.x + square.width + 120, square.y + square.height + 160)
    await page.mouse.up()
    await expect(picker).toBeVisible()

    // Every colour of it is one build, and the test leaves none in flight
    // to be cut off by the app closing.
    await expect(page.getByText(/Drawn in the colours you chose/)).toBeVisible({ timeout: 30_000 })
    expect(
      received(engineHome, 'map.build'),
      'one build for the whole gesture, not one per colour',
    ).toHaveLength(drawnBefore + 1)

    // A press outside the row dismisses it.
    await panel.getByRole('heading', { name: 'Line colours' }).click()
    await expect(picker).toBeHidden()
  })
})

test('one press opens another row’s picker while one is already open', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = page.getByRole('region', { name: 'Line colours' })

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
    const panel = page.getByRole('region', { name: 'Line colours' })
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
    const panel = page.getByRole('region', { name: 'Line colours' })
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

test('every control is reachable by keyboard and named for its line', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const panel = page.getByRole('region', { name: 'Line colours' })
    for (const line of ['A', 'B', 'C', 'D', 'E', 'K']) {
      await expect(
        panel.getByRole('button', { name: `Choose the colour of line ${line}` }),
      ).toBeVisible()
      await expect(
        panel.getByRole('button', { name: new RegExp(`^Reset line ${line} to`) }),
      ).toBeVisible()
    }
    // The disclosure takes focus and opens from the keyboard alone.
    const choose = panel.getByRole('button', { name: 'Choose the colour of line A' })
    await choose.focus()
    await expect(choose).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(panel.getByRole('group', { name: 'Colour for line A' })).toBeVisible()
    await expect(choose).toHaveAttribute('aria-expanded', 'true')
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
