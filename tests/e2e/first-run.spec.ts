// The first-run check of the bundled tools (A6-02, specs/026), against the
// stand-in engine. A development run checks only what the environment
// names, which is how these reach the dialog without a package: an empty
// folder as SCHEMATIC_LOOM_BIN, a file that is not there as
// SCHEMATIC_FFMPEG. The dialog names what failed with the Library behind
// it, closes once for the start, never opens over the mismatch dialog, and
// Settings keeps saying what the check found.
//
// Every launch moves the profile with LEGIBLE_USER_DATA, so nothing here
// writes a person's own settings or log.

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
import { INSTALL_GUIDE_URL } from '../../src/main/first-run-ipc'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

// Inside page.evaluate the code runs in the renderer, where the preload
// put `api` on the window; the test's own scope has no DOM types.
type Bridge = { api: Api }

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** A profile of the test's own, with the stand-in's control file in its engine home. */
function profile(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-first-run-'))
  const home = join(dir, 'engine')
  mkdirSync(home, { recursive: true })
  writeFileSync(
    join(home, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, ...control }),
  )
  return dir
}

/** An empty folder, as a LOOM folder that lost every tool. */
function emptyFolder(): string {
  return mkdtempSync(join(tmpdir(), 'legible-cities-first-run-loom-'))
}

/** A path under a fresh folder where nothing is. */
function nothingAt(name: string): string {
  return join(mkdtempSync(join(tmpdir(), 'legible-cities-first-run-ffmpeg-')), name)
}

async function withApp(
  userData: string,
  env: Record<string, string>,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
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
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

/** The check's result, as the page reads it. */
const firstRun = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as Bridge).api.firstRun.get())

test('names LOOM when its folder is empty, with the Library behind, once per start', async () => {
  const userData = profile()
  await withApp(userData, { SCHEMATIC_LOOM_BIN: emptyFolder() }, async (page) => {
    // SC-001: within ten seconds of start.
    const dialog = page.getByRole('dialog', { name: /LOOM.* will not run/ })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText(
      'The LOOM tools SCHEMATIC_LOOM_BIN names are missing, so maps cannot be laid out.',
    )
    // The detail is behind a closed disclosure, and names no absolute path.
    const details = dialog.locator('details')
    await expect(details.first()).not.toHaveAttribute('open', '')
    await details.first().locator('summary').click()
    await expect(details.first()).toContainText('has no gtfs2graph')
    expect(await details.first().textContent()).not.toContain(tmpdir())
    // The safe action is focused first; the Library is open behind.
    await expect(page.locator('h1')).toHaveText('Library')
    await expect(dialog.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'How to install' })).toBeVisible()

    const result = await firstRun(page)
    expect(result.finished).toBe(true)
    expect(result.loom).toMatchObject({ outcome: 'failed', kind: 'missing' })

    // Escape closes it, and it does not return this session.
    await dialog.getByRole('button', { name: 'OK' }).focus()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.locator('h1')).toHaveText('Settings')
    const tools = page.getByRole('region', { name: 'Bundled tools' })
    await expect(tools).toContainText('Not every tool the app needs ran.')
    await expect(
      tools.locator('dt', { hasText: /^LOOM tools$/ }).locator('xpath=following-sibling::dd[1]'),
    ).toContainText('are missing, so maps cannot be laid out')
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(page.locator('h1')).toHaveText('Library')
    await expect(page.getByRole('dialog', { name: /will not run/ })).toBeHidden()
  })
})

test('names ffmpeg when the file it names is not there, and says exports cannot be made', async () => {
  const userData = profile()
  await withApp(userData, { SCHEMATIC_FFMPEG: nothingAt('ffmpeg') }, async (page) => {
    const dialog = page.getByRole('dialog', { name: /ffmpeg will not run/ })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await expect(dialog).toContainText(
      'The ffmpeg SCHEMATIC_FFMPEG names is missing, so exports cannot be made.',
    )
    expect((await firstRun(page)).ffmpeg).toMatchObject({ outcome: 'failed', kind: 'missing' })
  })
})

test('names both in one dialog when both fail', async () => {
  const userData = profile()
  await withApp(
    userData,
    { SCHEMATIC_LOOM_BIN: emptyFolder(), SCHEMATIC_FFMPEG: nothingAt('ffmpeg') },
    async (page) => {
      const dialog = page.getByRole('dialog', { name: 'LOOM and ffmpeg will not run' })
      await expect(dialog).toBeVisible({ timeout: 10_000 })
      await expect(dialog).toContainText('maps cannot be laid out')
      await expect(dialog).toContainText('exports cannot be made')
      await expect(page.getByRole('dialog', { name: /will not run/ })).toHaveCount(1)
    },
  )
})

test('copies the diagnostics with the check in them, and opens the install document the main process names', async () => {
  const userData = profile()
  await withApp(userData, { SCHEMATIC_LOOM_BIN: emptyFolder() }, async (page, app) => {
    const dialog = page.getByRole('dialog', { name: /LOOM.* will not run/ })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    await dialog.getByRole('button', { name: 'Copy diagnostics' }).click()
    await expect(dialog.getByRole('status')).toContainText('on the clipboard')
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('## Bundled tools')
    expect(copied).toContain(
      'LOOM: The LOOM tools SCHEMATIC_LOOM_BIN names are missing, so maps cannot be laid out.',
    )

    // The platform's browser cannot be driven from a test: the main
    // process's own opener is replaced, so the app's handler still runs.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = (async (url: string) => {
        opened.push(url)
      }) as never
    })
    await dialog.getByRole('button', { name: 'How to install' }).click()
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual([INSTALL_GUIDE_URL])
  })
})

test('waits for the mismatch dialog to close before it opens', async () => {
  const userData = profile({ version: '0.1.0' })
  await withApp(userData, { SCHEMATIC_LOOM_BIN: emptyFolder() }, async (page) => {
    const mismatch = page.getByRole('dialog', { name: 'Engine version mismatch' })
    await expect(mismatch).toBeVisible({ timeout: 10_000 })
    // The check runs once the engine has settled, mismatched included.
    await expect.poll(async () => (await firstRun(page)).finished, { timeout: 10_000 }).toBe(true)
    const tools = page.getByRole('dialog', { name: /LOOM.* will not run/ })
    await expect(tools).toBeHidden()
    await mismatch.getByRole('button', { name: 'OK' }).click()
    await expect(mismatch).toBeHidden()
    await expect(tools).toBeVisible()
  })
})

test('waits for a dialog a person has open, and opens when it closes', async () => {
  test.slow()
  // The stand-in exits at once, so the engine's first start takes its three
  // restarts (about seven seconds) to settle as stopped: time to open the
  // New project dialog before the check runs.
  const userData = profile({ exit: 'at-once' })
  await withApp(userData, { SCHEMATIC_LOOM_BIN: emptyFolder() }, async (page) => {
    await expect(page.locator('h1')).toHaveText('Library')
    await page.getByRole('button', { name: 'New project' }).first().click()
    const creating = page.getByRole('dialog', { name: 'New project' })
    await expect(creating).toBeVisible()
    expect((await firstRun(page)).finished, 'the check finished before the dialog opened').toBe(
      false,
    )
    await expect.poll(async () => (await firstRun(page)).finished, { timeout: 30_000 }).toBe(true)
    const tools = page.getByRole('dialog', { name: /LOOM.* will not run/ })
    await expect(tools).toBeHidden()
    await expect(creating).toBeVisible()
    await creating.getByRole('button', { name: 'Cancel' }).click()
    await expect(creating).toBeHidden()
    await expect(tools).toBeVisible()
    await expect(tools.getByRole('button', { name: 'OK' })).toBeFocused()
  })
})

test('shows no dialog and says the check did not run when nothing is named in development', async () => {
  const userData = profile()
  await withApp(userData, {}, async (page) => {
    await expect(page.locator('h1')).toHaveText('Library')
    await expect.poll(async () => (await firstRun(page)).finished, { timeout: 10_000 }).toBe(true)
    const result = await firstRun(page)
    // A checkout whose .env.local names a tool checks that tool; this test
    // is about one that names neither.
    test.skip(
      result.loom.outcome !== 'skipped' || result.ffmpeg.outcome !== 'skipped',
      '.env.local names SCHEMATIC_LOOM_BIN or SCHEMATIC_FFMPEG here',
    )
    await expect(page.getByRole('dialog', { name: /will not run/ })).toBeHidden()
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('region', { name: 'Bundled tools' })).toContainText(
      'The check did not run (development: no bundled tools named).',
    )
  })
})
