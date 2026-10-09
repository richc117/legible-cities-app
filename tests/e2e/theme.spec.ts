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
  type Page,
} from '@playwright/test'
import { isTheme, type Theme } from '../../src/shared/project'
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
 * theme its address names, as every generated page has.
 */
const pageSource = (current: boolean): string =>
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
    ...(current
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
    '</script></body>',
  ].join('\n')

const THEMED_PAGE = pageSource(true)
const OLDER_PAGE = pageSource(false)

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

// A page the engine wrote before v0.11.0 has no `setTheme`, and nothing would
// show a choice made on one. The page says so ("this map cannot do that") and the
// viewer does what it did before the seam had a theme: the frame goes to the
// address with the project's theme, by the path a redraw takes, so the hour
// the page was at is given back.
test('a page with no setTheme is loaded again at the new theme, once', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    await openWithAPage(page, app, h, OLDER_PAGE)
    const address = await frame(page).getAttribute('src')
    expect(address, 'the project opens in the theme its record holds').toContain('theme=warm-dark')
    const asked = received(h, 'map.build').length

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
    expect(after?.seen, 'and, as after a redraw, was given back the hour it was at').toContainEqual(
      ['seek', LATER],
    )
    expect(received(h, 'map.build'), 'nothing was drawn again').toHaveLength(asked)
    expect(received(h, 'graph.build'), 'and nothing was laid out').toHaveLength(1)
  })
})

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
