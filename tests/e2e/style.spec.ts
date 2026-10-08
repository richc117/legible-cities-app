// The map's sizes in cell 04 (issue 350, ADR-049, ADR-050), against the
// stand-in engine: eight numeric fields, each committed on Enter or blur,
// each one `map.build` from the stored layout and never a layout, held to the
// engine's ranges before anything is sent, and written to the record only
// once the map carries them.
//
// The stand-in takes a `style` and ignores it, and `fake-engine.received`
// keeps every message it read, so what these assert is what the app *sent*:
// that a project nobody has sized sends no `style` at all, that the fields a
// person set go in the engine's names and nothing else goes, and that both
// radii go together. What the engine then draws (a `stroke-width` of 12, a
// `viewBox` that moves with a label size and not with the stations) is the
// engine's own test (its issue 36), and the coordinator's measurement
// against the real engine.
//
// Mutations the coordinator runs this file under, each of which must turn at
// least the named test red:
// - `styleParams` returns `{ style: {} }` for no style: 'draws a project nobody
//   has sized without a style' and 'a project made before'.
// - `styleSent` sends one radius alone (drop the pair): 'sends both radii'.
// - `readStyle` loses its equal-to-old-defaults rule: 'a project made before'.
// - `commitDrafts` stops judging the range and the pair (and `blocked` is
//   false): 'refuses a figure outside the range' and 'a station radius above
//   the interchange radius waits for it'.
// - `LayoutRun.restyle` calls `completeStyle` before the map call: 'one map
//   build ... written once the map carries it'.
// - a style source added to `stalenessOf`: 'one map build ... never stale'.
// - `restyle` sends a `graph.build`, or `rebuild` is used in its place:
//   'one map build ... from the stored layout'.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
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

/** The engine's own sentences (`serve._style`, v0.12.0), word for word. */
const LINE_WIDTH_RANGE =
  "style.line_width must be from 1 to 24, in SVG user units at the map's width"
const RADII_8_OVER_6 =
  'style.interchange_radius (6) must not be below style.station_radius (8); ' +
  'a field left out counts as its default, so send both'

/**
 * A slow-enough map for a test to look between the request and its answer:
 * eight stages at this delay, and the record is written only after the last.
 */
function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-style-'))
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

const recordFile = (engineHome: string): string => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return join(engineHome, 'projects', id, 'project.json')
}

const readRecord = (engineHome: string): Record<string, unknown> =>
  withoutOpened(JSON.parse(readFileSync(recordFile(engineHome), 'utf8')))

/** Every request of one method the stand-in read, in order, parsed. */
const requests = (engineHome: string, method: string): { params: Record<string, unknown> }[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`))
    .map((line) => JSON.parse(line) as { params: Record<string, unknown> })

const mapBuilds = (engineHome: string) => requests(engineHome, 'map.build')

const sizes = (page: Page): Locator => panel(page, 'Sizes')
const field = (page: Page, name: string): Locator => sizes(page).getByLabel(name, { exact: true })
const reset = (page: Page): Locator =>
  sizes(page).getByRole('button', { name: 'Reset to the engine’s sizes', exact: true })

/** Type a figure and commit it with Enter, as a person does. */
async function set(page: Page, name: string, figure: string): Promise<void> {
  await field(page, name).fill(figure)
  await field(page, name).press('Enter')
}

/** The map was drawn in the sizes chosen: cell 02's sentence, and the run is over. */
const drawnInSizes = (page: Page): Locator =>
  page.getByText(/Drawn in the sizes you chose, from the stored layout/)

/** A project laid out on the stand-in, with cell 04 open and its sizes in view. */
async function laidOut(page: Page): Promise<void> {
  await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
  await openCell(page, 'style')
  await expect(sizes(page)).toBeVisible()
}

test('draws a project nobody has sized without a style, and offers the engine’s own numbers', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)

    const builds = mapBuilds(engineHome)
    expect(builds, 'the layout run drew the map once').toHaveLength(1)
    expect(builds[0].params, 'and sent it no style at all').not.toHaveProperty('style')

    // Eight fields, in order, each showing the engine's number while unset,
    // with the engine's range in its description.
    const shown: [string, string, string][] = [
      ['Line width', '7', '1 to 24'],
      ['Line gap', '1.6', '1 to 3, times the line width'],
      ['Station radius', '4.2', '1 to 20'],
      ['Interchange radius', '6', '1 to 30'],
      ['Station outline', '2.2', '0 to 8'],
      ['Label size', '11', '6 to 32'],
      ['Label offset', '9', '0 to 40'],
      ['Margin', '24', '0 to 200'],
    ]
    for (const [name, value, range] of shown) {
      await expect(field(page, name), name).toHaveValue(value)
      await expect(field(page, name), name).toHaveAccessibleDescription(
        new RegExp(`^${range}\\. The engine’s own is ${value}\\.`),
      )
    }
    await expect(
      sizes(page).getByText(
        'In the map’s own units: the map is drawn 1,800 wide, so a line width of 7 is seven of 1,800.',
      ),
    ).toBeVisible()
    await expect(
      sizes(page).getByText(
        'The frame is padded, never cropped or rotated: a station is never cut off, and a tighter frame is a smaller margin.',
      ),
    ).toBeVisible()
    await expect(field(page, 'Margin')).toHaveAccessibleDescription(/never cropped or rotated/)
    // The sentence that said the engine could not be told is gone.
    await expect(page.getByText(/are the engine.s own for now/)).toHaveCount(0)
    await expect(reset(page), 'nothing to reset').toBeDisabled()

    await closeCell(page, 'style')
    await expect(cellHeading(page, 'style')).toContainText('Warm dark')
    await expect(cellHeading(page, 'style')).not.toContainText('sizes of your own')
  })
})

test('a line width is one map build from the stored layout, written once the map carries it, and never stale', async () => {
  // Slow enough to look at the record between the request and the answer.
  const engineHome = home({ progress_delay_ms: 300 })
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const layout = readRecord(engineHome).layout
    expect(typeof layout, 'a layout was stored').toBe('string')
    const before = mapBuilds(engineHome).length

    await set(page, 'Line width', '12')
    await expect.poll(() => mapBuilds(engineHome).length, { timeout: 15_000 }).toBe(before + 1)

    // The request is in and the map is not drawn: the record has not been
    // told, and the field keeps what was typed.
    expect(readRecord(engineHome).style, 'not written before the map carries it').toEqual({})
    await expect(field(page, 'Line width')).toHaveValue('12')
    // Cell 04 is the one running, and no other cell is told it is behind.
    await expect(cellHeading(page, 'style')).toContainText('running')

    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    const draw = mapBuilds(engineHome)
    expect(draw, 'one build, not one per keystroke').toHaveLength(before + 1)
    const { params } = draw[draw.length - 1]
    expect(params.style, 'only the field that was set, in the engine’s name').toEqual({
      line_width: 12,
    })
    expect(params.layout, 'from the stored layout').toBe(layout)
    expect(requests(engineHome, 'graph.build'), 'no layout run, nothing moved').toHaveLength(1)

    await expect.poll(() => readRecord(engineHome).style).toEqual({ lineWidth: 12 })
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual({ lineWidth: 12 })
    expect(readRecord(engineHome).version).toBe(2)

    // A size is a cheap edit: it redraws itself and marks nothing behind it.
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).not.toContainText('not drawn yet')
    await expect(cellHeading(page, 'style')).toContainText('ready')

    await closeCell(page, 'style')
    await expect(cellHeading(page, 'style')).toContainText('Warm dark, sizes of your own')
  })
})

test('sends both radii whenever either is set', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const before = mapBuilds(engineHome).length

    await set(page, 'Station radius', '5')
    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    const first = mapBuilds(engineHome)
    expect(first).toHaveLength(before + 1)
    expect(first[first.length - 1].params.style, 'the interchange radius goes with it').toEqual({
      station_radius: 5,
      interchange_radius: 6,
    })
    await expect.poll(() => readRecord(engineHome).style).toEqual({ stationRadius: 5 })
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual({
      stationRadius: 5,
      interchangeRadius: 6,
    })
  })
})

test('a station radius above the interchange radius waits for it, and both go in one build', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const before = mapBuilds(engineHome).length

    // 8 against the interchange radius's own 6: the engine would refuse it,
    // so it is refused beside the field first and nothing is sent.
    await set(page, 'Station radius', '8')
    const alert = sizes(page).getByRole('alert')
    await expect(alert).toHaveText(RADII_8_OVER_6)
    await expect(field(page, 'Station radius')).toHaveAttribute('aria-invalid', 'true')
    await expect(field(page, 'Station radius')).toHaveValue('8')
    await page.waitForTimeout(1_000)
    expect(mapBuilds(engineHome), 'nothing was sent').toHaveLength(before)

    // Setting the interchange radius is what mends it: both go, once.
    await set(page, 'Interchange radius', '9')
    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    await expect(alert).toHaveCount(0)
    const draw = mapBuilds(engineHome)
    expect(draw).toHaveLength(before + 1)
    expect(draw[draw.length - 1].params.style).toEqual({
      station_radius: 8,
      interchange_radius: 9,
    })
    await expect
      .poll(() => readRecord(engineHome).style)
      .toEqual({ stationRadius: 8, interchangeRadius: 9 })
  })
})

test('refuses a figure outside the range beside the field, in the engine’s sentence, before anything is sent', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const before = mapBuilds(engineHome).length

    await set(page, 'Line width', '30')
    const alert = sizes(page).getByRole('alert')
    await expect(alert).toHaveText(LINE_WIDTH_RANGE)
    const input = field(page, 'Line width')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input, 'the figure stays to be mended').toHaveValue('30')
    // Said beside the field it concerns: in the same row, under it, and
    // named by the field's description.
    await expect(input).toHaveAccessibleDescription(new RegExp(LINE_WIDTH_RANGE.slice(0, 20)))

    // Not a number is the same sentence.
    await set(page, 'Label size', 'big')
    await expect(sizes(page).getByRole('alert')).toHaveCount(2)
    await expect(sizes(page).getByRole('alert').nth(1)).toHaveText(
      "style.label_size must be from 6 to 32, in SVG user units at the map's width",
    )

    // Longer than the delay a commit waits before it draws: neither refusal
    // reached the engine or the record.
    await page.waitForTimeout(1_000)
    expect(mapBuilds(engineHome), 'nothing was sent').toHaveLength(before)
    expect(readRecord(engineHome).style, 'and nothing was stored').toEqual({})

    // Mending the line width sends it; the other figure, still not one,
    // waits as typed.
    await set(page, 'Line width', '12')
    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    const draws = mapBuilds(engineHome)
    expect(draws, 'one build, for the figure that was fine').toHaveLength(before + 1)
    expect(draws[draws.length - 1].params.style).toEqual({ line_width: 12 })
    await expect
      .poll(() => readRecord(engineHome).style, { message: 'and only that figure was stored' })
      .toEqual({ lineWidth: 12 })
    await expect(field(page, 'Label size')).toHaveValue('big')
  })
})

test('Reset puts every size back to the engine’s own, and the next build carries no style', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await set(page, 'Line width', '12')
    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readRecord(engineHome).style).toEqual({ lineWidth: 12 })
    const before = mapBuilds(engineHome).length
    await expect(reset(page)).toBeEnabled()

    await reset(page).click()
    // The button disables itself with nothing left to reset, so focus went to
    // the cell's heading first and not to the page (A6-07).
    await expect(cellHandback(page, 'style')).toBeFocused()
    await expect(field(page, 'Line width')).toHaveValue('7')
    await expect(reset(page)).toBeDisabled()

    await expect.poll(() => readRecord(engineHome).style).toEqual({})
    const draws = mapBuilds(engineHome)
    expect(draws, 'one build for the reset').toHaveLength(before + 1)
    expect(draws[draws.length - 1].params, 'and it carries no style').not.toHaveProperty('style')
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual({})
    await closeCell(page, 'style')
    await expect(cellHeading(page, 'style')).not.toContainText('sizes of your own')
  })
})

test('the sizes are still there when the project is opened again, and opening draws nothing', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await set(page, 'Line width', '12')
    await set(page, 'Margin', '40')
    await expect(drawnInSizes(page)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => readRecord(engineHome).style).toEqual({ lineWidth: 12, padding: 40 })
    const built = mapBuilds(engineHome).length

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await openCell(page, 'style')
    await expect(field(page, 'Line width')).toHaveValue('12')
    await expect(field(page, 'Margin')).toHaveValue('40')
    await expect(field(page, 'Label size'), 'the rest are the engine’s own').toHaveValue('11')
    await expect(reset(page)).toBeEnabled()
    // The row carries its sentence only while the cell is collapsed (DESIGN
    // 8.2), so it is read after the cell is closed, never while it is open.
    await closeCell(page, 'style')
    await expect(cellHeading(page, 'style')).toContainText('Warm dark, sizes of your own')
    expect(mapBuilds(engineHome), 'opening a project builds nothing').toHaveLength(built)
  })
})

test('a project made before this change opens with every size unset and draws without a style', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    // The screen writes `opened` a moment after it opens; the record is
    // rewritten below, so that write is waited out first.
    await expect
      .poll(
        () =>
          (JSON.parse(readFileSync(recordFile(engineHome), 'utf8')) as { opened: unknown }).opened,
      )
      .not.toBeNull()

    // The record as v0.1.0-rc.7 wrote it: version 1, the four numbers it
    // stored at creation and never sent, and a `drawn` without a style.
    const file = recordFile(engineHome)
    const old = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const drawn = { ...(old.drawn as Record<string, unknown>) }
    delete drawn.style
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...old,
          version: 1,
          style: { lineWidth: 10, stationRadius: 8, interchangeRadius: 11, labelSize: 26 },
          drawn,
        },
        null,
        2,
      ) + '\n',
    )

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await openCell(page, 'style')
    // Every field shows the engine's own number: nothing was chosen, so the
    // four old numbers are not read as choices.
    for (const [name, value] of [
      ['Line width', '7'],
      ['Station radius', '4.2'],
      ['Interchange radius', '6'],
      ['Label size', '11'],
    ] as const)
      await expect(field(page, name), name).toHaveValue(value)
    await expect(reset(page)).toBeDisabled()
    await closeCell(page, 'style')
    await expect(cellHeading(page, 'style')).not.toContainText('sizes of your own')

    // Its first draw after opening: a line moved in cell 05, which is one
    // map.build from the stored layout. It carries no style.
    await openCell(page, 'lines')
    const before = mapBuilds(engineHome).length
    await panel(page, 'Line order').getByRole('button', { name: 'Move line A down' }).click()
    // Cell 02 is collapsed on a reopened project, so its sentence is not
    // there to read: the build and then the record are.
    await expect.poll(() => mapBuilds(engineHome).length, { timeout: 30_000 }).toBe(before + 1)
    const draws = mapBuilds(engineHome)
    expect(draws[draws.length - 1].params, 'no style for a project made before').not.toHaveProperty(
      'style',
    )
    // And the write that followed made it a version-2 record with nothing set.
    await expect.poll(() => readRecord(engineHome).version).toBe(2)
    expect(readRecord(engineHome).style).toEqual({})
  })
})
