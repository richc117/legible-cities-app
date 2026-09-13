// Settings, against the stand-in engine: the three blocks, a theme and an
// export folder that survive a relaunch, a folder the environment names and
// will not change, and a reset that empties the engine's home and leaves the
// Library with nothing in it.
//
// The user-data folder is moved with LEGIBLE_USER_DATA, so the settings
// file this suite writes never lands in a person's own profile. The engine
// home is deliberately *not* named in the environment for most of these:
// the default under the user-data folder is what the reset must remove, and
// what the screen must offer to change.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/**
 * A profile of this suite's own: the user-data folder, with the engine's
 * default home made under it and the stand-in's control file already in it.
 * The stand-in reads that file from SCHEMATIC_HOME once, at start, so it
 * has to be there before the app launches.
 */
function profile(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-settings-'))
  const home = join(dir, 'engine')
  mkdirSync(home, { recursive: true })
  seedControl(home, control)
  return dir
}

/**
 * The stand-in's control file, in whichever home the app will run against.
 * Any home it starts in needs one: without it the stand-in reports its own
 * default version, the handshake refuses it and the mismatch dialog covers
 * the screen. That bites the moment a test moves the engine folder, and it
 * hides on a machine whose `.env.local` names a real engine checkout, which
 * answers the pinned version whatever the home holds.
 */
function seedControl(home: string, control: Record<string, unknown> = {}): void {
  mkdirSync(home, { recursive: true })
  writeFileSync(
    join(home, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, ...control }),
  )
}

async function withApp(
  userData: string,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
  env: Record<string, string> = {},
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      LEGIBLE_USER_DATA: userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...env,
    } as Record<string, string>,
    timeout: 30_000,
  })
  const child = app.process()
  try {
    await run(await app.firstWindow(), app)
  } finally {
    await app.close()
  }
  // A relaunch on the same profile must never meet the lock of a process
  // still quitting.
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

/** The <dd> paired with a <dt> in the versions list. */
const definition = (page: Page, term: string) =>
  page
    .locator('dl dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]')

/**
 * The platform's folder chooser cannot be driven from a test, so Electron's
 * dialog is replaced in the main process itself: the app's own handler
 * still runs, remembers its answer and applies it, as in use.
 */
async function chooserAnswers(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () =>
      p === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p] }) as never
  }, path)
}

const open = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
}

test('shows the folders, the size and the engine’s own versions', async () => {
  const userData = profile()
  await withApp(userData, async (page) => {
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await open(page)

    // The engine's home is the default under the user-data folder, and the
    // screen says so; the export folder is the one on the desktop.
    const engine = page.locator('#engine-folder-path')
    await expect(engine).toHaveText(join(userData, 'engine'))
    await expect(page.locator('#engine-folder-source')).toHaveText('the default')
    await expect(page.locator('#export-folder-source')).toHaveText('the default')
    // The size is measured, not guessed: the stand-in has written its home.
    await expect(page.locator('#engine-folder-size')).not.toHaveText('Measuring…')

    // The versions are the engine's answer. The stand-in reports no LOOM
    // commit and no ffmpeg, and both must read as words, never as a blank.
    await expect(definition(page, 'Engine')).toHaveText(PINNED_ENGINE)
    await expect(definition(page, 'Protocol')).toHaveText('1')
    await expect(definition(page, 'Python')).not.toBeEmpty()
    await expect(definition(page, 'LOOM backend')).toHaveText('docker')
    await expect(definition(page, 'LOOM commit')).toHaveText('the host reported no commit')
    await expect(definition(page, 'ffmpeg')).toHaveText('none found')

    // Keyboard: the heading takes focus on arrival, and every control on
    // the screen can be reached and pressed without a mouse.
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused()
    const back = page.getByRole('button', { name: 'Back to Library' })
    await back.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Library')
  })
})

test('keeps the theme and a chosen export folder across a relaunch', async () => {
  test.slow()
  const userData = profile()
  const chosen = mkdtempSync(join(tmpdir(), 'legible-cities-exports-'))

  await withApp(userData, async (page, app) => {
    // The system says dark, so the warm-dark defaults are in force and the
    // attribute is absent; choosing sepia is then visibly a choice, not the
    // system's preference wearing the same clothes. Playwright emulates the
    // scheme per page, never through nativeTheme (rules/renderer.md).
    await page.emulateMedia({ colorScheme: 'dark' })
    await open(page)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/)
    // The theme is the interface's own, applied at once.
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('sepia')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')

    await chooserAnswers(app, chosen)
    await page.getByRole('button', { name: 'Choose the export folder' }).click()
    await expect(page.locator('#export-folder-path')).toHaveText(chosen)
    await expect(page.locator('#export-folder-source')).toHaveText('chosen here')

    const written: unknown = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
    expect(written).toMatchObject({ version: 1, theme: 'sepia', exportFolder: chosen })
  })

  // The second launch reads the file before it draws anything.
  await withApp(userData, async (page) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'sepia')
    await open(page)
    await expect(page.locator('#export-folder-path')).toHaveText(chosen)
    await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveValue('sepia')

    // Back to the default, and that is what the next launch would use.
    await page.getByRole('button', { name: 'Use the default export folder' }).click()
    await expect(page.locator('#export-folder-source')).toHaveText('the default')
    const written: unknown = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
    expect(written).toMatchObject({ exportFolder: null })
  })
})

test('says the engine folder waits for a restart, and takes it at the next start', async () => {
  test.slow()
  const userData = profile()
  const chosen = mkdtempSync(join(tmpdir(), 'legible-cities-engine-'))
  // The second launch runs against this folder, so the stand-in needs its
  // control file here as much as in the default home.
  seedControl(chosen)

  await withApp(userData, async (page, app) => {
    await open(page)
    await chooserAnswers(app, chosen)
    await page.getByRole('button', { name: 'Choose the engine data folder' }).click()
    // The folder in force has not moved, and the screen says which will be.
    await expect(page.locator('#engine-folder-path')).toHaveText(join(userData, 'engine'))
    await expect(page.getByText(`Waiting for a restart: ${chosen}`)).toBeVisible()
    // A folder chosen but not yet in force can still be taken back.
    await expect(
      page.getByRole('button', { name: 'Use the default engine data folder' }),
    ).toBeVisible()
  })

  await withApp(userData, async (page) => {
    await open(page)
    await expect(page.locator('#engine-folder-path')).toHaveText(chosen)
    await expect(page.locator('#engine-folder-source')).toHaveText('chosen here')
    await expect(page.getByText(/Waiting for a restart/)).toHaveCount(0)
  })
})

test('offers no change for a folder the environment names', async () => {
  const userData = profile()
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-home-'))
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify({ version: PINNED_ENGINE }))

  await withApp(
    userData,
    async (page) => {
      await open(page)
      await expect(page.locator('#engine-folder-path')).toHaveText(home)
      await expect(page.locator('#engine-folder-source')).toContainText('set in the environment')
      await expect(page.locator('#engine-folder-source')).toContainText(
        'the app does not change it here',
      )
      await expect(page.getByRole('button', { name: 'Choose the engine data folder' })).toHaveCount(
        0,
      )
      // The export folder is still the app's to change.
      await expect(page.getByRole('button', { name: 'Choose the export folder' })).toBeVisible()
    },
    { SCHEMATIC_HOME: home },
  )
})

test('resets the engine data behind a confirmation, and leaves the Library empty', async () => {
  test.slow()
  const userData = profile()

  await withApp(userData, async (page) => {
    // A project to lose, made through the app so the record is the app's.
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
    const home = join(userData, 'engine')
    expect(readdirSync(join(home, 'projects'))).toHaveLength(1)

    await open(page)
    // A setting changed first, because the file is written when something
    // changes and not before: without one there is no file for the reset to
    // spare, and the assertion below would pass for the wrong reason.
    await page.getByRole('combobox', { name: 'Theme' }).selectOption('sepia')
    await expect.poll(() => existsSync(join(userData, 'settings.json'))).toBe(true)

    await page.getByRole('button', { name: 'Reset engine data' }).click()
    const confirm = page.getByRole('dialog')
    await expect(confirm.getByRole('heading', { level: 2 })).toHaveText("Reset the engine's data?")
    // Cancel is the safe default and is focused; it changes nothing.
    const cancel = confirm.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancel).toBeFocused()
    await cancel.click()
    expect(readdirSync(join(home, 'projects'))).toHaveLength(1)

    await page.getByRole('button', { name: 'Reset engine data' }).click()
    await confirm.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(
      page.getByRole('status').filter({ hasText: /engine's data is gone/ }),
    ).toBeVisible()

    // The four folders went. The home itself is still there, and so is
    // everything in it the app and the engine did not put there - the
    // stand-in's own control file stands in for a person's own files, which
    // is the whole reason the reset does not take the folder whole.
    expect(existsSync(home)).toBe(true)
    const left = readdirSync(home)
    for (const folder of ['data', 'out', 'projects', 'frames']) expect(left).not.toContain(folder)
    // Named rather than counted: the stand-in writes more than one file of
    // its own, and what is being proved is that a file the app did not put
    // there is still there, not how many the stand-in happens to keep.
    expect(left).toContain('fake-engine.json')
    expect(readdirSync(userData)).toContain('settings.json')

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(page.getByRole('status').filter({ hasText: /projects/i })).toContainText(
      /no projects/i,
    )
  })
})

// A6-03. The logs follow LEGIBLE_USER_DATA into this suite's own profile,
// on macOS too, where Electron would otherwise keep them in a person's own
// log folder; nothing here is ever written there.
test('keeps main.log and engine.log, and copies diagnostics without the home folder', async () => {
  test.slow()
  const userData = profile()
  const logs = join(userData, 'logs')

  await withApp(userData, async (page, app) => {
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await open(page)
    // An engine request of the page's own: the versions block asks engine.info.
    await expect(definition(page, 'Engine')).toHaveText(PINNED_ENGINE)

    // The button is reached and pressed from the keyboard, and the result
    // is a sentence where the button is.
    const copy = page.getByRole('button', { name: 'Copy diagnostics' })
    await copy.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('status').filter({ hasText: /on the clipboard/ })).toBeVisible()

    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    // In the spec's order: the app, the runtime, the system, the engine, the
    // two logs, the maps.
    const order = [
      /Legible Cities \S+/,
      /Electron \d+/,
      /Chromium \d+/,
      /Node \d+/,
      /## Operating system/,
      new RegExp(`"engine": "${PINNED_ENGINE.replace(/\./g, '\\.')}"`),
      /## main\.log/,
      /## engine\.log/,
      /No map has been drawn since the app started\./,
    ].map((pattern) => copied.search(pattern))
    expect(
      order.every((at) => at >= 0),
      copied,
    ).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    // The logs' tails are there: the configuration lines, and the engine's.
    expect(copied).toMatch(/\[config\] /)
    expect(copied).toMatch(/\[engine\] state: Engine ready/)

    // The home folder is nowhere in it, in either separator or any case.
    // The profile is under the temporary folder, which is under the home
    // folder on Windows, so the configuration lines alone would carry it.
    const plain = (text: string): string => text.replace(/[\\/]+/g, '/').toLowerCase()
    expect(plain(copied)).not.toContain(plain(homedir()))
  })

  // After the quit. Both files are in the moved profile, each line stamped;
  // the engine's lines are in its own file and nowhere else, and its
  // shutdown - the last thing the quit logs - reached the file before it
  // closed.
  await expect.poll(() => existsSync(join(logs, 'engine.log')), { timeout: 10_000 }).toBe(true)
  const main = readFileSync(join(logs, 'main.log'), 'utf8')
  const engine = readFileSync(join(logs, 'engine.log'), 'utf8')
  expect(main).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[config\] /m)
  expect(main).toContain('[settings] copied diagnostics')
  expect(main).not.toContain('[engine]')
  expect(engine).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[engine\] /m)
  expect(engine).toMatch(
    /\[engine\] (ended on request|ended on terminate|did not end on terminate)/,
  )
  // Never more than the two files a log may have.
  expect(
    readdirSync(logs)
      .filter((name) => name.endsWith('.log'))
      .sort(),
  ).toEqual(['engine.log', 'main.log'])
})
