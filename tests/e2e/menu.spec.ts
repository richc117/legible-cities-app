// The app's own menu (issue 554), against the stand-in engine: the menu the
// app set is its own and not Electron's default, its items reach the screen
// they name, a Help page opens the address main holds, and a command that
// arrives while a modal dialog is open does nothing.
//
// A development build, so View holds Reload and the developer tools; that a
// packaged one does not is the unit test's (tests/unit/menu.test.ts) and the
// acceptance checklist's, step 2. Every launch moves the profile with
// LEGIBLE_USER_DATA, so nothing here writes a person's own settings or log.

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
import { HELP_PAGES } from '../../src/main/help-ipc'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function profile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-menu-'))
  const home = join(dir, 'engine')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify({ version: PINNED_ENGINE }))
  return dir
}

async function withApp(run: (page: Page, app: ElectronApplication) => Promise<void>) {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      LEGIBLE_USER_DATA: profile(),
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
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

/** Choose a menu item by its id, as a click on it would. */
const choose = (app: ElectronApplication, id: string): Promise<void> =>
  app.evaluate(({ Menu }, which) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(which)
    if (item === null || item === undefined) throw new Error(`no menu item ${which}`)
    item.click()
  }, id)

/** The menu bar's labels, each with its items' labels, access keys taken out. */
const menuBar = (app: ElectronApplication) =>
  app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => ({
      label: item.label.replace('&', ''),
      items: (item.submenu?.items ?? [])
        .filter((sub) => sub.type !== 'separator' && sub.visible)
        .map((sub) => sub.label),
      // Electron may hand a role back in lower case, so it is compared so.
      roles: (item.submenu?.items ?? []).map((sub) => sub.role?.toLowerCase() ?? null),
    })),
  )

test('sets its own menu, with Help and the app’s commands', async () => {
  await withApp(async (page, app) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Library')
    const bar = await menuBar(app)
    const platform = await app.evaluate(() => process.platform)
    const labels = bar.map((menu) => menu.label)
    expect(labels).toEqual([
      ...(platform === 'darwin' ? ['Legible Cities'] : []),
      'File',
      'Edit',
      'View',
      'Window',
      'Help',
    ])
    const help = bar.find((menu) => menu.label === 'Help')
    expect(help?.items).toEqual([
      'Legible Cities guide',
      'Install and troubleshooting guide',
      'Report a problem',
      'Copy diagnostics',
      ...(platform === 'darwin' ? [] : ['About Legible Cities']),
    ])
    // A development build: the reload and the tools are there, under View.
    const view = bar.find((menu) => menu.label === 'View')
    expect(view?.roles).toEqual(expect.arrayContaining(['reload', 'forcereload', 'toggledevtools']))
  })
})

test('takes each command to the screen it names', async () => {
  await withApp(async (page, app) => {
    // By its element, not its role: behind a modal dialog the screen's
    // heading is inert, and it is read there too.
    const heading = page.locator('h1')
    await expect(heading).toHaveText('Library')
    // The diagnostics carry the engine's own answer.
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })

    await choose(app, 'settings')
    await expect(heading).toHaveText('Settings')
    await expect(heading).toBeFocused()

    // Copy diagnostics is Settings at its section, copying there.
    await choose(app, 'copy-diagnostics')
    await expect(page.getByRole('heading', { name: 'Logs and diagnostics' })).toBeFocused()
    await expect(
      page
        .getByRole('region', { name: 'Logs and diagnostics' })
        .getByRole('status')
        .filter({ hasText: /on the clipboard/ }),
    ).toBeVisible()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain(
      '# Legible Cities diagnostics',
    )

    // About, on Windows and Linux, is Settings at its versions; macOS has
    // the system's own About panel.
    const platform = await app.evaluate(() => process.platform)
    if (platform !== 'darwin') {
      await choose(app, 'about')
      await expect(page.getByRole('heading', { name: 'Versions' })).toBeFocused()
    }

    // New project, from anywhere: the Library, with its sheet open on the
    // New project card's press.
    await choose(app, 'new-project')
    await expect(heading).toHaveText('Library')
    const sheet = page.getByRole('dialog', { name: 'New project' })
    await expect(sheet).toBeVisible()

    // While the sheet is modal, a command does nothing: the screen behind
    // it stays the Library and the sheet stays open. One command, then two
    // frames, then one read with no retry: a read that retries would pass
    // before the screen had changed. The browser test
    // (menu-guard.browser.test.tsx) holds the same rule with its mutation.
    await choose(app, 'settings')
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    expect(await heading.textContent()).toBe('Library')
    expect(await sheet.isVisible()).toBe(true)

    // Closed, it hands focus back to the card it was opened from.
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await expect(page.getByRole('button', { name: 'New project' })).toBeFocused()
  })
})

test('still answers after the window refuses a navigation away', async () => {
  // A navigation the window refuses (`will-navigate`, src/main/index.ts)
  // has started all the same; the page stays, never subscribes again, and
  // must still hear the menu.
  await withApp(async (page, app) => {
    const heading = page.locator('h1')
    await expect(heading).toHaveText('Library')
    await page.evaluate(() => {
      location.href = 'https://example.org'
    })
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    )
    expect(page.url()).toMatch(/^app:\/\/local\/ui\//)
    await choose(app, 'settings')
    await expect(heading).toHaveText('Settings')
  })
})

test('opens a Help page at the address main holds', async () => {
  await withApp(async (page, app) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Library')
    // The platform's browser cannot be driven from a test: the main
    // process's own opener is replaced, so the app's handler still runs.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = (async (url: string) => {
        opened.push(url)
      }) as never
    })
    await choose(app, 'help-install')
    await choose(app, 'help-report')
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual([HELP_PAGES.install, HELP_PAGES.report])
  })
})
