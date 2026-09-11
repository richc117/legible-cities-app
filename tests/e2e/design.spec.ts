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

    for (const [source, attribute, focus] of [
      ['dark', null, 'rgb(129, 165, 255)'],
      ['light', 'sepia', 'rgb(64, 104, 207)'],
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
      const expected = source === 'dark' ? '#15120f' : '#f7efe1'
      expect(surfaces.surface).toBe(expected)
      expect(surfaces.figma).toBe(expected)
      expect(surfaces.body).toBe(source === 'dark' ? 'rgb(21, 18, 15)' : 'rgb(247, 239, 225)')
    }
  })
})

test('the create dialog is the kit at the document density, keyboard first', async () => {
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

    // Dialog controls sit at the document's dialog height, the kit's large size.
    const name = dialog.getByLabel('Name')
    await expect(name).toBeFocused()
    const inputBox = await dialog.locator('fig-input-text').first().boundingBox()
    expect(inputBox?.height).toBe(32)

    await page.keyboard.press('Tab')
    await expect(
      dialog.getByLabel('Feed key').or(dialog.getByRole('combobox', { name: 'Feed' })),
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Create' })).toBeFocused()
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
