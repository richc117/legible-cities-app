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
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
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

function launch(h: Home): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
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
 * The export's button, on the export tab (A5-01). The tab is opened first;
 * the button was "Export reel" while the reel was the only thing it made.
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
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))
  // The export lives on its own tab of the project panel, and starts on the
  // reel with the engine's defaults, which is what the one button made.
  await page.getByRole('tab', { name: 'Export' }).click()
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
    const run = page.getByRole('region', { name: 'Export' })
    await expect(run).toBeVisible()
    for (const stage of ['plan', 'capture', 'encode']) {
      await expect(run.getByText(stage, { exact: true })).toBeVisible()
    }
    await expect(page.getByText(/^Exported /)).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(/^Exported /)).toHaveText(`Exported ${REEL}.`)

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
    ) as { date: string }
    expect(sidecar.service_date, "the project's own service day").toBe(record.date)
    expect(framesLeft(h), 'the frames are gone').toEqual([])

    // Nothing on the screen is a path; the reveal is how the file is found.
    expect(await run.innerText()).not.toMatch(/[/\\]/)
    await page.getByRole('button', { name: 'Reveal' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as { __revealed?: string[] }).__revealed))
      .toEqual([file])
  })
})

test('cancelled during the capture: nothing written, no frames left, and it can run again', async () => {
  const h = home({ export_seconds: 8 })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(page.getByText(/^Captur/)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(existsSync(deliverable(h))).toBe(false)
    expect(framesLeft(h)).toEqual([])
    await expect(exportButton(page)).toBeVisible()
  })
})

test('cancelled during the encode: no partial file and no sidecar', async () => {
  const h = home({ encode_delay_ms: 600 })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(page.getByText(/^Encod/)).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText(/was cancelled/i)).toBeVisible({ timeout: 20_000 })
    expect(existsSync(deliverable(h))).toBe(false)
    expect(existsSync(deliverable(h) + '.json')).toBe(false)
    expect(framesLeft(h)).toEqual([])
  })
})

test("a failed encode shows the engine's own sentence and leaves nothing", async () => {
  const h = home({ encode_fails: true })
  await withApp(h, async (page) => {
    await laidOutProject(page, h)
    await exportButton(page).click()
    await expect(page.getByText('the stand-in could not encode')).toBeVisible({
      timeout: 30_000,
    })
    await expect(page.getByText('Nothing was written.')).toBeVisible()
    expect(existsSync(deliverable(h))).toBe(false)
    expect(framesLeft(h)).toEqual([])
  })
})

test('a quit mid-export leaves nothing, and a start clears what a crash would have left', async () => {
  const h = home({ export_seconds: 10 })
  const app = await launch(h)
  const page = await ready(app)
  await laidOutProject(page, h)
  await exportButton(page).click()
  await expect(page.getByText(/^Captur/)).toBeVisible({ timeout: 20_000 })
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
