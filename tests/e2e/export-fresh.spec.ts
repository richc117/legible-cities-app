// Every frame of an export proven fresh (app issue 100, engine v0.20.0), in
// the built app against the stand-in engine: the project's page is the
// captured stand-in, which draws its count of draws in a band under its stage
// as the engine's page does (`capturedStandInSource`). An export through cell
// 06 succeeds, and the frames it captured are the stage alone, the band
// cropped away; told to paint every step late, the same page fails the
// export with the capture's own sentence and leaves nothing behind.

import {
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
import { staleFrame } from '../../src/main/capture'
import { readPng, stripOf } from '../../src/main/capture-strip'
import { openCell } from '../support/project'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { capturedStandInSource, type CapturedStandInOptions } from '../support/standInPage'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

const REEL = 'la-metro-rail-instagram-reel.mp4'

interface Home {
  engineHome: string
  exportFolder: string
  /** Where the app keeps a copy of each export's captured frames (LEGIBLE_KEEP_FRAMES). */
  kept: string
}

function home(): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-export-fresh-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5 }),
  )
  const kept = join(dir, 'kept')
  mkdirSync(kept)
  return { engineHome, exportFolder: join(dir, 'exports'), kept }
}

const deliverable = (h: Home): string => join(h.exportFolder, 'Los Angeles', REEL)

/** What a running export leaves under the engine home, but for the folder's own mark. */
const framesLeft = (h: Home): string[] => {
  const dir = join(h.engineHome, 'frames')
  return existsSync(dir) ? readdirSync(dir).filter((name) => name !== '.legible-frames') : []
}

async function withApp(h: Home, run: (page: Page, app: ElectronApplication) => Promise<void>) {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_KEEP_FRAMES: h.kept,
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

/**
 * A laid-out project whose page is the captured stand-in: the layout run
 * writes the stand-in engine's placeholder page, and the stand-in goes over
 * it, at the name the export will ask for. Then cell 06.
 */
async function laidOutProject(page: Page, h: Home, options: CapturedStandInOptions) {
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
  writeFileSync(join(h.engineHome, 'out', id, 'la-metro-rail.html'), capturedStandInSource(options))
  await openCell(page, 'export')
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

const run = (page: Page) => page.getByRole('region', { name: 'Export run', exact: true })

test('an export of a page that draws its frame counter keeps every frame, the band cropped away', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, h, {})
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(
      run(page)
        .getByRole('status')
        .filter({ hasText: /^Exported / }),
    ).toBeVisible({
      timeout: 60_000,
    })
    expect(existsSync(deliverable(h)), 'the file is under the export folder').toBe(true)
    expect(framesLeft(h), 'the frames are gone').toEqual([])
  })
  // The stand-in engine plans the reel at half its size, at scale 1: 540 by
  // 960, which the shot was the band taller than.
  const [copy] = readdirSync(h.kept)
  const frames = readdirSync(join(h.kept, copy)).filter((n) => n.endsWith('.png'))
  expect(frames.length, 'a second of the reel').toBeGreaterThan(0)
  for (const name of frames) {
    const png = readPng(readFileSync(join(h.kept, copy, name)))
    expect([png.width, png.height], name).toEqual([540, 960])
    // The foot of a kept frame is the stage, not the band.
    expect(stripOf(png, png.height - 8), name).toBeNull()
  }
})

test('an export of a page that never paints its step fails with the capture’s sentence, and leaves nothing', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, h, { late: true })
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    // As the export's other failures are read (export.spec.ts): the sentence, anywhere on screen.
    await expect(page.getByText(staleFrame(1))).toBeVisible({ timeout: 60_000 })
    expect(existsSync(deliverable(h)), 'no file').toBe(false)
    expect(existsSync(deliverable(h) + '.json'), 'no sidecar').toBe(false)
    expect(framesLeft(h), 'no frames').toEqual([])
  })
})
