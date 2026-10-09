// The design system on the built app, in both themes: the theme follows
// the platform's colour-scheme preference, which Playwright emulates per
// page (it forces a light scheme unless told otherwise, so nativeTheme is
// not the lever here), and the status line, a Library card, a kit button
// and a dialog's input measure what docs/DESIGN.md says. No engine is
// needed; the status line reads "unavailable" and that is a state like
// any other.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { Api } from '../../src/shared/api'

const repoRoot = resolve(__dirname, '../..')
type Bridge = { api: Api }

async function withApp(
  run: (page: Page, app: ElectronApplication, home: string) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-design-'))
  const missing = join(home, 'nowhere', process.platform === 'win32' ? 'python.exe' : 'python')
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, SCHEMATIC_HOME: home, LEGIBLE_ENGINE_PYTHON: missing } as Record<
      string,
      string
    >,
    timeout: 30_000,
  })
  const child = app.process()
  try {
    await run(await app.firstWindow(), app, home)
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

async function setTheme(page: Page, source: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: source })
}

const px = (value: string): number => Number.parseFloat(value)

test('follows the platform theme and measures as the design document says', async () => {
  await withApp(async (page) => {
    // A project, so the Library has a card to measure.
    await page.evaluate(() =>
      (globalThis as unknown as Bridge).api.projects.create({
        name: 'Measured',
        feed: 'la-metro-rail',
      }),
    )
    await page.reload()

    // The focus ring is cobalt, the brand's accent, in both themes.
    for (const [source, attribute, focus] of [
      ['dark', null, 'rgb(111, 155, 255)'],
      ['light', 'sepia', 'rgb(42, 91, 181)'],
    ] as const) {
      await setTheme(page, source)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(attribute)

      const status = page.getByRole('status', { name: 'Engine' })
      await expect(status).toContainText(/engine unavailable/i)
      const statusStyle = await status.evaluate((el) => {
        const s = getComputedStyle(el)
        return { fontSize: s.fontSize, lineHeight: s.lineHeight }
      })
      expect(px(statusStyle.fontSize)).toBe(12)
      expect(px(statusStyle.lineHeight)).toBe(16)

      const card = page.getByRole('button', { name: 'Open Measured' })
      const cardBox = await card.boundingBox()
      expect(cardBox?.height).toBeGreaterThanOrEqual(28)
      expect(px(await card.evaluate((el) => getComputedStyle(el).fontSize))).toBe(13)

      // A kit button: the document's control height on the host element
      // (the role resolves to the kit's inner button), the app's focus ring.
      // The header's Settings, an icon and a label: the Library's own New
      // project is a card since issue 287, not a kit button.
      const settings = page.getByRole('button', { name: 'Settings' })
      const host = page.locator('.app-header fig-button', { hasText: 'Settings' })
      // Between its icon and its label the kit button holds --space-2-2:
      // its shadow style declares no gap (issue 273).
      const gap = await host.evaluate((el) => {
        const icon = el.querySelector('.icon')
        if (!icon) return null
        return parseFloat(getComputedStyle(icon).marginInlineEnd)
      })
      expect(gap, 'the icon-to-label gap on Settings').toBe(4)
      const box = await host.boundingBox()
      // The document's rule is a size, 28px, not a minimum: equal within a
      // pixel, since the layout engine returns 27.9995 for a 16px line
      // height plus padding on some displays.
      expect(box?.height, "a control is the document's height, within a pixel").toBeCloseTo(28, 0)
      // The kit draws the focus ring on the host (delegated focus).
      await settings.focus()
      const ring = await host.evaluate((el) => getComputedStyle(el).outlineColor)
      expect(ring).toBe(focus)

      // The background is the theme's surface, and the kit's button took it too.
      const surfaces = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return {
          body: getComputedStyle(document.body).backgroundColor,
          surface: root.getPropertyValue('--surface').trim(),
          figma: root.getPropertyValue('--figma-color-bg').trim(),
        }
      })
      // Computed custom properties come back resolved, so the chain
      // --figma-color-bg -> --surface -> --bg is one colour at the end.
      const expected = source === 'dark' ? '#1a1410' : '#f5e6c8'
      expect(surfaces.surface).toBe(expected)
      expect(surfaces.figma).toBe(expected)
      expect(surfaces.body).toBe(source === 'dark' ? 'rgb(26, 20, 16)' : 'rgb(245, 230, 200)')
    }
  })
})

test("a cell's prose is 16px on 24px lines, in the serif, in both themes", async () => {
  // Issue 280: the prose track was the sites' 18px on 1.72, 5px
  // above the 13px chrome beside it. The face is the brand's and stays.
  await withApp(async (page) => {
    await page.evaluate(() =>
      (globalThis as unknown as Bridge).api.projects.create({
        name: 'Measured',
        feed: 'la-metro-rail',
      }),
    )
    await page.reload()
    await page.getByRole('button', { name: 'Open Measured' }).click()
    const prose = page.locator('.cell p.prose').first()
    await expect(prose).toBeVisible()
    for (const source of ['dark', 'light'] as const) {
      await setTheme(page, source)
      const style = await prose.evaluate((el) => {
        const s = getComputedStyle(el)
        return { size: s.fontSize, line: s.lineHeight, face: s.fontFamily }
      })
      expect(px(style.size), source).toBe(16)
      expect(px(style.line), source).toBe(24)
      expect(style.face, source).toMatch(/Iowan Old Style/)
    }
  })
})

test('a Library card holds what it has, at the narrowest column and at the fluid widths', async () => {
  // Issue 287 (ADR-047), by issue 269's method. "Your projects" is a grid
  // of cards at `--card-min-width`, the New project card first; a card's
  // name and each of its facts start a line of their own, may wrap to a
  // second and are clamped there. Nothing a card holds may run out of it,
  // and what a line loses to its clamp stays in the document and in the
  // card's name. Measured at the window's narrowest,
  // where the column is 608 wide and two cards fit to a row (A7-05), and at
  // two fluid widths, 868 with three to a row and the widest column, 1024,
  // with four, where a card is narrowest after the minimum; the window's own
  // width rather than an emulated one, since the app sets the window and it
  // is the window a person drags.
  await withApp(async (page, app, home) => {
    const long = 'Los Angeles County Metropolitan Transportation Authority, Metro Rail'
    // As long as a name may be, with nowhere in it to break.
    const unbroken = 'Metropolitan'.repeat(10)
    for (const name of ['Short', long, unbroken])
      await page.evaluate(
        (name) =>
          (globalThis as unknown as Bridge).api.projects.create({ name, feed: 'la-metro-rail' }),
        name,
      )
    // And one the map was drawn for, with the engine's thumbnail beside its
    // page in both palettes (ADR-047): a drawing much taller than the
    // picture area's 16:10, which has to be fitted whole and cannot make the
    // area, or the card, any bigger. There is no engine here; the record and
    // the files are what the engine and the layout run leave.
    const pictured = await page.evaluate(async () => {
      const api = (globalThis as unknown as Bridge).api
      const made = await api.projects.create({ name: 'Pictured', feed: 'la-metro-rail' })
      await api.projects.completeLayout(made.id, {
        date: '2026-09-02',
        layout: 'a'.repeat(64),
        made: '2026-09-10T12:00:00+00:00',
        built: { mode: 'all', agency: null },
        service: {
          start: '2026-01-01',
          end: '2026-12-31',
          busiest: '2026-09-15',
          anchor: '2026-09-08',
        },
      })
      return made.id
    })
    mkdirSync(join(home, 'out', pictured), { recursive: true })
    for (const [palette, ink] of [
      ['dark', '#f2ede6'],
      ['light', '#2d241d'],
    ])
      writeFileSync(
        join(home, 'out', pictured, `la-metro-rail-thumb-${palette}.svg`),
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 400">' +
          `<rect width="100" height="400" fill="${ink}"/></svg>`,
      )
    await page.reload()
    const list = page.getByRole('list', { name: 'Projects' })
    const cards = list.getByRole('button')
    // New project and the four projects, New project first.
    await expect(cards).toHaveCount(5)
    await expect(cards.first()).toHaveAccessibleName('New project')
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll('.card-picture img')].every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
      )
      .toBe(true)
    // The clamp is the stylesheet's alone: the whole name is the card's
    // accessible name, and is in the document.
    await expect(list.getByRole('button', { name: `Open ${unbroken}` })).toHaveCount(1)

    // Asked for 640 and read back: a platform that will not make it quite
    // that narrow (this display's window manager gave 584 once) still gives
    // a column as narrow as the test needs. The wider two are asked as
    // `preview.spec.ts`'s roomy() asks: a display narrower than the size (a
    // Windows runner's is 1024) leaves the window as wide as it can be, and
    // every assertion below holds at any width, so the test carries on at
    // what it got and says so. 1100 is enough for the widest column, which
    // `--measure-wide` caps at 1024.
    for (const asked of [640, 900, 1100]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, 720)
      }, asked)
      if (asked === 640)
        await expect
          .poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 })
          .toBeLessThanOrEqual(700)
      else
        try {
          await expect
            .poll(() => page.evaluate(() => window.innerWidth), { timeout: 5_000 })
            .toBeGreaterThan(asked - 100)
        } catch {
          test.info().annotations.push({
            type: 'window smaller than asked',
            description: `asked ${asked} wide, got ${await page.evaluate(() => window.innerWidth)}`,
          })
        }
      const at = `a ${await page.evaluate(() => window.innerWidth)}px window`

      const measured = await cards.evaluateAll((all) =>
        all.map((card) => {
          const box = card.getBoundingClientRect()
          const style = getComputedStyle(card)
          const inner = {
            left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
            right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
            top: box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
            bottom:
              box.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom),
          }
          // Every part a card draws: the picture area, the name, each fact
          // and the chip. Each must sit inside the card's padding.
          const parts = [
            ...card.querySelectorAll('.card-picture, .card-name, .card-fact, .card-chip'),
          ]
          const outside = parts
            .map((part) => ({ part, r: part.getBoundingClientRect() }))
            .filter(
              ({ r }) =>
                r.left < inner.left - 1 ||
                r.right > inner.right + 1 ||
                r.top < inner.top - 1 ||
                r.bottom > inner.bottom + 1,
            )
            .map(({ part }) => part.className)
          // A line that lost text to its clamp or its ellipsis, and whether
          // its whole text is still in the document.
          const cut = parts
            .filter(
              (part) =>
                part.scrollWidth > part.clientWidth || part.scrollHeight > part.clientHeight,
            )
            .map((part) => part.className)
          const name = card.querySelector('.card-name') as HTMLElement
          // The picture, where there is one: whole inside its area, which
          // keeps its ratio and holds it, and an empty alternative text.
          const area = card.querySelector('.card-picture') as HTMLElement
          const image = area.querySelector('img')
          const areaBox = area.getBoundingClientRect()
          const imageBox = image?.getBoundingClientRect()
          return {
            picture:
              image === null || imageBox === undefined
                ? null
                : {
                    alt: image.getAttribute('alt'),
                    inside:
                      imageBox.left >= areaBox.left - 1 &&
                      imageBox.right <= areaBox.right + 1 &&
                      imageBox.top >= areaBox.top - 1 &&
                      imageBox.bottom <= areaBox.bottom + 1,
                    ratio: areaBox.width / areaBox.height,
                    clipped:
                      area.scrollWidth > area.clientWidth || area.scrollHeight > area.clientHeight,
                  },
            label: card.getAttribute('aria-label') ?? card.textContent ?? '',
            width: box.width,
            // The kit gives a button whose descendant's first child is an
            // svg - the picture area's glyph - a small left padding that
            // outranks a class; the card restates its own (issue 274).
            edges: [style.paddingLeft, style.paddingRight],
            outside,
            cut,
            // Whatever the card holds, words or not.
            held: card.scrollHeight <= card.clientHeight && card.scrollWidth <= card.clientWidth,
            nameText: name.textContent ?? '',
            nameLines: Math.round(
              name.clientHeight / parseFloat(getComputedStyle(name).lineHeight),
            ),
            nameClamped: name.scrollHeight > name.clientHeight + 1,
          }
        }),
      )
      // The window is the window, however long a name: the shell's one
      // column once took the unbroken name's width as its own, and the page
      // scrolled sideways (A7-05).
      const sideways = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }))
      expect(sideways.scroll, `${at}: the page does not scroll sideways`).toBeLessThanOrEqual(
        sideways.client,
      )
      const minimum = await page.evaluate(
        () =>
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--card-min-width'),
          ) * parseFloat(getComputedStyle(document.documentElement).fontSize),
      )
      for (const card of measured) {
        expect(card.edges, `${at}, ${card.label}: its own padding on both sides`).toEqual([
          '12px',
          '12px',
        ])
        expect(card.outside, `${at}, ${card.label}: nothing outside the card`).toEqual([])
        expect(card.held, `${at}, ${card.label}: the card holds all it has`).toBe(true)
        expect(
          card.nameLines,
          `${at}, ${card.label}: the name on two lines at most`,
        ).toBeLessThanOrEqual(2)
        // One grid of one card: every card as wide as the first, and never
        // narrower than the token.
        expect(card.width, `${at}, ${card.label}: as wide as the others`).toBeCloseTo(
          measured[0].width,
          0,
        )
        expect(
          card.width,
          `${at}, ${card.label}: at --card-min-width at least`,
        ).toBeGreaterThanOrEqual(minimum - 0.5)
      }
      const named = (name: string): (typeof measured)[number] | undefined =>
        measured.find((card) => card.label === `Open ${name}`)
      // The card this test is about is one whose name has to be clamped, so
      // it says so if this one was not; and the clamp keeps every letter in
      // the document. A name that fits is never broken to make room.
      expect(named(unbroken)?.nameClamped, `${at}: the unbroken name is clamped`).toBe(true)
      expect(named(unbroken)?.nameText, `${at}: the whole name is in the document`).toBe(unbroken)
      // The thumbnail is inside its area, at the area's ratio, with an empty
      // alternative text, and the card is named as any other project's is.
      const shown = named('Pictured')
      expect(shown?.picture?.alt, `${at}: the thumbnail has an empty alternative text`).toBe('')
      expect(shown?.picture?.inside, `${at}: the thumbnail is inside its area`).toBe(true)
      expect(shown?.picture?.clipped, `${at}: the area clips nothing`).toBe(false)
      expect(shown?.picture?.ratio, `${at}: the area is 16:10`).toBeCloseTo(1.6, 1)
      expect(named('Short')?.picture, `${at}: a project not drawn has no image`).toBeNull()
      expect(named('Short')?.nameLines, `${at}: a short name is on one line`).toBe(1)
      expect(named('Short')?.cut, `${at}: nothing of a short card is cut`).toEqual([])
    }

    // And the sample cities' heading, which is there with or without an
    // engine, is under the last card.
    const last = await cards.last().evaluate((el) => el.getBoundingClientRect().bottom)
    const after = await page
      .getByRole('heading', { level: 2, name: 'Sample cities' })
      .evaluate((el) => el.getBoundingClientRect().top)
    expect(after, 'the heading after the grid is under it').toBeGreaterThanOrEqual(last)
  })
})

test('with no projects the New project card keeps its slot, and the quiet line its place', async () => {
  // ADR-047: "Your projects" with none holds the New project card in its
  // first slot and the quiet line beside it, where the projects will go.
  // Where only one card fits to a row - a zoomed window, a reflow - there is
  // nothing beside it, and the line goes under the card, which stays as
  // wide as the row as every card is. The window itself is sized, as the
  // cards test sizes it, and every judgement is made at the width it gave:
  // a window manager may give less than is asked (584 for 640, once).
  await withApp(async (page, app) => {
    const list = page.getByRole('list', { name: 'Projects' })
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(
      page.getByText('Projects you make appear here, most recently opened first.', {
        exact: true,
      }),
    ).toBeVisible()

    const sized = async (asked: number, most: number): Promise<number> => {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, 720)
      }, asked)
      await expect
        .poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 })
        .toBeLessThanOrEqual(most)
      return page.evaluate(() => window.innerWidth)
    }

    const seen: string[] = []
    const judge = async (width: number): Promise<void> => {
      const m = await page.evaluate(() => {
        const wrap = document.querySelector('.projects') as HTMLElement
        const box = (el: Element): { left: number; right: number; top: number; bottom: number } => {
          const r = el.getBoundingClientRect()
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }
        const line = wrap.querySelector(':scope > .hint') as HTMLElement
        const root = getComputedStyle(document.documentElement)
        return {
          wrap: box(wrap),
          card: box(wrap.querySelector('.card') as Element),
          line: box(line),
          // The line wraps where it must and runs out of nothing.
          lineHeld: line.scrollWidth <= line.clientWidth,
          tracks: getComputedStyle(wrap).gridTemplateColumns.split(' ').length,
          gap: parseFloat(getComputedStyle(wrap).columnGap),
          least: parseFloat(root.getPropertyValue('--card-min-width')) * parseFloat(root.fontSize),
        }
      })
      const at = `a ${width}px window`
      const row = m.wrap.right - m.wrap.left
      // What the container query decides: two cards and the gap between
      // them fit, or one card fills the row.
      const two = row >= 2 * m.least + m.gap
      seen.push(two ? 'beside' : 'under')
      // As wide as one track of the cards' grid: the row less its gaps,
      // shared out - the whole row where one card fills it.
      const track = (row - m.gap * (m.tracks - 1)) / m.tracks
      expect(m.card.right - m.card.left, `${at}: the card is one track wide`).toBeCloseTo(track, 0)
      expect(m.card.left, `${at}: the card is first`).toBeCloseTo(m.wrap.left, 0)
      expect(m.line.right, `${at}: the line inside the region`).toBeLessThanOrEqual(
        m.wrap.right + 1,
      )
      expect(m.lineHeld, `${at}: the line holds its words`).toBe(true)
      if (two) {
        expect(m.tracks, `${at}: more than one card fits to a row`).toBeGreaterThan(1)
        expect(m.line.top, `${at}: the line on the card's row`).toBeLessThan(m.card.bottom)
        expect(m.line.left, `${at}: the line beside the card`).toBeGreaterThanOrEqual(m.card.right)
      } else {
        // A track the grid made for the line would show here as a second
        // column, and the card would be narrower than the row.
        expect(m.tracks, `${at}: one card fills the row`).toBe(1)
        expect(m.card.right, `${at}: the card fills the row`).toBeCloseTo(m.wrap.right, 0)
        expect(m.line.top, `${at}: the line under the card`).toBeGreaterThanOrEqual(m.card.bottom)
        expect(m.line.left, `${at}: from the row's near edge`).toBeCloseTo(m.wrap.left, 0)
      }
    }

    // The window at its narrowest, where two cards fit to a row.
    await judge(await sized(640, 700))
    // And narrower than the app lets a person make it, where one card
    // fills the row: the minimum (640 by 480, `src/main/index.ts`) is
    // lowered for this measure only and put back whatever happens, so the
    // app leaves as it came. A person reaches the same column by zooming
    // the window in, which this stands in for.
    try {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setMinimumSize(320, 480)
      })
      await judge(await sized(400, 420))
    } finally {
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setMinimumSize(640, 480)
      })
    }
    // Both of the line's places were seen, or the test proved only one.
    expect(seen, 'beside the card, then under it').toEqual(['beside', 'under'])
  })
})

test('the New project sheet is the kit at the document density, keyboard first', async () => {
  await withApp(async (page) => {
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('New project')
    expect(
      px(
        await dialog
          .getByRole('heading', { level: 2 })
          .evaluate((el) => getComputedStyle(el).fontSize),
      ),
    ).toBe(15)

    // Keyboard first, and the safe action first (A5.6-05): the sheet opens
    // on Cancel, so a reflexive Enter creates nothing.
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    // Dialog controls sit at the document's dialog height, the kit's large size.
    const inputBox = await dialog.locator('fig-input-text').first().boundingBox()
    expect(inputBox?.height, "a control is the document's height, within a pixel").toBeCloseTo(
      32,
      0,
    )

    // Forward from Cancel to Create, then back up the sheet: Name, the
    // feed, and the source group as one stop.
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(
      dialog.getByLabel('Feed key').or(dialog.getByRole('combobox', { name: 'Feed' })),
    ).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(
      dialog.getByRole('radio', { name: 'A sample city, or a feed you added' }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

test('the progress line renders in both themes', async () => {
  await withApp(async (page) => {
    await page.goto('app://local/ui/?progress-preview')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Progress line')
    for (const source of ['dark', 'light'] as const) {
      await setTheme(page, source)
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(source === 'dark' ? null : 'sepia')
      await expect(page.getByRole('img', { name: 'Four stages, topo running' })).toBeVisible()
      await page.screenshot({ path: join('test-results', `progress-${source}.png`) })
    }
  })
})
