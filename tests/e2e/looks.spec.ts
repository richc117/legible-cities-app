// Cell 04's looks, markers, label face and trains (issue 391, spec 034),
// against the stand-in engine: the engine's named looks offered at the head
// of the sizes group and written as their fields, two marker selects and the
// label face after the sizes, and the trains' two fields in the sizes'
// pattern, sent beside `style` rather than inside it. Every one is the
// sizes' cheap edit: one `map.build` from the stored layout, never a layout,
// written to the record only once the map carries it.
//
// The stand-in answers `style.presets` with the engine's three looks at
// v0.15.0 and refuses, in the engine's sentences, a style or a train number
// the engine would (`tests/unit/stand-in-shapes.test.ts` holds both), and
// `fake-engine.received` keeps every message it read, so what these assert
// is what the app *sent*. What the engine then draws - a tick on the side of
// a name, a square interchange, a face, a trail - is the engine's own test
// and a person's at acceptance step 8.
//
// Mutations the coordinator runs this file under, each of which must turn at
// least the named test red:
// - `withLook` writes the look's name (a `preset` key) instead of its fields,
//   or `styleParams` sends `preset`: 'choosing a look'.
// - `matchLook` remembered rather than worked out (the select never turns to
//   Custom): 'Custom appears'.
// - `withLook(_, null)` clears the face and the trains too: 'Custom appears'.
// - `styleParams` puts `dot_radius` and `trail` inside `style` (the stand-in
//   refuses the draw): 'the trains'.
// - `commitDrafts` reads the eight sizes only: 'the trains'.
// - `StyleFields`'s `show` draws a choice without the debounce, or never
//   schedules one: 'a marker and the face'.
// - Reset schedules `{ ...view.style }` with the sizes alone cleared, or
//   writes the theme: 'Reset clears the whole group'.
// - `readStyle` drops the markers, the face or the trains: 'a reopened
//   project'.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cellHandback,
  cellHeading,
  laidOutProject,
  openCell,
  panel,
  withoutOpened,
} from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** The engine's own sentences (`serve._animation_number`, v0.15.0), word for word. */
const DOT_RANGE = "dot_radius must be from 2 to 12, in SVG user units at the map's width"
const TRAIL_RANGE = 'trail must be from 0 to 3, in seconds of playback'

/** Beck as the engine answers it, less its two fields at the engine's own number, on the wire. */
const BECK_WIRE = {
  line_width: 6,
  line_gap: 1.33,
  station_radius: 3.6,
  interchange_radius: 7.5,
  station_stroke: 3,
  label_offset: 10,
  station_shape: 'tick',
}
/** The same in the record's names. */
const BECK = {
  lineWidth: 6,
  lineGap: 1.33,
  stationRadius: 3.6,
  interchangeRadius: 7.5,
  stationStroke: 3,
  labelOffset: 10,
  stationShape: 'tick',
}

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-looks-'))
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

const styleOf = (engineHome: string): unknown => readRecord(engineHome).style

/** Every request of one method the stand-in read, in order, parsed. */
const requests = (engineHome: string, method: string): { params: Record<string, unknown> }[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`))
    .map((line) => JSON.parse(line) as { params: Record<string, unknown> })

const mapBuilds = (engineHome: string) => requests(engineHome, 'map.build')
const lastBuild = (engineHome: string): Record<string, unknown> => {
  const builds = mapBuilds(engineHome)
  return builds[builds.length - 1].params
}

const sizes = (page: Page): Locator => panel(page, 'Sizes')
const field = (page: Page, name: string): Locator => sizes(page).getByLabel(name, { exact: true })
const select = (page: Page, name: string): Locator =>
  sizes(page).getByRole('combobox', { name, exact: true })
const look = (page: Page): Locator => select(page, 'Look')
const reset = (page: Page): Locator =>
  sizes(page).getByRole('button', { name: 'Reset to the engine’s sizes', exact: true })

/** Type a figure and commit it with Enter, as a person does. */
async function set(page: Page, name: string, figure: string): Promise<void> {
  await field(page, name).fill(figure)
  await field(page, name).press('Enter')
}

/** The options a select offers, by their words. */
const words = (locator: Locator): Promise<string[]> => locator.locator('option').allTextContents()

/** A project laid out on the stand-in, with cell 04 open and the engine's looks listed. */
async function laidOut(page: Page): Promise<void> {
  await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
  await openCell(page, 'style')
  await expect(sizes(page)).toBeVisible()
  await expect
    .poll(() => words(look(page)), { message: 'the engine’s looks arrive', timeout: 15_000 })
    .toEqual(['The engine’s sizes', 'Beck', 'Blueprint', 'Paper'])
}

test('choosing a look redraws once from the stored layout and writes its fields, never its name', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const layout = readRecord(engineHome).layout
    expect(mapBuilds(engineHome), 'the layout run drew the map once').toHaveLength(1)
    for (const name of ['style', 'dot_radius', 'trail'])
      expect(
        lastBuild(engineHome),
        `a project that chose nothing sends no ${name}`,
      ).not.toHaveProperty(name)
    // What the select says before anything is chosen, and what it says of a look.
    await expect(look(page)).toHaveValue('engine-own')
    await expect(look(page)).toHaveAccessibleDescription(
      'A look sets the sizes and the markers; the typeface and the trains stay as they are.',
    )
    expect(requests(engineHome, 'style.presets'), 'the looks are asked once').toHaveLength(1)

    await look(page).selectOption('beck')
    await expect.poll(() => styleOf(engineHome), { timeout: 30_000 }).toEqual(BECK)
    const builds = mapBuilds(engineHome)
    expect(builds, 'one build for the look').toHaveLength(2)
    const { params } = builds[1]
    expect(params.style, 'its fields that are not the engine’s own, in its names').toEqual(
      BECK_WIRE,
    )
    expect(params, 'never its name').not.toHaveProperty('preset')
    expect(Object.values(params.style as object), 'nor anywhere in the style').not.toContain('beck')
    expect(params.layout, 'from the stored layout').toBe(layout)
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)
    // The record holds the fields and nothing that names the look.
    expect(Object.values(readRecord(engineHome)), 'the record holds no look’s name').not.toContain(
      'beck',
    )
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual(BECK)

    // The group shows the look: the select, the fields and the station's marker.
    await expect(look(page)).toHaveValue('beck')
    await expect(field(page, 'Line width')).toHaveValue('6')
    await expect(field(page, 'Line gap')).toHaveValue('1.33')
    await expect(field(page, 'Label size'), 'the engine’s own, which is also Beck’s').toHaveValue(
      '11',
    )
    await expect(select(page, 'Station marker')).toHaveValue('tick')
    await expect(select(page, 'Interchange marker')).toHaveValue('circle')
    // A cheap edit: nothing below it is behind.
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).not.toContainText('not drawn yet')
  })
})

test('Custom appears once a size is typed over a look, and the engine’s sizes put the look back and keep the face', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await select(page, 'Label typeface').selectOption('inter')
    await look(page).selectOption('beck')
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ ...BECK, labelFont: 'inter' })
    await expect(words(look(page))).resolves.not.toContain('Custom')

    // A size typed over the look turns the select to Custom, an option that
    // is there only now.
    await set(page, 'Line width', '7')
    await expect(look(page)).toHaveValue('custom')
    await expect.poll(() => words(look(page))).toContain('Custom')
    const { lineWidth: _width, ...rest } = BECK
    void _width
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ ...rest, labelFont: 'inter' })

    // The engine's sizes: the ten a look sets go back to the engine's own,
    // and the face stays, as it does for any look.
    await look(page).selectOption('engine-own')
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ labelFont: 'inter' })
    await expect(look(page)).toHaveValue('engine-own')
    await expect.poll(() => words(look(page))).not.toContain('Custom')
    await expect(select(page, 'Station marker')).toHaveValue('circle')
    await expect(select(page, 'Label typeface')).toHaveValue('inter')
    await expect(field(page, 'Line gap')).toHaveValue('1.6')
    expect(lastBuild(engineHome).style, 'only the face is sent').toEqual({ label_font: 'inter' })
  })
})

test('a marker and the face reach the engine inside the style, from the stored layout', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await expect(select(page, 'Station marker')).toHaveAccessibleDescription(
      'A tick stands on the side of the station’s name, as on the London diagram.',
    )
    expect(await words(select(page, 'Station marker'))).toEqual(['Circle', 'Tick', 'Square'])
    expect(await words(select(page, 'Interchange marker'))).toEqual(['Ring', 'Square'])
    expect(await words(select(page, 'Label typeface'))).toEqual([
      'System',
      'Inter',
      'Atkinson Hyperlegible Next',
    ])
    const before = mapBuilds(engineHome).length

    await select(page, 'Station marker').selectOption('square')
    await select(page, 'Interchange marker').selectOption('square')
    await select(page, 'Label typeface').selectOption('atkinson-hyperlegible-next')
    const chosen = {
      stationShape: 'square',
      interchangeShape: 'square',
      labelFont: 'atkinson-hyperlegible-next',
    }
    await expect.poll(() => styleOf(engineHome), { timeout: 30_000 }).toEqual(chosen)
    expect(lastBuild(engineHome).style, 'in the engine’s names, inside the style').toEqual({
      station_shape: 'square',
      interchange_shape: 'square',
      label_font: 'atkinson-hyperlegible-next',
    })
    // Drawn after the delay, so the three are not three builds a choice each
    // behind; how many it took depends on the runner, not on the app.
    const builds = mapBuilds(engineHome).length - before
    expect(builds).toBeGreaterThanOrEqual(1)
    expect(builds).toBeLessThanOrEqual(3)
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual(chosen)
    // A marker back to the engine's own is no choice, and is not kept.
    await select(page, 'Interchange marker').selectOption('circle')
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ stationShape: 'square', labelFont: 'atkinson-hyperlegible-next' })
    await expect(cellHeading(page, 'style')).toContainText('ready')
  })
})

test('the trains’ two fields refuse a figure out of range beside the field, and go beside the style', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await expect(sizes(page).getByRole('group', { name: 'Trains' })).toBeVisible()
    await expect(field(page, 'Dot size')).toHaveValue('5')
    await expect(field(page, 'Dot size')).toHaveAccessibleDescription(
      '2 to 12. The engine’s own is 5.',
    )
    await expect(field(page, 'Trail')).toHaveValue('0')
    await expect(field(page, 'Trail')).toHaveAccessibleDescription(
      '0 to 3 seconds. The engine’s own is 0. There is no trail while a train stands at a station, in the Time view, or for a person who has asked for reduced motion.',
    )
    const before = mapBuilds(engineHome).length

    // Refused beside the field, in the engine's sentence, the figure kept.
    await set(page, 'Dot size', '13')
    const alert = sizes(page).getByRole('alert')
    await expect(alert).toHaveText(DOT_RANGE)
    await expect(field(page, 'Dot size')).toHaveAttribute('aria-invalid', 'true')
    await expect(field(page, 'Dot size')).toHaveValue('13')
    await expect(field(page, 'Dot size')).toHaveAccessibleDescription(new RegExp(DOT_RANGE))

    // A figure in range in the other field is drawn, and the refused one is
    // not: had it been sent, the build would carry it or the stand-in would
    // have refused the draw.
    await set(page, 'Trail', '1.5')
    await expect.poll(() => styleOf(engineHome), { timeout: 30_000 }).toEqual({ trail: 1.5 })
    expect(mapBuilds(engineHome), 'one build, for the trail').toHaveLength(before + 1)
    expect(lastBuild(engineHome).trail, 'beside the style').toBe(1.5)
    expect(lastBuild(engineHome)).not.toHaveProperty('dot_radius')
    expect(lastBuild(engineHome), 'nothing of the map, so no style').not.toHaveProperty('style')
    await expect(field(page, 'Dot size'), 'still waiting to be mended').toHaveValue('13')

    await set(page, 'Dot size', '8')
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ dotRadius: 8, trail: 1.5 })
    await expect(alert).toHaveCount(0)
    expect(lastBuild(engineHome)).toMatchObject({ dot_radius: 8, trail: 1.5 })
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual({
      dotRadius: 8,
      trail: 1.5,
    })

    // The trail's own range, and the next figure in range goes without it.
    await set(page, 'Trail', '4')
    await expect(sizes(page).getByRole('alert')).toHaveText(TRAIL_RANGE)
    await set(page, 'Dot size', '9')
    await expect
      .poll(() => styleOf(engineHome), { timeout: 30_000 })
      .toEqual({ dotRadius: 9, trail: 1.5 })
    expect(lastBuild(engineHome)).toMatchObject({ dot_radius: 9, trail: 1.5 })
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)
  })
})

test('Reset clears the whole group, leaves the theme, and the next build carries none of it', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await panel(page, 'Theme').locator('label.theme-card', { hasText: 'Sepia' }).click()
    await expect.poll(() => readRecord(engineHome).theme).toBe('sepia')

    await look(page).selectOption('blueprint')
    await select(page, 'Station marker').selectOption('tick')
    await select(page, 'Label typeface').selectOption('inter')
    await set(page, 'Dot size', '8')
    await set(page, 'Trail', '2')
    await expect
      .poll(() => (styleOf(engineHome) as Record<string, unknown>).trail, { timeout: 30_000 })
      .toBe(2)
    const style = styleOf(engineHome) as Record<string, unknown>
    expect(style).toMatchObject({ stationShape: 'tick', labelFont: 'inter', dotRadius: 8 })
    await expect(reset(page)).toBeEnabled()
    const before = mapBuilds(engineHome).length

    await reset(page).click()
    // The button disables itself with nothing left to reset, so focus went to
    // the cell's heading first and not to the page (A6-07).
    await expect(cellHandback(page, 'style')).toBeFocused()
    await expect(reset(page)).toBeDisabled()
    await expect.poll(() => styleOf(engineHome), { timeout: 30_000 }).toEqual({})
    expect(readRecord(engineHome).theme, 'the theme stays').toBe('sepia')
    expect(mapBuilds(engineHome), 'one build for the reset').toHaveLength(before + 1)
    for (const name of ['style', 'dot_radius', 'trail'])
      expect(lastBuild(engineHome), name).not.toHaveProperty(name)
    expect((readRecord(engineHome).drawn as { style: unknown }).style).toEqual({})

    await expect(look(page)).toHaveValue('engine-own')
    await expect(select(page, 'Station marker')).toHaveValue('circle')
    await expect(select(page, 'Label typeface')).toHaveValue('system')
    await expect(field(page, 'Line width')).toHaveValue('7')
    await expect(field(page, 'Dot size')).toHaveValue('5')
    await expect(field(page, 'Trail')).toHaveValue('0')
  })
})

test('a reopened project shows its look, its face and its trail, and opening draws nothing', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await look(page).selectOption('paper')
    await select(page, 'Label typeface').selectOption('atkinson-hyperlegible-next')
    await set(page, 'Trail', '2')
    await expect
      .poll(() => (styleOf(engineHome) as Record<string, unknown>).trail, { timeout: 30_000 })
      .toBe(2)
    expect(styleOf(engineHome)).toMatchObject({
      lineWidth: 6,
      labelSize: 12,
      padding: 28,
      labelFont: 'atkinson-hyperlegible-next',
    })
    const built = mapBuilds(engineHome).length

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await openCell(page, 'style')
    await expect
      .poll(() => words(look(page)), { timeout: 15_000 })
      .toEqual(['The engine’s sizes', 'Beck', 'Blueprint', 'Paper'])
    await expect(look(page)).toHaveValue('paper')
    await expect(select(page, 'Label typeface')).toHaveValue('atkinson-hyperlegible-next')
    await expect(select(page, 'Station marker')).toHaveValue('circle')
    await expect(field(page, 'Trail')).toHaveValue('2')
    await expect(field(page, 'Margin')).toHaveValue('28')
    await expect(reset(page)).toBeEnabled()
    expect(mapBuilds(engineHome), 'opening a project builds nothing').toHaveLength(built)
    expect(
      requests(engineHome, 'style.presets'),
      'the looks are asked once a session',
    ).toHaveLength(1)
  })
})
