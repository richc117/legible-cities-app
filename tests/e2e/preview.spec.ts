// The pinned preview, and the frame held by identity (A5.5-20, ADR-045,
// docs/DESIGN.md 8.2, "The pinned preview").
//
// Two things only a running app shows, and they are the two this issue is
// about.
//
// **The frame is one element.** Moving an iframe between parents reloads
// it, and so does remounting it, which is what a `key` on `<Viewer>` used
// to do after every run. Nothing here reads the source: the element itself
// is stamped with a property React cannot see, the screen is then scrolled,
// its cells opened and collapsed and its map re-laid out, and the stamp is
// read back. A stamp that survives all of it is the same element.
//
// **A navigation that has to happen gives the page back.** The export's
// preview takes the frame while cell 06 is open (A5-01), which is a real
// navigation of the plain map away and back again. The page is asked what
// it was showing before it goes and told again when it returns, so the
// clock, the view and the labels are where they were - which is engine
// issue 29's class of problem, and the thing the scrub in cell 03 would
// otherwise make visible.
//
// The boundary itself is `viewer.spec.ts`'s, and is not restated here: the
// frame carries `sandbox="allow-scripts"` and nothing else, and every route
// out of it is asserted there.

import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
import { cellHeading, closeCell, laidOutProject, openCell } from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Home {
  engineHome: string
  userData: string
  exportFolder: string
}

function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-preview-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5, ...control }),
  )
  // A user-data folder of this test's own, so nothing here writes the
  // profile every other end-to-end file shares.
  return { engineHome, userData: join(dir, 'profile'), exportFolder: join(dir, 'exports') }
}

async function withApp(
  h: Home,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_USER_DATA: h.userData,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    await run(await app.firstWindow(), app)
  } finally {
    await app.close()
    rmSync(h.engineHome, { recursive: true, force: true })
  }
}

/**
 * A page with the seam the app drives, in place of the one the stand-in
 * engine writes (which is `{}`, and answers nothing).
 *
 * Its clock moves only when it is seeked. The real page runs at sixty
 * service-seconds a second, which would make "where the clock was" a moving
 * target and this test a stopwatch; what is being measured is whether the
 * value read before a navigation is the value set after it.
 */
const mapPage = (): string =>
  [
    '<!doctype html><meta charset="utf-8"><title>stand-in map</title><body>',
    '<script>',
    'var now = 0, viewName = "schematic", labels = true, playing = true, speed = 60;',
    'window.__present = {',
    '  seek: function (sec) { now = sec },',
    '  showView: function (name) { viewName = name },',
    '  setLabels: function (on) { labels = !!on },',
    '  setPlaying: function (on) { playing = !!on },',
    '  setSpeed: function (x) { speed = x },',
    '  setRoutes: function () {},',
    '  hasGeo: function () { return true },',
    '  bounds: function () { return { t0: 0, t1: 86400 } },',
    // The shape the engine's own page answers, and no more of it: `now`,
    // `viewName` and `labels` are what a restore has to work from.
    '  state: function () { return { now: now, clock: "07:00", viewName: viewName,',
    '                               labels: labels, speed: speed, playing: playing } },',
    '};',
    '</script></body>',
  ].join('\n')

/** Put that page where the engine wrote its own, for every page of a project. */
function standInPage(h: Home): void {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  const out = join(h.engineHome, 'out', id)
  for (const name of readdirSync(out).filter((n) => n.endsWith('.html')))
    writeFileSync(join(out, name), mapPage())
}

const frame = (page: Page): ReturnType<Page['locator']> => page.locator('iframe.viewer-frame')
const preview = (page: Page): ReturnType<Page['locator']> => page.locator('.preview')

/** One of the page's own methods, through the bridge, as the interface asks. */
const drive = (page: Page, method: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(
    ([m, a]) =>
      (
        globalThis as unknown as {
          api: { viewer: { call(m: string, ...a: unknown[]): Promise<unknown> } }
        }
      ).api.viewer.call(m as string, ...(a as unknown[])),
    [method, args] as [string, unknown[]],
  )

/**
 * Mark the frame element itself. A property, not an attribute: React never
 * sees it, and it goes the moment the element does - which is exactly what
 * is being asked about.
 */
const STAMP = '__a55520'
const markFrame = (page: Page): Promise<void> =>
  frame(page).evaluate((el, key) => {
    ;(el as unknown as Record<string, unknown>)[key] = 'the same frame'
  }, STAMP)
const markOnFrame = (page: Page): Promise<unknown> =>
  frame(page).evaluate((el, key) => (el as unknown as Record<string, unknown>)[key] ?? null, STAMP)

test('the frame is one element across a scroll, a cell toggling and a redraw', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await expect(frame(page)).toHaveCount(1)
    await markFrame(page)

    // Scrolled to the foot of the notebook and back. The preview is pinned
    // with CSS and stays where it is; nothing is moved between parents.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(markOnFrame(page)).resolves.toBe('the same frame')
    await page.evaluate(() => window.scrollTo(0, 0))

    // A cell opening and a cell collapsing, above the frame and below it.
    await openCell(page, 'export')
    await closeCell(page, 'export')
    await closeCell(page, 'data')
    await openCell(page, 'data')
    await expect(markOnFrame(page)).resolves.toBe('the same frame')

    // A redraw: the run rewrites the page file, so the frame is sent to it
    // deliberately - and the element it is sent from is the element it was.
    // This is what `key={drawn}` used to do by throwing the element away.
    const before = await frame(page).getAttribute('src')
    await page.getByRole('button', { name: 'Lay out again', exact: true }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 60_000 })
    await expect(frame(page)).not.toHaveAttribute('src', before ?? '', { timeout: 30_000 })
    await expect(frame(page)).toHaveCount(1)
    await expect(markOnFrame(page)).resolves.toBe('the same frame')
  })
})

test('the map comes back to its clock, view and labels when the export takes the frame and gives it back', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    standInPage(h)
    // Out of the project and in again, so the frame loads the page just
    // written rather than the one the stand-in engine wrote.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(frame(page)).toBeVisible()
    await expect.poll(() => drive(page, 'state')).toMatchObject({ viewName: 'schematic' })
    await markFrame(page)

    // Where a person left the map: a time scrubbed to, a view chosen and
    // the labels turned off.
    await drive(page, 'seek', 30_600)
    await drive(page, 'showView', 'time')
    await drive(page, 'setLabels', false)

    // Cell 06 opens and the engine's plan takes the frame (A5-01). That is
    // a navigation, and the page that arrives is a new document.
    await openCell(page, 'export')
    await expect(frame(page)).toHaveAttribute('src', /frame=/, { timeout: 60_000 })
    await expect.poll(() => drive(page, 'state')).toMatchObject({ now: 0 })

    // And closing it hands the frame back to the plain map, which is where
    // it was left rather than where a fresh document starts.
    await closeCell(page, 'export')
    await expect(frame(page)).toHaveAttribute('src', /controls=1/, { timeout: 60_000 })
    await expect
      .poll(() => drive(page, 'state'), { timeout: 30_000 })
      .toMatchObject({ viewName: 'time', labels: false })
    const state = (await drive(page, 'state')) as { now: number }
    expect(Math.abs(state.now - 30_600), 'the clock came back to within a second').toBeLessThan(1)

    // All of it on the one element.
    await expect(markOnFrame(page)).resolves.toBe('the same frame')
  })
})

test('the preview is pinned under the header, and above the cells at every width', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await expect(preview(page)).toBeVisible()

    // Pinned by the stylesheet alone, from the top of the column: sticky,
    // and offset by exactly the header's own height.
    const pinned = await preview(page).evaluate((el) => {
      const style = getComputedStyle(el)
      const header = document.querySelector('.app-header')
      return {
        position: style.position,
        top: style.top,
        headerHeight: header === null ? null : `${header.getBoundingClientRect().height}px`,
      }
    })
    expect(pinned.position).toBe('sticky')
    // The header's height and the rule under it: a pixel less and the
    // pinned map covers that rule, and it is on the header's own layer.
    expect(pinned.top).toBe(pinned.headerHeight)

    // A band, not the window: half of what is below the header, so the cell
    // being edited underneath stays in view. Bounded on the height and not
    // on the shape, so the map keeps the width it had.
    const band = await page.evaluate(() => {
      const shape = document.querySelector('.viewer-shape')?.getBoundingClientRect()
      const viewer = document.querySelector('.viewer')?.getBoundingClientRect()
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      return shape === undefined || viewer === undefined || header === undefined
        ? null
        : {
            height: shape.height,
            width: shape.width,
            viewerWidth: viewer.width,
            top: header.height,
          }
    })
    expect(band, 'the map has a box on screen').not.toBeNull()
    const half = ((await page.evaluate(() => window.innerHeight)) - (band?.top ?? 0)) / 2
    expect(Math.abs((band?.height ?? 0) - half), 'half the window below the header').toBeLessThan(4)
    expect(band?.width ?? 0, 'the width it already had').toBeGreaterThanOrEqual(
      (band?.viewerWidth ?? 0) - 1,
    )

    // Scrolled to the foot of the notebook, the map is still on screen and
    // still below the header rather than off the top of it. Not asserted as
    // an exact offset: sticky also stops the preview leaving the column, so
    // at the very bottom of a short notebook it is carried up a little, and
    // an exact figure would make this a test of the footer's height. What
    // matters is that it did not scroll away, which without the pinning it
    // would have done by several windows.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(frame(page)).toBeInViewport()
    const box = await preview(page).boundingBox()
    const headerBottom = await page.evaluate(
      () => document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? -1,
    )
    expect(box, 'the preview has a box on screen').not.toBeNull()
    expect(box?.y ?? -1, 'clear of the header').toBeGreaterThanOrEqual(headerBottom - 1)

    // Below 900px it sits above the notebook rather than beside it - which
    // it does at every width, because it is a child of the column and not a
    // region next to it. The window itself is made narrower, as a person
    // would drag it.
    await page.evaluate(() => window.scrollTo(0, 0))
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(900)
    const stacked = await page.evaluate(() => {
      const map = document.querySelector('.preview')?.getBoundingClientRect()
      const first = document.querySelector('.cell')?.getBoundingClientRect()
      return map === undefined || first === undefined
        ? null
        : { mapBottom: map.bottom, cellTop: first.top }
    })
    expect(stacked, 'the preview and the first cell are both on screen').not.toBeNull()
    expect(
      (stacked?.mapBottom ?? 1) <= (stacked?.cellTop ?? 0) + 1,
      'the map is above the cells, never beside them',
    ).toBe(true)
  })
})

test('the notebook holds one frame and the preview holds it, wherever the cells are', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    // The wrapper is a direct child of the notebook's column and not of any
    // cell: a frame inside a cell would be reparented the moment the cell
    // that holds it moved, and unmounted the moment it was replaced.
    const where = await page.evaluate(() => {
      const wrapper = document.querySelector('.preview')
      const frameEl = document.querySelector('iframe.viewer-frame')
      return {
        parent: wrapper?.parentElement?.className ?? null,
        first: wrapper?.parentElement?.firstElementChild === wrapper,
        insideCell: frameEl?.closest('.cell') !== null,
        insidePreview: frameEl?.closest('.preview') !== null,
      }
    })
    expect(where.parent).toBe('notebook')
    expect(where.first, 'the column begins with the map').toBe(true)
    expect(where.insideCell, 'no cell owns the frame').toBe(false)
    expect(where.insidePreview).toBe(true)

    // Every cell open, which is several windows of scrolling, and still one.
    for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const) {
      await openCell(page, id)
    }
    await expect(frame(page)).toHaveCount(1)
    await expect(cellHeading(page, 'export')).toHaveAttribute('aria-expanded', 'true')
  })
})
