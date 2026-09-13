// Determinism, as the constitution states it (principle III): the same
// project, exported twice, agrees within the published threshold, and a test
// says so (A5-04). The project is the committed BART fixture - the feed and
// a stored layout - with a page the real engine draws from that layout; the
// app, against the real engine at the pin and the vendored ffmpeg, exports
// its draft `instagram-reel-gif` through the Export tab twice. The two GIFs
// are decoded and compared frame by frame in RGB with a channel tolerance of
// 8, never RGBA and never exact equality, and the layout is checked not to
// have moved: the record's id and made, the stored set's meta, and the
// engine's own record of what it was asked, which must hold no graph.build.
// No node count appears anywhere in it (ADR-019).
//
// Opt-in, and never in the ci workflow: it needs the engine and ffmpeg, and
// takes minutes. `.github/workflows/determinism.yml` runs it on three
// platforms, once per pull request and five times a week.
//
//   LEGIBLE_DETERMINISM_TEST=1 \
//   LEGIBLE_ENGINE_PYTHON=<interpreter with the pinned engine> \
//   SCHEMATIC_FFMPEG=<ffmpeg, with ffprobe beside it> \
//   npx playwright test tests/e2e/determinism.spec.ts
//
// Opted in, a missing interpreter or ffmpeg fails rather than skips: a
// scheduled job that skipped would read as green.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import {
  FEED,
  PROJECT_NAME,
  REQUESTS_SHIM,
  layoutDrift,
  layoutSnapshot,
  prepareProject,
  requestsLog,
  requestsReceived,
  seedHome,
} from '../support/determinism'
import { compareDecoded, extractFrames, TOLERANCE } from '../support/frames'

const OPTED_IN = process.env.LEGIBLE_DETERMINISM_TEST === '1'
const PYTHON = process.env.LEGIBLE_ENGINE_PYTHON ?? ''
const FFMPEG = process.env.SCHEMATIC_FFMPEG ?? ''

/** The preset's size at draft quality (scale 1), as the engine's table has it at v0.8.2. */
const WIDTH = 630
const HEIGHT = 1120
const FILE = `${FEED}-instagram-reel-gif.gif`

test.skip(!OPTED_IN, 'opt in with LEGIBLE_DETERMINISM_TEST=1; it takes minutes')

const exportPanel = (page: Page): Locator => page.getByRole('tabpanel', { name: 'Export' })

test('the same project, exported twice, decodes to the same frames within the tolerance, from the same stored layout', async () => {
  test.setTimeout(45 * 60_000)
  const testInfo = test.info()
  expect(PYTHON, 'LEGIBLE_ENGINE_PYTHON names an interpreter with the pinned engine').not.toBe('')
  expect(existsSync(PYTHON), 'LEGIBLE_ENGINE_PYTHON exists').toBe(true)
  expect(FFMPEG, 'SCHEMATIC_FFMPEG names the vendored ffmpeg').not.toBe('')
  expect(existsSync(FFMPEG), 'SCHEMATIC_FFMPEG exists').toBe(true)

  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-determinism-'))
  const userData = join(dir, 'profile')
  const engineHome = join(dir, 'engine')
  const exportFolder = join(dir, 'exports')
  const evidence = testInfo.outputPath('evidence')

  seedHome(engineHome)
  const record = await prepareProject(PYTHON, engineHome)
  const before = layoutSnapshot(engineHome)
  expect(before.layout).toBe(record.layout)
  expect(layoutDrift(before, before)).toEqual([])
  // Only what the app sends from here on is in the engine's record.
  rmSync(requestsLog(engineHome), { force: true })

  const app = await electron.launch({
    args: ['.'],
    cwd: join(__dirname, '../..'),
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_USER_DATA: userData,
      LEGIBLE_EXPORT_FOLDER: exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON,
      SCHEMATIC_FFMPEG: FFMPEG,
      // In development only, the app passes this to the engine, and Python
      // imports the shim in it at start: it records each request's method.
      PYTHONPATH: REQUESTS_SHIM,
    } as Record<string, string>,
    timeout: 60_000,
  })
  const started = Date.now()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 150_000,
    })
    await page.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROJECT_NAME)
    await page.getByRole('tab', { name: 'Export' }).click()
    const panel = exportPanel(page)
    await expect(panel.getByRole('combobox', { name: 'Preset' })).toHaveValue(
      'instagram-reel-gif',
      { timeout: 60_000 },
    )
    await expect(panel.getByRole('combobox', { name: 'Quality' })).toHaveValue('draft')
    // The preview has answered: the map's frame is at the preset's frame.
    await expect
      .poll(
        async () =>
          new URL(
            (await page.locator('iframe.viewer-frame').getAttribute('src')) ?? 'x:/',
          ).searchParams.get('frame'),
        { timeout: 60_000 },
      )
      .toBe(`${WIDTH}:${HEIGHT}`)

    const file = join(exportFolder, PROJECT_NAME, FILE)
    const ended = panel.getByText(/^Exported |Nothing was written|The engine stopped/)
    const exportOnce = async (keep: string): Promise<Record<string, unknown>> => {
      const t0 = Date.now()
      const button = panel.getByRole('button', { name: 'Export', exact: true })
      await expect(button).toBeEnabled({ timeout: 60_000 })
      await button.click()
      // The sentence from the export before goes as this one starts; it
      // cannot be missed, since a capture of a hundred frames takes seconds.
      await expect(ended).toBeHidden({ timeout: 60_000 })
      await expect(ended).toBeVisible({ timeout: 20 * 60_000 })
      await expect(ended).toHaveText(`Exported ${FILE}.`)
      console.log(`export ${keep}: ${Math.round((Date.now() - t0) / 1000)} s`)
      expect(existsSync(file)).toBe(true)
      copyFileSync(file, join(dir, keep))
      const sidecar = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Record<string, unknown>
      // The stored layout has not moved: not in the record, not on disk.
      expect(layoutDrift(before, layoutSnapshot(engineHome)), 'the layout moved').toEqual([])
      expect(sidecar.preset).toBe('instagram-reel-gif')
      expect(sidecar.service_date).toBe(record.date)
      // At v0.8.2 the engine's sidecar carries no layout id; the record and
      // the stored set are what say which layout drew the file. Should the
      // engine add one, it must be the project's.
      if ('layout' in sidecar) expect(sidecar.layout).toBe(record.layout)
      return sidecar
    }

    const first = await exportOnce('first.gif')
    const second = await exportOnce('second.gif')
    // The two sidecars agree, apart from the files' sizes.
    const withoutBytes = (sidecar: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(sidecar).filter(([key]) => key !== 'bytes'))
    expect(withoutBytes(second), 'the two sidecars agree').toEqual(withoutBytes(first))

    // What the engine was asked while the app ran: two exports, and no
    // layout. The export requests are asserted too, so an empty record
    // cannot pass for a clean one.
    const received = requestsReceived(engineHome)
    expect(
      received.filter((m) => m === 'export.encode'),
      'export.encode requests',
    ).toHaveLength(2)
    expect(received, 'the engine was never asked to lay the network out').not.toContain(
      'graph.build',
    )

    const a = join(dir, 'first.gif')
    const b = join(dir, 'second.gif')
    mkdirSync(testInfo.outputDir, { recursive: true })
    copyFileSync(a, join(testInfo.outputDir, 'first.gif'))
    copyFileSync(b, join(testInfo.outputDir, 'second.gif'))
    const frameBytes = WIDTH * HEIGHT * 3
    const result = await compareDecoded(a, b, { ffmpeg: FFMPEG, frameBytes })
    const identical = readFileSync(a).equals(readFileSync(b))
    console.log(
      `${statSync(a).size} and ${statSync(b).size} bytes; files byte-identical: ${identical}; ` +
        `${result.frames} frames, ${result.bytes} decoded bytes, max channel difference ` +
        `${result.maxDiff}, ${result.over} channels over ${TOLERANCE} in ` +
        `${result.differing.length} frames`,
    )
    if (result.differing.length > 0) {
      // Evidence for a person, never the verdict: a frame that cannot be
      // extracted is logged, and the comparison below still fails the test.
      try {
        await extractFrames(a, result.differing, evidence, 'first', { ffmpeg: FFMPEG })
        await extractFrames(b, result.differing, evidence, 'second', { ffmpeg: FFMPEG })
      } catch (error) {
        console.log(`the differing frames could not be extracted: ${String(error)}`)
      }
    }
    expect(result.bytes % frameBytes, 'the decoded bytes are whole frames').toBe(0)
    expect(result.frames, 'frames decoded').toBeGreaterThan(1)
    expect(result.sameLength, 'the same number of frames').toBe(true)
    expect(result.differing, `frames with a channel differing by more than ${TOLERANCE}`).toEqual(
      [],
    )
    expect(result.over, `channels differing by more than ${TOLERANCE}`).toBe(0)
  } finally {
    console.log(`determinism test: ${Math.round((Date.now() - started) / 1000)} s in all`)
    await app.close()
  }
  // Kept when the test fails, for a person to look at; gone when it passed.
  rmSync(dir, { recursive: true, force: true })
})
