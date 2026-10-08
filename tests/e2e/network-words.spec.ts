// The geographic pane's text alternative against the stand-in engine (issue
// 105, spec 031): the pane named for its counts, the disclosure "The
// network in words" after the keys hint, the extent and one sentence a line,
// a line's stations in order behind a disclosure of its own, and the
// service day the engine is asked to time the description for.
//
// What the stand-in answers is read from the stand-in itself and not written
// out here: `Engine.stage_description` in `tests/fake-engine/schematic/
// serve.py`, called by Python with the lines the drawing names. The wording
// of every sentence is held by `tests/unit/network-words.test.ts`; this spec
// holds that the pane draws the engine's description, from the day drawn,
// and keeps the frame, its sandbox and the pane's keys as they were (FR-009).
//
// It launches Electron, so it runs on a runner and not in a lane.

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { FAKE_ENGINE } from '../support/python'
import { PYTHON, profile, sweep, withApp, type Profile } from '../support/a11y'
import { cell, laidOutProject, panel } from '../support/project'
import { STAGE_SANDBOX } from '../../src/renderer/src/StageView'
import { networkWords } from '../../src/renderer/src/networkWords'
import type { StageDescription } from '../../src/shared/protocol'

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface StoredRecord {
  date: string | null
  drawn: { date: string | null } | null
}

const readRecord = (p: Profile): StoredRecord => {
  const [id] = readdirSync(join(p.engineHome, 'projects'))
  return JSON.parse(readFileSync(join(p.engineHome, 'projects', id, 'project.json'), 'utf8'))
}

/** Every render.stage the stand-in has read, as it was sent. */
const stageRequests = (p: Profile): { params: Record<string, unknown> }[] =>
  readFileSync(join(p.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes('"render.stage"'))
    .map((line) => JSON.parse(line))

/**
 * The description the stand-in answers for a drawing of these lines on this
 * day, asked of the stand-in's own function. Run from the profile's folder,
 * so nothing beside the interpreter is on its path but the stand-in.
 */
function standInDescription(p: Profile, lines: string[], date: string | null): StageDescription {
  const code =
    'import json, sys; from schematic.serve import Engine; ' +
    'print(json.dumps(Engine.stage_description(json.loads(sys.argv[1]), sys.argv[2] or None)))'
  const out = execFileSync(PYTHON as string, ['-c', code, JSON.stringify(lines), date ?? ''], {
    cwd: p.userData,
    env: { ...process.env, PYTHONPATH: FAKE_ENGINE, SCHEMATIC_HOME: p.engineHome },
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  })
  return JSON.parse(out) as StageDescription
}

/** The lines the drawing names: the stand-in writes them into the svg as `gtfs2graph: A, B`. */
async function drawnLines(page: Page): Promise<string[]> {
  const srcdoc = (await page.locator('iframe.stage-frame').getAttribute('srcdoc')) ?? ''
  const found = /gtfs2graph: ([^<]*)</.exec(srcdoc)
  if (found === null) throw new Error('the stand-in’s drawing does not name its lines')
  return found[1].split(', ')
}

const countsOf = (view: Locator): Locator => view.getByRole('definition')

test('the pane is named for its counts, and the network in words says where the routes run', async () => {
  test.setTimeout(420_000)
  const p = profile()
  await withApp(p, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const view = panel(page, 'Where the routes run')
    const frame = view.locator('iframe.stage-frame')
    await expect(frame, 'the stage is drawn').toHaveAttribute('srcdoc', /<svg/, { timeout: 30_000 })

    // The pane's name: the stage, its gloss and the counts the engine sent,
    // read from the list on screen beside it rather than written out.
    const counts = countsOf(view)
    await expect(counts.nth(4), 'the counts are in').toHaveText(/^\d+$/)
    const stations = Number(await counts.nth(1).textContent())
    const lineCount = Number(await counts.nth(4).textContent())
    expect(lineCount, 'more than one line, so the name is in the plural').toBeGreaterThan(1)
    const pane = view.getByRole('group', { name: /^The gtfs2graph stage/ })
    await expect(
      pane,
      'the pane is named for the stage, its gloss and its counts',
    ).toHaveAccessibleName(
      `The gtfs2graph stage, as the feed draws its routes: ${lineCount} lines, ${stations} stations`,
    )
    await expect(pane, 'and is described by the keys hint, as before').toHaveAccessibleDescription(
      /^Zoom with the wheel or plus and minus/,
    )

    // The disclosure is the next stop after the pane, and closed. The frame
    // between them takes no focus.
    const words = view.getByRole('button', { name: 'The network in words', exact: true })
    const group = view.locator('[role="group"][aria-label="The network\'s extent and its lines"]')
    await expect(words, 'the disclosure is there').toBeVisible()
    await expect(words, 'closed by default').toHaveAttribute('aria-expanded', 'false')
    await expect(group, 'and its words are hidden until it is opened').toBeHidden()
    const order = await view.evaluate((section) =>
      ['#stage-keys', '.network-words'].map((selector) =>
        [...section.children].indexOf(section.querySelector(selector) as Element),
      ),
    )
    expect(
      order.every((i) => i >= 0),
      'the keys hint and the disclosure are both in the section',
    ).toBe(true)
    expect(order[0], 'the disclosure comes immediately after the keys hint').toBe(order[1] - 1)
    await pane.focus()
    await expect(pane, 'the pane takes focus').toBeFocused()
    await page.keyboard.press('Tab')
    await expect(words, 'one Tab from the pane reaches the disclosure').toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(pane, 'and one Shift+Tab goes back').toBeFocused()

    // The pane still pans and zooms by its keys: the disclosure changed none
    // of its handling (FR-009).
    const transform = (): Promise<string> =>
      frame.evaluate((el) => (el as HTMLElement).style.transform)
    const before = await transform()
    await page.keyboard.press('+')
    await expect.poll(transform, { message: 'plus zooms the frame from outside' }).not.toBe(before)
    await page.keyboard.press('0')
    await expect.poll(transform, { message: 'and 0 fits it again' }).toBe(before)
    await expect(frame, 'the frame still takes no permission').toHaveAttribute(
      'sandbox',
      STAGE_SANDBOX,
    )
    await expect(frame, 'and is still hidden from assistive technology').toHaveAttribute(
      'aria-hidden',
      'true',
    )

    // The day the engine was asked to time the description for is the day
    // drawn, which is the record's day after a layout run.
    const record = readRecord(p)
    expect(record.date, 'the layout run stored a day').not.toBeNull()
    expect(record.drawn?.date, 'and the map was drawn for it').toBe(record.date)
    const asked = stageRequests(p)
    expect(asked.length, 'the stage was asked for').toBeGreaterThan(0)
    for (const request of asked)
      expect(
        request.params.date,
        `render.stage was sent the service day: ${JSON.stringify(request.params)}`,
      ).toBe(record.date)

    // What the stand-in says of this drawing on that day.
    const lines = await drawnLines(page)
    const description = standInDescription(p, lines, record.date)
    const expected = networkWords(description)
    expect(expected.extent, 'the stand-in times the description for a day').not.toBeNull()
    expect(
      description.lines.map((l) => l.label),
      'one description line per drawn line',
    ).toEqual(lines)

    await words.click()
    await expect(words, 'pressed, it opens').toHaveAttribute('aria-expanded', 'true')
    await expect(group, 'and its words are on screen').toBeVisible()
    await expect(
      group.locator('.network-extent'),
      'the extent is one sentence, of the day drawn',
    ).toHaveText(expected.extent as string)
    // The same facts, read from the raw fields rather than from the module
    // that words them: the longest trip's minutes, its line and its ends.
    const extent = description.extent as NonNullable<StageDescription['extent']>
    await expect(group.locator('.network-extent'), 'the extent names its minutes').toContainText(
      `${extent.minutes} minutes`,
    )
    await expect(group.locator('.network-extent'), 'its line and its two ends').toContainText(
      `the ${extent.line} from ${extent.from} to ${extent.to}.`,
    )

    const items = group.locator('li.network-line')
    await expect(items, 'one item per line, in the engine’s order').toHaveCount(
      description.lines.length,
    )
    await expect(
      items.locator(':scope > p'),
      'each line’s sentence is the engine’s description in words',
    ).toHaveText(expected.lines.map((l) => l.sentence))
    for (const [i, line] of description.lines.entries()) {
      const sentence = (await items.nth(i).locator(':scope > p').textContent()) ?? ''
      expect(sentence, `${line.label} is told from one terminus to the other`).toContain(
        `${line.label}: from ${line.termini[0]} to ${line.termini[1]}, ${line.stations.length} stations`,
      )
      for (const meeting of line.meets)
        expect(sentence, `${line.label} meets at ${meeting.station}`).toContain(
          ` at ${meeting.station}`,
        )
    }

    // No station is listed until a person opens one (FR-005, US2).
    await expect(group.locator('ol'), 'no station list is open').toHaveCount(0)
    const first = description.lines[0]
    const stationsButton = items
      .nth(0)
      .getByRole('button', { name: `Stations on ${first.label}, in order`, exact: true })
    await expect(stationsButton, 'a line’s stations are behind a disclosure').toHaveAttribute(
      'aria-expanded',
      'false',
    )
    await stationsButton.click()
    await expect(stationsButton).toHaveAttribute('aria-expanded', 'true')
    await expect(group.locator('ol'), 'only that line’s list is open').toHaveCount(1)
    await expect(items.nth(0).locator('ol > li'), 'its stations, in the engine’s order').toHaveText(
      first.stations,
    )

    // A toggle between the stages keeps the person's place in the words: the
    // component's state is its own. The words follow the stage shown.
    await view.getByRole('button', { name: 'loom' }).click()
    await expect(frame, 'the loom stage is drawn').toHaveAttribute('srcdoc', /loom/)
    const loomStations = Number(await counts.nth(1).textContent())
    const loomLines = Number(await counts.nth(4).textContent())
    await expect(
      view.getByRole('group', { name: /^The loom stage/ }),
      'the pane is named for the stage shown, with its own counts',
    ).toHaveAccessibleName(
      `The loom stage, lines sorted onto shared track: ${loomLines} lines, ${loomStations} stations`,
    )
    await expect(words, 'the disclosure stays open across the toggle').toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(stationsButton, 'and so does the line’s list').toHaveAttribute(
      'aria-expanded',
      'true',
    )
    await expect(items.nth(0).locator('ol > li'), 'with the same stations').toHaveText(
      first.stations,
    )
    expect(
      stageRequests(p).some((request) => request.params.stage === 'loom'),
      'the engine was asked for the loom stage’s description too',
    ).toBe(true)
    for (const request of stageRequests(p))
      expect(
        request.params.date,
        `every render.stage carries the day: ${JSON.stringify(request.params)}`,
      ).toBe(record.date)
  })
})

test('a day drawn re-times the words; a day only chosen does not', async () => {
  test.setTimeout(240_000)
  const p = profile()
  await withApp(p, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const view = panel(page, 'Where the routes run')
    await expect(view.locator('iframe.stage-frame')).toHaveAttribute('srcdoc', /<svg/, {
      timeout: 30_000,
    })
    const first = readRecord(p).date
    expect(first, 'the layout run stored a day').not.toBeNull()
    await expect
      .poll(() => stageRequests(p).length, { message: 'the stage has been asked for' })
      .toBeGreaterThan(0)
    const asked = stageRequests(p).length

    // A day chosen is written at once and draws nothing (A5.5-15): the words
    // say "the day drawn", so they are not timed for it yet.
    const section = cell(page, 'frame')
    const other = first === '2026-06-20' ? '2026-06-21' : '2026-06-20'
    await section.getByLabel('Draw for another day').fill(other)
    await expect.poll(() => readRecord(p).date, { message: 'the chosen day is stored' }).toBe(other)
    expect(readRecord(p).drawn?.date, 'and the map on screen is still the old day’s').toBe(first)
    await page.waitForTimeout(500)
    expect(
      stageRequests(p)
        .slice(asked)
        .map((request) => request.params.date),
      'nothing was asked for a day that is not drawn',
    ).toEqual([])

    // Drawn, the day is the day drawn and the words are timed for it.
    await section.getByRole('button', { name: 'Draw for this day' }).click()
    await expect(page.getByText(new RegExp(`^Drawn for ${other}`))).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(
        () =>
          stageRequests(p)
            .slice(asked)
            .map((request) => request.params.date),
        {
          message: 'the stage is asked for again, for the day now drawn',
          timeout: 30_000,
        },
      )
      .toContain(other)
    await view.getByRole('button', { name: 'The network in words', exact: true }).click()
    const description = standInDescription(p, await drawnLines(page), other)
    await expect(view.locator('.network-extent'), 'the words are those of the new day').toHaveText(
      networkWords(description).extent as string,
    )
  })
})

test('the accessibility sweep passes with the disclosure closed, open, and a list open', async () => {
  // Three sweeps, so six walks (each sweep walks once in each theme): the
  // disclosure's buttons are controls in the Tab order and its text is on
  // the page, and both themes must draw them (SC-003).
  test.setTimeout(480_000)
  const p = profile()
  await withApp(p, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const view = panel(page, 'Where the routes run')
    await expect(view.locator('iframe.stage-frame')).toHaveAttribute('srcdoc', /<svg/, {
      timeout: 30_000,
    })
    const words = view.getByRole('button', { name: 'The network in words', exact: true })
    await expect(words).toHaveAttribute('aria-expanded', 'false')
    await sweep(page, 'cell 01, the network in words closed')

    await words.click()
    await expect(words).toHaveAttribute('aria-expanded', 'true')
    await sweep(page, 'cell 01, the network in words open')

    await view
      .getByRole('button', { name: /^Stations on .*, in order$/ })
      .first()
      .click()
    await expect(view.locator('ol')).toHaveCount(1)
    await sweep(page, 'cell 01, the network in words open with a line’s stations')
  })
})
