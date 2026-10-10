// Cell 05's line options (issue 394, spec 036), against the stand-in
// engine: a closed disclosure under each row of the colours list, its name,
// its switch, its three selects, the casing's colour and Reset line, each
// one the colours' cheap edit - one `map.build` from the stored layout,
// never a layout, written to the record only once the map carries it.
//
// The stand-in takes `map.build`'s `lines` with the engine's bounds and
// refusals at v0.16.0, refuses a map whose every layout line is hidden, and
// writes into the page it draws the lines the page would list and the names
// it would show (`tests/unit/stand-in-shapes.test.ts` holds all three), and
// `fake-engine.received` keeps every message it read, so what these assert
// is what the app sent and what the stand-in made of it. What the engine
// then draws - a bold, cased or dashed stroke, a name on a chip - is the
// engine's own test and a person's at acceptance step 9.
//
// The stand-in's LA layout carries lines A and B, and its feed lists six
// (A, B, C, D, E, K), so hiding B leaves A drawn. The last-line refusal is
// the app's own, before the engine's: it is seen on a feed a person added,
// which lists one line, "1", while the stand-in's layout still carries A
// and B, so nothing but the app can refuse it.
//
// Written, not run in the lane: the coordinator runs this file, and the
// mutations it must be watched failing under are these, each turning at
// least the named test red:
// - `linesParams` sends nothing (the record's options never go on the
//   wire): 'each option reaches'.
// - `useLineOptions`'s commit builds without the debounce, or `choose` does
//   not schedule: 'each option reaches' (no build, or one per choice).
// - `redrawLines` draws `project.lines` in place of the options chosen:
//   'each option reaches'.
// - `withCasingWidth` starts a casing with no colour (the stand-in refuses
//   the draw): 'each option reaches'.
// - `LineRow`'s `data-hidden` never set: 'a hidden line stays listed'.
// - `hidesEveryLine` always false: 'the last line drawn'.
// - `readName` takes any length: 'a name past 40'.
// - `useLineOptions.reset` clears every line: 'Reset line clears one line'.
// - `readLines` drops the casing on read: 'a reopened project'.
// - `CasingColour` drawn whatever the casing: 'the casing’s colour'.
// - `redrawLines` leaving `optioned` false (cell 02 says the colours were
//   drawn): 'each option reaches'.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cellHandback,
  cellHeading,
  laidOutProject,
  openCell,
  openProject,
  panel,
  withoutOpened,
} from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** The engine's own sentences (`serve._lines` and `pipeline.run` at v0.16.0). */
const NAME_REFUSED = "lines['A'].name must be from 1 to 40 characters with no line break"
const EVERY_LINE_HIDDEN = 'every line on this map is hidden; show at least one line to draw it'

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-line-options-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

/** A feed a person added, written into the stand-in's registry before the app starts. */
function addedFeed(engineHome: string): void {
  const folder = join(engineHome, 'data', 'feeds')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'user-feeds.json'),
    JSON.stringify([
      {
        key: 'metro-de-prueba',
        name: 'Metro de Prueba',
        city: '',
        network: '',
        url: null,
        mode: 'all',
        label_pattern: null,
        label_strip: null,
        agency: null,
        geographic: true,
        notes: [],
        source: 'user',
      },
    ]),
  )
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

const projectId = (engineHome: string): string => readdirSync(join(engineHome, 'projects'))[0]

const readRecord = (engineHome: string): Record<string, unknown> =>
  withoutOpened(
    JSON.parse(
      readFileSync(join(engineHome, 'projects', projectId(engineHome), 'project.json'), 'utf8'),
    ),
  )

const linesOf = (engineHome: string): unknown => readRecord(engineHome).lines

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

/** What the stand-in's page says it shows of the lines, for a draw sent `lines`. */
const pageOf = (engineHome: string, key = 'la-metro-rail'): unknown =>
  JSON.parse(readFileSync(join(engineHome, 'out', projectId(engineHome), `${key}.html`), 'utf8'))

/** A sentence as a pattern that matches it and nothing else, for a description that holds it. */
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const colours = (page: Page): Locator => panel(page, 'Line colours')
const rowOf = (page: Page, label: string): Locator =>
  colours(page)
    .getByRole('list', { name: 'Lines', exact: true })
    .getByRole('listitem')
    .filter({ has: page.locator('.line-name', { hasText: new RegExp(`^${label}$`) }) })
const toggle = (page: Page, label: string): Locator =>
  colours(page).getByRole('button', { name: new RegExp(`^Line options for line ${label},`) })
const options = (page: Page, label: string): Locator =>
  colours(page).getByRole('group', { name: `Line options for line ${label}`, exact: true })
const nameField = (page: Page, label: string): Locator =>
  options(page, label).getByLabel('Name', { exact: true })
const shown = (page: Page, label: string): Locator =>
  options(page, label).getByRole('switch', { name: 'Shown', exact: true })
const select = (page: Page, label: string, name: string): Locator =>
  options(page, label).getByRole('combobox', { name, exact: true })
const resetLine = (page: Page, label: string): Locator =>
  options(page, label).getByRole('button', { name: `Reset line ${label}’s options`, exact: true })

/** A laid-out LA project with cell 05 open and its rows read from the feed. */
async function laidOut(page: Page): Promise<void> {
  await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
  await openCell(page, 'lines')
  await expect(
    colours(page).getByRole('list', { name: 'Lines', exact: true }).getByRole('listitem'),
  ).toHaveCount(6, { timeout: 15_000 })
}

/** Open a line's options and wait for its group. */
async function openOptions(page: Page, label: string): Promise<void> {
  await toggle(page, label).click()
  await expect(toggle(page, label)).toHaveAttribute('aria-expanded', 'true')
  await expect(options(page, label)).toBeVisible()
}

test('each option reaches the stand-in’s request and the record, once drawn, and the summary follows', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    const layout = readRecord(engineHome).layout
    expect(mapBuilds(engineHome), 'the layout run drew the map once').toHaveLength(1)
    expect(lastBuild(engineHome), 'a project that chose nothing sends no lines').not.toHaveProperty(
      'lines',
    )
    // Every row carries a closed disclosure that says it holds nothing.
    for (const label of ['A', 'B', 'C', 'D', 'E', 'K']) {
      await expect(toggle(page, label)).toHaveAttribute('aria-expanded', 'false')
      await expect(toggle(page, label)).toHaveAccessibleName(
        `Line options for line ${label}, Default`,
      )
    }

    await openOptions(page, 'A')
    await expect(nameField(page, 'A')).toHaveValue('')
    await expect(nameField(page, 'A')).toHaveAttribute('placeholder', 'A')
    await expect(nameField(page, 'A')).toHaveAccessibleDescription(
      'Shown in place of A in the page’s chips, rows and time chart, and on its trains. Up to 40 characters; left empty, the line is called A.',
    )
    await expect(shown(page, 'A')).toBeChecked()
    await expect(select(page, 'A', 'Width')).toHaveValue('1')
    await expect(select(page, 'A', 'Width')).toHaveAccessibleDescription(
      'A multiple of the map’s line width: thin 0.75, regular 1, bold 1.25, heavy 1.5. A wider line moves the lines beside it out to make room.',
    )
    await expect(select(page, 'A', 'Casing')).toHaveValue('0')
    await expect(select(page, 'A', 'Dash')).toHaveValue('solid')
    await expect(resetLine(page, 'A')).toBeDisabled()

    // A name, committed with Enter: one build, from the stored layout.
    await nameField(page, 'A').fill('Airport Express')
    await nameField(page, 'A').press('Enter')
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ A: { name: 'Airport Express' } })
    expect(mapBuilds(engineHome), 'one build for the name').toHaveLength(2)
    // Cell 02 says what was drawn, in the options' words and not the colours'.
    await expect(page.getByText(/Drawn with the line options you chose/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText(/Drawn in the colours you chose/)).toHaveCount(0)
    expect(lastBuild(engineHome).lines).toEqual({ A: { name: 'Airport Express' } })
    expect(lastBuild(engineHome).layout, 'from the stored layout').toBe(layout)
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)
    expect((readRecord(engineHome).drawn as { lines: unknown }).lines).toEqual({
      A: { name: 'Airport Express' },
    })
    expect(pageOf(engineHome), 'the stand-in’s page names the line').toEqual({
      lines: ['A', 'B'],
      names: { A: 'Airport Express' },
    })
    await expect(toggle(page, 'A')).toHaveAccessibleName('Line options for line A, Renamed')

    // Three choices in quick succession are drawn together after the delay.
    const before = mapBuilds(engineHome).length
    await select(page, 'A', 'Width').selectOption('1.25')
    await select(page, 'A', 'Casing').selectOption('0.5')
    await select(page, 'A', 'Dash').selectOption('dashed')
    const chosen = {
      A: {
        name: 'Airport Express',
        width: 1.25,
        casing: { width: 0.5, color: '#ffffff' },
        dash: 'dashed',
      },
    }
    await expect.poll(() => linesOf(engineHome), { timeout: 30_000 }).toEqual(chosen)
    expect(lastBuild(engineHome).lines, 'in the engine’s names, a casing starting white').toEqual(
      chosen,
    )
    const builds = mapBuilds(engineHome).length - before
    expect(builds).toBeGreaterThanOrEqual(1)
    expect(builds).toBeLessThanOrEqual(3)
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)
    await expect(toggle(page, 'A')).toHaveAccessibleName(
      'Line options for line A, Bold, cased, dashed, renamed',
    )
    // The colours and the order stay where they are on the wire.
    expect(lastBuild(engineHome)).toMatchObject({ colors: {}, default_color: '#888888' })
    expect(lastBuild(engineHome)).not.toHaveProperty('line_order')
    // A cheap edit: nothing below it is behind.
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).not.toContainText('not drawn yet')

    // A choice put back to the engine's own keeps nothing for it.
    await select(page, 'A', 'Dash').selectOption('solid')
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({
        A: { name: 'Airport Express', width: 1.25, casing: { width: 0.5, color: '#ffffff' } },
      })
  })
})

test('the casing’s colour is a chip beside its select, only while there is a casing, and builds on its own button', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await openOptions(page, 'B')
    const chip = options(page, 'B').getByRole('button', {
      name: 'Choose the casing colour of line B',
      exact: true,
    })
    await expect(chip).toHaveCount(0)
    await expect(options(page, 'B')).not.toContainText('The casing keeps this colour')

    await select(page, 'B', 'Casing').selectOption('1')
    await expect(chip).toBeVisible()
    await expect(options(page, 'B')).toContainText(
      'The casing keeps this colour in both of the map’s themes, so choose one that reads on the map’s ground.',
    )
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ B: { casing: { width: 1, color: '#ffffff' } } })

    await chip.click()
    const picker = colours(page).getByRole('group', { name: 'Casing colour for line B' })
    await expect(picker).toBeVisible()
    const before = mapBuilds(engineHome).length
    await picker.getByLabel('Hex value').fill('#112233')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect(picker).toBeHidden()
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ B: { casing: { width: 1, color: '#112233' } } })
    expect(mapBuilds(engineHome), 'one build for the colour').toHaveLength(before + 1)
    expect(lastBuild(engineHome).lines).toEqual({ B: { casing: { width: 1, color: '#112233' } } })

    // None takes the casing away, its colour with it, and the chip goes.
    await select(page, 'B', 'Casing').selectOption('0')
    await expect(chip).toHaveCount(0)
    await expect.poll(() => linesOf(engineHome), { timeout: 30_000 }).toBeUndefined()
    expect(lastBuild(engineHome), 'nothing left to send').not.toHaveProperty('lines')
  })
})

test('a hidden line stays listed and dimmed, Line order keeps it, and the page leaves it out', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await openOptions(page, 'B')
    await shown(page, 'B').click()
    await expect(shown(page, 'B')).not.toBeChecked()
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ B: { hidden: true } })
    expect(lastBuild(engineHome).lines).toEqual({ B: { hidden: true } })
    expect(pageOf(engineHome), 'the stand-in’s page draws A alone').toEqual({ lines: ['A'] })
    expect(requests(engineHome, 'graph.build'), 'no layout run').toHaveLength(1)

    // The row stays where it was, its words dimmed and its summary saying
    // so, and every control in it still works.
    await expect(
      colours(page).getByRole('list', { name: 'Lines', exact: true }).getByRole('listitem'),
    ).toHaveCount(6)
    await expect(rowOf(page, 'B')).toHaveAttribute('data-hidden', 'true')
    await expect(rowOf(page, 'A')).not.toHaveAttribute('data-hidden', 'true')
    const colourOf = (label: string): Promise<string> =>
      rowOf(page, label)
        .locator('.line-name')
        .evaluate((name) => getComputedStyle(name).color)
    expect(await colourOf('B'), 'the hidden line’s name is drawn faint').not.toBe(
      await colourOf('A'),
    )
    await expect(toggle(page, 'B')).toHaveAccessibleName('Line options for line B, Hidden')
    await expect(
      colours(page).getByRole('button', { name: 'Choose the colour of line B', exact: true }),
    ).toBeEnabled()
    // Line order keeps it in its place.
    await expect(
      panel(page, 'Line order')
        .getByRole('list', { name: 'Lines in the order they are drawn' })
        .getByRole('listitem'),
    ).toHaveCount(6)
    await expect(
      panel(page, 'Line order').getByRole('button', { name: 'Move line B up', exact: true }),
    ).toBeVisible()
    for (const id of ['frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).not.toContainText('not drawn yet')

    // Shown again: the map is drawn once more and the record keeps nothing.
    await shown(page, 'B').click()
    await expect(shown(page, 'B')).toBeChecked()
    await expect.poll(() => linesOf(engineHome), { timeout: 30_000 }).toBeUndefined()
    expect(lastBuild(engineHome)).not.toHaveProperty('lines')
    expect(
      readFileSync(join(engineHome, 'out', projectId(engineHome), 'la-metro-rail.html'), 'utf8'),
    ).toBe('{}')
    await expect(rowOf(page, 'B')).not.toHaveAttribute('data-hidden', 'true')
  })
})

test('the last line drawn is not hidden: the switch stays on and the engine’s sentence is said beside it', async () => {
  const engineHome = home()
  addedFeed(engineHome)
  await withApp(engineHome, async (page) => {
    await laidOutProject(page, 'Metro de Prueba', 'Prueba')
    await openCell(page, 'lines')
    await expect(
      colours(page).getByRole('list', { name: 'Lines', exact: true }).getByRole('listitem'),
    ).toHaveCount(1, { timeout: 15_000 })
    const built = mapBuilds(engineHome).length
    await openOptions(page, '1')
    await shown(page, '1').click()
    const alert = options(page, '1').getByRole('alert')
    await expect(alert).toHaveText(EVERY_LINE_HIDDEN)
    await expect(shown(page, '1')).toBeChecked()
    await expect(shown(page, '1')).toHaveAccessibleDescription(
      new RegExp(escaped(EVERY_LINE_HIDDEN)),
    )
    expect(readRecord(engineHome)).not.toHaveProperty('lines')
    // Nothing was sent for it, and nothing waits: the next choice is drawn
    // once, alone, with the line still shown. (A deadline on what the next
    // build carries, rather than a sleep to see that none came.)
    await select(page, '1', 'Dash').selectOption('dotted')
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ '1': { dash: 'dotted' } })
    expect(mapBuilds(engineHome), 'one build, for the dash').toHaveLength(built + 1)
    expect(lastBuild(engineHome).lines).toEqual({ '1': { dash: 'dotted' } })
  })
})

test('a name past 40 characters is refused beside the field, and an empty one clears it', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await openOptions(page, 'A')
    const built = mapBuilds(engineHome).length
    const long = 'x'.repeat(41)
    await nameField(page, 'A').fill(long)
    await nameField(page, 'A').press('Enter')
    const alert = options(page, 'A').getByRole('alert')
    await expect(alert).toHaveText(NAME_REFUSED)
    await expect(nameField(page, 'A')).toHaveAttribute('aria-invalid', 'true')
    await expect(nameField(page, 'A')).toHaveValue(long)
    await expect(nameField(page, 'A')).toHaveAccessibleDescription(
      new RegExp(escaped(NAME_REFUSED)),
    )
    expect(readRecord(engineHome)).not.toHaveProperty('lines')

    // Forty is taken, in one build: the refused name was never sent, and
    // nothing of it waits. Then emptied, the name is cleared and nothing is
    // kept.
    await nameField(page, 'A').fill('x'.repeat(40))
    await nameField(page, 'A').press('Enter')
    await expect(alert).toHaveCount(0)
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ A: { name: 'x'.repeat(40) } })
    expect(mapBuilds(engineHome), 'one build, for the name taken').toHaveLength(built + 1)
    expect(lastBuild(engineHome).lines).toEqual({ A: { name: 'x'.repeat(40) } })
    await nameField(page, 'A').fill('')
    await nameField(page, 'A').press('Enter')
    await expect.poll(() => linesOf(engineHome), { timeout: 30_000 }).toBeUndefined()
    expect(lastBuild(engineHome)).not.toHaveProperty('lines')
  })
})

test('Reset line clears one line, leaves the others and the colours, and hands focus to the cell', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    // A colour of A's own, which Reset line must leave alone.
    await colours(page)
      .getByRole('button', { name: 'Choose the colour of line A', exact: true })
      .click()
    const picker = colours(page).getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect
      .poll(() => readRecord(engineHome).colors, { timeout: 30_000 })
      .toEqual({ A: '#ff0000' })

    await openOptions(page, 'A')
    await select(page, 'A', 'Width').selectOption('1.5')
    await openOptions(page, 'B')
    await select(page, 'B', 'Dash').selectOption('dotted')
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ A: { width: 1.5 }, B: { dash: 'dotted' } })
    await expect(resetLine(page, 'A')).toBeEnabled()
    const before = mapBuilds(engineHome).length

    await resetLine(page, 'A').click()
    // The button disables itself with nothing left to reset, so focus went
    // to the cell's heading first and not to the page (A6-07).
    await expect(cellHandback(page, 'lines')).toBeFocused()
    await expect(resetLine(page, 'A')).toBeDisabled()
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ B: { dash: 'dotted' } })
    expect(mapBuilds(engineHome), 'one build for the reset').toHaveLength(before + 1)
    expect(lastBuild(engineHome).lines).toEqual({ B: { dash: 'dotted' } })
    expect(readRecord(engineHome).colors, 'A’s colour stays').toEqual({ A: '#ff0000' })
    await expect(select(page, 'A', 'Width')).toHaveValue('1')
    await expect(toggle(page, 'A')).toHaveAccessibleName('Line options for line A, Default')
    await expect(toggle(page, 'B')).toHaveAccessibleName('Line options for line B, Dotted')

    // Reset every line is the colours', and leaves the options.
    await colours(page).getByRole('button', { name: 'Reset every line', exact: true }).click()
    await expect.poll(() => readRecord(engineHome).colors, { timeout: 30_000 }).toEqual({})
    expect(linesOf(engineHome)).toEqual({ B: { dash: 'dotted' } })
  })
})

test('a reopened project shows its options, and opening draws nothing', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOut(page)
    await openOptions(page, 'B')
    await nameField(page, 'B').fill('Red Line')
    await nameField(page, 'B').press('Enter')
    await select(page, 'B', 'Casing').selectOption('0.25')
    await expect
      .poll(() => linesOf(engineHome), { timeout: 30_000 })
      .toEqual({ B: { name: 'Red Line', casing: { width: 0.25, color: '#ffffff' } } })
    const built = mapBuilds(engineHome).length

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    await openCell(page, 'lines')
    await expect(toggle(page, 'B')).toHaveAccessibleName(
      'Line options for line B, Cased, renamed',
      {
        timeout: 15_000,
      },
    )
    await expect(toggle(page, 'B'), 'closed again, as every row opens').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await openOptions(page, 'B')
    await expect(nameField(page, 'B')).toHaveValue('Red Line')
    await expect(select(page, 'B', 'Casing')).toHaveValue('0.25')
    await expect(
      options(page, 'B').getByRole('button', { name: 'Choose the casing colour of line B' }),
    ).toBeVisible()
    expect(mapBuilds(engineHome), 'opening a project builds nothing').toHaveLength(built)
  })
})
