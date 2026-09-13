// Determinism, as the constitution states it (principle III): the same
// project, exported twice, agrees within the published threshold, and a test
// says so (A5-04). The project is the committed BART fixture - the feed and
// a stored layout - with a page the real engine draws from that layout; the
// app, against the real engine at the pin and the vendored ffmpeg, exports
// its draft `instagram-reel-gif` through the Export tab twice.
//
// The verdict is the capture's. The app keeps each export's captured frames
// (LEGIBLE_KEEP_FRAMES, which this test sets and a packaged app ignores), and
// the two captures must have the same frames, compared one by one in RGB
// with a channel tolerance of 8 - never RGBA, never exact equality - and must
// move: the first and last captured frames differ by more than the
// tolerance. The layout must not have moved either: the record's id and
// made, the stored set's meta and stage files, and the engine's own record
// of what it was asked, which must hold two export.encode and no graph.build.
// No node count appears anywhere in it (ADR-019).
//
// The delivered GIFs are checked for their structure only: both there, the
// preset's size, the captured number of frames each, and not trivially
// small. Their pixels are compared and logged, never asserted, because the
// engine's GIF encode does not preserve the tolerance: it builds one palette
// from every captured frame (palettegen=stats_mode=diff), so differences
// below 8 in a few captured pixels move palette entries, and with them
// colours in every frame, by far more than 8. Measured on 12 September 2026:
// five runs whose captures agreed within the tolerance every time gave GIFs
// that differed past it in four. That is the engine's to fix (engine issue
// 33, richc117/legible-cities#33), not a capture this app can make steadier.
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
// scheduled job that skipped would read as green. The per-frame report is
// captured-frames.json among the test's results, beside the two GIFs.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
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
import {
  channelsOver,
  compareCaptured,
  compareDecoded,
  decodedEnds,
  decodeImage,
  neighbours,
  probeSize,
  TOLERANCE,
} from '../support/frames'

const OPTED_IN = process.env.LEGIBLE_DETERMINISM_TEST === '1'
const PYTHON = process.env.LEGIBLE_ENGINE_PYTHON ?? ''
const FFMPEG = process.env.SCHEMATIC_FFMPEG ?? ''

/** The preset's size at draft quality (scale 1), from the pinned engine's preset table. */
const WIDTH = 630
const HEIGHT = 1120
const FILE = `${FEED}-instagram-reel-gif.gif`
/** Smaller than this, a GIF of a hundred frames of a map holds next to nothing. */
const GIF_MIN_BYTES = 64 * 1024

test.skip(!OPTED_IN, 'opt in with LEGIBLE_DETERMINISM_TEST=1; it takes minutes')

const exportPanel = (page: Page): Locator => page.getByRole('tabpanel', { name: 'Export' })

test('the same project, exported twice, captures the same frames within the tolerance, from the same stored layout', async () => {
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
  // Where the app keeps each export's captured frames, one folder per export.
  const kept = join(dir, 'captured')
  mkdirSync(kept)
  const evidence = testInfo.outputPath('evidence')

  seedHome(engineHome)
  const { record, trips } = await prepareProject(PYTHON, engineHome)
  // A page with no trains animates nothing, and two exports of nothing agree.
  expect(trips, 'trips the engine drew on the page').toBeGreaterThan(0)
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
      // In development only, the app copies each export's captured frames here.
      LEGIBLE_KEEP_FRAMES: kept,
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
      // Kept with the test's results at once, so whatever fails after this
      // point uploads the file it failed on.
      mkdirSync(testInfo.outputDir, { recursive: true })
      copyFileSync(file, join(testInfo.outputDir, keep))
      const sidecar = JSON.parse(readFileSync(`${file}.json`, 'utf8')) as Record<string, unknown>
      // The stored layout has not moved: not in the record, not on disk.
      expect(layoutDrift(before, layoutSnapshot(engineHome)), 'the layout moved').toEqual([])
      expect(sidecar.preset).toBe('instagram-reel-gif')
      expect(sidecar.service_date).toBe(record.date)
      // The pinned engine's sidecar carries no layout id; the record and
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

    // The capture: what principle III's rule is about. Everything is measured
    // and written down first, so a failure reports all of it.
    const runs = readdirSync(kept).sort()
    expect(runs, 'one kept frames folder per export').toHaveLength(2)
    const [ka, kb] = runs.map((name) => join(kept, name))
    // Beside ffmpeg, by name, as the engine finds it (export.ffprobe_path).
    const ffprobe = join(dirname(FFMPEG), basename(FFMPEG).replace('ffmpeg', 'ffprobe'))
    const captured = await compareCaptured(ka, kb, { ffmpeg: FFMPEG, ffprobe })
    const differing = captured.frames.filter((f) => f.pixels > 0)
    const size =
      captured.framesA > 0
        ? await probeSize(ffprobe, join(ka, '000000.png'))
        : { width: 0, height: 0 }
    // The first and last captured frames, when there are two to compare; the
    // verdict below says so when there are not.
    let capturedMoved = 0
    if (captured.framesA > 1) {
      const lastName = `${String(captured.framesA - 1).padStart(6, '0')}.png`
      const capturedFirst = await decodeImage(join(ka, '000000.png'), { ffmpeg: FFMPEG })
      const capturedLast = await decodeImage(join(ka, lastName), { ffmpeg: FFMPEG })
      capturedMoved = channelsOver(capturedFirst, capturedLast)
    }
    // Whether a differing frame is the other run's frame before or after it:
    // the signature of a capture that took the last painted frame.
    const near = await neighbours(
      ka,
      kb,
      differing.map((f) => f.frame),
      size.width,
      { ffmpeg: FFMPEG, count: Math.min(captured.framesA, captured.framesB) },
    )

    // The delivered GIFs: structure, and their pixels for information only.
    const a = join(dir, 'first.gif')
    const b = join(dir, 'second.gif')
    const frameBytes = WIDTH * HEIGHT * 3
    const gifSizes = [await probeSize(ffprobe, a), await probeSize(ffprobe, b)]
    const gifEnds = [
      await decodedEnds(a, frameBytes, { ffmpeg: FFMPEG }),
      await decodedEnds(b, frameBytes, { ffmpeg: FFMPEG }),
    ]
    const gifMoved =
      gifEnds[0].first !== null && gifEnds[0].last !== null
        ? channelsOver(gifEnds[0].first, gifEnds[0].last)
        : 0
    // Never asserted: the engine's palette quantisation turns differences
    // below the tolerance in the capture into differences far above it in
    // every frame of the GIF (see the top of this file).
    const gif = await compareDecoded(a, b, { ffmpeg: FFMPEG, frameBytes })

    mkdirSync(testInfo.outputDir, { recursive: true })
    writeFileSync(
      join(testInfo.outputDir, 'captured-frames.json'),
      JSON.stringify(
        {
          tolerance: TOLERANCE,
          captured: { ...captured, size, differing: differing.length, moved: capturedMoved },
          neighbours: near,
          gif: {
            bytes: [statSync(a).size, statSync(b).size],
            identical: readFileSync(a).equals(readFileSync(b)),
            sizes: gifSizes,
            frames: gifEnds.map((e) => e.frames),
            moved: gifMoved,
            comparison: gif,
          },
        },
        null,
        2,
      ),
    )
    console.log(
      `captured frames: ${captured.framesA} and ${captured.framesB} at ${size.width}x${size.height}; ` +
        `${captured.identicalFiles} PNG files byte-identical; ${differing.length} frames with a ` +
        `pixel over ${TOLERANCE}; ${capturedMoved} channels over ${TOLERANCE} between the first ` +
        `and last captured frames` +
        differing
          .slice(0, 20)
          .map(
            (f) =>
              `\n  frame ${f.frame}: ${f.pixels} pixels, max ${f.maxDiff}, ` +
              `x ${f.box?.x0}-${f.box?.x1}, y ${f.box?.y0}-${f.box?.y1}`,
          )
          .join(''),
    )
    for (const n of near)
      console.log(
        `  frame ${n.frame} against the other run: A vs B[-1,0,+1] ` +
          `${n.aAgainstB.before},${n.aAgainstB.same},${n.aAgainstB.after}; ` +
          `B vs A[-1,0,+1] ${n.bAgainstA.before},${n.bAgainstA.same},${n.bAgainstA.after} pixels`,
      )
    console.log(
      `GIFs, for information and never the verdict: ${statSync(a).size} and ${statSync(b).size} ` +
        `bytes, byte-identical: ${readFileSync(a).equals(readFileSync(b))}; ${gif.frames} frames; ` +
        `max channel difference ${gif.maxDiff}, ${gif.over} channels over ${TOLERANCE} in ` +
        `${gif.differing.length} frames; ${gifMoved} channels over ${TOLERANCE} between the ` +
        `first GIF's first and last frames`,
    )
    const pairs = join(evidence, 'captured')
    mkdirSync(pairs, { recursive: true })
    for (const f of differing.slice(0, 12)) {
      const name = `${String(f.frame).padStart(6, '0')}.png`
      copyFileSync(join(ka, name), join(pairs, `first-${name}`))
      copyFileSync(join(kb, name), join(pairs, `second-${name}`))
    }

    // The verdict: the two captures agree within the tolerance, and move.
    expect(captured.framesA, 'frames captured').toBeGreaterThan(1)
    expect(captured.framesB, 'the same number of captured frames').toBe(captured.framesA)
    expect(captured.frames, 'every captured frame compared').toHaveLength(captured.framesA)
    expect(
      differing.map((f) => f.frame),
      `captured frames with a channel differing by more than ${TOLERANCE}`,
    ).toEqual([])
    expect(capturedMoved, 'the capture moves: its first and last frames differ').toBeGreaterThan(0)

    // The GIFs' structure.
    for (const [i, file] of [a, b].entries()) {
      expect(gifSizes[i], `${basename(file)} is the preset's size`).toEqual({
        width: WIDTH,
        height: HEIGHT,
      })
      expect(gifEnds[i].frames, `${basename(file)} holds the captured frames`).toBe(
        captured.framesA,
      )
      expect(statSync(file).size, `${basename(file)} is not trivially small`).toBeGreaterThan(
        GIF_MIN_BYTES,
      )
    }
    expect(gif.bytes % frameBytes, 'the GIFs decode to whole frames').toBe(0)
    expect(gifMoved, 'the GIF moves: its first and last frames differ').toBeGreaterThan(0)
  } finally {
    console.log(`determinism test: ${Math.round((Date.now() - started) / 1000)} s in all`)
    await app.close()
  }
  // Kept when the test fails, for a person to look at; gone when it passed.
  rmSync(dir, { recursive: true, force: true })
})
