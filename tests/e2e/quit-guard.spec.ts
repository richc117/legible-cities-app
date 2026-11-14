// Asking before a quit or a close throws a run away (issue 552,
// specs/039-quit-guard, SC-002), in the built app against the stand-in
// engine. The rule, the guard and the dialog each have unit tests; these are
// what only the running app shows: that a real quit is held, that the page's
// dialog is what holds it, that the run goes on behind it, and that going
// ahead leaves what a quit always left - no process, no frames, an engine
// that was stopped and not abandoned.
//
// A quit is asked for as the menu's Quit asks (`app.quit()` in the main
// process, which is also all Playwright's `app.close()` does), and the
// window is closed as its close button closes it. Every wait is a deadline.
// Each launch has a profile of its own (`LEGIBLE_USER_DATA`): the app writes
// its window's place there as it closes, and its logs are read from it.
//
// The mutations these are to be watched failing under need the built app, so
// they are the coordinator's to run; each test names its own.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
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
import { exportLine, openCell, openProject } from '../support/project'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  askToQuit,
  hasExited,
  pressAndLetTheWindowGo,
  quitApp,
  untilAnswerable,
} from '../support/quit'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

// Each test launches once, lays a project out and holds a run: more than the
// suite's minute on a loaded runner.
test.setTimeout(180_000)

const REEL = 'la-metro-rail-instagram-reel.mp4'

// Long enough that a run is certainly still going at every step of a test,
// whatever the machine: a capture of nine thousand frames, and a layout held
// in the engine for longer than the test may take (and for less than the
// supervisor's ten minutes without progress, which would end it).
//
// The stand-in also takes a moment to leave once asked, as it does for the
// test of a window closed during an export (export.spec.ts): the app does not
// wait for a cancelled export's frames to be removed before it goes - a start
// sweeps what a quit left - so the removal is given the length of the
// engine's stop, and "no frames are left" can be read the moment the process
// has gone. Two seconds, inside the three the supervisor gives the engine to
// leave when asked: these tests capture for longer than that one before
// they quit, so there is more to remove.
const HELD_EXPORT = { export_seconds: 300, shutdown_delay_ms: 2_000 }
const HELD_LAYOUT = { octi_child: true, octi_ms: 240_000 }

interface Home {
  engineHome: string
  exportFolder: string
  userData: string
}

function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-quit-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5, ...control }),
  )
  return { engineHome, exportFolder: join(dir, 'exports'), userData: join(dir, 'profile') }
}

function launch(h: Home): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_USER_DATA: h.userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
}

/**
 * The app, ready, for one test; closed afterwards whatever it is running,
 * and whether or not the test has already seen it go.
 */
async function withApp(
  h: Home,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await launch(h)
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await run(page, app)
  } finally {
    await quitApp(app).catch(() => undefined)
  }
}

async function openNewProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible()
  await openProject(page, name)
}

const layOutButton = (page: Page): Locator =>
  page.getByRole('button', { name: /^lay out( again)?$/i })

/** A project called Los Angeles, laid out, exporting its reel, and caught in the capture. */
async function exporting(page: Page, h: Home): Promise<void> {
  await openNewProject(page, 'Los Angeles')
  await layOutButton(page).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  // The export captures an animated page; the stand-in's own is a placeholder.
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))
  const cell = await openCell(page, 'export')
  await expect(cell.getByRole('combobox', { name: 'Preset' })).toBeVisible({ timeout: 20_000 })
  await cell.getByRole('button', { name: 'Export', exact: true }).click()
  await expect(exportLine(page, /^Captured \d+ of \d+ frames\./)).toBeVisible({ timeout: 30_000 })
}

/** A project called Los Angeles whose layout run is held in the engine. */
async function layingOut(page: Page): Promise<void> {
  await openNewProject(page, 'Los Angeles')
  await layOutButton(page).click()
  await expect(jobsToggle(page)).toHaveAccessibleName('Jobs, 1 running', { timeout: 20_000 })
}

const jobsToggle = (page: Page): Locator => page.getByRole('button', { name: /^Jobs, / })

const deliverable = (h: Home): string => join(h.exportFolder, 'Los Angeles', REEL)

/** What a running export has under the engine home; the marker that says the folder is the app's is not a leftover. */
const framesLeft = (h: Home): string[] => {
  const dir = join(h.engineHome, 'frames')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name !== '.legible-frames') : []
}

/** The frames the capture has taken, as the export's line says. */
async function captured(page: Page): Promise<number> {
  const said = await exportLine(page, /^Captured \d+ of \d+ frames\./).innerText()
  return Number(/^Captured (\d+) of/.exec(said)?.[1] ?? -1)
}

/** The capture is still taking frames: the count the line says goes up. */
async function captureGoesOn(page: Page, what: string): Promise<void> {
  const at = await captured(page)
  await expect.poll(() => captured(page), { timeout: 30_000, message: what }).toBeGreaterThan(at)
}

/** The one record's fields a layout run writes when it finishes. */
function laidOutFields(h: Home): Record<string, unknown> {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  const record = JSON.parse(
    readFileSync(join(h.engineHome, 'projects', id, 'project.json'), 'utf8'),
  ) as Record<string, unknown>
  return { layout: record.layout, made: record.made, drawn: record.drawn, date: record.date }
}

/** The interface's own windows open, never the export's capture window. */
const appWindows = (app: ElectronApplication): Promise<number> =>
  app.evaluate(
    ({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().filter((w) =>
        w.webContents.getURL().startsWith('app://local/ui/'),
      ).length,
  )

/** Close the app's own window as its close button does, not the capture's. */
function closeAppWindow(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.webContents.getURL().startsWith('app://local/ui/')) window.close()
  })
}

/** The question on the screen, by its title; its sentence is its description. */
async function question(page: Page, title: string, sentence: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: title, exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleDescription(sentence)
  return dialog
}

const button = (within: Locator | Page, name: string): Locator =>
  within.getByRole('button', { name, exact: true })

/** The process has gone, well inside the time a held run would have kept it. */
async function exits(child: ReturnType<ElectronApplication['process']>, what: string) {
  await expect.poll(() => hasExited(child), { timeout: 20_000, message: what }).toBe(true)
}

/** The supervisor's own line, written only when the engine's stop ran to its end (specs/004, FR-014). */
function engineWasStopped(h: Home): void {
  const engineLog = join(h.userData, 'logs', 'engine.log')
  expect(existsSync(engineLog), 'the engine log was written').toBe(true)
  expect(readFileSync(engineLog, 'utf8')).toMatch(/ended on (request \(quit\)|terminate)/)
}

// Mutations to watch this fail under, in the built app: `quitGuard.beforeQuit`
// made to return false in `onBeforeQuit` (src/main/quit-guard.ts) - the first
// quit goes ahead and no dialog is found; `stop` taken out of the `shutDown`
// that index.ts hands `onBeforeQuit` - the engine's log has no line of a stop.
test('a quit during an export asks first: Keep working keeps it, Quit anyway quits and leaves nothing', async () => {
  const h = home(HELD_EXPORT)
  await withApp(h, async (page, app) => {
    // Taken now: the application object is disposed once the process is gone.
    const child = app.process()
    await exporting(page, h)

    await askToQuit(app)
    const asked = await question(
      page,
      'Quit while an export is running?',
      'The export of Los Angeles has not finished. Quitting stops it, and nothing of it is kept.',
    )
    await expect(button(asked, 'Keep working')).toBeFocused()
    await expect(button(asked, 'Quit anyway')).toBeVisible()
    await expect(asked.getByRole('button')).toHaveCount(2)
    expect(hasExited(child), 'the app did not quit').toBe(false)

    await button(asked, 'Keep working').click()
    await expect(asked).toBeHidden()
    expect(hasExited(child)).toBe(false)
    // The export goes on as if nothing had happened: its Cancel is still
    // offered, its frames are still there, and the capture is still counting.
    await expect(
      page.getByRole('region', { name: 'Export run', exact: true }).getByRole('button', {
        name: 'Cancel',
      }),
    ).toBeVisible()
    expect(framesLeft(h)).toHaveLength(1)
    await captureGoesOn(page, 'the capture went on after Keep working')

    await askToQuit(app)
    const again = await question(
      page,
      'Quit while an export is running?',
      'The export of Los Angeles has not finished. Quitting stops it, and nothing of it is kept.',
    )
    await expect(button(again, 'Keep working')).toBeFocused()
    await button(again, 'Quit anyway').click()

    await exits(child, 'the app quit once the person said Quit anyway')
    expect(existsSync(deliverable(h)), 'nothing of the export is kept').toBe(false)
    expect(existsSync(deliverable(h) + '.part')).toBe(false)
    expect(framesLeft(h), 'no frames are left').toEqual([])
    // The quit that was confirmed is the quit the app always made: the
    // engine was stopped before the app let go.
    engineWasStopped(h)
  })
})

// Mutation: `if (facts.open !== null) return …` taken out of `quitQuestion`
// (src/main/window-lifecycle.ts) - the second quit is asked about again, and
// the process is still there at the deadline. That a second quit which comes
// sooner than a second is held is the unit table's: in the built app "sooner"
// is a race with the machine.
test('a second quit, once the question has been open a second, is an answer, and quits', async () => {
  const h = home(HELD_EXPORT)
  await withApp(h, async (page, app) => {
    const child = app.process()
    await exporting(page, h)

    await askToQuit(app)
    await expect(
      page.getByRole('dialog', { name: 'Quit while an export is running?', exact: true }),
    ).toBeVisible()
    // Seen now, so asked no later than now: old enough once this has passed.
    await untilAnswerable(Date.now())
    expect(hasExited(child), 'the app waited for an answer meanwhile').toBe(false)
    await askToQuit(app).catch(() => undefined)

    await exits(child, 'the app quit at the second quit, with the question unanswered')
    expect(existsSync(deliverable(h))).toBe(false)
    expect(framesLeft(h), 'no frames are left').toEqual([])
    engineWasStopped(h)
  })
})

// Mutation: the report taken out of `QuitDialog.tsx` (`reportRunningLayouts`
// not called) - main never hears of the layout, the quit goes ahead, and no
// dialog is found.
test('a quit during a layout asks first: Keep working keeps it, Quit anyway quits and writes nothing', async () => {
  const h = home(HELD_LAYOUT)
  await withApp(h, async (page, app) => {
    const child = app.process()
    await layingOut(page)
    const before = laidOutFields(h)

    await askToQuit(app)
    const asked = await question(
      page,
      'Quit while a layout is running?',
      'The layout of Los Angeles has not finished. Quitting stops it, and nothing of it is kept.',
    )
    await expect(button(asked, 'Keep working')).toBeFocused()
    expect(hasExited(child), 'the app did not quit').toBe(false)

    // Escape answers Keep working.
    await page.keyboard.press('Escape')
    await expect(asked).toBeHidden()
    expect(hasExited(child)).toBe(false)
    await expect(jobsToggle(page), 'the layout is still running').toHaveAccessibleName(
      'Jobs, 1 running',
    )
    await expect(
      page.getByRole('region', { name: 'Layout run', exact: true }).getByRole('button', {
        name: 'Cancel',
        exact: true,
      }),
    ).toBeVisible()

    await askToQuit(app)
    const again = await question(
      page,
      'Quit while a layout is running?',
      'The layout of Los Angeles has not finished. Quitting stops it, and nothing of it is kept.',
    )
    await button(again, 'Quit anyway').click()

    await exits(child, 'the app quit once the person said Quit anyway')
    expect(laidOutFields(h), 'a layout that never finished wrote nothing').toEqual(before)
    engineWasStopped(h)
  })
})

// Mutation: `[...named.values()]` made `[...named.values()].reverse()` in
// `quitQuestion` - the sentence names Bart before Los Angeles, which started
// first.
test('a quit during two runs counts them and names each project once, in the order they started', async () => {
  const h = home(HELD_LAYOUT)
  await withApp(h, async (page, app) => {
    const child = app.process()
    await layingOut(page)
    // A run outlives the screen that started it: a second project, laid out
    // while the first still is.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openNewProject(page, 'Bart')
    await layOutButton(page).click()
    await expect(jobsToggle(page)).toHaveAccessibleName('Jobs, 2 running', { timeout: 20_000 })

    await askToQuit(app)
    const asked = await question(
      page,
      'Quit while 2 runs are going?',
      'The runs of Los Angeles and Bart have not finished. Quitting stops them, and nothing of them is kept.',
    )
    await expect(button(asked, 'Keep working')).toBeFocused()
    await button(asked, 'Quit anyway').click()
    await exits(child, 'the app quit once the person said Quit anyway')
    engineWasStopped(h)
  })
})

// Mutations: the `close` handler in index.ts made to keep the window's place
// and nothing else (`onAppWindowClose` not consulted) - the window closes at
// the first close and no dialog is found; `stopExports` taken out of the
// guard's `answer` and the `runsToStop` loop out of `QuitDialog.tsx` - on
// macOS the frames folder is still there at the deadline.
test('closing the window during an export asks first: Keep working keeps it, Close anyway stops the export', async () => {
  const h = home(HELD_EXPORT)
  await withApp(h, async (page, app) => {
    const child = app.process()
    await exporting(page, h)

    await closeAppWindow(app)
    const asked = await question(
      page,
      'Close while an export is running?',
      'The export of Los Angeles has not finished. Closing stops it, and nothing of it is kept.',
    )
    await expect(button(asked, 'Keep working')).toBeFocused()
    await expect(button(asked, 'Close anyway')).toBeVisible()
    expect(await appWindows(app), 'the window did not close').toBe(1)

    await button(asked, 'Keep working').click()
    await expect(asked).toBeHidden()
    expect(await appWindows(app)).toBe(1)
    expect(framesLeft(h)).toHaveLength(1)
    await captureGoesOn(page, 'the capture went on after Keep working')

    await closeAppWindow(app)
    const again = await question(
      page,
      'Close while an export is running?',
      'The export of Los Angeles has not finished. Closing stops it, and nothing of it is kept.',
    )
    // The press closes the window it is in.
    await pressAndLetTheWindowGo(button(again, 'Close anyway'))

    if (process.platform === 'darwin') {
      // The app stays running with no window, as its apps do, and nothing of
      // the export goes on: its frames are removed, and it never arrives.
      await expect
        .poll(() => appWindows(app), { timeout: 20_000, message: 'the window closed' })
        .toBe(0)
      await expect
        .poll(() => framesLeft(h), { timeout: 20_000, message: 'the export was stopped' })
        .toEqual([])
      expect(hasExited(child), 'the app is still running, with no window').toBe(false)
      // Asked again with nothing running and no page to ask: it quits.
      await askToQuit(app).catch(() => undefined)
      await exits(child, 'the app quit when asked, with no window and nothing running')
    } else {
      // The app quits with its window, as it does when nothing is running,
      // and is not asked a second time on the way out.
      await exits(child, 'the app quit when its window closed')
      expect(framesLeft(h), 'no frames are left').toEqual([])
      engineWasStopped(h)
    }
    expect(existsSync(deliverable(h)), 'nothing of the export is kept').toBe(false)
    expect(existsSync(deliverable(h) + '.part')).toBe(false)
  })
})

// Mutation: `if (runs.length === 0) return GO_AHEAD` taken out of
// `quitQuestion` - the idle quit is held behind a question about no run, and
// the process is still there at the deadline.
test('quitting with nothing running shows no dialog and quits at once', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    const child = app.process()
    // A layout that ran and finished is not a run any more.
    await openNewProject(page, 'Los Angeles')
    await layOutButton(page).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(jobsToggle(page)).toHaveAccessibleName('Jobs, none running')
    await expect(page.locator('dialog[open]')).toHaveCount(0)

    // The app can be gone before it has said the quit was asked for.
    await askToQuit(app).catch(() => undefined)
    // One quit, and no answer from anybody: had the app asked, it would
    // still be here at the deadline.
    await exits(child, 'the app quit at the one quit, with nothing asked')
    engineWasStopped(h)
  })
})

// Mutation: as for the idle quit, at the window's close.
test('closing the window with nothing running closes it at once', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    const child = app.process()
    await expect(page.locator('dialog[open]')).toHaveCount(0)
    await closeAppWindow(app)
    if (process.platform === 'darwin') {
      await expect
        .poll(() => appWindows(app), { timeout: 20_000, message: 'the window closed unasked' })
        .toBe(0)
      expect(hasExited(child), 'macOS keeps running with no window').toBe(false)
    } else {
      await exits(child, 'the app quit with its window, unasked')
    }
  })
})

// A quit while another dialog is open: the question opens over it, and the
// dialog behind has focus back when the question is answered. Mutation: the
// `<QuitDialog />` taken out of `App.tsx` - the quit goes ahead, since no
// page listens, and no question is found.
test('the question opens over a dialog that is already open, and hands focus back to it', async () => {
  const h = home(HELD_EXPORT)
  await withApp(h, async (page, app) => {
    const child = app.process()
    await exporting(page, h)
    // The export outlives the screen that started it; the New project sheet
    // is a modal dialog of the Library's.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'New project' }).click()
    const sheet = page.getByRole('dialog', { name: 'New project' })
    await expect(sheet).toBeVisible()
    const name = sheet.getByLabel('Name', { exact: true })
    await name.focus()

    await askToQuit(app)
    const asked = await question(
      page,
      'Quit while an export is running?',
      'The export of Los Angeles has not finished. Quitting stops it, and nothing of it is kept.',
    )
    await expect(button(asked, 'Keep working')).toBeFocused()
    await expect(sheet, 'the sheet is still open behind the question').toBeVisible()

    await button(asked, 'Keep working').click()
    await expect(asked).toBeHidden()
    await expect(sheet).toBeVisible()
    await expect(name, 'focus is back where it was, in the sheet').toBeFocused()
    expect(hasExited(child)).toBe(false)
  })
})
