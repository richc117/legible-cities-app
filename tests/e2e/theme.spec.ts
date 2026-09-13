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
  rmSync,
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

test('the switch is out of reach while a run is going, because the page is being rewritten', async () => {
  const h = home({ progress_delay_ms: 400 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    const sepia = switchOf(page).getByRole('button', { name: 'Sepia' })
    await expect(sepia).toBeEnabled()

    await page.getByRole('button', { name: /lay out/i }).click()
    // `map.build` writes the project's page in place, and a theme change
    // reloads the frame that reads it: a press now would show half a
    // document and an alert saying the map is gone.
    await expect(sepia).toBeDisabled()
    // And it says why, where the switch is: the run's own panel is
    // elsewhere on the screen and tied to this section by nothing a screen
    // reader can follow (FR-008).
    await expect(switchOf(page).getByRole('status')).toContainText(/waits until the run/)
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(sepia).toBeEnabled()
  })
})

test('focus is handed over before the buttons go, when a timer closes the way', async () => {
  const h = home({ progress_delay_ms: 400 })
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })

    // A colour change is debounced, so its build starts from a timer with
    // nobody pressing anything - and Chromium blurs a disabled element, so
    // the buttons going would take the focus to the body.
    const colours = page.getByRole('region', { name: 'Line colours' })
    await colours.getByRole('button', { name: /^Choose the colour of line A/ }).click()
    const picker = colours.getByRole('group', { name: 'Colour for line A' })
    await picker.getByLabel('Hex value').fill('#ff0000')
    await picker.getByRole('button', { name: 'Use this colour' }).click()

    // Inside the debounce, with focus moved into the theme switch.
    const sepia = switchOf(page).getByRole('button', { name: 'Sepia' })
    await sepia.focus()
    await expect(sepia).toBeFocused()

    await expect(sepia).toBeDisabled({ timeout: 30_000 })
    await expect(switchOf(page).getByRole('heading', { name: 'Theme' })).toBeFocused()
  })
})

test('two presses inside one write end where the second asked, not the first', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await project(page, 'Los Angeles')
    const group = switchOf(page).getByRole('group', { name: 'The theme this map is drawn in' })
    await group.getByRole('button', { name: 'Sepia' }).click()
    await group.getByRole('button', { name: 'Warm dark' }).click()
    await expect(group.getByRole('button', { name: 'Warm dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect.poll(() => readRecord(h).theme).toBe('warm-dark')
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

    await switchOf(page).getByRole('button', { name: 'Sepia' }).click()
    await expect(switchOf(page).getByRole('alert')).toBeVisible()
    // And the switch still shows what the project actually is.
    await expect(switchOf(page).getByRole('button', { name: 'Warm dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

test('an export is planned in the theme the project is drawn in', async () => {
  const h = home({ encode_delay_ms: 600 })
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

    // The export is on its own tab (A5-01). Its preview plans too, so the
    // press waits for the preview to have answered - the frame at the
    // reel's shape - or a late preview's plan could land beside the
    // export's own.
    await page.getByRole('tab', { name: 'Export' }).click()
    await expect
      .poll(
        async () =>
          new URL((await frame(page).getAttribute('src')) ?? '').searchParams.get('frame'),
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
    // planned with is the theme the reel will have, whatever is pressed now
    // (FR-008). It is on the map tab, and leaving the export tab does not
    // stop the export; the encode is slowed so the export is still going.
    await page.getByRole('tab', { name: 'Map' }).click()
    await expect(switchOf(page).getByRole('button', { name: 'Warm dark' })).toBeDisabled()

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
