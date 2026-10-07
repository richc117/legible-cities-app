// The map in the notebook's flow, and the frame held by identity (ADR-046,
// specs/029, docs/DESIGN.md 8.2, "The map"; A5.5-20 before it).
//
// **The frame is one element.** Moving an iframe between parents reloads
// it, and so does remounting it, which is what a `key` on `<Viewer>` used
// to do after every run. Nothing here reads the source: the element itself
// is stamped with a property React cannot see, the screen is then scrolled,
// its cells opened and collapsed and its map re-laid out, and the stamp is
// read back. A stamp that survives all of it is the same element.
//
// **Cell 06 has a frame of its own.** Until ADR-046 the export's preview
// took the map's frame while cell 06 was open, a navigation away and back
// that the map had to survive. Now opening cell 06 adds a second frame in
// the cell, and the map's page is told nothing: its clock runs on, no
// restore is sent, and cell 03's transport goes on driving it.
//
// **The map is a block in the column**, after cell 02 and before cell 03,
// scrolling with the cells; nothing is pinned. Where there is no map yet
// the block is still there, saying so; a run never opens its cell; and a
// read-only project gets the map and no export preview.
//
// The boundary itself is `viewer.spec.ts`'s, and is not restated here: the
// frame carries `sandbox="allow-scripts"` and nothing else, and every route
// out of it is asserted there.
//
// And the column the map sits in (A7-05, issue 277): the three screens are
// one column as wide as the region up to `--measure-wide`, measured at
// three sizes of the real window, and the map fills that column's content
// box, centred in it, where it used to break out of a narrower one.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
import {
  cell,
  cellHandback,
  cellHeading,
  closeCell,
  createProject,
  laidOutProject,
  layOut,
  openCell,
  openProject,
} from '../support/project'
import { VIEWER_SANDBOX } from '../../src/shared/viewer'

// The empty state's two sentences, as the release documents quote them
// (`notebook/Preview.tsx`). Restated rather than imported: the component
// file brings React with it.
const NO_MAP = 'This project has no map yet.'
const MAP_DRAWN = 'The map is drawn.'

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

/**
 * Ask the real window for a size, and say so if it will not take it: the
 * page emulated at a size is not the window at that size, and a display
 * smaller than the size (a CI runner's, or macOS putting a too-wide window
 * back a moment later) leaves the window as wide as it can be. The tests
 * that use this want room to scroll and a wide column, not an exact width,
 * so they carry on at what they got, and the annotation says what that was.
 */
async function roomy(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
    },
    { width, height },
  )
  try {
    await expect
      .poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 })
      .toBeGreaterThan(width - 100)
  } catch {
    const got = await page.evaluate(() => window.innerWidth)
    test.info().annotations.push({
      type: 'window smaller than asked',
      description: `asked ${width} wide, got ${got}`,
    })
  }
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
    const page = await app.firstWindow()
    // What the frames did, kept for the failure that cannot be reproduced:
    // "the map is not on the screen" has failed on CI three times and not
    // once on a desk, and the one thing that would say why is whether the
    // frame navigated, and when, around the call that was refused.
    const began = Date.now()
    const opened = new Date(began).toISOString()
    const navigations: string[] = []
    page.on('framenavigated', (frame) =>
      navigations.push(`+${Date.now() - began}ms ${frame.url().slice(0, 160)}`),
    )
    try {
      await run(page, app)
    } catch (error) {
      if (error instanceof Error) {
        error.message += `\n\nThe window's frames at the failure:\n${page
          .frames()
          .map((frame) => `  ${frame.url().slice(0, 160)}`)
          .join('\n')}\nTheir navigations, with the time since the window opened (${opened}):\n${
          navigations.map((line) => `  ${line}`).join('\n') || '  none'
        }`
      }
      throw error
    }
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

/** One of the map page's own methods, through the bridge, as the interface asks. */
const drive = (page: Page, method: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(
    ([m, a]) =>
      (
        globalThis as unknown as {
          api: { viewer: { call(r: string, m: string, ...a: unknown[]): Promise<unknown> } }
        }
      ).api.viewer.call('map', m as string, ...(a as unknown[])),
    [method, args] as [string, unknown[]],
  )

/**
 * Wait, within a deadline, until the page in the frame answers a call with
 * what is expected of it.
 *
 * Not `expect.poll(() => drive(...))`, which fails on the first throw, and
 * the bridge throws "the map is not on the screen" until the frame's `load`
 * has made the main process hold it: that failed this file on CI and never
 * on a desk (issue 312).
 *
 * The frame's document is waited for first, by the one thing only the
 * stand-in page has - the engine's own page and a frame still on its way
 * have no `#told` - so the first asking is made of the stand-in's own
 * document, and the retry is left for what follows it: the load event's
 * hand-over to the main process, which the test cannot see.
 */
async function pageAnswers(
  page: Page,
  method: string,
  expected: Record<string, unknown>,
  timeout = 30_000,
): Promise<void> {
  await expect(told(page), 'the stand-in page is the document in the frame').toBeAttached({
    timeout,
  })
  const began = Date.now()
  const answers: string[] = []
  let last = ''
  try {
    await expect(async () => {
      try {
        expect(await drive(page, method)).toMatchObject(expected)
      } catch (error) {
        const said = (error instanceof Error ? error.message : String(error))
          .replace(/\s+/g, ' ')
          .slice(0, 160)
        if (said !== last) answers.push(`+${Date.now() - began}ms ${said}`)
        last = said
        throw error
      }
    }).toPass({ timeout })
  } catch (error) {
    if (error instanceof Error) {
      const history = answers.map((line) => `  ${line}`).join('\n')
      error.message += `\n\nWhat the map answered to ${method}, each change with the time since the first asking (first asked at ${new Date(began).toISOString()}):\n${history}`
    }
    throw error
  }
  if (answers.length > 0) {
    // Both: the annotation is for a reporter that reads it, and none that
    // this project runs does (`list`, `github`), which do echo the output.
    const description = `${method} was refused before it was answered:\n${answers.join('\n')}`
    test.info().annotations.push({ type: 'map-refused-before-it-answered', description })
    console.warn(description)
  }
}

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

/** Every engine frame in the document: the map's and, while cell 06 is open, the export's. */
const engineFrames = (page: Page): ReturnType<Page['locator']> =>
  page.locator(`iframe[sandbox="${VIEWER_SANDBOX}"]`)
const exportFrame = (page: Page): ReturnType<Page['locator']> => page.locator('iframe.export-frame')

/**
 * Write down every address the map's frame is given from now on, where a
 * test can read it back: the first, and each one a change of `src` sets.
 */
const watchMapAddress = (page: Page): Promise<void> =>
  frame(page).evaluate((el) => {
    const seen = [el.getAttribute('src') ?? '']
    ;(window as unknown as { __mapSrcs: string[] }).__mapSrcs = seen
    new MutationObserver(() => seen.push(el.getAttribute('src') ?? '')).observe(el, {
      attributes: true,
      attributeFilter: ['src'],
    })
  })
const mapAddresses = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __mapSrcs: string[] }).__mapSrcs)

test('cell 06 adds a frame of its own, and the map keeps its clock and is sent nothing', async () => {
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
    // page could also have answered. Asked until it answers: `pageAnswers`.
    await pageAnswers(page, 'state', { clock: '07:00' })
    await markFrame(page)
    await watchMapAddress(page)

    // Where a person left the map: a view chosen, the labels turned off and
    // a moment scrubbed to.
    await drive(page, 'showView', 'time')
    await drive(page, 'setLabels', false)
    await drive(page, 'seek', 30_600)
    await expect(told(page)).toHaveText(/^showView=time\/undefined setLabels=false seek=30600$/)
    await expect(engineFrames(page)).toHaveCount(1)

    // Cell 06 opens: a second frame, in the cell, at the planned address.
    // The map's own page is told nothing and keeps running from where it
    // was. The clock is read either side of the open and allowed to have run
    // on by the wall time between the two reads and one second more: the
    // stand-in runs at sixty service-seconds a second, as the engine's page
    // does, and a page that had been sent away and back would be at the
    // start of the day, or restored by a seek the page would have written
    // down.
    const t0 = Date.now()
    const before = ((await drive(page, 'state')) as { now: number }).now
    await openCell(page, 'export')
    await expect(exportFrame(page)).toHaveAttribute('src', /[?&]frame=/, { timeout: 60_000 })
    await expect(engineFrames(page)).toHaveCount(2)
    const after = ((await drive(page, 'state')) as { now: number }).now
    const wall = (Date.now() - t0) / 1000
    expect(after, 'the map ran on and did not start again').toBeGreaterThanOrEqual(before)
    expect(
      after - before,
      'and moved by no more than the time that passed and a second',
    ).toBeLessThanOrEqual((wall + 1) * 60)
    await expect(told(page), 'no restore was sent to the map').toHaveText(
      /^showView=time\/undefined setLabels=false seek=30600$/,
    )
    expect(await drive(page, 'state')).toMatchObject({ viewName: 'time', labels: false })

    // Both frames carry exactly the sandbox, and nothing else (ADR-028).
    for (const each of await engineFrames(page).all())
      await expect(each).toHaveAttribute('sandbox', VIEWER_SANDBOX)
    // The export's is inside cell 06, at the address the engine planned
    // with the safe zones (the reel has them); the map's is in no cell.
    expect(
      await exportFrame(page).evaluate((el) => el.closest('.cell')?.getAttribute('data-cell')),
    ).toBe('06')
    await expect(exportFrame(page)).toHaveAttribute('src', /[?&]safe=1(&|$)/)
    expect(await frame(page).evaluate((el) => el.closest('.cell'))).toBeNull()

    // Cell 03's transport drives the map's frame and not the export's. The
    // export's page is the same stand-in, writing down what it is told, so
    // a call that reached it would show.
    const transport = page.getByRole('region', { name: 'Transport' })
    await transport.getByRole('button', { name: /^(Pause|Play day)$/ }).click()
    await expect(told(page), 'the press reached the map').toContainText('setPlaying=')
    await expect(
      page.frameLocator('iframe.export-frame').locator('#told'),
      'and not the preview',
    ).toBeEmpty()

    // Closing the cell takes its frame away and sends the map nothing.
    const open = (await told(page).textContent()) ?? ''
    await closeCell(page, 'export')
    await expect(exportFrame(page)).toHaveCount(0)
    await expect(engineFrames(page)).toHaveCount(1)
    await expect(told(page)).toHaveText(open)

    // The map's frame was never given another address at all - the export's
    // with `safe=1` least of all - and it is the element it was.
    const addresses = await mapAddresses(page)
    expect(addresses.filter((a) => /[?&]safe=1(&|$)/.test(a))).toEqual([])
    expect(new Set(addresses).size, `the map stayed on one address: ${addresses.join(', ')}`).toBe(
      1,
    )
    await expect(markOnFrame(page)).resolves.toBe('the same frame')
  })
})

test('the map is a block in the column after cell 02, and scrolls with it', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await roomy(app, page, 1200, 700)
    await expect(preview(page)).toBeVisible()

    // Where it is: a child of the column, between cells 02 and 03, and in
    // the column's flow - and nothing in the column is pinned.
    const where = await preview(page).evaluate((block) => ({
      parent: block.parentElement?.className ?? null,
      before: block.previousElementSibling?.getAttribute('data-cell') ?? null,
      after: block.nextElementSibling?.getAttribute('data-cell') ?? null,
      position: getComputedStyle(block).position,
      // A popover is `position: fixed` by the browser's own style even while
      // it is closed, and it lives in the top layer, out of the flow: it is
      // not something the column pins (the colour picker's panels are the
      // ones in a cell).
      pinned: [block, ...document.querySelectorAll('.notebook *')]
        .filter((el) => !el.matches('[popover]'))
        .filter((el) => ['sticky', 'fixed'].includes(getComputedStyle(el).position))
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
    }))
    expect(where.parent).toBe('notebook')
    expect(where.before, 'after cell 02, whose layout it is drawn from').toBe('02')
    expect(where.after, 'before cell 03, the first cell that acts on it').toBe('03')
    expect(where.position).toBe('static')
    expect(where.pinned, 'nothing in the column is pinned').toEqual([])

    // Its top moves with the scroll, by the scroll. The document is taller
    // than the window here (every cell but 06 is open), and the scroll is
    // read back before the box is, so the comparison is of two settled
    // positions.
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    const top0 = await preview(page).evaluate((el) => el.getBoundingClientRect().top)
    await page.evaluate(() => window.scrollTo(0, 150))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(150)
    const top1 = await preview(page).evaluate((el) => el.getBoundingClientRect().top)
    expect(top0 - top1, 'the block moved up by the scroll').toBeCloseTo(150, 0)

    // As wide as the column, at the height the rule gives, and not the
    // ratio's width at that height (the trap a `max-height` against an
    // automatic width fell into once: 546 wide in a box of 1024).
    const box = await page.evaluate(() => {
      const shape = document.querySelector('.preview .viewer-shape') as HTMLElement
      const block = document.querySelector('.preview') as HTMLElement
      const root = getComputedStyle(document.documentElement)
      const floor = parseFloat(root.getPropertyValue('--map-height-floor'))
      return {
        width: shape.getBoundingClientRect().width,
        height: shape.getBoundingClientRect().height,
        column: block.clientWidth,
        floor,
        windowHeight: window.innerHeight,
      }
    })
    expect(box.width, 'the map fills the column').toBeCloseTo(box.column, 0)
    expect(box.height, 'at least the floor').toBeGreaterThanOrEqual(box.floor - 0.5)
    expect(box.height, 'never taller than the window').toBeLessThan(box.windowHeight)
    expect(
      box.width,
      `not shrunk to its ratio at that height (the map ${box.width} by ${box.height})`,
    ).toBeGreaterThan((box.height * 16) / 9 - 1)
  })
})

test('the notebook holds one engine frame, and two while cell 06 is open, the map in no cell', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    const where = await page.evaluate(() => {
      const frameEl = document.querySelector('iframe.viewer-frame')
      return {
        insideCell: frameEl?.closest('.cell') !== null,
        insidePreview: frameEl?.closest('.preview') !== null,
      }
    })
    expect(where.insideCell, 'no cell owns the map').toBe(false)
    expect(where.insidePreview).toBe(true)
    await expect(engineFrames(page)).toHaveCount(1)

    // Every cell open, which is several windows of scrolling: the map's
    // frame and the export's, and no more.
    for (const id of ['data', 'process', 'frame', 'style', 'lines', 'export'] as const) {
      await openCell(page, id)
    }
    await expect(exportFrame(page)).toHaveCount(1, { timeout: 60_000 })
    await expect(engineFrames(page)).toHaveCount(2)
    await expect(frame(page)).toHaveCount(1)
    expect(await frame(page).evaluate((el) => el.closest('.cell'))).toBeNull()
    // Opened and closed again, more than once: one frame each time it is
    // open, none when it is closed, and never a second map.
    for (let i = 0; i < 2; i += 1) {
      await closeCell(page, 'export')
      await expect(engineFrames(page)).toHaveCount(1)
      await openCell(page, 'export')
      await expect(engineFrames(page)).toHaveCount(2, { timeout: 60_000 })
      await expect(frame(page)).toHaveCount(1)
    }
  })
})

test('a project with no map keeps the map’s place, says so, and points at cell 02', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await createProject(page, 'LA Metro Rail', 'Los Angeles')
    await openProject(page, 'Los Angeles')
    // With no layout, cells 01 and 02 open: they are the work left to do.
    await expect(cellHeading(page, 'data')).toHaveAttribute('aria-expanded', 'true')
    await expect(cellHeading(page, 'process')).toHaveAttribute('aria-expanded', 'true')

    // The block is there, between cells 02 and 03, a status region saying
    // there is no map yet, and no frame.
    const status = preview(page).locator('.preview-status')
    await expect(status).toHaveAttribute('role', 'status')
    await expect(status).toContainText(`${NO_MAP} Lay it out in cell 02.`)
    await expect(engineFrames(page)).toHaveCount(0)
    expect(
      await preview(page).evaluate((el) => el.previousElementSibling?.getAttribute('data-cell')),
    ).toBe('02')

    // Its link takes a person to cell 02, opening it if they had closed it,
    // with focus on the cell's heading.
    await closeCell(page, 'process')
    await status.getByRole('button', { name: 'Lay it out in cell 02.' }).click()
    await expect(cellHeading(page, 'process')).toHaveAttribute('aria-expanded', 'true')
    await expect(cellHandback(page, 'process')).toBeFocused()

    // The map arrives into the same status region, which says so, and the
    // frame follows it: the region was never taken out of the document.
    await status.evaluate((el) => {
      ;(el as unknown as Record<string, unknown>).__same = 'the same region'
    })
    await layOut(page)
    await expect(status).toHaveText(MAP_DRAWN)
    expect(
      await status.evaluate((el) => (el as unknown as Record<string, unknown>).__same ?? null),
    ).toBe('the same region')
    await expect(frame(page)).toHaveCount(1)
    // A finished run closes nothing: what the person had open stays open.
    await expect(cellHeading(page, 'process')).toHaveAttribute('aria-expanded', 'true')

    // Opened again, a laid-out project starts on its map: 01 and 02
    // collapsed, 03 to 05 open, 06 closed.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Los Angeles')
    const expanded = {
      data: 'false',
      process: 'false',
      frame: 'true',
      style: 'true',
      lines: 'true',
      export: 'false',
    } as const
    for (const [id, want] of Object.entries(expanded))
      await expect(cellHeading(page, id as keyof typeof expanded), id).toHaveAttribute(
        'aria-expanded',
        want,
      )
  })
})

test('a run never opens its cell or moves the page, and its row says what it is doing', async () => {
  test.setTimeout(180_000)
  // Slow enough to read the row while it runs; and the map refused at the
  // end, so the same run shows a failure.
  const h = home({ progress_delay_ms: 300, map_draws: false })
  await withApp(h, async (page, app) => {
    await roomy(app, page, 1200, 700)
    await createProject(page, 'LA Metro Rail', 'Los Angeles')
    await openProject(page, 'Los Angeles')
    await closeCell(page, 'data')
    await closeCell(page, 'process')
    await page.evaluate(() => window.scrollTo(0, 0))
    const row = cellHeading(page, 'process')

    await page.getByRole('button', { name: 'Run all' }).click()
    // The row says the stage and its place, in the progress line's words.
    await expect(row).toContainText(/running [a-z]+, \d of 8/, { timeout: 30_000 })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => window.scrollY), 'the page did not move').toBe(0)
    expect(
      await page.evaluate(() => document.activeElement?.closest('.cell') ?? null),
      'nothing in a cell took focus',
    ).toBeNull()

    // And where it failed, in the row and in the header, still collapsed.
    await expect(row).toContainText(/failed at [a-z]+, \d of 8/, { timeout: 60_000 })
    await expect(page.locator('.project-run-state')).toHaveText('02 Process failed.')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})

test('a read-only project shows its map and no export preview, and offers no layout', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', 'Los Angeles')
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await createProject(page, 'LA Metro Rail', 'Unmade')
    // Both written by "a newer version of the app": a record version this
    // one does not know, which it opens read-only.
    for (const id of readdirSync(join(h.engineHome, 'projects'))) {
      const file = join(h.engineHome, 'projects', id, 'project.json')
      const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      writeFileSync(file, JSON.stringify({ ...record, version: 99 }))
    }

    await openProject(page, 'Los Angeles')
    await expect(page.getByText(/is read-only here/)).toBeVisible()
    await expect(frame(page), 'viewing is not editing: the map is there').toHaveCount(1)
    await openCell(page, 'export')
    await expect(cell(page, 'export')).toContainText(
      'This project was made by a newer version of the app, so its export cannot be changed or made here.',
    )
    await expect(cell(page, 'export').getByRole('combobox')).toHaveCount(0)
    // Given time to plan, nothing is: no preview is drawn for an export that
    // cannot be made, and no plan was asked of the engine for one. Paired with
    // the same cell on a project that can export, which does plan.
    await page.waitForTimeout(1500)
    await expect(exportFrame(page)).toHaveCount(0)
    const asked = readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    // The log is the stand-in's, and it has recorded the layout, so an empty
    // answer below is an answer and not a missing file.
    expect(asked, 'the stand-in logged the project being laid out').toContain('graph.build')
    expect(asked, 'a read-only project plans no export').not.toContain('"export.plan"')

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, 'Unmade')
    const status = preview(page).locator('.preview-status')
    await expect(status).toHaveText(NO_MAP)
    await expect(status.getByRole('button')).toHaveCount(0)
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
