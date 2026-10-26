// The theme a project's map is drawn in (specs/021-theme): the switch on
// the project screen - since A7-13 two native radios, each a card of the
// engine's picture over its word - the page restyled in place through its seam, the
// theme on the address of the next load, the record on disk, the theme still
// there when the project is opened again, and the export made in it.
//
// Nothing here asks the engine anything: a theme is neither a layout nor a
// render, and the page restyles itself when it is told (`setTheme`, engine
// v0.11.0; issue 349) - the frame is not reloaded, so its address, its
// document and its clock stay as they were. The one engine request a theme
// ever reaches is `export.plan`, which is given the engine's own word for it.
//
// The stand-in engine's own page is `{}` and has no seam, so the tests that
// ask the page something write over it a page that has one (`themedPage`).

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
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
  NO_TRIP_ON_IT,
  ON_SCREEN_AS_IT_WAS,
  OPENING_REDRAW_FAILED,
  OPENING_REDRAW_STOPPED,
  THEME_BY_RELOAD,
  openingFallback,
} from '../../src/renderer/src/notebook/olderPage'
import { END, OLD_PAGE, START, TRIP } from '../../src/renderer/src/tripWords'
import { type Theme } from '../../src/shared/project/types'
import { isTheme } from '../../src/shared/project/validate'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cell,
  cellHandback,
  cellHeading,
  closeCell,
  createProject,
  openCell,
  openProject,
  withoutOpened,
} from '../support/project'
import { everySeamBut } from '../support/standInPage'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Home {
  engineHome: string
  exportFolder: string
  /**
   * A user-data folder of this test's own. One scenario sets the
   * *interface's* theme, which is written to settings.json there, and the
   * real profile is shared with every other end-to-end file: leaving sepia
   * behind in it failed the design suite's "no attribute unless a person
   * chose one" two files later (A1-04 added this key for exactly this).
   */
  userData: string
}

/** An engine home with the stand-in's control file, and the folders beside it. */
function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-theme-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return { engineHome, exportFolder: join(dir, 'exports'), userData: join(dir, 'profile') }
}

async function withApp(
  h: Home,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
  /** Laid over the launch's environment: an engine that is not there, for one. */
  env: Record<string, string> = {},
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      // Never the desktop: an export in a test writes where the test says.
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_USER_DATA: h.userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...env,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    await run(await app.firstWindow(), app)
  } finally {
    await app.close()
  }
}

const readRecord = (h: Home): Record<string, unknown> => {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  return withoutOpened(
    JSON.parse(readFileSync(join(h.engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
}

/** Every message of one method the stand-in read, in order. */
const received = (h: Home, method: string): string[] =>
  readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"${method}"`))

async function project(page: Page, name: string): Promise<void> {
  await createProject(page, 'LA Metro Rail', name)
  await openProject(page, name)
}

const switchOf = (page: Page) => cell(page, 'style')
const GROUP = 'The theme this map is drawn in'
/**
 * A theme's radio, by the name a screen reader gives it: the word. The input
 * is visually hidden (A7-13), so it is read, focused and asserted on here
 * and never pressed.
 */
const radio = (page: Page, word: string) =>
  switchOf(page).getByRole('radio', { name: word, exact: true })
/**
 * The card a theme is chosen by: the label round its radio, its picture and
 * its word, which is where a person presses. Playwright refuses to press a
 * hidden input, whose hit target is the card over it, so a spec presses the
 * card, as a person does.
 */
const card = (page: Page, word: string) =>
  switchOf(page).locator('label.theme-card', { hasText: word })
const frame = (page: Page) => page.locator('iframe.viewer-frame')
// Cell 06's own preview frame (ADR-046), there only while the cell is open.
const exportFrame = (page: Page) => page.locator('iframe.export-frame')

/**
 * A page with the seam the app drives and a theme of its own, in place of
 * the `{}` the stand-in engine writes.
 *
 * It does what the engine's page does that this spec reads: it boots in the
 * theme its address names (`?theme=`), wears it as `data-theme` on the root
 * as the engine's boot script does, takes `setTheme(name)` (true for the two
 * names, false and no change for any other) and says `theme` from
 * `state()`. It also keeps, for the test and for no one else, which
 * document it is (`__document`, new on every load), the theme it booted in
 * (`__bootTheme`: what the address alone gave the first paint) and every
 * call it was asked (`__seen`). Its clock moves only when it is sought, so
 * a clock that has been moved and is still there is a document that was not
 * replaced.
 *
 * `current: false` is a page the engine wrote before v0.11.0: the same page
 * with no `setTheme` and no `theme` in `state()`, which still boots in the
 * theme its address names, as every generated page has. A current page has
 * every other seam the pinned engine's page has too, doing nothing
 * (`EVERY_SEAM`), so it is not taken for an older engine's and redrawn as its
 * project opens (issue 465); the older one has none of them.
 */
const pageSource = (current: boolean, lacking: readonly string[] = []): string =>
  [
    '<!doctype html><meta charset="utf-8"><title>stand-in map</title><body>',
    '<script>',
    'var T0 = 21600, T1 = 93600, at = T0;',
    'var boot = new URLSearchParams(location.search).get("theme") === "sepia" ? "sepia" : "warm-dark";',
    'var root = document.documentElement;',
    'if (boot === "sepia") root.setAttribute("data-theme", "sepia");',
    'var themeName = function () { return root.getAttribute("data-theme") === "sepia" ? "sepia" : "warm-dark" };',
    'window.__document = String(Math.random()).slice(2);',
    'window.__bootTheme = boot;',
    'window.__seen = [];',
    'function fmt(s) {',
    '  var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);',
    '  return String(h % 24).padStart(2, "0") + ":" + String(m).padStart(2, "0")',
    '       + (h >= 24 ? " +1d" : "");',
    '}',
    'window.__present = {',
    '  showView: function (name) { window.__seen.push(["showView", name]) },',
    '  setLabels: function (on) { window.__seen.push(["setLabels", !!on]) },',
    '  setRoutes: function (keep) { window.__seen.push(["setRoutes", keep]) },',
    '  seek: function (sec) { at = Math.max(T0, Math.min(T1, sec)); window.__seen.push(["seek", at]) },',
    '  setSpeed: function (x) { window.__seen.push(["setSpeed", x]) },',
    '  setPlaying: function (on) { window.__seen.push(["setPlaying", !!on]) },',
    '  hasGeo: function () { return true },',
    '  bounds: function () { return { t0: T0, t1: T1 } },',
    ...(current && !lacking.includes('setTheme')
      ? [
          '  setTheme: function (name) {',
          '    if (name !== "warm-dark" && name !== "sepia") return false;',
          '    if (name === "sepia") root.setAttribute("data-theme", "sepia");',
          '    else root.removeAttribute("data-theme");',
          '    window.__seen.push(["setTheme", name]);',
          '    return true;',
          '  },',
        ]
      : []),
    '  state: function () {',
    `    return { now: at, clock: fmt(at), viewName: "schematic", labels: true${current ? ', theme: themeName()' : ''} };`,
    '  },',
    '};',
    ...(current ? [everySeamBut(lacking)] : []),
    '</script></body>',
  ].join('\n')

const THEMED_PAGE = pageSource(true)
const OLDER_PAGE = pageSource(false)
/**
 * A page from engine v0.13.0 to v0.14.x: a theme and a trip, and not the
 * opening's two seams, so older, and redrawn as its project opens, and still
 * able to take a theme in place (issue 517).
 */
const NO_OPENING_PAGE = pageSource(true, ['setCard', 'setDrawn'])

/** The project's page file, where the engine writes it. */
function pageFile(h: Home): string {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  return join(h.engineHome, 'out', id, 'la-metro-rail.html')
}

const themedPage = (h: Home, source = THEMED_PAGE): void => writeFileSync(pageFile(h), source)

/**
 * Keep the themed page written over whatever the stand-in engine writes,
 * until the returned function is called.
 *
 * A run's `map.build` writes `{}` into the page file and then answers, and
 * the frame loads that file a state read and a navigation later, so the
 * page a redraw arrives at is `{}` unless something puts the themed one back
 * in between. This does, every few milliseconds, by renaming a whole file
 * over it so a load never reads half of one. The stand-in engine cannot be
 * told to write a page with a seam; this spec may not edit it.
 */
function keepPageWritten(h: Home): () => void {
  const file = pageFile(h)
  const timer = setInterval(() => {
    try {
      writeFileSync(`${file}.next`, THEMED_PAGE)
      renameSync(`${file}.next`, file)
    } catch {
      // Windows refuses a rename over a file a reader has open; the next
      // tick tries again.
    }
  }, 5)
  return () => clearInterval(timer)
}

interface Bridge {
  api: { viewer: { call(role: string, method: string, ...args: unknown[]): Promise<unknown> } }
}

/**
 * What the map's page says it is showing, asked through the bridge the app
 * itself uses, or null where it says nothing (no page, a page between
 * documents, an answer that is not an object).
 */
const stateOf = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate(async () => {
    try {
      const answer = await (window as unknown as Bridge).api.viewer.call('map', 'state')
      return answer !== null && typeof answer === 'object'
        ? (answer as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  })

/** One of the page's own methods, asked through the bridge; its answer, or null. */
const askPage = (page: Page, method: string, ...args: unknown[]): Promise<unknown> =>
  page.evaluate(
    async ([name, rest]) => {
      try {
        return await (window as unknown as Bridge).api.viewer.call(
          'map',
          name as string,
          ...(rest as unknown[]),
        )
      } catch {
        return null
      }
    },
    [method, args] as const,
  )

/** The theme `state()` answers, checked to be one of the two names before it is used. */
const themeOf = async (page: Page): Promise<Theme | null> => {
  const theme = (await stateOf(page))?.theme
  return isTheme(theme) ? theme : null
}

/** What the frame's document says about itself, from the only side that can reach it. */
interface Facts {
  /** Which document this is: new on every load. */
  document: string | null
  /** The theme its address gave the first paint. */
  boot: string | null
  /** The `data-theme` on its root, which is what is painted. */
  attribute: string | null
  /** Every call it was asked, in order. */
  seen: [string, unknown][]
}

async function factsOf(app: ElectronApplication): Promise<Facts | null> {
  return (await app.evaluate(async ({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
    // The viewer's frame by the app's own word for it, never cell 01's
    // `srcdoc` or cell 06's preview.
    const frame = main.frames.find((f) => f !== main && f.url.includes('controls=1'))
    if (frame === undefined) return null
    try {
      const read = frame.executeJavaScript(
        `({ document: window.__document || null, boot: window.__bootTheme || null,
            attribute: document.documentElement.getAttribute('data-theme'),
            seen: window.__seen || [] })`,
      ) as Promise<unknown>
      // A frame being replaced can take the read and never answer it: not yet.
      const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1000))
      return await Promise.race([read, late])
    } catch {
      return null
    }
  })) as Facts | null
}

/**
 * Put the current page in place of whatever the stand-in engine writes over
 * the older one, until the returned function is called, and leave the older
 * page alone until then: the redraw a project's opening makes writes `{}`,
 * and the page the pinned engine would have drawn is the one that should
 * arrive. A whole file is renamed over it each time, so a load never reads
 * half of one.
 */
function keepCurrentOverDrawn(h: Home): () => void {
  const file = pageFile(h)
  const timer = setInterval(() => {
    try {
      const now = readFileSync(file, 'utf8')
      if (now === OLDER_PAGE || now === THEMED_PAGE) return
      writeFileSync(`${file}.next`, THEMED_PAGE)
      renameSync(`${file}.next`, file)
    } catch {
      // Windows refuses a rename over a file a reader has open; the next
      // tick tries again.
    }
  }, 5)
  return () => clearInterval(timer)
}

/** An interpreter that is not there, so the engine never starts: "the engine is away". */
const NO_ENGINE = (h: Home): Record<string, string> => ({
  LEGIBLE_ENGINE_PYTHON: join(
    h.engineHome,
    'nowhere',
    process.platform === 'win32' ? 'python.exe' : 'python',
  ),
})

/**
 * A laid-out project whose page carries the seam and a theme, open on cell
 * 04 with the page having answered. The page is written after the run and
 * the screen is left and entered again so the frame loads it: the viewer
 * navigates on a redraw and on nothing else.
 */
async function openWithAPage(
  page: Page,
  app: ElectronApplication,
  h: Home,
  source = THEMED_PAGE,
): Promise<void> {
  await project(page, 'Los Angeles')
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  themedPage(h, source)
  await page.getByRole('button', { name: 'Back to Library' }).click()
  await page.getByRole('button', { name: 'Open Los Angeles' }).click()
  await openCell(page, 'style')
  await expect
    .poll(async () => (await factsOf(app))?.document ?? null, {
      message: 'the themed page loaded in the map’s frame',
      timeout: 20_000,
    })
    .not.toBeNull()
  await expect
    .poll(() => stateOf(page), { message: 'the page answers state() through the bridge' })
    .not.toBeNull()
}

test('offers the two themes as radios and says which one the map is drawn in', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    // A fieldset named for what it sets, holding exactly the two radios (A7-13).
    const group = switchOf(page).getByRole('group', { name: GROUP })
    await expect(group.getByRole('radio')).toHaveCount(2)
    await expect(group.getByRole('radio').first()).toHaveAccessibleName('Warm dark')
    await expect(group.getByRole('radio').last()).toHaveAccessibleName('Sepia')
    await expect(radio(page, 'Warm dark')).toBeChecked()
    await expect(radio(page, 'Sepia')).not.toBeChecked()
    // The pictures are the engine's files in images with no alternative text,
    // so they add nothing to a name and are not read.
    const pictures = group.locator('img')
    await expect(pictures).toHaveCount(2)
    for (const picture of await pictures.all()) {
      await expect(picture).toHaveAttribute('alt', '')
      expect(
        await picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        'the picture loaded',
      ).toBe(true)
    }
    // Nothing else in the section is pressable: the theme is not a button.
    await expect(group.getByRole('button')).toHaveCount(0)
    // The two cards share a row at the default window. The kit's own rule makes
    // every fieldset a column flexbox, which would stack them one under the
    // other in a single narrow column; the group restates `display` against it.
    const warm = await card(page, 'Warm dark').boundingBox()
    const sepia = await card(page, 'Sepia').boundingBox()
    expect(warm, 'the Warm dark card has a box').not.toBeNull()
    expect(sepia, 'the Sepia card has a box').not.toBeNull()
    expect(sepia?.y, 'the cards are in one row').toBe(warm?.y)
    expect(sepia?.x ?? 0, 'Sepia is beside Warm dark, to its right').toBeGreaterThan(
      (warm?.x ?? 0) + (warm?.width ?? 0) - 1,
    )
  })
})

test('Tab enters the pair once, the arrows move the choice, and the ring is on the card', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await openCell(page, 'style')
    const warm = radio(page, 'Warm dark')
    const sepia = radio(page, 'Sepia')

    // Tab from the cell's own row lands on the checked radio, the pair's one
    // stop, and not on the first of two.
    await cellHeading(page, 'style').focus()
    await page.keyboard.press('Tab')
    await expect(warm).toBeFocused()
    // The ring is the card's, since the radio is not drawn: the app's own
    // ring, in --focus, and it is there for the card holding focus alone.
    const ring = (word: string) =>
      card(page, word).evaluate((el) => {
        const style = getComputedStyle(el)
        return { style: style.outlineStyle, width: style.outlineWidth, colour: style.outlineColor }
      })
    expect(await ring('Warm dark')).toMatchObject({ style: 'solid', width: '2px' })
    expect((await ring('Sepia')).style, 'and not on the other card').toBe('none')

    // An arrow moves focus and the choice together, and writes it.
    await page.keyboard.press('ArrowRight')
    await expect(sepia).toBeFocused()
    await expect(sepia).toBeChecked()
    await expect(warm).not.toBeChecked()
    await expect.poll(() => readRecord(h).theme).toBe('sepia')
    expect((await ring('Sepia')).style).toBe('solid')
    expect((await ring('Warm dark')).style).toBe('none')
    await page.keyboard.press('ArrowLeft')
    await expect(warm).toBeFocused()
    await expect(warm).toBeChecked()
    await expect.poll(() => readRecord(h).theme).toBe('warm-dark')

    // Tab leaves the pair rather than visiting the other radio, and Shift+Tab
    // comes back to the checked one.
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => document.activeElement?.matches('input[type="radio"]') ?? false),
      'Tab left the pair',
    ).toBe(false)
    await page.keyboard.press('Shift+Tab')
    await expect(warm).toBeFocused()
  })
})

test('a checked card is told from a focused one by its edge, in both of the interface’s themes', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await openCell(page, 'style')
    // A token as the colour the browser paints it in: a probe element wearing
    // it, read back computed, in the theme the page is in now.
    const colourOf = (token: string): Promise<string> =>
      page.evaluate((name) => {
        const probe = document.createElement('span')
        probe.style.color = `var(${name})`
        document.body.append(probe)
        const colour = getComputedStyle(probe).color
        probe.remove()
        return colour
      }, token)
    const read = (word: string) =>
      card(page, word).evaluate((el) => {
        const style = getComputedStyle(el)
        const box = el.getBoundingClientRect()
        const root = getComputedStyle(document.documentElement)
        return {
          edge: style.borderTopColor,
          edgeWidth: style.borderTopWidth,
          ring: style.outlineColor,
          // A ring is drawn when its style is not `none`. Its width is not
          // evidence either way: Chromium reports `3px`, the initial
          // `medium`, for an outline whose style is `none`.
          ringStyle: style.outlineStyle,
          ringWidth: style.outlineWidth,
          width: box.width,
          height: box.height,
          // Where the picture sits inside the card, which is the padding and
          // the edge together: unchanged if the edge is taken from the padding.
          pictureTop:
            (el.querySelector('.card-picture')?.getBoundingClientRect().top ?? 0) - box.top,
          pictureWidth: el.querySelector('.card-picture')?.getBoundingClientRect().width ?? 0,
          narrowest:
            parseFloat(root.getPropertyValue('--card-min-width')) * parseFloat(root.fontSize),
        }
      })
    for (const [scheme, attribute] of [
      ['dark', null],
      ['light', 'sepia'],
    ] as const) {
      // The interface follows the system until Settings says otherwise, and
      // the attribute lands a turn after the emulation.
      await page.emulateMedia({ colorScheme: scheme })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(attribute)

      // The same card before and after it is checked: Sepia, chosen with the
      // pointer. Its edge goes from 1px of --border to 2px of --text, and the
      // card is the size it was and its picture is where it was, because the
      // edge is taken from the padding. (Two cards of one grid row are always
      // as tall as each other, so the other card is no witness to this.)
      const before = await read('Sepia')
      expect(before.edgeWidth, `${scheme}: the resting edge is 1px`).toBe('1px')
      expect(before.edge, `${scheme}: the resting edge is --border`).toBe(
        await colourOf('--border'),
      )
      await card(page, 'Sepia').click()
      await expect(radio(page, 'Sepia')).toBeChecked()
      await expect.poll(() => readRecord(h).theme).toBe('sepia')
      const after = await read('Sepia')
      expect(after.edgeWidth, `${scheme}: the checked edge is 2px`).toBe('2px')
      expect(after.edge, `${scheme}: the checked edge is --text`).toBe(await colourOf('--text'))
      expect(after.height, `${scheme}: the card did not grow`).toBeCloseTo(before.height, 0)
      expect(after.width, `${scheme}: nor widen`).toBeCloseTo(before.width, 0)
      expect(after.pictureTop, `${scheme}: its picture did not move down`).toBeCloseTo(
        before.pictureTop,
        0,
      )
      expect(after.pictureWidth, `${scheme}: nor narrow`).toBeCloseTo(before.pictureWidth, 0)
      expect(after.width, `${scheme}: a card is at least --card-min-width`).toBeGreaterThanOrEqual(
        after.narrowest - 1,
      )
      // And back, so the next pass starts as this one did.
      await card(page, 'Warm dark').click()
      await expect(radio(page, 'Warm dark')).toBeChecked()
      await expect.poll(() => readRecord(h).theme).toBe('warm-dark')

      // Warm dark is the checked card, and focused from the keyboard: it
      // wears the edge and the ring together, and they are two colours.
      await cellHeading(page, 'style').focus()
      await page.keyboard.press('Tab')
      await expect(radio(page, 'Warm dark')).toBeFocused()
      const checked = await read('Warm dark')
      expect(checked.edgeWidth, `${scheme}: the checked edge is 2px`).toBe('2px')
      expect(checked.edge, `${scheme}: the checked edge is --text`).toBe(await colourOf('--text'))
      expect(checked.ringStyle, `${scheme}: the ring is drawn`).toBe('solid')
      expect(checked.ringWidth, `${scheme}: the ring is 2px`).toBe('2px')
      expect(checked.ring, `${scheme}: the ring is --focus`).toBe(await colourOf('--focus'))
      expect(checked.edge, `${scheme}: the edge is not the ring`).not.toBe(checked.ring)
      // The card that is neither checked nor focused has no ring.
      expect((await read('Sepia')).ringStyle, `${scheme}: no ring on the other card`).toBe('none')
    }
    await page.emulateMedia({ colorScheme: null })
  })
})

test('a chosen theme restyles the page in place, is stored, and asks the engine nothing', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    await openWithAPage(page, app, h)
    const address = await frame(page).getAttribute('src')
    expect(address, 'the project opens in the theme its record holds').toContain('theme=warm-dark')
    expect(await themeOf(page), 'the page boots in it').toBe('warm-dark')
    const asked = received(h, 'map.build').length

    // The page is moved to a later hour first. A reload would put its clock
    // back at the start of the day, and the hour it is left at is the
    // one thing a reload cannot hand back by itself.
    const LATER = 50_000
    await askPage(page, 'seek', LATER)
    expect((await stateOf(page))?.now, 'the page took the seek').toBe(LATER)
    const before = await factsOf(app)
    expect(before?.document, 'the page is a document with an identity to compare').toBeTruthy()

    // Everything a navigation of the frame would show, counted from here:
    // the interface's `load` on the frame element, and the frame's own
    // navigations.
    await frame(page).evaluate((element) => {
      const counted = window as unknown as { __loads?: number }
      counted.__loads = 0
      element.addEventListener('load', () => {
        counted.__loads = (counted.__loads ?? 0) + 1
      })
    })
    const navigated: string[] = []
    page.on('framenavigated', (moved) => {
      if (moved !== page.mainFrame() && moved.url().includes('controls=1'))
        navigated.push(moved.url())
    })

    await card(page, 'Sepia').click()
    await expect
      .poll(() => readRecord(h).theme, { message: 'the record holds the theme' })
      .toBe('sepia')
    await expect
      .poll(() => themeOf(page), { message: 'state().theme answers the new theme' })
      .toBe('sepia')

    // A reload, were one coming, is a state read, a navigation and a load
    // away from the press; the pause is longer than that, so the absences
    // below are the page's and not the clock's.
    await page.waitForTimeout(1500)

    expect(await frame(page).getAttribute('src'), 'the frame’s address did not change').toBe(
      address,
    )
    expect(
      await page.evaluate(() => (window as unknown as { __loads?: number }).__loads),
      'no load fired on the frame',
    ).toBe(0)
    expect(navigated, 'the frame was not navigated').toEqual([])
    const after = await factsOf(app)
    expect(after?.document, 'the page is the same document').toBe(before?.document)
    expect(after?.attribute, 'and it is wearing sepia').toBe('sepia')
    expect(after?.seen, 'it was told, in place').toContainEqual(['setTheme', 'sepia'])
    expect(after?.seen, 'and it still remembers the seek it was given').toContainEqual([
      'seek',
      LATER,
    ])
    expect((await stateOf(page))?.now, 'state().now was not reset').toBe(LATER)
    expect(received(h, 'map.build'), 'a theme is neither a layout nor a render').toHaveLength(asked)
    expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(1)

    // Back to the Library and in again: the fresh address carries the theme
    // of the moment it was made, which is the record's, and the page boots
    // in it before anything is sent.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(frame(page), 'the fresh address carries the chosen theme').toHaveAttribute(
      'src',
      /theme=sepia/,
    )
    await expect(radio(page, 'Sepia'), 'and the switch says Sepia').toBeChecked()
    await expect
      .poll(async () => (await factsOf(app))?.boot ?? null, {
        message: 'the first paint was sepia: the address gave it, before any call',
        timeout: 20_000,
      })
      .toBe('sepia')
    await expect.poll(() => themeOf(page), { message: 'and the page says so' }).toBe('sepia')
  })
})

// A page the engine wrote before v0.11.0 has no `setTheme`. Since issue 465
// such a page is redrawn from its stored layout as its project opens (the two
// tests after this one), so the case left is the one where that redraw
// cannot run: here, the engine is away. A choice made on the page then has
// nothing to show it but its address. The page says so ("this map cannot do
// that") and the viewer does what it did before the seam had a theme: the
// frame goes to the address with the project's theme, by the path a redraw
// takes, so the hour the page was at is given back.
test('a page with no setTheme is loaded again at the new theme, once, while the engine is away', async () => {
  test.setTimeout(120_000)
  const h = home()
  // Laid out with the engine there, and the older page written over the map.
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    themedPage(h, OLDER_PAGE)
  })
  const asked = received(h, 'map.build').length
  // Opened again with no engine, so nothing can redraw the page.
  await withApp(
    h,
    async (page, app) => {
      await expect(page.getByRole('status', { name: 'Engine' })).toContainText(
        /engine unavailable/i,
      )
      await page.getByRole('button', { name: 'Open Los Angeles' }).click()
      await openCell(page, 'style')
      await expect
        .poll(async () => (await factsOf(app))?.document ?? null, {
          message: 'the older page loaded in the map’s frame',
          timeout: 20_000,
        })
        .not.toBeNull()
      await expect
        .poll(() => stateOf(page), { message: 'the page answers state() through the bridge' })
        .not.toBeNull()
      const address = await frame(page).getAttribute('src')
      expect(address, 'the project opens in the theme its record holds').toContain(
        'theme=warm-dark',
      )
      expect(address, 'and on the page as it stands, not redrawn').toContain('redraw=0')

      const LATER = 50_000
      await askPage(page, 'seek', LATER)
      expect((await stateOf(page))?.now, 'the page took the seek').toBe(LATER)
      const before = await factsOf(app)
      expect(before?.document, 'the page is a document with an identity to compare').toBeTruthy()
      expect(before?.boot, 'and it booted in warm dark').toBe('warm-dark')

      await frame(page).evaluate((element) => {
        const counted = window as unknown as { __loads?: number }
        counted.__loads = 0
        element.addEventListener('load', () => {
          counted.__loads = (counted.__loads ?? 0) + 1
        })
      })
      const navigated: string[] = []
      page.on('framenavigated', (moved) => {
        if (moved !== page.mainFrame() && moved.url().includes('controls=1'))
          navigated.push(moved.url())
      })

      await card(page, 'Sepia').click()
      await expect
        .poll(() => readRecord(h).theme, { message: 'the record holds the theme' })
        .toBe('sepia')
      await expect(
        frame(page),
        'the page could not be told, so the frame was sent to the address with the new theme',
      ).toHaveAttribute('src', /theme=sepia/)
      await expect
        .poll(async () => (await factsOf(app))?.boot ?? null, {
          message: 'the page that arrived booted in sepia: its address said so',
          timeout: 20_000,
        })
        .toBe('sepia')

      // Once is once: a second navigation would be a state read and a load
      // away; the pause is longer than that.
      await page.waitForTimeout(1500)
      expect(
        await page.evaluate(() => (window as unknown as { __loads?: number }).__loads),
        'the frame loaded once',
      ).toBe(1)
      expect(navigated, 'and was navigated once').toHaveLength(1)
      const after = await factsOf(app)
      expect(after?.document, 'to a new document').not.toBe(before?.document)
      expect(after?.attribute, 'which is wearing sepia').toBe('sepia')
      expect(
        after?.seen,
        'and, as after a redraw, was given back the hour it was at',
      ).toContainEqual(['seek', LATER])
      expect(received(h, 'map.build'), 'nothing was drawn again').toHaveLength(asked)
      expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(1)
    },
    NO_ENGINE(h),
  )
})

// Issue 465: a project whose stored page an older engine drew is redrawn from
// its stored layout as it opens - one `map.build`, never a re-layout, for the
// day the map shows - and the page that arrives is told a theme in place,
// with no "this map cannot do that" and no reload of the frame for it.
test('a page an older engine drew is redrawn once as its project opens, and then takes a theme in place', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    themedPage(h, OLDER_PAGE)
    await page.getByRole('button', { name: 'Back to Library' }).click()
    const asked = received(h, 'map.build').length
    const day = readRecord(h).date
    expect(day, 'the layout chose a day').toBeTruthy()

    const stop = keepCurrentOverDrawn(h)
    try {
      await page.getByRole('button', { name: 'Open Los Angeles' }).click()
      await expect
        .poll(() => received(h, 'map.build').length, {
          message: 'the older page was redrawn as the project opened',
          timeout: 20_000,
        })
        .toBe(asked + 1)
      const sent = JSON.parse(received(h, 'map.build')[asked]) as {
        params?: { date?: unknown; layout?: unknown }
      }
      expect(sent.params?.date, 'for the day the map already showed').toBe(day)
      expect(sent.params?.layout, 'from the stored layout').toBe(readRecord(h).layout)
      await expect(
        frame(page),
        'and the frame was sent to the page the redraw wrote',
      ).toHaveAttribute('src', /redraw=1/)
      await expect
        .poll(async () => (await factsOf(app))?.seen ?? null, {
          message: 'the page that arrived can be told a theme: its restore told it one',
          timeout: 20_000,
        })
        .toContainEqual(['setTheme', 'warm-dark'])
    } finally {
      stop()
    }

    // Once: nothing redraws it again, and nothing was laid out.
    await page.waitForTimeout(1500)
    expect(received(h, 'map.build'), 'the page was redrawn once').toHaveLength(asked + 1)
    expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(1)
    expect(readRecord(h).date, 'and the day is the one it was').toBe(day)

    // A theme now is taken in place, as on any page the pinned engine drew.
    await openCell(page, 'style')
    await card(page, 'Sepia').click()
    await expect
      .poll(() => readRecord(h).theme, { message: 'the record holds the theme' })
      .toBe('sepia')
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the page was told the theme in place',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'sepia'])
    await expect.poll(() => themeOf(page), { message: 'and says so' }).toBe('sepia')
    await page.waitForTimeout(1500)
    const address = await frame(page).getAttribute('src')
    expect(address, 'the frame was not loaded again for it').not.toContain('reload=')
    expect(address, 'and is on the address the redraw sent it to').toContain('theme=warm-dark')
    expect(received(h, 'map.build'), 'and nothing was drawn for it').toHaveLength(asked + 1)
  })
})

test('a page the pinned engine drew is not redrawn as its project opens', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    themedPage(h, THEMED_PAGE)
    await page.getByRole('button', { name: 'Back to Library' }).click()
    const asked = received(h, 'map.build').length

    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the current page loaded and was given back its theme',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'warm-dark'])
    // Longer than a redraw takes to be asked for: the seam is asked after the
    // restore, and the stand-in answers a map.build in well under this.
    await page.waitForTimeout(2000)
    expect(received(h, 'map.build'), 'nothing was redrawn').toHaveLength(asked)
    await expect(frame(page), 'and the frame is on the page as it stood').toHaveAttribute(
      'src',
      /redraw=0/,
    )
  })
})

// Issue 494: a page with every seam the pinned page has is older still where
// its record says an engine below the running one drew it - a page engine
// v0.15.0 to v0.18.x drew has every seam - or names no engine at all, as
// every record drawn before the field does (decided by the maintainer, 25 Oct
// 2026); and the redraw's own write names the running engine, so it happens
// once. "Running" is the stand-in's `engine.info` here, which answers the
// pinned version or is refused.

/** An engine version below any pin this app has had since `drawn.engine` was kept. */
const OLDER_ENGINE = '0.18.1'

/** What the record's `drawn` says of the engine that drew the map. */
const drawnBy = (h: Home): unknown =>
  (readRecord(h).drawn as { engine?: unknown } | null | undefined)?.engine

/**
 * Write `engine` into the record's `drawn` as the engine that drew the map,
 * or, for null, take the field out, as a record an earlier engine's draw (or
 * a build from before the field) left behind: the whole file renamed
 * over the record, so a read never meets half of one. Called only once the
 * last opening's own write has landed (`openProject`), so nothing of the
 * app's is written over it.
 *
 * Windows refuses a rename over a file a reader has open, as the store's own
 * list may have it while the Library is shown, so a refusal of that kind is
 * tried again until a deadline, as `keepPageWritten` tries on its next tick.
 */
async function drawnByEngine(h: Home, engine: string | null): Promise<void> {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  const file = join(h.engineHome, 'projects', id, 'project.json')
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { drawn: Record<string, unknown> }
  const drawn = { ...raw.drawn }
  if (engine === null) delete drawn.engine
  else drawn.engine = engine
  writeFileSync(`${file}.next`, JSON.stringify({ ...raw, drawn }))
  const deadline = Date.now() + 5_000
  for (;;) {
    try {
      renameSync(`${file}.next`, file)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const refused = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (!refused || Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
}

for (const [names, engine] of [
  ['names an older engine', OLDER_ENGINE],
  ['names no engine, as one drawn before the field', null],
] as const)
  test(`a page with every seam is redrawn once as its project opens where its record ${names}`, async () => {
    test.setTimeout(120_000)
    const h = home()
    await withApp(h, async (page, app) => {
      await project(page, 'Los Angeles')
      await page.getByRole('button', { name: /lay out/i }).click()
      await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
      expect(drawnBy(h), 'the layout run named the engine that drew the map').toBe(PINNED_ENGINE)
      themedPage(h, THEMED_PAGE)
      await page.getByRole('button', { name: 'Back to Library' }).click()
      await drawnByEngine(h, engine)
      expect(drawnBy(h), 'the record names what the test wrote').toBe(engine ?? undefined)
      const asked = received(h, 'map.build').length
      const day = readRecord(h).date
      expect(day, 'the layout chose a day').toBeTruthy()

      // The page every redraw arrives at keeps every seam, so the only thing
      // older about the one the project opens on is the version its record names.
      const stop = keepPageWritten(h)
      try {
        await openProject(page, 'Los Angeles')
        await expect
          .poll(() => received(h, 'map.build').length, {
            message: 'the page an older engine drew was redrawn as the project opened',
            timeout: 20_000,
          })
          .toBe(asked + 1)
        const sent = JSON.parse(received(h, 'map.build')[asked]) as {
          params?: { date?: unknown; layout?: unknown }
        }
        expect(sent.params?.date, 'for the day the map already showed').toBe(day)
        expect(sent.params?.layout, 'from the stored layout').toBe(readRecord(h).layout)
        await expect(
          frame(page),
          'and the frame was sent to the page the redraw wrote',
        ).toHaveAttribute('src', /redraw=1/)
        await expect
          .poll(() => drawnBy(h), { message: 'the redraw’s write names the running engine' })
          .toBe(PINNED_ENGINE)
        await expect
          .poll(async () => (await factsOf(app))?.seen ?? null, {
            message: 'the page that arrived was given back its theme in place',
            timeout: 20_000,
          })
          .toContainEqual(['setTheme', 'warm-dark'])
      } finally {
        stop()
      }

      // Once: nothing redraws it again, and nothing was laid out.
      await page.waitForTimeout(1500)
      expect(received(h, 'map.build'), 'the page was redrawn once').toHaveLength(asked + 1)
      expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(1)
      expect(readRecord(h).date, 'and the day is the one it was').toBe(day)

      // And opened again, the record now names the running engine: not again.
      await page.getByRole('button', { name: 'Back to Library' }).click()
      await openProject(page, 'Los Angeles')
      await expect
        .poll(async () => (await factsOf(app))?.seen ?? null, {
          message: 'the page loaded again and was given back its theme',
          timeout: 20_000,
        })
        .toContainEqual(['setTheme', 'warm-dark'])
      await page.waitForTimeout(2000)
      expect(received(h, 'map.build'), 'nothing was redrawn on the second opening').toHaveLength(
        asked + 1,
      )
    })
  })

test('a page with every seam is not redrawn as its project opens where its record names the running engine, or a later one', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    themedPage(h, THEMED_PAGE)
    await page.getByRole('button', { name: 'Back to Library' }).click()
    expect(drawnBy(h), 'the record names the running engine').toBe(PINNED_ENGINE)
    const asked = received(h, 'map.build').length

    for (const engine of [PINNED_ENGINE, '99.0.0']) {
      await drawnByEngine(h, engine)
      await openProject(page, 'Los Angeles')
      await expect
        .poll(async () => (await factsOf(app))?.seen ?? null, {
          message: `the page drawn by ${engine} loaded and was given back its theme`,
          timeout: 20_000,
        })
        .toContainEqual(['setTheme', 'warm-dark'])
      // Longer than a redraw takes to be asked for: the seam is asked after
      // the restore, and the stand-in answers a map.build in well under this.
      await page.waitForTimeout(2000)
      expect(received(h, 'map.build'), `nothing was redrawn for ${engine}`).toHaveLength(asked)
      await expect(frame(page), 'and the frame is on the page as it stood').toHaveAttribute(
        'src',
        /redraw=0/,
      )
      expect(drawnBy(h), 'and the record still names it').toBe(engine)
      await page.getByRole('button', { name: 'Back to Library' }).click()
    }
  })
})

// Issue 517, decided 25 Oct 2026: a redraw on open that fails says so as an
// error in cell 03, in words for a person who pressed nothing, and the
// fallback issue 465 kept still holds - the page as it stands, a theme taken
// by loading it again at an address carrying the theme where the page has no
// `setTheme`, a trip refused with the old page's sentence where it has no
// `setTrip`. What cell 03 says still holds is built from the seams the page
// lacks, so the page in the second test, which lacks only the opening's two,
// is told neither and takes a theme in place.
//
// The refusal is the stand-in's own. The control file is read at each
// launch's start, so a second launch could be given `map_draws: false`; but
// that would never be reached. The stand-in keeps its layouts in memory and
// judges the layout before `map_draws`, so a stand-in started again holds
// none and refuses the redraw's `map.build` with its "no stored layout" hint
// whatever the control says - as an engine whose data was reset refuses one.
// So the first launch lays out with the map drawn, and the second, with the
// same control, opens the project.

/** What the stand-in answers a map.build for a layout it does not hold, as cell 03 says it. */
const noLayoutReason = (layout: unknown): string =>
  `la-metro-rail has no stored layout ${String(layout).slice(0, 8)}; lay the feed out first (graph.build).`

/**
 * Lay a project out with the map drawn, write `source` over the page, and
 * close the app: the first launch of the two below. Answers the record it
 * left, and how many map.build and graph.build the stand-in had read.
 */
async function laidOutWithPage(
  h: Home,
  source: string,
): Promise<{ first: Record<string, unknown>; drawn: number; laidOut: number }> {
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    themedPage(h, source)
  })
  const first = readRecord(h)
  expect(first.drawn, 'the layout drew the map, so the opening asks to redraw it').toBeTruthy()
  return {
    first,
    drawn: received(h, 'map.build').length,
    laidOut: received(h, 'graph.build').length,
  }
}

/**
 * Open the project on a second launch, once the engine is ready, and wait
 * for the opening's own write (`markOpened`), which raises the record's
 * revision; then wait for the redraw it asks for, and for cell 03 to fail.
 * Answers the record as it stood once the opening had written.
 */
async function openedAndRefused(
  page: Page,
  h: Home,
  drawn: number,
): Promise<Record<string, unknown>> {
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
  await openProject(page, 'Los Angeles')
  const opened = readRecord(h)
  await expect
    .poll(() => received(h, 'map.build').length, {
      message: 'the older page was asked to be redrawn as the project opened',
      timeout: 20_000,
    })
    .toBe(drawn + 1)
  await expect(
    page.locator('.cell[data-cell="03"]'),
    'the run is cell 03’s, failed',
  ).toHaveAttribute('data-state', 'error', { timeout: 20_000 })
  return opened
}

test('a redraw on open the engine refuses says so in cell 03, and the fallback still holds', async () => {
  test.setTimeout(180_000)
  const h = home()
  const { first, drawn, laidOut } = await laidOutWithPage(h, OLDER_PAGE)
  const reason = noLayoutReason(first.layout)

  await withApp(h, async (page, app) => {
    const before = await openedAndRefused(page, h, drawn)
    const frameCell = page.locator('.cell[data-cell="03"]')
    await expect(cellHeading(page, 'frame')).toHaveAccessibleName(
      /^03 Frame and service day failed/,
    )

    // Its error, first in the cell: what was tried and the engine's reason,
    // then what still holds of this page, which has no setTheme and no
    // setTrip.
    await openCell(page, 'frame')
    const body = frameCell.locator('.cell-body')
    const error = body.locator('p.message.error', { hasText: OPENING_REDRAW_FAILED })
    await expect(error, 'cell 03 says the redraw on open failed, and why').toHaveText(
      `${OPENING_REDRAW_FAILED} ${reason}`,
    )
    await expect(body.locator('p.prose', { hasText: ON_SCREEN_AS_IT_WAS })).toHaveText(
      openingFallback({ theme: true, trip: true }),
    )
    expect(
      await body.evaluate((element) => element.firstElementChild?.textContent ?? null),
      'and it is the first thing the cell says',
    ).toContain(OPENING_REDRAW_FAILED)
    // Cell 02's run panel points at cell 03, not at a day nobody chose.
    await expect(page.getByText(OPENING_REDRAW_STOPPED, { exact: true })).toHaveCount(1)
    await expect(page.getByText(/The map was not drawn for that day/)).toHaveCount(0)

    // Announced once: the header's alert, and nothing in the cell beside it.
    const alerts = page.getByRole('alert')
    const failure = alerts.filter({ hasText: 'Frame and service day failed' })
    await expect(failure, 'one alert says the cell failed').toHaveCount(1)
    await expect(failure).toHaveText('03 Frame and service day failed.')
    await expect(
      alerts.filter({ hasText: OPENING_REDRAW_FAILED }),
      'the cell’s words are not a second announcement of it',
    ).toHaveCount(0)

    // Its job is listed, failed, with the engine's reason.
    const toggle = page.getByRole('button', { name: /^Jobs, / })
    await toggle.click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    const job = inspector.getByRole('listitem', { name: /Rebuild for / })
    await expect(job, 'the redraw is the one job').toHaveCount(1)
    await expect(job).toHaveAttribute('data-state', 'failed')
    await expect(job.locator('.message.error')).toContainText('has no stored layout')
    await toggle.click()
    await expect(inspector).toHaveCount(0)

    // The map stays as it was: the older page, on the address it opened on.
    await expect
      .poll(async () => (await factsOf(app))?.document ?? null, {
        message: 'the older page is in the map’s frame',
        timeout: 20_000,
      })
      .not.toBeNull()
    await expect(frame(page), 'the frame was not sent to a new page').toHaveAttribute(
      'src',
      /redraw=0/,
    )

    // A trip is refused with the old page's sentence, and writes nothing.
    const trip = page.getByRole('region', { name: TRIP, exact: true })
    await chooseStation(trip, START, 'alp')
    await chooseStation(trip, END, 'bra')
    await expect(trip.locator('.trip-instead'), 'a trip has the old page’s sentence').toHaveText(
      OLD_PAGE,
    )
    expect(readRecord(h), 'nothing was written to the record').toEqual(before)

    // A theme goes by the address: the page cannot be told one.
    await openCell(page, 'style')
    await card(page, 'Sepia').click()
    await expect
      .poll(() => readRecord(h).theme, { message: 'the record holds the theme' })
      .toBe('sepia')
    await expect(
      frame(page),
      'the page could not be told, so the frame was sent to the address with the new theme',
    ).toHaveAttribute('src', /theme=sepia/)
    await expect
      .poll(async () => (await factsOf(app))?.boot ?? null, {
        message: 'the page that arrived booted in sepia: its address said so',
        timeout: 20_000,
      })
      .toBe('sepia')
    // Once, after all of that: nothing redrew it again or laid anything out.
    expect(received(h, 'map.build'), 'the redraw was asked once').toHaveLength(drawn + 1)
    expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(laidOut)
    await expect(failure, 'and the alert still says it, unchanged').toHaveText(
      '03 Frame and service day failed.',
    )
  })
})

test('a page lacking only the opening’s seams is told nothing of a theme or a trip, and takes a theme in place', async () => {
  test.setTimeout(180_000)
  const h = home()
  const { first, drawn } = await laidOutWithPage(h, NO_OPENING_PAGE)

  await withApp(h, async (page, app) => {
    await openedAndRefused(page, h, drawn)
    await openCell(page, 'frame')
    const body = page.locator('.cell[data-cell="03"] .cell-body')
    await expect(body.locator('p.message.error', { hasText: OPENING_REDRAW_FAILED })).toHaveText(
      `${OPENING_REDRAW_FAILED} ${noLayoutReason(first.layout)}`,
    )
    // The page has setTheme and setTrip: only that the map stays as it was.
    await expect(body.locator('p.prose', { hasText: ON_SCREEN_AS_IT_WAS })).toHaveText(
      ON_SCREEN_AS_IT_WAS,
    )
    await expect(body).not.toContainText(THEME_BY_RELOAD)
    await expect(body).not.toContainText(NO_TRIP_ON_IT)

    // And a theme is taken in place, as the cell did not say otherwise.
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the page on screen was given back its theme',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'warm-dark'])
    await openCell(page, 'style')
    await card(page, 'Sepia').click()
    await expect
      .poll(() => readRecord(h).theme, { message: 'the record holds the theme' })
      .toBe('sepia')
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the page was told the theme in place',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'sepia'])
    await expect.poll(() => themeOf(page), { message: 'and says so' }).toBe('sepia')
    const address = await frame(page).getAttribute('src')
    expect(address, 'the frame was not loaded again for it').not.toContain('reload=')
    expect(address, 'and is on the address it opened on').toContain('theme=warm-dark')
    expect(received(h, 'map.build'), 'and nothing was drawn for it').toHaveLength(drawn + 1)
  })
})

// Issue 494 with 517: a page older only by the version its record names has
// every seam, so where its redraw fails cell 03 says the opening's words and
// the engine's reason, then only that the map stays as it was - neither the
// theme's sentence nor the trip's is true of it - and it takes a theme in place.
test('a page older only by its record’s engine, whose redraw on open fails, is told nothing of a theme or a trip', async () => {
  test.setTimeout(180_000)
  const h = home()
  const { first, drawn } = await laidOutWithPage(h, THEMED_PAGE)
  expect((first.drawn as { engine?: unknown }).engine, 'the layout named the running engine').toBe(
    PINNED_ENGINE,
  )
  await drawnByEngine(h, OLDER_ENGINE)

  await withApp(h, async (page, app) => {
    await openedAndRefused(page, h, drawn)
    await openCell(page, 'frame')
    const body = page.locator('.cell[data-cell="03"] .cell-body')
    await expect(body.locator('p.message.error', { hasText: OPENING_REDRAW_FAILED })).toHaveText(
      `${OPENING_REDRAW_FAILED} ${noLayoutReason(first.layout)}`,
    )
    await expect(body.locator('p.prose', { hasText: ON_SCREEN_AS_IT_WAS })).toHaveText(
      ON_SCREEN_AS_IT_WAS,
    )
    await expect(body).not.toContainText(THEME_BY_RELOAD)
    await expect(body).not.toContainText(NO_TRIP_ON_IT)
    expect(drawnBy(h), 'nothing was drawn, so the record still names the older engine').toBe(
      OLDER_ENGINE,
    )

    // And a theme is taken in place, as the cell did not say otherwise.
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the page on screen was given back its theme',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'warm-dark'])
    await openCell(page, 'style')
    await card(page, 'Sepia').click()
    await expect
      .poll(async () => (await factsOf(app))?.seen ?? null, {
        message: 'the page was told the theme in place',
        timeout: 20_000,
      })
      .toContainEqual(['setTheme', 'sepia'])
    const address = await frame(page).getAttribute('src')
    expect(address, 'the frame was not loaded again for it').not.toContain('reload=')
    expect(received(h, 'map.build'), 'and nothing was drawn for it').toHaveLength(drawn + 1)
  })
})

/**
 * Choose a station from the keyboard, as `trip.spec.ts` does: focus the
 * picker, type part of its name, Down to the first match, Enter.
 */
async function chooseStation(trip: Locator, name: string, typed: string): Promise<void> {
  const field = trip.getByRole('combobox', { name, exact: true })
  await field.focus()
  await field.fill('')
  await field.pressSequentially(typed)
  await field.press('ArrowDown')
  await field.press('Enter')
}

test('a page a run has rewritten arrives in the theme chosen before the run', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    await openWithAPage(page, app, h)
    await card(page, 'Sepia').click()
    await expect
      .poll(() => themeOf(page), { message: 'the page took sepia in place' })
      .toBe('sepia')
    const first = await factsOf(app)
    // How many runs the address says have rewritten the page this screen has
    // been open for: a run is a new document, and the address says so.
    const redrawsOf = async (): Promise<number> =>
      Number(new URL((await frame(page).getAttribute('src')) ?? 'x:/').searchParams.get('redraw'))
    const redraws = await redrawsOf()

    const stop = keepPageWritten(h)
    try {
      // A rebuild from the stored layout: the one press that rewrites the
      // page file without laying anything out.
      await openCell(page, 'frame')
      await cell(page, 'frame').getByLabel('Draw for another day').fill('2026-06-20')
      await cell(page, 'frame').getByRole('button', { name: 'Draw for this day' }).click()
      await expect
        .poll(() => received(h, 'map.build').length, {
          message: 'the run drew the map again',
          timeout: 30_000,
        })
        .toBe(2)
      await expect
        .poll(async () => (await factsOf(app))?.document ?? first?.document, {
          message: 'the frame went to a new document: the run rewrote the page',
          timeout: 30_000,
        })
        .not.toBe(first?.document)
      expect(await redrawsOf(), 'the address counts the run').toBe(redraws + 1)
      expect(
        await frame(page).getAttribute('src'),
        'the address for the rewritten page carries the theme chosen before it',
      ).toContain('theme=sepia')

      await expect
        .poll(async () => (await factsOf(app))?.boot ?? null, {
          message: 'the new document’s first paint was sepia: its address said so',
          timeout: 20_000,
        })
        .toBe('sepia')
      await expect
        .poll(() => themeOf(page), { message: 'and state().theme answers sepia after the rewrite' })
        .toBe('sepia')
      await expect
        .poll(async () => (await factsOf(app))?.seen?.[0] ?? null, {
          message: 'the viewer’s first call to the new document is the project’s theme',
          timeout: 20_000,
        })
        .toEqual(['setTheme', 'sepia'])
    } finally {
      stop()
    }
    expect(readRecord(h).theme, 'the record still holds it').toBe('sepia')
  })
})

test('the map keeps its own theme whatever the interface is wearing', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    // The interface's own theme is a separate setting; the map does not
    // follow it, which is the behaviour this feature changes.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('sepia')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(frame(page)).toHaveAttribute('src', /theme=warm-dark/)
  })
})

test('the switch is out of reach while a run is going, because the page is being rewritten', async () => {
  const h = home({ progress_delay_ms: 400 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    const sepia = radio(page, 'Sepia')
    await expect(sepia).toBeEnabled()

    await page.getByRole('button', { name: /lay out/i }).click()
    // `map.build` writes the project's page in place and then sends the
    // frame to the result: a choice now would restyle a document that is
    // about to go, and nothing on screen would show it taking.
    await expect(sepia).toBeDisabled()
    // And it says why, where the switch is: the run's own panel is
    // elsewhere on the screen and tied to this section by nothing a screen
    // reader can follow (FR-008).
    await expect(switchOf(page).getByRole('status')).toContainText(/waits until the run/)
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(sepia).toBeEnabled()
  })
})

test('focus is handed over before the radios go, when a timer closes the way', async () => {
  const h = home({ progress_delay_ms: 400 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    // A change of the line order is debounced, so its build starts from a
    // timer with nobody pressing anything - and Chromium blurs a disabled
    // element, so the radios going would take the focus to the body. (A
    // colour is not the way to this: since issue 262 it builds in the press
    // that releases it, so the way closes under a person who has just
    // pressed, and there is no gap to put focus in.)
    await cell(page, 'lines').getByRole('button', { name: 'Move line A down', exact: true }).click()

    // Inside the order's debounce, with focus moved into the theme switch.
    const sepia = radio(page, 'Sepia')
    await sepia.focus()
    await expect(sepia).toBeFocused()

    await expect(sepia).toBeDisabled({ timeout: 30_000 })
    // The cell's heading row is the panel's heading now (A5.5-08), so that
    // is where focus is handed when the radios go.
    await expect(cellHandback(page, 'style')).toBeFocused()
  })
})

test('the switch still says which theme is chosen after a rebuild has disabled it and given it back', async () => {
  const h = home({ progress_delay_ms: 400 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const warm = radio(page, 'Warm dark')
    const sepia = radio(page, 'Sepia')
    const builds = received(h, 'map.build').length

    // A colour change rebuilds the map from the stored layout, and the
    // switch is disabled while it runs. The kit's buttons lost their
    // pressed state to a re-sync doing it, so after the first rebuild
    // neither theme was announced as chosen (issue 124); the radios are
    // native and a fieldset going unavailable and coming back leaves what
    // was checked checked, which is asserted rather than assumed.
    const colours = cell(page, 'lines')
    await colours.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = colours.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()
    await expect(sepia).toBeDisabled({ timeout: 30_000 })
    await expect
      .poll(() => received(h, 'map.build').length, { timeout: 30_000 })
      .toBeGreaterThan(builds)
    await expect(sepia).toBeEnabled({ timeout: 30_000 })
    await expect(warm).toBeEnabled()

    await expect(warm).toBeChecked()
    await expect(sepia).not.toBeChecked()

    await card(page, 'Sepia').click()
    await expect.poll(() => readRecord(h).theme).toBe('sepia')
    await expect(sepia).toBeChecked()
    await expect(warm).not.toBeChecked()
  })
})

test('two choices inside one write end where the second asked, not the first', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await card(page, 'Sepia').click()
    await card(page, 'Warm dark').click()
    await expect(radio(page, 'Warm dark')).toBeChecked()
    await expect.poll(() => readRecord(h).theme).toBe('warm-dark')
    await expect(radio(page, 'Warm dark')).toBeChecked()
    await expect(radio(page, 'Sepia')).not.toBeChecked()
  })
})

test('a write that fails says so where the switch is, and changes nothing', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    // The project's folder goes while it is open, which is the shape of
    // every write that cannot land: a disk that has gone, a permission that
    // has changed, a record removed from under the app.
    const [id] = readdirSync(join(h.engineHome, 'projects'))
    rmSync(join(h.engineHome, 'projects', id), { recursive: true, force: true })

    await card(page, 'Sepia').click()
    await expect(switchOf(page).getByRole('alert')).toBeVisible()
    // And the switch still shows what the project actually is: the card
    // that showed the choice while it was being written lets it go.
    await expect(radio(page, 'Warm dark')).toBeChecked()
    await expect(radio(page, 'Sepia')).not.toBeChecked()
  })
})

test('an export is planned in the theme the project is drawn in', async () => {
  const h = home({ encode_delay_ms: 600 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await card(page, 'Sepia').click()
    await expect.poll(() => readRecord(h).theme).toBe('sepia')

    // The stand-in engine's placeholder page cannot be captured; the
    // fixture that animates goes over it, as the export's own suite does.
    const [id] = readdirSync(join(h.engineHome, 'projects'))
    copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))

    // The export is on its own tab (A5-01). Its preview plans too, so the
    // press waits for the preview to have answered - cell 06's frame at the
    // reel's shape - or a late preview's plan could land beside the
    // export's own.
    await openCell(page, 'export')
    await expect
      .poll(
        async () =>
          new URL((await exportFrame(page).getAttribute('src')) ?? 'x:/').searchParams.get('frame'),
        {
          timeout: 20_000,
        },
      )
      .toBe('1080:1920')
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(page.getByText(/Planning|Capturing|Encoding/)).toBeVisible({
      timeout: 30_000,
    })
    // The switch is out of reach while the export runs: the theme it was
    // planned with is the theme the reel will have, whatever is chosen now
    // (FR-008). Closing the export's cell does not stop the export; the
    // encode is slowed so the export is still going.
    await closeCell(page, 'export')
    await expect(radio(page, 'Warm dark')).toBeDisabled()

    await expect
      .poll(() => received(h, 'export.encode').length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    // The export's own plan: the export tab plans previews too, so the last
    // plan overall may be a preview's.
    const lines = readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8').split('\n')
    const encode = lines.findIndex((line) => line.includes('"method": "export.encode"'))
    let plan: string | undefined
    // The nearest plan before the encode that is the reel's and does not
    // ask for the safe zones: a preview of the reel always does.
    for (let i = encode - 1; i >= 0 && plan === undefined; i--)
      if (
        lines[i].includes('"method": "export.plan"') &&
        lines[i].includes('"preset": "instagram-reel"') &&
        !lines[i].includes('"safe"')
      )
        plan = lines[i]
    // The engine's own word for it, and the page the capture drives carries
    // the page's own word.
    expect(plan).toContain('"theme": "light"')
  })
})
