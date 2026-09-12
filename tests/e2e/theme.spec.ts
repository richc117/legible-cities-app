// The theme a project's map is drawn in (specs/021-theme): the switch on
// the project screen, the theme on the page's address, the record on disk,
// the theme still there when the project is opened again, and the export
// made in it.
//
// Nothing here asks the engine anything: a theme is neither a layout nor a
// render, and the page restyles itself from its own address. The one engine
// request a theme ever reaches is `export.plan`, which is given the
// engine's own word for it.

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

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

async function withApp(h: Home, run: (page: Page) => Promise<void>): Promise<void> {
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
    await run(await app.firstWindow())
  } finally {
    await app.close()
  }
}

const readRecord = (h: Home): Record<string, unknown> => {
  const [id] = readdirSync(join(h.engineHome, 'projects'))
  return JSON.parse(readFileSync(join(h.engineHome, 'projects', id, 'project.json'), 'utf8'))
}

/** Every message of one method the stand-in read, in order. */
const received = (h: Home, method: string): string[] =>
  readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((l) => l.includes(`"${method}"`))

async function project(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
  await page
    .getByRole('listitem', { name: 'LA Metro Rail', exact: true })
    .getByRole('button', { name: /Start a project/ })
    .click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}

const switchOf = (page: Page) => page.getByRole('region', { name: 'Theme' })
const frame = (page: Page) => page.locator('iframe.viewer-frame')

test('offers the two themes and says which one the map is drawn in', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    const group = switchOf(page).getByRole('group', { name: 'The theme this map is drawn in' })
    await expect(group.getByRole('button')).toHaveCount(2)
    await expect(group.getByRole('button', { name: 'Warm dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(group.getByRole('button', { name: 'Sepia' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

test('a chosen theme reaches the page’s address, is stored, and asks the engine nothing', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(frame(page)).toHaveAttribute('src', /theme=warm-dark/)
    const asked = received(h, 'map.build').length

    await switchOf(page).getByRole('button', { name: 'Sepia' }).click()
    await expect(frame(page)).toHaveAttribute('src', /theme=sepia/)
    await expect.poll(() => readRecord(h).theme).toBe('sepia')
    expect(received(h, 'map.build'), 'a theme is neither a layout nor a render').toHaveLength(asked)
    expect(received(h, 'graph.build')).toHaveLength(1)

    // Back to the Library and in again: the same theme, still on the address.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(frame(page)).toHaveAttribute('src', /theme=sepia/)
    await expect(switchOf(page).getByRole('button', { name: 'Sepia' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
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

test('an export is planned in the theme the project is drawn in', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await switchOf(page).getByRole('button', { name: 'Sepia' }).click()
    await expect.poll(() => readRecord(h).theme).toBe('sepia')

    // The stand-in engine's placeholder page cannot be captured; the
    // fixture that animates goes over it, as the export's own suite does.
    const [id] = readdirSync(join(h.engineHome, 'projects'))
    copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))

    await page.getByRole('button', { name: 'Export reel' }).click()
    await expect(page.getByText(/Exported|Planning|Capturing|Encoding/)).toBeVisible({
      timeout: 30_000,
    })
    await expect
      .poll(() => received(h, 'export.plan').length, { timeout: 30_000 })
      .toBeGreaterThan(0)
    const plans = received(h, 'export.plan')
    // The engine's own word for it, and the page the capture drives carries
    // the page's own word.
    expect(plans[plans.length - 1]).toContain('"theme": "light"')
  })
})
