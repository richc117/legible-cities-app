// Route mode in cell 03 (issue 272, spec 030, ADR-048): a start and an end
// station chosen from the keyboard, one `setTrip` to the engine's page for
// the pair, the steps and the announcement drawn from what the page
// answered, "Show the whole network" and an emptied picker each sending one
// `setTrip(null)`, the refusals said beside the control that caused them,
// the trip given back to a page a redraw reloaded, and the engine asked
// nothing at all.
//
// The stand-in engine's own page is `{}` and has no seam, so after the
// layout run the stand-in page (`tests/fixtures/capture-page.html`) is
// written over it: it answers `setTrip` over the stand-in's three stations
// as one line, A, running Alpha, Bravo, Charlie, and records every call it
// was asked in `window.__seen`, which this spec reads from the map's frame
// through the main process. The pickers' options are the record's
// `drawn.stations`, which the stand-in's `map.build` answered.

import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
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
import {
  END,
  OLD_PAGE,
  SAME_STATION,
  START,
  TRIP,
  WHOLE_NETWORK,
  matchWords,
  tripRefusal,
} from '../../src/renderer/src/tripWords'
import { UNLISTED_STATION } from '../../src/shared/trip'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { cellHeading, openCell, openProject, withoutOpened } from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** The stand-in engine's three stations, by the ids its `map.build` lists them under. */
const ALPHA = '0x6000036f4a40'
const BRAVO = '0x6000036f4c80'
const CHARLIE = '0x6000036f4010'

/** A launch, a layout run, a reopen and the walks below: the transport's budget. */
const TRIP_TIMEOUT = 180_000

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-trip-'))
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
      LEGIBLE_USER_DATA: join(engineHome, 'profile'),
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await run(page, app)
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

/** How many requests of one method the stand-in engine has read. */
const received = (engineHome: string, method: string): number =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`)).length

/** Where the project's page is, which a run writes and this spec writes over. */
const pagePath = (engineHome: string): string => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return join(engineHome, 'out', id, 'la-metro-rail.html')
}

/** The stand-in page, with the seam, over the `{}` the stand-in engine wrote. */
const standInPage = (engineHome: string): void => copyFileSync(fixture, pagePath(engineHome))

/**
 * Keep the stand-in page written over whatever a redraw writes, until the
 * returned function is called: a rebuild's `map.build` writes `{}` and the
 * frame loads it a state read and a navigation later. A whole file is
 * renamed over it each time, so a load never reads half of one.
 */
function keepStandInPage(engineHome: string): () => void {
  const file = pagePath(engineHome)
  const source = readFileSync(fixture)
  const timer = setInterval(() => {
    try {
      writeFileSync(`${file}.next`, source)
      renameSync(`${file}.next`, file)
    } catch {
      // Windows refuses a rename over a file a reader has open; the next tick tries again.
    }
  }, 5)
  return () => clearInterval(timer)
}

/**
 * Every call the map's page recorded, or null where it could not be read
 * this time: no frame yet, a frame between documents, or a read that met
 * its deadline (issue 232). The map's frame is the one whose address
 * carries the app's own `controls=1`; cell 01's stage view and cell 06's
 * preview are frames as well.
 */
async function seenByMap(app: ElectronApplication): Promise<unknown[][] | null> {
  const late = new Promise<null>((done) => setTimeout(() => done(null), 2000))
  const read = app
    .evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
      const frame = main.frames.find((f) => f !== main && f.url.includes('controls=1'))
      if (frame === undefined) return null
      const answer = frame.executeJavaScript('window.__seen || null') as Promise<unknown[][] | null>
      const slow = new Promise<null>((done) => setTimeout(() => done(null), 1000))
      return Promise.race([answer, slow])
    })
    .catch(() => null)
  return Promise.race([read, late])
}

/**
 * Mark the document now in the map's frame, so a later read can tell it
 * from the document a redraw loads: both carry `controls=1`, and the old one
 * stays in the frame until the new one arrives.
 */
async function markDocument(app: ElectronApplication): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
    const frame = main.frames.find((f) => f !== main && f.url.includes('controls=1'))
    await frame?.executeJavaScript('window.__marked = true')
  })
}

/** What a document the mark has not reached recorded: a new one, or null while there is none yet. */
async function seenByNewDocument(app: ElectronApplication): Promise<unknown[][] | null> {
  const late = new Promise<null>((done) => setTimeout(() => done(null), 2000))
  const read = app
    .evaluate(async ({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
      const frame = main.frames.find((f) => f !== main && f.url.includes('controls=1'))
      if (frame === undefined) return null
      const answer = frame.executeJavaScript(
        'window.__marked === true ? null : window.__seen || null',
      ) as Promise<unknown[][] | null>
      const slow = new Promise<null>((done) => setTimeout(() => done(null), 1000))
      return Promise.race([answer, slow])
    })
    .catch(() => null)
  return Promise.race([read, late])
}

/**
 * The `setTrip` calls the map's page recorded, from a read that answered,
 * or null when none did for ten seconds - never an empty list, which would
 * let "nothing was sent" pass on a page that could not be read at all.
 */
async function trips(app: ElectronApplication): Promise<unknown[][] | null> {
  const until = Date.now() + 10_000
  for (;;) {
    const seen = await seenByMap(app)
    if (seen !== null) return seen.filter((call) => call[0] === 'setTrip')
    if (Date.now() > until) return null
  }
}

/**
 * Make the map's page answer `setTrip` with a hand-made answer, as the real
 * page can and the stand-in's one line never does: no trip and a reason, a
 * trip with a caveat and hidden lines, a station the project does not list.
 * The call is still recorded. `null` takes the method away, as a page the
 * engine wrote before v0.13.0 has none. Injected from the main process, as
 * every read here is; the page is the stand-in, at an opaque origin.
 */
async function pageAnswers(app: ElectronApplication, answer: unknown): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, given) => {
    const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
    const frame = main.frames.find((f) => f !== main && f.url.includes('controls=1'))
    if (frame === undefined) throw new Error('no map frame')
    await frame.executeJavaScript(
      `(function (given) {
        var present = window.__present, seen = window.__seen
        if (given === 'gone') { delete present.setTrip; return }
        present.setTrip = function (from, to) {
          var a = from === undefined ? null : from, b = to === undefined ? null : to
          seen.push(['setTrip', a, b])
          return a === null ? null : JSON.parse(JSON.stringify(given))
        }
      })(${JSON.stringify(given)})`,
    )
  }, answer ?? 'gone')
}

const tripRegion = (page: Page): Locator => page.getByRole('region', { name: TRIP, exact: true })
const picker = (page: Page, name: string): Locator =>
  tripRegion(page).getByRole('combobox', { name, exact: true })

/**
 * Choose a station from the keyboard, as a person would: focus the picker,
 * type part of its name, Down to the first match, Enter.
 */
async function chooseStation(page: Page, name: string, typed: string): Promise<void> {
  const field = picker(page, name)
  await field.focus()
  // Emptied first, as a person clears a field, so the letters are the only
  // text in it whatever it held. `fill` and not a select-all chord, which
  // is not the same keys on every platform.
  await field.fill('')
  await field.pressSequentially(typed)
  await field.press('ArrowDown')
  await field.press('Enter')
}

/** A laid-out project whose page has the seam, open, with cell 03 disclosed. */
async function projectWithAPage(page: Page, engineHome: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await openProject(page, 'Los Angeles')
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  standInPage(engineHome)
  // Reopened so the frame loads what was just written: the viewer
  // navigates on a redraw and on nothing else, and nothing has redrawn.
  await page.getByRole('button', { name: /back to library/i }).click()
  await openProject(page, 'Los Angeles')
  await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
  await openCell(page, 'frame')
  // The page has loaded and been held: the transport draws only once the
  // page has answered what day it has.
  await expect(page.getByRole('region', { name: 'Transport', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

test('a trip chosen by keyboard is one setTrip, its steps and one announcement, and asks the engine nothing', async () => {
  test.setTimeout(TRIP_TIMEOUT)
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)

    // The stations the pickers offer are the ones the build answered, kept
    // with the record (FR-004).
    const drawn = readRecord(engineHome).drawn as { stations: unknown }
    expect(drawn.stations).toEqual([
      { id: ALPHA, name: 'Alpha' },
      { id: BRAVO, name: 'Bravo' },
      { id: CHARLIE, name: 'Charlie' },
    ])

    // US1 scenario 1: after the transport, a region "Trip" named by its
    // heading, two comboboxes, and nothing pressed or disabled.
    const region = tripRegion(page)
    await expect(region).toBeVisible()
    await expect(region.getByRole('heading', { level: 3, name: TRIP, exact: true })).toBeVisible()
    await expect(picker(page, START)).toBeVisible()
    await expect(picker(page, END)).toBeVisible()
    await expect(region.locator('[disabled], [aria-disabled="true"], [aria-pressed]')).toHaveCount(
      0,
    )
    const transportBox = (await page
      .getByRole('region', { name: 'Transport', exact: true })
      .boundingBox())!
    const tripBox = (await region.boundingBox())!
    expect(tripBox.y, 'the trip is after the transport').toBeGreaterThan(transportBox.y)

    // What the engine had been asked before anyone picked a station.
    const before = {
      map: received(engineHome, 'map.build'),
      graph: received(engineHome, 'graph.build'),
      plan: received(engineHome, 'export.plan'),
    }

    // US1 scenario 2: letters typed list the stations whose names hold
    // them, anywhere in the name, and the polite line counts them; focus
    // never leaves the field.
    const start = picker(page, START)
    await start.focus()
    await start.pressSequentially('a')
    const startList = page.getByRole('listbox', { name: START })
    await expect(startList.getByRole('option')).toHaveText(['Alpha', 'Bravo', 'Charlie'])
    await expect(start).toHaveAttribute('aria-expanded', 'true')
    await expect(region.getByRole('status').filter({ hasText: matchWords(3) })).toHaveCount(1)
    await start.fill('')
    await start.pressSequentially('lph')
    await expect(startList.getByRole('option')).toHaveText(['Alpha'])
    await expect(region.getByRole('status').filter({ hasText: matchWords(1) })).toHaveCount(1)
    await expect(start).toBeFocused()
    // Down highlights by aria-activedescendant, and focus stays in the field.
    await start.press('ArrowDown')
    // Waited for, then read, as the steps are: an attribute a render sets.
    await expect(start).toHaveAttribute('aria-activedescendant', /.+/)
    const active = await start.getAttribute('aria-activedescendant')
    expect(active).toBeTruthy()
    await expect(page.locator(`[id="${active}"]`)).toHaveText('Alpha')
    await expect(page.locator(`[id="${active}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect(start).toBeFocused()
    // Escape shuts the popup and leaves the typed text.
    await start.press('Escape')
    await expect(start).toHaveAttribute('aria-expanded', 'false')
    await expect(start).toHaveValue('lph')
    // Down opens it again, and Enter chooses.
    await start.press('ArrowDown')
    await start.press('Enter')
    await expect(start).toHaveValue('Alpha')
    await expect(start).toHaveAttribute('aria-expanded', 'false')
    await expect(start).toBeFocused()

    // Start alone sends nothing: the map is whole (US3 scenario 2).
    expect(await trips(app), 'Start alone asks the page nothing').toEqual([])

    // End completes the pair, and exactly one setTrip goes, for that pair:
    // not one a keystroke (SC-002).
    await chooseStation(page, END, 'char')
    await expect(picker(page, END)).toHaveValue('Charlie')
    await expect
      .poll(() => trips(app), { message: 'one setTrip for the pair', timeout: 20_000 })
      .toEqual([['setTrip', ALPHA, CHARLIE]])

    // The steps (FR-006), from the page's legs and the record's names.
    await expect(region.getByRole('listitem')).toHaveText([
      'At Alpha, board the A towards Charlie. Ride 2 stops to Charlie and get off.',
    ])
    // And the announcement, once (FR-007).
    await expect(region.locator('.trip-summary')).toHaveText('2 stops, no changes.')
    await expect(region.locator('.trip-summary')).toHaveAttribute('role', 'status')
    await expect(region.getByRole('button', { name: WHOLE_NETWORK })).toBeVisible()

    // Nothing of it reached the engine or the record (FR-001, FR-010).
    await page.waitForTimeout(1000)
    expect(await trips(app), 'still one call').toHaveLength(1)
    expect(received(engineHome, 'map.build'), 'no map was built').toBe(before.map)
    expect(received(engineHome, 'graph.build'), 'nothing was laid out').toBe(before.graph)
    expect(received(engineHome, 'export.plan'), 'no export was planned').toBe(before.plan)
    await expect(page.getByRole('button', { name: /^Jobs, / })).toHaveAccessibleName(
      'Jobs, none running',
    )
    for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const)
      await expect(cellHeading(page, id), id).toHaveAccessibleName(/ ready/)
    expect(JSON.stringify(readRecord(engineHome))).not.toContain('"trip"')
  })
})

test('"Show the whole network" and an emptied picker each send one setTrip(null)', async () => {
  test.setTimeout(TRIP_TIMEOUT)
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)
    const region = tripRegion(page)
    await chooseStation(page, START, 'alp')
    await chooseStation(page, END, 'cha')
    await expect.poll(() => trips(app), { timeout: 20_000 }).toEqual([['setTrip', ALPHA, CHARLIE]])
    const whole = region.getByRole('button', { name: WHOLE_NETWORK })
    await expect(whole).toBeVisible()

    // US3 scenario 1: one setTrip(null), both pickers empty, focus on
    // Start, and the button gone.
    await whole.click()
    await expect
      .poll(() => trips(app), { timeout: 20_000 })
      .toEqual([
        ['setTrip', ALPHA, CHARLIE],
        ['setTrip', null, null],
      ])
    await expect(picker(page, START)).toHaveValue('')
    await expect(picker(page, END)).toHaveValue('')
    await expect(picker(page, START)).toBeFocused()
    await expect(whole).toHaveCount(0)
    await expect(region.getByRole('listitem')).toHaveCount(0)

    // A trip again, and End emptied: one setTrip(null) more, and nothing
    // for the keystroke that emptied it beyond that.
    await chooseStation(page, START, 'bra')
    await chooseStation(page, END, 'alp')
    await expect.poll(async () => (await trips(app))?.length, { timeout: 20_000 }).toBe(3)
    expect((await trips(app))?.[2]).toEqual(['setTrip', BRAVO, ALPHA])
    await expect(region.getByRole('listitem')).toHaveText([
      'At Bravo, board the A towards Alpha. Ride 1 stop to Alpha and get off.',
    ])
    const end = picker(page, END)
    await end.focus()
    await end.fill('')
    await expect.poll(async () => (await trips(app))?.length, { timeout: 20_000 }).toBe(4)
    expect((await trips(app))?.[3]).toEqual(['setTrip', null, null])
    await page.waitForTimeout(1000)
    expect(await trips(app), 'no call twice').toHaveLength(4)
    await expect(region.getByRole('button', { name: WHOLE_NETWORK })).toHaveCount(0)
  })
})

test('the same station in both pickers is refused beside End, and nothing is sent', async () => {
  test.setTimeout(TRIP_TIMEOUT)
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)
    const region = tripRegion(page)
    await chooseStation(page, START, 'alp')
    await chooseStation(page, END, 'alp')
    // Refused where it was chosen, in an alert, and not taken: the field
    // shows what it held before, which was nothing.
    const end = picker(page, END)
    await expect(region.getByRole('alert').filter({ hasText: SAME_STATION })).toHaveCount(1)
    await expect(end).toHaveValue('')
    await expect(end).toHaveAttribute('aria-invalid', 'true')
    await expect(end).toHaveAccessibleDescription(SAME_STATION)
    await expect(end).not.toBeDisabled()
    await page.waitForTimeout(1000)
    expect(await trips(app), 'nothing was sent').toEqual([])
    // A station that differs is taken, and the refusal goes.
    await chooseStation(page, END, 'bra')
    await expect.poll(() => trips(app), { timeout: 20_000 }).toEqual([['setTrip', ALPHA, BRAVO]])
    await expect(region.getByRole('alert').filter({ hasText: SAME_STATION })).toHaveCount(0)
  })
})

test('a page a redraw reloaded is given its trip back between the labels and playing', async () => {
  test.setTimeout(TRIP_TIMEOUT)
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)
    const region = tripRegion(page)
    await chooseStation(page, START, 'alp')
    await chooseStation(page, END, 'cha')
    await expect.poll(() => trips(app), { timeout: 20_000 }).toEqual([['setTrip', ALPHA, CHARLIE]])
    // The steps as the stand-in page's answer draws them, waited for rather
    // than read: the call is recorded before its answer has come back and
    // the list has rendered, and a slow runner read an empty list here.
    const steps = ['At Alpha, board the A towards Charlie. Ride 2 stops to Charlie and get off.']
    await expect(region.getByRole('listitem')).toHaveText(steps)
    const frame = page.locator('iframe.viewer-frame')
    const address = await frame.getAttribute('src')

    // A rebuild for another day: the map is drawn again from the stored
    // layout and the frame is sent to the page it wrote. The document there
    // now is marked, so what is read afterwards is the new one's record and
    // never this one's, which holds the person's own setTrip already.
    await markDocument(app)
    const stop = keepStandInPage(engineHome)
    try {
      await page.getByLabel('Draw for another day').fill('2026-06-20')
      await page.getByRole('button', { name: 'Draw for this day' }).click()
      await expect(frame).not.toHaveAttribute('src', address ?? '', { timeout: 30_000 })
      // The new document's own record: the restore, in order.
      let calls: unknown[][] = []
      await expect
        .poll(
          async () => {
            calls = (await seenByNewDocument(app)) ?? []
            return calls.map((call) => call[0])
          },
          { timeout: 20_000, message: 'the reloaded page was given its trip back' },
        )
        .toContain('setTrip')
      const order = calls.map((call) => call[0])
      expect(order.indexOf('setLabels'), JSON.stringify(order)).toBeGreaterThan(-1)
      expect(order.indexOf('setTrip'), JSON.stringify(order)).toBeGreaterThan(
        order.indexOf('setLabels'),
      )
      expect(order.indexOf('setTrip'), JSON.stringify(order)).toBeGreaterThan(
        order.indexOf('showView'),
      )
      // Playing resumes after it, where the restore resumes it at all.
      const resumed = calls.findIndex((call) => call[0] === 'setPlaying' && call[1] === true)
      if (resumed !== -1) expect(order.indexOf('setTrip')).toBeLessThan(resumed)
      expect(calls.filter((call) => call[0] === 'setTrip')).toEqual([['setTrip', ALPHA, CHARLIE]])
    } finally {
      stop()
    }
    // The steps are unchanged (US4 scenario 1).
    await expect(region.getByRole('listitem')).toHaveText(steps)
    await expect(picker(page, START)).toHaveValue('Alpha')
    await expect(picker(page, END)).toHaveValue('Charlie')
  })
})

test('the page’s answers that are not a plain trip are said beside the pickers, and an unlisted station is not drawn', async () => {
  // Hand-made answers (FR-005, FR-011, US1 scenario 5, US2 scenario 3):
  // the stand-in's one line finds every trip, so the page is made to answer
  // what the real page answers on a real network.
  test.setTimeout(TRIP_TIMEOUT)
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)
    const region = tripRegion(page)
    const instead = region.locator('.trip-instead')
    const whole = region.getByRole('button', { name: WHOLE_NETWORK })

    // No trip, and the page's reason: said word for word as a sentence,
    // under the pickers, in the error colour; no steps and no button.
    await pageAnswers(app, {
      from: ALPHA,
      to: CHARLIE,
      legs: null,
      changes: 0,
      reason: 'no trip joins these stations',
    })
    await chooseStation(page, START, 'alp')
    await chooseStation(page, END, 'cha')
    await expect(instead).toHaveText('No trip joins these stations.')
    await expect(region.getByRole('listitem')).toHaveCount(0)
    await expect(whole).toHaveCount(0)
    await expect(region.locator('.trip-summary')).toHaveText('')

    // A trip with a caveat and lines hidden: the steps, then the caveat as a
    // sentence and the lines it avoided, quietly, under them.
    await pageAnswers(app, {
      from: ALPHA,
      to: BRAVO,
      legs: [{ line: 'A', towards: CHARLIE, board: ALPHA, alight: BRAVO, stops: 1 }],
      changes: 0,
      reason: "a stop on this trip is one the map's data says its line does not make",
      hidden: ['B'],
    })
    await chooseStation(page, END, 'bra')
    await expect(region.getByRole('listitem')).toHaveText([
      'At Alpha, board the A towards Charlie. Ride 1 stop to Bravo and get off.',
    ])
    await expect(region.locator('.trip-note')).toHaveText([
      "A stop on this trip is one the map's data says its line does not make.",
      'Avoids the lines you hid: B.',
    ])
    await expect(instead).toHaveText('')
    await expect(whole).toBeVisible()

    // A trip through a station the project does not list: refused with a
    // sentence, no steps, and the page told the whole network at once, so
    // the map is not left faded around steps nobody can read.
    await pageAnswers(app, {
      from: CHARLIE,
      to: BRAVO,
      legs: [{ line: 'A', towards: 'nowhere', board: CHARLIE, alight: BRAVO, stops: 1 }],
      changes: 0,
    })
    await chooseStation(page, START, 'cha')
    await expect(instead).toHaveText(UNLISTED_STATION)
    await expect(region.getByRole('listitem')).toHaveCount(0)
    await expect(whole).toHaveCount(0)
    await expect
      .poll(async () => (await trips(app))?.slice(-2), { timeout: 20_000 })
      .toEqual([
        ['setTrip', CHARLIE, BRAVO],
        ['setTrip', null, null],
      ])

    // A page with no setTrip at all: one from before engine v0.13.0.
    await pageAnswers(app, null)
    await chooseStation(page, START, 'alp')
    await expect(instead).toHaveText(OLD_PAGE)
    await expect(region.getByRole('listitem')).toHaveCount(0)

    // The page gains the method, as a redraw would give it one, and the
    // station already chosen, chosen again, asks again: which is what a
    // person told the trip could not be shown would try.
    const count = (await trips(app))?.length ?? -1
    await pageAnswers(app, {
      from: ALPHA,
      to: BRAVO,
      legs: [{ line: 'A', towards: CHARLIE, board: ALPHA, alight: BRAVO, stops: 1 }],
      changes: 0,
    })
    const end = picker(page, END)
    await expect(end).toHaveValue('Bravo')
    await end.focus()
    await end.press('ArrowDown')
    await end.press('ArrowDown')
    await end.press('Enter')
    await expect
      .poll(async () => (await trips(app))?.slice(count), { timeout: 20_000 })
      .toEqual([['setTrip', ALPHA, BRAVO]])
    await expect(region.getByRole('listitem')).toHaveText([
      'At Alpha, board the A towards Charlie. Ride 1 stop to Bravo and get off.',
    ])
    await expect(instead).toHaveText('')
  })
})

test('a choice made while a run holds the page is refused beside it, and the sentence goes with the run', async () => {
  test.setTimeout(TRIP_TIMEOUT)
  // Slow enough that the run is still going when the choice is made and
  // the page is read: the map build alone is eight stages of this, and a
  // run that ended early would have sent the frame to the stand-in
  // engine's own page, which has no record to read.
  const engineHome = home({ progress_delay_ms: 500 })
  await withApp(engineHome, async (page, app) => {
    await projectWithAPage(page, engineHome)
    const region = tripRegion(page)
    await chooseStation(page, START, 'alp')
    const held = tripRefusal({ laying: true, exporting: false }) as string
    // A laid-out project opens with cell 02 collapsed (`Notebook.tsx`), and
    // a collapsed cell's panel is hidden, so its "Lay out again" is not in
    // the tree until the cell is opened. It stays open for the run's own
    // "Laid out" below. The run in this session has finished, so the cell's
    // "Layout run" region is drawn for `openCell` to wait on.
    await openCell(page, 'process')
    await page.getByRole('button', { name: 'Lay out again', exact: true }).click()
    await expect(cellHeading(page, 'process')).toHaveAccessibleName(/ running/)
    await chooseStation(page, END, 'cha')
    const end = picker(page, END)
    await expect(region.getByRole('alert').filter({ hasText: held })).toHaveCount(1)
    await expect(end, 'not taken, and not disabled').toHaveValue('')
    await expect(end).not.toBeDisabled()
    expect(await trips(app), 'nothing was sent').toEqual([])
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(region.getByRole('alert').filter({ hasText: held })).toHaveCount(0)
  })
})
