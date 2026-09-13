// The export tab in the built app, against the stand-in engine
// (specs/022-export-tab): the Map | Export strip from the keyboard, the
// thirteen presets grouped by platform, the preview's address as each
// option changes and the safe zones only where a preset has them, a still,
// a video and a GIF for each of Instagram, LinkedIn and Bluesky from one
// press each, the storyboard reaching the plan, the geographic refusal, and
// the choice still there when the project is opened again.
//
// The stand-in answers `export.presets` and `export.storyboards` with the
// pinned engine's own tables, and its `export.plan` echoes the options on
// the address it answers, as the engine's `url_for` writes them, so what
// reached the engine is read off the frame.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Home {
  engineHome: string
  exportFolder: string
  /** A profile of this test's own, so nothing it does reaches the real one. */
  userData: string
}

function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-export-tab-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5, ...control }),
  )
  return { engineHome, exportFolder: join(dir, 'exports'), userData: join(dir, 'profile') }
}

function launch(h: Home): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_USER_DATA: h.userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
}

async function withApp(h: Home, run: (page: Page) => Promise<void>): Promise<void> {
  const app = await launch(h)
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await run(page)
  } finally {
    await app.close()
  }
}

const projectId = (h: Home): string => readdirSync(join(h.engineHome, 'projects'))[0]

const readRecord = (h: Home): Record<string, unknown> =>
  JSON.parse(readFileSync(join(h.engineHome, 'projects', projectId(h), 'project.json'), 'utf8'))

/** Every request of one method the stand-in received, as the lines it logged. */
const received = (h: Home, method: string): string[] =>
  readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"method": "${method}"`))

/** A laid-out project named Los Angeles, whose page is the stand-in that animates. */
async function laidOut(page: Page, h: Home): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: 'Open Los Angeles' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  copyFileSync(fixture, join(h.engineHome, 'out', projectId(h), 'la-metro-rail.html'))
}

const exportPanel = (page: Page): Locator => page.getByRole('tabpanel', { name: 'Export' })
const presetSelect = (page: Page): Locator =>
  exportPanel(page).getByRole('combobox', { name: 'Preset' })
const exportButton = (page: Page): Locator =>
  exportPanel(page).getByRole('button', { name: 'Export', exact: true })
const frame = (page: Page): Locator => page.locator('iframe.viewer-frame')

async function openExportTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Export' }).click()
  await expect(presetSelect(page)).toBeVisible({ timeout: 20_000 })
}

/** The address the map's frame shows, as search parameters. */
async function frameQuery(page: Page): Promise<URLSearchParams> {
  const src = (await frame(page).getAttribute('src')) ?? ''
  return new URL(src).searchParams
}

test('the tab strip is one tab stop, moved with the arrow keys, and each tab shows its panel', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    const strip = page.getByRole('tablist')
    const mapTab = strip.getByRole('tab', { name: 'Map' })
    const exportTab = strip.getByRole('tab', { name: 'Export' })
    await expect(mapTab).toHaveAttribute('aria-selected', 'true')
    await expect(exportTab).toHaveAttribute('tabindex', '-1')
    await expect(page.getByRole('tabpanel', { name: 'Map' })).toBeVisible()
    await expect(exportPanel(page)).toBeHidden()

    await mapTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(exportTab).toBeFocused()
    await expect(exportTab).toHaveAttribute('aria-selected', 'true')
    await expect(exportPanel(page)).toBeVisible()
    await expect(page.getByRole('tabpanel', { name: 'Map' })).toBeHidden()

    await page.keyboard.press('Home')
    await expect(mapTab).toBeFocused()
    await expect(mapTab).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(exportTab).toHaveAttribute('aria-selected', 'true')

    // The strip is one stop: Tab leaves it for the panel's first control.
    await page.keyboard.press('Tab')
    await expect(page.locator('[role="tab"]:focus')).toHaveCount(0)
  })
})

test('offers the thirteen social presets by platform, and previews the safe zones only where the preset has them', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    // Under the map tab the frame is the plain map, with its own controls.
    expect((await frameQuery(page)).get('controls')).toBe('1')
    await openExportTab(page)

    const select = presetSelect(page)
    await expect(select.locator('option')).toHaveCount(13)
    expect(
      await select.locator('optgroup').evaluateAll((g) => g.map((e) => e.getAttribute('label'))),
    ).toEqual(['Instagram', 'LinkedIn', 'Bluesky', 'X'])
    await expect(select.locator('option[value^="portfolio"]')).toHaveCount(0)
    await expect(select).toHaveValue('instagram-reel')

    // The reel draws Instagram's interface over itself: the preview asks
    // for the zones, at the reel's frame.
    await expect
      .poll(async () => (await frameQuery(page)).get('safe'), { timeout: 20_000 })
      .toBe('1')
    expect((await frameQuery(page)).get('frame')).toBe('1080:1920')
    expect((await frameQuery(page)).get('controls')).toBeNull()

    // A LinkedIn video sits in a card with nothing over it: no zones.
    await select.selectOption('linkedin-video')
    await expect
      .poll(async () => (await frameQuery(page)).get('frame'), { timeout: 20_000 })
      .toBe('1200:1200')
    expect((await frameQuery(page)).get('safe')).toBeNull()

    // The story has them, and it is a still: no storyboard is offered.
    await select.selectOption('instagram-story')
    await expect
      .poll(async () => (await frameQuery(page)).get('safe'), { timeout: 20_000 })
      .toBe('1')
    await expect(exportPanel(page).getByRole('combobox', { name: 'Storyboard' })).toHaveCount(0)

    // Back to the map tab: the plain map again.
    await page.getByRole('tab', { name: 'Map' }).click()
    await expect.poll(async () => (await frameQuery(page)).get('controls')).toBe('1')
    expect((await frameQuery(page)).get('safe')).toBeNull()
  })
})

test('every option changes the preview, and a typed one is written when it is committed', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    const panel = exportPanel(page)
    await expect
      .poll(async () => (await frameQuery(page)).get('safe'), { timeout: 20_000 })
      .toBe('1')

    await panel.getByRole('checkbox', { name: /^The title/ }).uncheck()
    await expect.poll(async () => (await frameQuery(page)).get('title')).toBe('0')
    await panel.getByRole('checkbox', { name: 'The clock' }).uncheck()
    await expect.poll(async () => (await frameQuery(page)).get('clock')).toBe('0')
    await panel.getByRole('checkbox', { name: 'Station names' }).uncheck()
    await expect.poll(async () => (await frameQuery(page)).get('labels')).toBe('0')
    await panel.getByRole('combobox', { name: 'View' }).selectOption('linear')
    await expect.poll(async () => (await frameQuery(page)).get('view')).toBe('linear')

    // The stand-in's feed has lines A and B; keeping one hides the other.
    await panel.getByRole('checkbox', { name: 'B', exact: true }).check()
    await expect.poll(async () => (await frameQuery(page)).get('lines')).toBe('B')

    // A start time is written when the field is left, not on each key.
    const at = panel.getByLabel('Start time')
    await at.fill('07:3')
    await expect
      .poll(() => (readRecord(h).export as { options: object }).options)
      .not.toHaveProperty('at')
    await at.fill('07:30')
    await at.press('Tab')
    await expect.poll(async () => (await frameQuery(page)).get('at')).toBe('07:30')

    // A tag the engine's pattern refuses says why and is not written.
    const tag = panel.getByLabel('Filename tag')
    await tag.fill('has space')
    await tag.press('Enter')
    await expect(panel.getByText(/a tag is up to 64 letters/)).toBeVisible()
    await tag.fill('draft-1')
    await tag.press('Enter')
    await panel.getByRole('combobox', { name: 'Quality' }).selectOption('draft')

    await expect
      .poll(() => readRecord(h).export)
      .toEqual({
        preset: 'instagram-reel',
        options: {
          title: false,
          clock: false,
          labels: false,
          view: 'linear',
          lines: ['B'],
          at: '07:30',
          tag: 'draft-1',
          quality: 'draft',
        },
      })
  })
})

test('a still, a video and a GIF for each of Instagram, LinkedIn and Bluesky, from one press each, never with the safe zones', async () => {
  test.setTimeout(6 * 60_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    const cases = [
      ['instagram-post', 'png'],
      ['instagram-reel', 'mp4'],
      ['instagram-reel-gif', 'gif'],
      ['linkedin', 'png'],
      ['linkedin-video', 'mp4'],
      ['linkedin-gif', 'gif'],
      ['bluesky', 'jpg'],
      ['bluesky-video', 'mp4'],
      ['bluesky-gif', 'gif'],
    ] as const
    for (const [preset, format] of cases) {
      await presetSelect(page).selectOption(preset)
      await expect.poll(() => (readRecord(h).export as { preset: string }).preset).toBe(preset)
      const plansBefore = received(h, 'export.plan').length
      await exportButton(page).click()
      const name = `la-metro-rail-${preset}.${format}`
      await expect(exportPanel(page).getByText(`Exported ${name}.`)).toBeVisible({
        timeout: 60_000,
      })
      const file = join(h.exportFolder, 'Los Angeles', name)
      expect(existsSync(file), name).toBe(true)
      const sidecar = JSON.parse(readFileSync(file + '.json', 'utf8')) as Record<string, unknown>
      expect(sidecar.preset).toBe(preset)
      expect(sidecar.format).toBe(format)
      expect(sidecar.service_date).toBe(readRecord(h).date)
      // One second of the stand-in's plan at the preset's own rate, or one
      // frame for a still.
      const fps = format === 'gif' ? 12 : 30
      expect(sidecar.frames, name).toBe(format === 'png' || format === 'jpg' ? 1 : fps)

      // The export's own plan: the one that asked for this preset's file
      // after the press, and it never asks for the safe zones.
      const plans = received(h, 'export.plan').slice(plansBefore)
      const exported = plans.filter((line) => line.includes(`"preset": "${preset}"`))
      expect(exported.length, name).toBeGreaterThan(0)
      expect(
        exported.some((line) => !line.includes('"safe"')),
        name,
      ).toBe(true)
    }
    // Every plan made for a file, across all nine, is without `safe`: the
    // ones with it are previews, and each of those names a preset whose
    // zones the engine draws.
    for (const line of received(h, 'export.plan').filter((l) => l.includes('"safe"')))
      expect(line).toMatch(/"preset": "instagram-(reel|story)"/)
  })
})

test('a storyboard chosen for a video reaches the plan, and the preset’s own is what it starts on', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    await presetSelect(page).selectOption('linkedin-video')
    const storyboard = exportPanel(page).getByRole('combobox', { name: 'Storyboard' })
    await expect(storyboard).toHaveValue('tour')
    await storyboard.selectOption('day')
    await expect
      .poll(() => readRecord(h).export)
      .toEqual({
        preset: 'linkedin-video',
        storyboard: 'day',
        options: {},
      })
    await exportButton(page).click()
    await expect(exportPanel(page).getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
    const plans = received(h, 'export.plan').filter((l) => !l.includes('"safe"'))
    expect(plans[plans.length - 1]).toContain('"storyboard": "day"')
  })
})

test('a storyboard the feed cannot draw is refused in the engine’s sentence, and Export waits for another', async () => {
  const h = home({ no_geographic: true })
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    await presetSelect(page).selectOption('linkedin-video')
    await expect
      .poll(async () => (await frameQuery(page)).get('frame'), { timeout: 20_000 })
      .toBe('1200:1200')
    const good = await frame(page).getAttribute('src')

    const storyboard = exportPanel(page).getByRole('combobox', { name: 'Storyboard' })
    await storyboard.selectOption('transform')
    const refusal = exportPanel(page).getByRole('alert')
    await expect(refusal).toContainText('carries no geographic geometry', { timeout: 20_000 })
    await expect(exportButton(page)).toBeDisabled()
    // A refused plan never blanks the preview: the last good address stays.
    expect(await frame(page).getAttribute('src')).toBe(good)

    await storyboard.selectOption('tour')
    await expect(refusal).toHaveCount(0, { timeout: 20_000 })
    await expect(exportButton(page)).toBeEnabled()
  })
})

test('the choice is the project’s, and it is there when the project is opened again', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    await presetSelect(page).selectOption('bluesky-gif')
    await exportPanel(page).getByRole('combobox', { name: 'Storyboard' }).selectOption('reveal')
    await exportPanel(page).getByRole('checkbox', { name: 'The clock' }).uncheck()
    await expect
      .poll(() => readRecord(h).export)
      .toEqual({
        preset: 'bluesky-gif',
        storyboard: 'reveal',
        options: { clock: false },
      })
  })
  await withApp(h, async (page) => {
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await openExportTab(page)
    await expect(presetSelect(page)).toHaveValue('bluesky-gif')
    await expect(exportPanel(page).getByRole('combobox', { name: 'Storyboard' })).toHaveValue(
      'reveal',
    )
    await expect(exportPanel(page).getByRole('checkbox', { name: 'The clock' })).not.toBeChecked()
  })
})
