// The export in the built app, against the stand-in engine and the stand-in
// page: one click, the three stages on screen, a file and its sidecar under
// the export folder, and nothing left of the frames. The stand-in engine
// plans a short job for the animated stand-in page and encodes it in shape
// (five steps of progress, a file, a sidecar, a cancel that removes both),
// so the whole flow runs without ffmpeg or a feed; the real engine and the
// real page are the reel test's business (tests/e2e/reel.spec.ts).

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { KEEP_BOTH } from '../../src/renderer/src/notebook/outputWords'
import { exportLine, openCell, openProject } from '../support/project'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

const REEL = 'la-metro-rail-instagram-reel.mp4'

interface Home {
  engineHome: string
  exportFolder: string
}

/** An engine home with the stand-in's control file, and an export folder beside it. */
function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-export-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5, ...control }),
  )
  return { engineHome, exportFolder: join(dir, 'exports') }
}

const deliverable = (h: Home): string => join(h.exportFolder, 'Los Angeles', REEL)

/**
 * What a running export leaves under the engine home, if anything. The
 * marker that says the folder is the app's is not a leftover: it is what
 * lets the sweep empty this folder and refuse one it did not make
 * (src/main/frames.ts).
 */
const framesLeft = (h: Home): string[] => {
  const dir = join(h.engineHome, 'frames')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name !== '.legible-frames') : []
}

function launch(h: Home, extra: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...extra,
    } as Record<string, string>,
    timeout: 30_000,
  })
}

async function ready(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
  return page
}

async function withApp(
  h: Home,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await launch(h)
  try {
    await run(await ready(app), app)
  } finally {
    await app.close()
  }
}

/**
 * The export's button, in cell 06 (A5-01; the Export tab until A5.5-08). The
 * cell is opened first; the button was "Export reel" while the reel was the
 * only thing it made.
 */
function exportButton(page: Page) {
  return page.getByRole('button', { name: 'Export', exact: true })
}

/**
 * A laid-out project whose page is the stand-in that animates: the layout
 * run writes the stand-in engine's placeholder page, and the fixture goes
 * over it, at the name the export will ask for.
 */
async function laidOutProject(page: Page, h: Home): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const entry = page.getByRole('button', { name: 'Open Los Angeles' })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
  await page.getByRole('button', { name: /^lay out( again)?$/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))
  // The export is cell 06 of the notebook, and starts on the reel with the
  // engine's defaults, which is what the one button made.
  await openCell(page, 'export')
  await expect(exportButton(page)).toBeVisible({ timeout: 20_000 })
}

test('exports the reel from one click: three stages, a file, its sidecar, and no path on screen', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOutProject(page, h)
    // The reveal is the one thing here the operating system does; it is
    // replaced so the test can see what it was asked to show.
    await app.evaluate(({ shell }) => {
      const seen: string[] = []
      ;(globalThis as { __revealed?: string[] }).__revealed = seen
      shell.showItemInFolder = (path: string) => {
        seen.push(path)
      }
    })

    await exportButton(page).click()
    const run = page.getByRole('region', { name: 'Export run', exact: true })
    await expect(run).toBeVisible()
    for (const stage of ['plan', 'capture', 'encode']) {
      await expect(run.getByText(stage, { exact: true })).toBeVisible()
    }
    await expect(run.getByText(/^Exported /)).toBeVisible({ timeout: 45_000 })
    await expect(run.getByText(/^Exported /)).toHaveText(`Exported ${REEL}.`)

    const file = deliverable(h)
    expect(existsSync(file), 'the file is under the export folder').toBe(true)
    const sidecar = JSON.parse(readFileSync(file + '.json', 'utf8')) as Record<string, unknown>
    expect(sidecar.file).toBe(REEL)
    // The fields the engine's own sidecar carries, which the stand-in's
    // matches (`_write_sidecar` at the pinned tag).
    expect(sidecar.preset).toBe('instagram-reel')
    expect(sidecar.size).toBe('1080x1920')
    const [id] = readdirSync(join(h.engineHome, 'projects'))
    const record = JSON.parse(
      readFileSync(join(h.engineHome, 'projects', id, 'project.json'), 'utf8'),
    ) as { date: string; drawn: { date: string } }
    // The day the page was drawn for, which is what the frames show. Not
    // `record.date`, which since A5.5-15 may be a day chosen and not yet
    // drawn: comparing against that would pass while the sidecar named a
    // day the picture does not have in it.
    expect(sidecar.service_date, 'the day the exported page was drawn for').toBe(record.drawn.date)
    expect(record.drawn.date, 'and here nothing has moved since the draw').toBe(record.date)
    expect(framesLeft(h), 'the frames are gone').toEqual([])

    // Nothing on the screen is a path; the reveal is how the file is found.
    expect(await run.innerText()).not.toMatch(/[/\\]/)
    // Scoped to the export's own region: the rail's Outputs list carries a
    // Reveal per row as well (A5.5-21), so an unscoped name matches two.
    await run.getByRole('button', { name: 'Reveal' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __revealed?: string[] }).__revealed))
      .toEqual([file])
  })
})

// Issue 545: the rail's Outputs row is dated by its sidecar, and an export
// over a file of the same name replaces that sidecar. The walk that raised
// this showed the old date after "Exported"; the code reads the folder
// again on `done`, which is after the engine has moved the sidecar into
// place, and the walk's own screenshot shows the new date. This is the
// test that says so on every run.
//
// The first export's sidecar is put back to 2020 and the project reopened,
// so the row on screen reads that date and no read has happened since;
// the second export then has to move it, with no reload, as soon as the
// run says it is done. The mutation to watch it fail under: take
// `runState` out of the effect's dependencies in `Outputs.tsx`.
test('Outputs dates a re-exported file by the new export, with no reload', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(
      page.getByRole('region', { name: 'Export run', exact: true }).getByText(/^Exported /),
    ).toHaveText(`Exported ${REEL}.`, {
      timeout: 45_000,
    })
    const sidecar = `${deliverable(h)}.json`
    const long = new Date('2020-01-01T12:00:00Z')
    utimesSync(sidecar, long, long)

    // The screen mounted afresh reads the folder: the row says 2020.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    const made = page.getByRole('region', { name: 'Outputs' }).locator('time[datetime^="2020"]')
    await expect(made).toHaveCount(1)

    await openCell(page, 'export')
    await expect(exportButton(page)).toBeVisible({ timeout: 20_000 })
    await exportButton(page).click()
    // The run belongs to the project and outlives the trip to the Library,
    // so "Exported" is on screen from the start and says nothing about this
    // export. The sidecar moving past 2020 is the engine having put the new
    // one in place; the row has to follow it, and that is asserted next.
    await expect
      .poll(() => statSync(sidecar).mtimeMs, { timeout: 45_000 })
      .toBeGreaterThan(long.getTime())
    // Within the expectation's own deadline, and with no reload, no way
    // back to the Library and no press: the run's `done` is the only thing
    // that can make the list read again.
    await expect(made).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('region', { name: 'Outputs' }).locator('time')).toHaveCount(1)
  })
})

// Issue 563: the names are deterministic, so a second export of one preset
// replaces the first, and cell 06 says so beside Export before the press:
// which file, when it was made, and that a filename tag keeps both. The
// sidecar is dated 2020 and the project reopened, so the moment on screen is
// the folder's and not this session's; nothing is said before the first
// export, and Export is described by the line. Written, not run.
test('a second export of one preset says, before the press, what it replaces', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    const replaces = page.locator('#export-replaces')
    await expect(replaces, 'nothing to replace before the first export').toHaveCount(0)
    await exportButton(page).click()
    await expect(
      page.getByRole('region', { name: 'Export run', exact: true }).getByText(/^Exported /),
    ).toHaveText(`Exported ${REEL}.`, { timeout: 45_000 })

    const sidecar = `${deliverable(h)}.json`
    const long = new Date('2020-01-01T12:00:00Z')
    utimesSync(sidecar, long, long)
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    await openCell(page, 'export')
    await expect(exportButton(page)).toBeVisible({ timeout: 20_000 })

    // The moment is written in the machine's own locale and zone, so the
    // words around it are asserted and the moment by its exact value.
    await expect(replaces).toContainText(`Exporting replaces ${REEL}, made `, { timeout: 20_000 })
    await expect(replaces).toContainText(KEEP_BOTH)
    await expect(replaces.locator('time')).toHaveAttribute('datetime', long.toISOString())
    await expect(exportButton(page)).toHaveAccessibleDescription(
      new RegExp(`^Exporting replaces ${REEL.replace(/\./g, '\\.')}, made .+\\. ${KEEP_BOTH}$`),
    )

    // A file that has gone is replaced by nothing, and the line goes with it.
    rmSync(deliverable(h))
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    await openCell(page, 'export')
    await expect(exportButton(page)).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('region', { name: 'Outputs' })).toContainText('moved or deleted')
    await expect(replaces).toHaveCount(0)
  })
})

// The invariant A5.5-15 broke, with an export over the gap it opens: the
// capture navigates to the page the last draw wrote, so a day chosen and
// not drawn must not reach the plan or the sidecar. Stale never blocks an
// export (ADR-045), so nothing stops a person doing exactly this.
test('exports the day the page was drawn for, not a day chosen and not yet drawn', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    const record = (): { date: string; drawn: { date: string } } => {
      const [id] = readdirSync(join(h.engineHome, 'projects'))
      return JSON.parse(readFileSync(join(h.engineHome, 'projects', id, 'project.json'), 'utf8'))
    }
    const drawnDay = record().drawn.date

    // Choose another day and draw nothing for it.
    const frame = await openCell(page, 'frame')
    await frame.getByLabel('Draw for another day').fill('2026-06-20')
    await expect.poll(() => record().date).toBe('2026-06-20')
    expect(record().drawn.date, 'the page is still the day it was drawn for').toBe(drawnDay)
    await openCell(page, 'export')

    await exportButton(page).click()
    // What this waits for is the run's own line saying the export finished,
    // not any text on the screen beginning "Exported": cell 06's provenance
    // strip has an `Exported` term of its own since A5.5-11, and a page-wide
    // match resolves to both. The line is shown and not a live region since
    // issue 570, so it is read by its class.
    await expect(
      page
        .getByRole('region', { name: 'Export run', exact: true })
        .locator('p.prose', { hasText: /^Exported / }),
    ).toBeVisible({ timeout: 60_000 })
    const sidecar = JSON.parse(readFileSync(deliverable(h) + '.json', 'utf8')) as Record<
      string,
      unknown
    >
    expect(
      sidecar.service_date,
      'the sidecar names the day in the picture, not the day on the record',
    ).toBe(drawnDay)
    expect(record().date, 'and the choice is untouched by the export').toBe('2026-06-20')
  })
})

test('cancelled during the capture: nothing written, no frames left, and it can run again', async () => {
  const h = home({ export_seconds: 8 })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(exportLine(page, /^Captur/)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(existsSync(deliverable(h))).toBe(false)
    expect(framesLeft(h)).toEqual([])
    await expect(exportButton(page)).toBeVisible()
  })
})

/**
 * Until the stand-in's encode has written its first step: the page shows
 * "Encoded <n> of <m> frames." only from the encode's first `job/progress`,
 * which the stand-in sends after it has written that step (`encode` in
 * tests/fake-engine/schematic/serve.py). "Encoding <m> frames." is the main
 * process's own sentence as the stage starts, before the engine has done
 * anything, so a Cancel pressed on it can land before any write at all and
 * prove nothing about what a write leaves.
 */
async function encodedAStep(page: Page): Promise<void> {
  await expect(exportLine(page, /^Encoded \d+ of \d+ frames\./)).toBeVisible({ timeout: 30_000 })
}

// Since engine v0.18.0 (its issue 79) the encode writes the file and its
// sidecar beside the destination as `.part` files, and a cancel before they
// are moved into place removes those and nothing else, so what is checked
// is that no `.part` is left as well as that nothing reached the
// destination. Cancel is pressed once a `.part` is on disk, so there is one
// for the cancel to remove.
//
// The mutation it is to be watched failing under: the stand-in's `remove()`
// inside `encode` made a no-op (its body `pass`), so a cancel leaves the
// `.part` it wrote.
test('cancelled during the encode: no partial file and no sidecar', async () => {
  const h = home({ encode_delay_ms: 600 })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await encodedAStep(page)
    await expect
      .poll(() => existsSync(deliverable(h) + '.part'), {
        timeout: 20_000,
        message: 'the stand-in has written a step of the file under its .part name',
      })
      .toBe(true)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(existsSync(deliverable(h))).toBe(false)
    expect(existsSync(deliverable(h) + '.json')).toBe(false)
    expect(existsSync(deliverable(h) + '.part'), 'no .part of the file is left').toBe(false)
    expect(existsSync(deliverable(h) + '.json.part'), 'nor of its sidecar').toBe(false)
    expect(framesLeft(h)).toEqual([])
  })
})

// A later export of the same options replaces an earlier one by design, so
// before engine v0.18.0 a re-export that was cancelled - or failed - took the
// earlier file and its sidecar with it: the encode truncated the destination
// as it began, and its cleanup removed both (engine issue 79). Now the
// earlier export is as it was.
//
// Cancel is pressed once the stand-in has written a step (`encodedAStep`),
// so a write exists for the earlier export to survive.
//
// The mutation it is to be watched failing under: the stand-in's encode
// writing its partial file to the destination itself (`dest.write_bytes`
// for `part.write_bytes` in the step loop of `encode`,
// tests/fake-engine/schematic/serve.py), as the engine did before - the
// earlier file is then truncated by the first step, before the cancel.
test('a re-export cancelled during the encode leaves the earlier export as it was', async () => {
  const h = home({ encode_delay_ms: 600 })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    mkdirSync(join(h.exportFolder, 'Los Angeles'), { recursive: true })
    writeFileSync(deliverable(h), 'the earlier export')
    const earlierSidecar = JSON.stringify({ file: REEL, preset: 'instagram-reel' })
    writeFileSync(deliverable(h) + '.json', earlierSidecar)
    await exportButton(page).click()
    await encodedAStep(page)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(readFileSync(deliverable(h), 'utf8'), 'the earlier file').toBe('the earlier export')
    expect(readFileSync(deliverable(h) + '.json', 'utf8'), 'and its sidecar').toBe(earlierSidecar)
    expect(existsSync(deliverable(h) + '.part')).toBe(false)
    expect(existsSync(deliverable(h) + '.json.part')).toBe(false)
    expect(framesLeft(h)).toEqual([])
  })
})

// Engine v0.18.0 (its issues 79 and 80): the encode writes the file and its
// sidecar as `.part` files beside the destination and moves them into place
// once whole, and a cancel that comes after that move is too late. The
// engine answers the result with `cancel_too_late`, both files are at the
// destination, and the export is finished: the file named, the reveal
// offered, and the run saying it was kept rather than that it was
// cancelled. The stand-in's `cancel_too_late` control has the encode wait,
// once both files are in place, for the cancel pressed below.
//
// Written, not run, by the lane that added it (issue 423). The mutations it
// is to be watched failing under: the field left unread in the main
// process (`const late = false` in src/main/export.ts) - the run then says
// "Exported" with no word of the cancel; and a cancel looked at after the
// encode's answer (`this.#stopIfCancelled(control)` after the
// `export.encode` request) - the run then says the export was cancelled
// over a file on disk.
test('cancelled during the encode after the file was in place: the export finishes and says so', async () => {
  test.setTimeout(120_000)
  const h = home({ cancel_too_late: { 'export.encode': 20_000 } })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    const run = page.getByRole('region', { name: 'Export run', exact: true })
    // Both files are in place, and the stand-in is waiting for the cancel.
    await expect.poll(() => existsSync(deliverable(h) + '.json'), { timeout: 45_000 }).toBe(true)
    await run.getByRole('button', { name: 'Cancel' }).click()
    await expect(
      exportLine(page, 'The export was already written when you cancelled; it is kept.'),
    ).toBeVisible({ timeout: 20_000 })
    await expect(run.locator('p.prose', { hasText: /^Exported / })).toHaveText(`Exported ${REEL}.`)
    await expect(run.getByRole('button', { name: 'Reveal' })).toBeVisible()
    await expect(run.getByText(/was cancelled/i)).toHaveCount(0)
    expect(existsSync(deliverable(h)), 'the file is at the destination').toBe(true)
    const sidecar = JSON.parse(readFileSync(deliverable(h) + '.json', 'utf8')) as {
      file: string
    }
    expect(sidecar.file).toBe(REEL)
    expect(existsSync(deliverable(h) + '.part'), 'no .part is left').toBe(false)
    expect(existsSync(deliverable(h) + '.json.part')).toBe(false)
    expect(framesLeft(h), 'the frames are gone').toEqual([])
    const cancels = readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
      .split('\n')
      .filter((line) => line.includes('"$/cancelRequest"'))
    expect(cancels, 'the cancel reached the engine').toHaveLength(1)
  })
})

// A failure while the encode runs no longer says "Nothing was written."
// outright (engine v0.18.0, its issue 79): the one failure the engine
// documents that leaves something, the sidecar's own move after the
// file's, leaves the new file beside the sidecar the folder had, and the
// page cannot tell which failure it was. The stand-in's failure is before
// the moves, so nothing is at the destination and no `.part` is left.
test("a failed encode shows the engine's own sentence and leaves nothing", async () => {
  const h = home({ encode_fails: true })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(exportLine(page, /^the stand-in could not encode/)).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByText(
        'Export again to write the file and its sidecar together. Nothing was written, unless the file reached its folder before its sidecar could.',
      ),
    ).toBeVisible()
    expect(existsSync(deliverable(h))).toBe(false)
    expect(existsSync(deliverable(h) + '.part')).toBe(false)
    expect(existsSync(deliverable(h) + '.json.part')).toBe(false)
    expect(framesLeft(h)).toEqual([])
  })
})

test('a quit mid-export leaves nothing, and a start clears what a crash would have left', async () => {
  const h = home({ export_seconds: 10 })
  const app = await launch(h)
  const page = await ready(app)
  await laidOutProject(page, h)
  await exportButton(page).click()
  await expect(exportLine(page, /^Captur/)).toBeVisible({ timeout: 20_000 })
  await app.close()
  expect(existsSync(deliverable(h))).toBe(false)

  // What a crash would leave: a frames folder nobody will ask for again.
  // The app made this one - an export has run against this home - so the
  // marker is there and the sweep may empty it.
  mkdirSync(join(h.engineHome, 'frames', 'stale'), { recursive: true })
  writeFileSync(join(h.engineHome, 'frames', 'stale', '000000.png'), 'png')
  await withApp(h, async () => {
    expect(framesLeft(h)).toEqual([])
  })
})

// Closing the app's window during an export (issue 537). The export's
// offscreen capture window is a window too, and the quit and the Dock icon
// used to count every window: on Windows and Linux the app sat windowless
// until the capture ended and then quit, cancelling the export at its encode
// with nothing said; on macOS no window came back from the Dock until then.
// The app's own window decides now. Both tests close the app's window with
// the capture running, and tell it from the capture window by its address.

/** Close the app's own window, not the capture's. */
function closeAppWindow(app: ElectronApplication): Promise<void> {
  return app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.webContents.getURL().startsWith('app://local/ui/')) window.close()
  })
}

test('closing the window during an export quits at once, on Windows and Linux, and leaves nothing', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps running with no window')
  // Long enough that the export is certainly still running when the window
  // closes, whatever the machine.
  // The stand-in takes a moment to leave once asked, so a quit that did not
  // wait for the stop would be gone before the supervisor's line is written.
  const h = home({ export_seconds: 120, shutdown_delay_ms: 800 })
  // A profile of this test's own, so its logs are the only ones read below
  // (LEGIBLE_USER_DATA moves the logs with it, src/main/index.ts).
  const userData = join(dirname(h.engineHome), 'profile')
  const app = await launch(h, { LEGIBLE_USER_DATA: userData })
  // Taken now: the application object is disposed once the process is gone.
  const child = app.process()
  try {
    const page = await ready(app)
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(exportLine(page, /^Captur/)).toBeVisible({ timeout: 20_000 })
    // The capture window is open, as the old rule counted it.
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length),
    ).toBeGreaterThan(1)

    await closeAppWindow(app)
    // Well inside the capture's 120 seconds: the quit is the window's, not
    // the capture's end. A deadline, and the process's own exit.
    await expect
      .poll(() => child.exitCode !== null || child.signalCode !== null, {
        timeout: 15_000,
        message: 'the process quit when its window closed, though a capture window was open',
      })
      .toBe(true)
    expect(existsSync(deliverable(h))).toBe(false)
    expect(existsSync(deliverable(h) + '.part')).toBe(false)
    expect(framesLeft(h), 'no frames are left').toEqual([])
    // The supervisor stopped the engine before the app let go: its own line,
    // written only when the stop ran to its end (FR-014). A close that
    // quit twice used to leave with the stop half done and no such line.
    const engineLog = join(userData, 'logs', 'engine.log')
    expect(existsSync(engineLog), 'the engine log was written').toBe(true)
    expect(readFileSync(engineLog, 'utf8')).toMatch(/ended on (request \(quit\)|terminate)/)
  } finally {
    await app.close().catch(() => undefined)
  }
})

test('closing the window during an export on macOS keeps the export going, and the Dock brings a window back', async () => {
  test.skip(process.platform !== 'darwin', 'Windows and Linux quit with their window')
  const h = home({ export_seconds: 6 })
  await withApp(h, async (page, app) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(exportLine(page, /^Captur/)).toBeVisible({ timeout: 20_000 })

    await closeAppWindow(app)
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((w) =>
            w.webContents.getURL().startsWith('app://local/ui/'),
          ),
        ),
      )
      .toBe(false)

    // The Dock icon, while the capture window is still open.
    const reopened = app.waitForEvent('window', { timeout: 15_000 })
    await app.evaluate(({ app: electron }) => {
      electron.emit('activate')
    })
    await reopened
    // The window exists before its page is asked for, so its address is
    // empty for a moment: on a loaded runner, longer than one read.
    await expect
      .poll(
        () =>
          app.evaluate(
            ({ BrowserWindow }) =>
              BrowserWindow.getAllWindows().filter((w) =>
                w.webContents.getURL().startsWith('app://local/ui/'),
              ).length,
          ),
        { timeout: 15_000, message: 'one window of the interface came back' },
      )
      .toBe(1)

    // And the export, which nothing cancelled, finishes into its folder.
    await expect
      .poll(() => existsSync(deliverable(h)), {
        timeout: 60_000,
        message: 'the export finished with no window of the app open for a while',
      })
      .toBe(true)
    // The frames go in the exporter's finally, after the encode has answered.
    await expect.poll(() => framesLeft(h)).toEqual([])
  })
})
