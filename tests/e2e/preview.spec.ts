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
//
// And the column the map sits in (A7-05, issue 277): the three screens are
// one column as wide as the region up to `--measure-wide`, measured at
// three sizes of the real window, and the map fills that column's content
// box, centred in it, where it used to break out of a narrower one.

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
 * It answers **exactly what the engine's own page answers** that the app
 * can use - `now`, `clock`, `viewName`, `labels` - and not the speed and
 * not whether it is playing, which the engine's `state()` reports for
 * neither (engine issue 29's seam gap from the other side). A stand-in
 * that reported them would exercise a six-call restore the real app can
 * never produce and never the three-call one it always does.
 *
 * Its clock runs at sixty service-seconds a second, as the engine's does,
 * and is never stopped - the app cannot stop it, for want of that same
 * field - so what the map is at any moment is a moving target and no
 * assertion here is allowed to be a stopwatch. Instead the page writes
 * down what it was told, in order, where a test can read it through the
 * frame: the value seeked is exact and the sequence is exact, and the
 * running afterwards is the engine's own business.
 */
const mapPage = (): string =>
  [
    '<!doctype html><meta charset="utf-8"><title>stand-in map</title><body>',
    '<p id="told"></p>',
    '<script>',
    'var now = 0, viewName = "schematic", labels = true, told = [];',
    'var last = performance.now();',
    // The engine's own default speed, so a navigation costs what it costs.
    'function tick(at) { now += ((at - last) / 1000) * 60; last = at;',
    '                    requestAnimationFrame(tick) }',
    'requestAnimationFrame(tick);',
    'function say(what) { told.push(what);',
    '                     document.getElementById("told").textContent = told.join(" ") }',
    'window.__present = {',
    '  seek: function (sec) { now = sec; say("seek=" + sec) },',
    '  showView: function (name, dur) { viewName = name; say("showView=" + name + "/" + dur) },',
    '  setLabels: function (on) { labels = !!on; say("setLabels=" + !!on) },',
    '  setPlaying: function (on) { say("setPlaying=" + !!on) },',
    '  setSpeed: function (x) { say("setSpeed=" + x) },',
    '  setRoutes: function () { say("setRoutes") },',
    '  hasGeo: function () { return true },',
    '  bounds: function () { return { t0: 0, t1: 86400 } },',
    '  state: function () { return { now: now, clock: "07:00",',
    '                               viewName: viewName, labels: labels } },',
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

/**
 * What the page in the frame has been told, in order, read from inside it.
 *
 * The frame is sandboxed to an opaque origin and the app cannot reach in
 * (ADR-028); a test driver can, and this asks for nothing the app is able
 * to ask for. It is read this way rather than added to the page's `state()`
 * on purpose: `state()` has to answer exactly what the engine's own page
 * answers, or the restore under test is not the one the app will make.
 */
const told = (page: Page): ReturnType<Page['locator']> =>
  page.frameLocator('iframe.viewer-frame').locator('#told')

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
    //
    // The wait is the address moving and nothing else: "Laid out" is on
    // screen from the first run and would be there whether this one ran or
    // not, and the address moves when the run has written the page.
    const before = await frame(page).getAttribute('src')
    await page.getByRole('button', { name: 'Lay out again', exact: true }).click()
    await expect(frame(page)).not.toHaveAttribute('src', before ?? '', { timeout: 90_000 })
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
    // The stand-in page is the one loaded, and driveable: the engine's own
    // `{}` page refuses `state` outright, so this is not a value the plain
    // page could also have answered.
    await expect.poll(() => drive(page, 'state')).toMatchObject({ clock: '07:00' })
    await markFrame(page)

    // Where a person left the map: a view chosen, the labels turned off and
    // a moment scrubbed to. The clock is read back rather than assumed,
    // because the page runs on from wherever it is put, as the engine's
    // does.
    await drive(page, 'showView', 'time')
    await drive(page, 'setLabels', false)
    await drive(page, 'seek', 30_600)
    const left = ((await drive(page, 'state')) as { now: number }).now
    expect(left, 'the page took the scrub').toBeGreaterThanOrEqual(30_600)

    // Cell 06 opens and the engine's plan takes the frame (A5-01). That is
    // a navigation, and what arrives is a new document - which is what the
    // empty record of what it has been told says, and it says as well that
    // the plain map's own state was not handed to the export's preview,
    // whose address is the engine's word on where the map should be.
    await openCell(page, 'export')
    await expect(frame(page)).toHaveAttribute('src', /frame=/, { timeout: 60_000 })
    await expect(told(page)).toBeEmpty({ timeout: 30_000 })

    // And closing it hands the frame back to the plain map, which is given
    // back where it was left rather than where a fresh document starts.
    //
    // Asserted as the sequence the page was told, in order, with the clock
    // exact: that is the three-call restore the engine's own `state()` can
    // produce and the whole of it. The clock afterwards is not asserted as
    // a figure - the page runs at sixty service-seconds a second and the
    // app cannot stop it, having no way to learn it was running (engine
    // issue 29) - only that it went on from where it was put and not from
    // the start of the day.
    await closeCell(page, 'export')
    await expect(frame(page)).toHaveAttribute('src', /controls=1/, { timeout: 60_000 })
    await expect(told(page)).toHaveText(/^showView=time\/0 setLabels=false seek=\d/, {
      timeout: 30_000,
    })

    // The view and the labels exactly, and the clock within a deadline of
    // where the map was. Not the figure: the page runs at sixty
    // service-seconds a second and the app cannot stop it, having no way to
    // learn it was running (engine issue 29), so the clock the app read at
    // the moment it navigated is later than the one read here and the two
    // are not the same number. What it promises is that the map is put back
    // where it was rather than at the start of the day, and the tolerance
    // is a deadline - ten seconds of running - not a turn count.
    const said = (await told(page).textContent()) ?? ''
    const seeked = Number(said.slice(said.indexOf('seek=') + 'seek='.length))
    expect(
      seeked,
      'given the clock the map was at, not the start of the day',
    ).toBeGreaterThanOrEqual(left)
    expect(seeked - left, 'and not some other moment').toBeLessThan(600)
    const back = ((await drive(page, 'state')) as { now: number }).now
    expect(back, 'the clock went on from where it was put').toBeGreaterThanOrEqual(seeked)
    expect(await drive(page, 'state')).toMatchObject({ viewName: 'time', labels: false })

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

    // A window this test chooses, rather than whatever one the machine
    // gave it. Wide and short on purpose: the two bounds this rule is
    // choosing between - half the window, and half the window at 16:10 -
    // give the same width when the window is tall enough, and telling them
    // apart is what the width is measured for.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1200, 700)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeGreaterThan(1100)

    // Pinned by the stylesheet alone, from the top of the column: sticky,
    // offset by the header's own token, and one step under the header's
    // layer so the header always draws its own rule.
    //
    // Against the token and not against the header's measured box. How the
    // header's forty pixels and its one-pixel rule divide between its box
    // and its border is not a thing this rule can know - a page holding
    // these stylesheets alone measures forty-one - and an assertion that
    // reads it back is asserting the box model rather than the rule.
    const pinned = await preview(page).evaluate((el) => {
      const style = getComputedStyle(el)
      const root = getComputedStyle(document.documentElement)
      return {
        position: style.position,
        top: style.top,
        headerToken: root.getPropertyValue('--header-height').trim(),
        layer: Number(style.zIndex),
        headerLayer: Number(root.getPropertyValue('--layer-raised').trim()),
      }
    })
    expect(pinned.position).toBe('sticky')
    expect(pinned.top).toBe(pinned.headerToken)
    // Above the cells, whose own positioned parts come after the map in the
    // document, and below the header, whose rule it must never cover.
    expect(pinned.layer, 'above the cells').toBeGreaterThan(0)
    expect(pinned.layer, "under the header's own layer").toBeLessThan(pinned.headerLayer)

    // A band, not the window: half of what is below the header, so the cell
    // being edited underneath stays in view. Bounded on the height and not
    // on the shape, so the map keeps the width it had.
    //
    // Measured against the box's **content**, which is what a child fills,
    // and reported with the grid's own used track beside it. The first
    // reading of this said the map was 992 in a box of 1024 - a whole
    // `--space-4-4` short at each edge - and no window driven outside the
    // app reproduced it, so the failure carries what it would take to tell
    // the three cases apart next time: a box with padding in it, a track
    // narrower than the box, or a map that does not fill its track.
    const band = await page.evaluate(() => {
      const shapeEl = document.querySelector('.viewer-shape')
      const viewerEl = document.querySelector('.viewer')
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      if (shapeEl === null || viewerEl === null || header === undefined) return null
      const shape = shapeEl.getBoundingClientRect()
      const viewer = viewerEl.getBoundingClientRect()
      const style = getComputedStyle(viewerEl)
      const pad = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      return {
        height: shape.height,
        width: shape.width,
        viewerWidth: viewer.width,
        content: viewerEl.clientWidth - pad,
        track: style.gridTemplateColumns,
        shapes: document.querySelectorAll('.viewer-shape').length,
        top: header.height,
      }
    })
    expect(band, 'the map has a box on screen').not.toBeNull()
    const half = ((await page.evaluate(() => window.innerHeight)) - (band?.top ?? 0)) / 2
    expect(Math.abs((band?.height ?? 0) - half), 'half the window below the header').toBeLessThan(4)
    // Wider than the ratio: a bound that kept 16:10 while capping the height
    // would make the map exactly `height * 16 / 10` wide - 546 against the
    // 1024 it had when it broke out of the column, measured - so this is the
    // assertion that tells the two bounds apart, and `viewerWidth` is what
    // it is measured against because that is the width the column gives the
    // map (A7-05).
    const boxes =
      `the map ${band?.width}, its box ${band?.viewerWidth} (content ${band?.content}), ` +
      `the grid's track ${band?.track}, ${band?.shapes} shape(s) on the screen`
    expect(band?.shapes, `one map on the screen: ${boxes}`).toBe(1)
    expect(band?.width ?? 0, `the width it already had - ${boxes}`).toBeGreaterThanOrEqual(
      (band?.content ?? 0) - 1,
    )
    expect(
      band?.width ?? 0,
      `not shrunk to the band\u2019s own ratio (the map ${band?.width} by ${band?.height})`,
    ).toBeGreaterThan(((band?.height ?? 0) * 16) / 10 + 1)

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

    // Below 900px it still sits above the notebook rather than beside it.
    // That much is structural - the preview is a child of the column and
    // the test below asserts it as structure, where it can actually fail -
    // so what is measured here is the thing that can go wrong at a width
    // and a height the app was not laid out at: the band follows the
    // window rather than keeping a size taken at some other one. The window
    // itself is made narrower, as a person would drag it.
    await page.evaluate(() => window.scrollTo(0, 0))
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(900)
    const narrow = await page.evaluate(() => {
      const shape = document.querySelector('.viewer-shape')?.getBoundingClientRect()
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      return shape === undefined || header === undefined
        ? null
        : { height: shape.height, want: (window.innerHeight - header.height) / 2 }
    })
    expect(narrow, 'the map has a box at the narrow width').not.toBeNull()
    expect(
      Math.abs((narrow?.height ?? 0) - (narrow?.want ?? 0)),
      'the band is half of the shorter window, not half of the taller one',
    ).toBeLessThan(4)
    expect((narrow?.height ?? 0) < (band?.height ?? 0), 'and it did shrink').toBe(true)
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

// The column (A7-05, issue 277, docs/DESIGN.md 9). The figures are the
// design document's and not read back from the stylesheets, so a token that
// moved would fail here rather than carry the expectation with it.
const COLUMN = 1024 // --measure-wide, 64rem: the column's cap
const MEASURE = 640 // --measure, 40rem: prose inside the column
const RAIL = { open: 240, collapsed: 64 } // the project's rail, above 900px and at it
const INSPECTOR = 320 // beside the main region above 900px; at 900 and below it covers it
const NARROW = 900 // 56.25rem, where both of those change

type Screen = 'Library' | 'Settings' | 'Los Angeles'

interface Column {
  /** The window as a media query reads it. */
  window: number
  /** The window as layout has it: less a scroll bar, where the platform draws one. */
  viewport: number
  panel: { left: number; width: number; content: number }
  /** `.app-main`'s content box: the window less the rail's padding and the inspector beside it. */
  region: { left: number; right: number }
  viewer: { left: number; width: number } | null
  /** The cells and the Library's lists: rows that fill the column. */
  rows: { what: string; width: number }[]
  prose: number[]
  fields: number[]
}

const measureColumn = (page: Page): Promise<Column | null> =>
  page.evaluate(() => {
    const panelEl = document.querySelector('main.panel')
    const mainEl = document.querySelector('.app-main')
    if (panelEl === null || mainEl === null) return null
    const shown = (el: Element): boolean => el.getClientRects().length > 0
    const width = (el: Element): number => el.getBoundingClientRect().width
    const p = panelEl.getBoundingClientRect()
    const ps = getComputedStyle(panelEl)
    const m = mainEl.getBoundingClientRect()
    const ms = getComputedStyle(mainEl)
    const v = panelEl.querySelector('.viewer')?.getBoundingClientRect()
    return {
      window: window.innerWidth,
      viewport: document.documentElement.clientWidth,
      panel: {
        left: p.left,
        width: p.width,
        content: p.width - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight),
      },
      region: {
        left: m.left + parseFloat(ms.paddingLeft),
        right: m.right - parseFloat(ms.paddingRight),
      },
      viewer: v === undefined ? null : { left: v.left, width: v.width },
      rows: [...panelEl.querySelectorAll('.cell, ul.entries, ul.sample-cards')]
        .filter(shown)
        .map((el) => ({ what: el.className, width: width(el) })),
      prose: [...panelEl.querySelectorAll('.prose')].filter(shown).map(width),
      fields: [...panelEl.querySelectorAll('.field')].filter(shown).map(width),
    }
  })

/** What the column should be, from the design document's figures alone. */
function columnWidth(screen: Screen, c: Column, inspectorOpen: boolean): number {
  const narrow = c.window <= NARROW
  const rail = screen === 'Los Angeles' ? (narrow ? RAIL.collapsed : RAIL.open) : 0
  const inspector = inspectorOpen && !narrow ? INSPECTOR : 0
  return Math.min(COLUMN, c.viewport - rail - inspector)
}

test('the three screens are one column up to the wide measure, and the map fills it, centred', async () => {
  test.setTimeout(240_000)
  const h = home()
  await withApp(h, async (page, app) => {
    const toggle = page.getByRole('button', { name: /^Jobs, / })
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    const heading = page.getByRole('heading', { level: 1 })

    // The Library's introduction, while there is no project to list: a
    // sentence, so it wraps at the prose measure inside the wider column.
    const intro = page.locator('.empty .prose')
    await expect(intro).toBeVisible()
    const introAt = await measureColumn(page)
    expect(introAt, 'the Library has a column').not.toBeNull()
    expect(
      (await intro.boundingBox())?.width ?? 0,
      `the introduction, in a column whose content is ${introAt?.panel.content}`,
    ).toBeCloseTo(Math.min(MEASURE, introAt?.panel.content ?? 0), 0)

    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')

    const go = async (screen: Screen): Promise<void> => {
      const now = await heading.textContent()
      if (now === screen) return
      if (screen === 'Settings') {
        await page.getByRole('button', { name: 'Settings' }).click()
      } else {
        if (now !== 'Library') {
          await page.getByRole('button', { name: 'Back to Library' }).click()
          await expect(heading).toHaveText('Library')
        }
        if (screen === 'Los Angeles')
          await page.getByRole('button', { name: 'Open Los Angeles' }).click()
      }
      await expect(heading).toHaveText(screen)
      // The heading is drawn before what is under it is read, so the screen
      // is measured once what it holds is on it.
      if (screen === 'Library') {
        await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
        await expect(page.getByRole('list', { name: 'Presets' })).toBeVisible()
      } else if (screen === 'Settings') {
        await expect(page.getByRole('heading', { name: 'Engine data' })).toBeVisible()
      } else {
        await expect(frame(page)).toBeVisible()
        await expect(page.locator('.cell')).toHaveCount(6)
      }
    }

    const check = async (
      screen: Screen,
      inspectorOpen: boolean,
      w: number,
      size: string,
    ): Promise<void> => {
      const where = `${screen} at ${size}, the inspector ${inspectorOpen ? 'open' : 'closed'}`
      // Polled, since the window has just been resized or the inspector
      // just opened, and a frame can move what a single read sees.
      await expect
        .poll(
          async () => {
            const c = await measureColumn(page)
            return c === null
              ? Number.POSITIVE_INFINITY
              : Math.abs(c.panel.width - columnWidth(screen, c, inspectorOpen))
          },
          { message: `${where}: the column is the region's width up to ${COLUMN}` },
        )
        .toBeLessThanOrEqual(0.5)
      const c = (await measureColumn(page)) as Column
      const facts = `${where}: ${JSON.stringify(c)}`
      // Still the window asked for: a platform that resized it under the
      // test would otherwise have every figure below measured at a size
      // nobody chose, and each of them would agree with the others.
      expect(c.window, `the window is still ${w} wide - ${facts}`).toBe(w)
      const centre = c.panel.left + c.panel.width / 2
      expect(
        Math.abs(centre - (c.region.left + c.region.right) / 2),
        `the column is centred in its region - ${facts}`,
      ).toBeLessThanOrEqual(1)

      // Lists, tables and the cells fill the column (section 9).
      for (const row of c.rows)
        expect(row.width, `${row.what} fills the column - ${facts}`).toBeCloseTo(c.panel.content, 0)
      // Sentences keep the reading measure inside it, and so do fields.
      for (const w of [...c.prose, ...c.fields])
        expect(w, `prose and fields keep the measure - ${facts}`).toBeLessThanOrEqual(MEASURE + 0.5)

      if (screen === 'Los Angeles') {
        // The map is the column's content box, so its centre is the
        // column's: no breakout, and nothing for the two centres to
        // disagree about.
        expect(c.viewer, `the map has a box - ${facts}`).not.toBeNull()
        const viewer = c.viewer as { left: number; width: number }
        expect(viewer.width, `the map is the column's content - ${facts}`).toBeCloseTo(
          c.panel.content,
          0,
        )
        expect(
          Math.abs(viewer.left + viewer.width / 2 - centre),
          `the map's centre is the column's - ${facts}`,
        ).toBeLessThanOrEqual(1)
        expect(c.rows.length, `six cells - ${facts}`).toBe(6)
        // The measure is reached and not merely undershot: in a column this
        // wide, a cell's sentence is as wide as the measure.
        expect(Math.max(...c.prose), `a cell's sentence - ${facts}`).toBeCloseTo(MEASURE, 0)
      }
      if (screen === 'Library') expect(c.rows.length, `the Library's lists - ${facts}`).toBe(2)
      if (screen === 'Settings') {
        // Every group's heading and rows start where the screen's own
        // heading does, with nothing of the kit's indenting them.
        const edges = await page.evaluate(() => {
          const h1 = document.querySelector('.settings h1')?.getBoundingClientRect().left ?? null
          const items = [...document.querySelectorAll('.settings section > *')]
            .filter((el) => el.getClientRects().length > 0)
            .map((el) => ({
              what: `${el.tagName.toLowerCase()}.${el.className}`,
              left: el.getBoundingClientRect().left,
            }))
          return { h1, items }
        })
        // Sentences keep the measure here too, though they are not `.prose`:
        // a line of messages the full width of the column would run past
        // what a person can read in one sweep of the eye.
        const messages = await page.evaluate(() =>
          [...document.querySelectorAll('.settings .message')]
            .filter((el) => el.getClientRects().length > 0 && (el.textContent ?? '').trim() !== '')
            .map((el) => el.getBoundingClientRect().width),
        )
        expect(messages.length, 'Settings has messages to measure').toBeGreaterThan(0)
        for (const width of messages) expect(width).toBeLessThanOrEqual(MEASURE + 0.5)
        expect(edges.h1, 'Settings has its heading').not.toBeNull()
        expect(edges.items.length, 'and groups under it').toBeGreaterThan(10)
        for (const item of edges.items)
          expect(item.left, `${item.what} starts where the h1 does`).toBeCloseTo(
            edges.h1 as number,
            0,
          )
      }
    }

    const made: string[] = []
    for (const [w, ht] of [
      [1280, 680],
      [1600, 680],
      [900, 600],
    ] as const) {
      const size = `${w} by ${ht}`
      // The window itself, as a person would drag it, rather than the page
      // emulated at a size. A window wider than its display's work area is
      // a size this run cannot measure: macOS takes it, reports it, and a
      // moment later puts the window back on its screen - measured, a
      // window asked for 1600 on a 1512 display was 1600 for the first read
      // and 1512 two hundred milliseconds later. So that size is skipped,
      // and said to be, rather than measured at whatever the window became.
      // Only macOS does that. On a Linux display server with no window
      // manager (the CI job's, whose default screen is small) a window can
      // be as wide as it is asked, and skipping by the screen's size would
      // skip every size and measure nothing; there the window is asked and
      // its width read back. Windows may clamp a window to its display:
      // that is found by the width read back too, and said.
      const work = await app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows()[0]
        return screen.getDisplayMatching(win.getBounds()).workArea.width
      })
      const skip = (why: string): void => {
        test.info().annotations.push({ type: 'size not made', description: why })
        console.warn(`  ${why}`)
      }
      if (process.platform === 'darwin' && w > work) {
        skip(`${size} not measured: the display's work area is ${work} wide`)
        continue
      }
      await app.evaluate(
        ({ BrowserWindow }, s) => {
          BrowserWindow.getAllWindows()[0].setContentSize(s.w, s.h)
        },
        { w, h: ht },
      )
      try {
        await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 }).toBe(w)
      } catch {
        skip(`${size} not measured: the window would not be ${w} wide here (work area ${work})`)
        continue
      }
      made.push(size)

      for (const screen of ['Library', 'Settings', 'Los Angeles'] as const) {
        await go(screen)
        for (const open of [false, true]) {
          if (open) {
            await toggle.click()
            await expect(inspector).toBeVisible()
          }
          await check(screen, open, w, size)
          if (open) {
            await toggle.click()
            await expect(inspector).toHaveCount(0)
          }
        }
      }
    }
    expect(made.length, 'at least one size was measured').toBeGreaterThan(0)
    // The cap and the inspector beside the region are only seen above the
    // narrow width. Where nothing can clamp the window (Linux under a
    // display server) one such size must have been measured, or the test
    // would be green having measured neither.
    if (process.platform === 'linux')
      expect(
        made.filter((size) => Number.parseInt(size, 10) > 900).length,
        'a size above the narrow width was measured',
      ).toBeGreaterThan(0)
  })
})
