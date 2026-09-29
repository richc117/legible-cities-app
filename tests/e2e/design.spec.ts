// The design system on the built app, in both themes: the theme follows
// the platform's colour-scheme preference, which Playwright emulates per
// page (it forces a light scheme unless told otherwise, so nativeTheme is
// not the lever here), and the status line, a Library row, a kit button
// and a dialog's input measure what docs/DESIGN.md says. No engine is
// needed; the status line reads "unavailable" and that is a state like
// any other.

import { mkdtempSync } from 'node:fs'
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
  run: (page: Page, app: ElectronApplication) => Promise<void>,
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
    await run(await app.firstWindow(), app)
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
    // A project, so the Library has a row to measure.
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

      const row = page.getByRole('button', { name: 'Open Measured' })
      const rowBox = await row.boundingBox()
      expect(rowBox?.height).toBeGreaterThanOrEqual(28)
      expect(px(await row.evaluate((el) => getComputedStyle(el).fontSize))).toBe(13)

      // A kit button: the document's control height on the host element
      // (the role resolves to the kit's inner button), the app's focus ring.
      const newProject = page.getByRole('button', { name: 'New project' })
      const host = page.locator('fig-button', { hasText: 'New project' })
      const box = await host.boundingBox()
      expect(box?.height).toBe(28)
      // The kit draws the focus ring on the host (delegated focus).
      await newProject.focus()
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

test('a Library row holds what it has, however many lines that takes', async () => {
  // Issue 269. The kit gives every native button one control's height, and
  // a row that wrapped hung below its own rule, over the row after it.
  await withApp(async (page) => {
    const long = 'Los Angeles County Metropolitan Transportation Authority, Metro Rail'
    for (const name of ['Short', long])
      await page.evaluate(
        (name) =>
          (globalThis as unknown as Bridge).api.projects.create({ name, feed: 'la-metro-rail' }),
        name,
      )
    await page.reload()
    const rows = page.getByRole('list', { name: 'Projects' }).getByRole('button')
    await expect(rows).toHaveCount(2)

    const measured = await rows.evaluateAll((all) =>
      all.map((row) => {
        const box = row.getBoundingClientRect()
        const words = document.createRange()
        words.selectNodeContents(row)
        const lines = [...words.getClientRects()]
        return {
          name: row.getAttribute('aria-label'),
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          above: Math.max(...lines.map((line) => box.top - line.top)),
          below: Math.max(...lines.map((line) => line.bottom - box.bottom)),
          beside: Math.max(...lines.map((line) => line.right - box.right)),
          lines: new Set(lines.map((line) => Math.round(line.top))).size,
        }
      }),
    )
    const wrapped = measured.find((row) => row.name === `Open ${long}`)
    expect(wrapped, 'the long name has a row').toBeDefined()
    // The test is about a row that wraps, so it says so if this one did not.
    expect(wrapped?.lines, 'the long row takes more than one line').toBeGreaterThan(1)
    for (const row of measured) {
      expect(row.above, `${row.name}: nothing above its box`).toBeLessThanOrEqual(1)
      expect(row.below, `${row.name}: nothing below its box`).toBeLessThanOrEqual(1)
      expect(row.beside, `${row.name}: nothing beside its box`).toBeLessThanOrEqual(1)
    }
    // One under the other, neither over the other.
    const [first, second] = [...measured].sort((a, b) => a.top - b.top)
    expect(second.top, 'the second row starts where the first ends').toBeGreaterThanOrEqual(
      first.bottom - 1,
    )
    // And whatever comes after the list is under the last row. Without an
    // engine there are no sample cities, so it is looked for, not expected.
    const next = page.getByRole('heading', { level: 2 }).filter({ hasNotText: 'Your projects' })
    if ((await next.count()) > 0) {
      const after = await next.first().evaluate((el) => el.getBoundingClientRect().top)
      expect(after, 'the heading after the list is under it').toBeGreaterThanOrEqual(second.bottom)
    }
    // One control tall at the least, and as tall as its lines beyond that.
    // A short name's row wraps as well: its facts alone take two lines.
    for (const row of measured) expect(row.height, `${row.name}`).toBeGreaterThanOrEqual(28)
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
    expect(inputBox?.height).toBe(32)

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
