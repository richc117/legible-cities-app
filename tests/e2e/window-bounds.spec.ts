// The app's window opens where it was left (issue 549): resized and moved,
// then relaunched on the same user-data folder, it comes back at the same
// place; and a place on a display that is not attached opens on one that is.
//
// Every launch here moves the user-data folder with LEGIBLE_USER_DATA, so
// the settings file it writes never lands in a person's own profile. The
// stand-in engine answers the handshake, so no mismatch dialog sits over the
// window; nothing here needs the engine beyond that.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A user-data folder of this test's own, with the stand-in's control file in its engine home. */
function profile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-window-'))
  const home = join(dir, 'engine')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify({ version: PINNED_ENGINE }))
  return dir
}

/**
 * One launch on `userData`, closed afterwards whatever happens, and not
 * returned from until the process has ended: a relaunch on the same profile
 * must never meet the lock of a process still quitting.
 */
async function withApp(
  userData: string,
  run: (app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      LEGIBLE_USER_DATA: userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  const child = app.process()
  try {
    // A window exists a moment before its page does (getURL() is empty
    // then), so the page is waited for before the window is looked for.
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(() => page.url(), { timeout: 20_000 }).toMatch(/^app:\/\/local\/ui\//)
    await run(app)
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

/** The app's own window's bounds, once it is shown: never a capture window. */
async function appBounds(app: ElectronApplication): Promise<Rect> {
  await expect
    .poll(
      () =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some(
            (w) => w.webContents.getURL().startsWith('app://local/ui/') && w.isVisible(),
          ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true)
  return app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().startsWith('app://local/ui/'),
    )
    if (window === undefined) throw new Error('no app window')
    return window.getBounds()
  })
}

const near = (a: Rect, b: Rect, slack = 2): boolean =>
  Math.abs(a.x - b.x) <= slack &&
  Math.abs(a.y - b.y) <= slack &&
  Math.abs(a.width - b.width) <= slack &&
  Math.abs(a.height - b.height) <= slack

const storedWindow = (userData: string): unknown => {
  try {
    return (
      JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { window?: unknown }
    ).window
  } catch {
    return undefined
  }
}

test('opens at the size and place it was left in, after a relaunch', async () => {
  test.setTimeout(120_000)
  const userData = profile()
  const seen: { left?: Rect } = {}

  await withApp(userData, async (app) => {
    const first = await appBounds(app)
    // Somewhere inside the primary display's work area, of a size that is
    // neither the default nor the minimum, so a window that forgot would
    // be seen to.
    const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea)
    const target: Rect = {
      x: area.x + 60,
      y: area.y + 50,
      width: Math.min(820, area.width - 120),
      height: Math.min(560, area.height - 100),
    }
    expect(target.width, 'the display is wide enough to tell a resize').toBeGreaterThan(640)
    await app.evaluate(({ BrowserWindow }, bounds) => {
      const window = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().startsWith('app://local/ui/'),
      )
      window?.setBounds(bounds)
    }, target)
    // What the platform made of it, which is what must come back.
    await expect.poll(async () => near(await appBounds(app), target, 30)).toBe(true)
    const left = await appBounds(app)
    seen.left = left
    expect(near(left, first), 'the window really moved').toBe(false)
    // Written once the window is still, before the close writes it again.
    await expect
      .poll(
        () => {
          const kept = storedWindow(userData) as (Rect & { maximized: boolean }) | undefined
          return kept !== undefined && kept !== null && !kept.maximized && near(kept, left)
        },
        { timeout: 10_000 },
      )
      .toBe(true)
  })

  await withApp(userData, async (app) => {
    const left = seen.left as Rect
    const back = await appBounds(app)
    expect(near(back, left), `${JSON.stringify(back)} is ${JSON.stringify(left)}`).toBe(true)
  })
})

test('opens on a display that is attached when its place is on none', async () => {
  test.setTimeout(90_000)
  const userData = profile()
  // Further out than any display a runner has: the place of a monitor that
  // has been unplugged.
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      version: 1,
      window: { x: 500_000, y: 500_000, width: 900, height: 600, maximized: false },
    }),
  )
  await withApp(userData, async (app) => {
    const bounds = await appBounds(app)
    const displays = await app.evaluate(({ screen }) =>
      screen.getAllDisplays().map((display) => display.bounds),
    )
    const centre = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    const onOne = displays.some(
      (d) =>
        centre.x >= d.x &&
        centre.x <= d.x + d.width &&
        centre.y >= d.y &&
        centre.y <= d.y + d.height,
    )
    expect(onOne, `${JSON.stringify(bounds)} on ${JSON.stringify(displays)}`).toBe(true)
    expect(bounds.width, 'the default size, not the stored one').not.toBe(900)
  })
})
