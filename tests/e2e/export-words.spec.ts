// Cell 06's three words-and-places controls in the built app, against the
// stand-in engine (issue 352, ADR-052): a caption, the clock's corner and the
// alt text for the sidecar. What reached the engine is read off the preview's
// address, which the stand-in's `export.plan` writes as the engine's `url_for`
// does, and off the requests the stand-in logged: the plan's options, and the
// `export.encode` that hands the plan back (`CaptureJob.caption`,
// `CaptureJob.clock_corner`) beside the provenance (`alt`).
//
// **A project that sets none of the three plans what it planned before** is
// not a test of its own here: it is every test in `export-tab.spec.ts`,
// `export.spec.ts` and `preview.spec.ts`, which this change leaves as they
// were, and the first assertion of the corner test below, which reads the
// plans of a project that has set nothing.
//
// The accessibility sweep reaches these controls through
// `notebook-a11y.spec.ts` ("cell 06, and focus through an export"), which
// walks cell 06 open in both themes; the controls are drawn on the default
// reel, so it walks them without a line of its own.

import {
  copyFileSync,
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
import { cell, openCell, withoutOpened } from '../support/project'
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
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-export-words-'))
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

interface Stored {
  export: {
    preset: string
    storyboard?: string
    options: Record<string, unknown>
    alt?: string
  }
}

const readRecord = (h: Home): Stored =>
  withoutOpened(
    JSON.parse(readFileSync(join(h.engineHome, 'projects', projectId(h), 'project.json'), 'utf8')),
  ) as unknown as Stored

/** One request the stand-in received, parsed, with the parts these tests read. */
interface Request {
  method: string
  params: {
    options?: Record<string, unknown>
    /** `export.encode`: the plan handed back, which is the engine's `CaptureJob`. */
    plan?: { caption: string | null; clock_corner: string; url: string }
    provenance?: Record<string, unknown>
  }
}

/** Every request of one method the stand-in received, in order, as it logged them. */
const received = (h: Home, method: string): Request[] =>
  readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"method": "${method}"`))
    .map((line) => JSON.parse(line) as Request)

/** The last `export.encode` the stand-in received: the plan handed back, and the provenance. */
const lastEncode = (
  h: Home,
): { plan: NonNullable<Request['params']['plan']>; provenance: Record<string, unknown> } => {
  const encodes = received(h, 'export.encode')
  expect(encodes.length, 'an export reached the encode').toBeGreaterThan(0)
  const { plan, provenance } = encodes[encodes.length - 1].params
  if (plan === undefined) throw new Error('the encode named no plan')
  return { plan, provenance: provenance ?? {} }
}

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

const exportPanel = (page: Page): Locator => cell(page, 'export')
const presetSelect = (page: Page): Locator =>
  exportPanel(page).getByRole('combobox', { name: 'Preset' })
const cornerSelect = (page: Page): Locator =>
  exportPanel(page).getByRole('combobox', { name: 'Clock corner' })
const captionField = (page: Page): Locator =>
  exportPanel(page).getByLabel('Caption', { exact: true })
const altField = (page: Page): Locator => exportPanel(page).getByLabel(/^Alt text for the file/)
const exportButton = (page: Page): Locator =>
  exportPanel(page).getByRole('button', { name: 'Export', exact: true })
/** Cell 06's own preview frame (ADR-046), there only while the cell is open. */
const frame = (page: Page): Locator => page.locator('iframe.export-frame')

async function openExportTab(page: Page): Promise<void> {
  await openCell(page, 'export')
  await expect(presetSelect(page)).toBeVisible({ timeout: 20_000 })
}

/** The address cell 06's preview shows, as search parameters; none while it has no frame. */
async function frameQuery(page: Page): Promise<URLSearchParams> {
  if ((await frame(page).count()) === 0) return new URLSearchParams()
  const src = (await frame(page).getAttribute('src')) ?? ''
  return new URL(src).searchParams
}

/** Choose a preset and wait until the preview is at its frame, so the next plan is its own. */
async function choosePreset(page: Page, preset: string, frameRatio: string): Promise<void> {
  await presetSelect(page).selectOption(preset)
  await expect
    .poll(async () => (await frameQuery(page)).get('frame'), {
      message: `the preview is at ${preset}'s frame`,
      timeout: 20_000,
    })
    .toBe(frameRatio)
}

/**
 * The corners the select offers, read until they are the ones expected. The
 * kit copies a select's options into its inner select when they change, and
 * the corner select is made afresh when its list does, so a read straight
 * after the change that caused it can be of the list before.
 */
const optionValues = (select: Locator): Promise<string[]> =>
  select.locator('option').evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value))

/** Longer than any write a keystroke started, and the preview's delay (250 ms) twice over. */
const SETTLE_MS = 1_500

test('a caption typed in the cell is on the preview’s address, in the plan and in the export; an 81st character and a line break are refused beside the field', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    // A still, so an export is quick.
    await choosePreset(page, 'instagram-post', '1080:1350')
    const panel = exportPanel(page)
    const caption = captionField(page)
    const message = panel.locator('#export-caption-message')

    expect((await frameQuery(page)).get('caption'), 'none set: none on the address').toBeNull()
    expect(
      received(h, 'export.plan').filter((r) => 'caption' in (r.params.options ?? {})),
      'none set: none planned',
    ).toEqual([])

    // Typed, and written when the field is left, as the start time is.
    await caption.fill('Rush hour on the Red Line')
    await caption.press('Tab')
    await expect
      .poll(async () => (await frameQuery(page)).get('caption'), {
        message: 'the caption is on the preview’s address',
        timeout: 20_000,
      })
      .toBe('Rush hour on the Red Line')
    await expect
      .poll(() => readRecord(h).export.options.caption, { message: 'and in the record' })
      .toBe('Rush hour on the Red Line')
    expect(
      received(h, 'export.plan').some(
        (r) => r.params.options?.caption === 'Rush hour on the Red Line',
      ),
      'and in the plan the engine was asked for',
    ).toBe(true)

    // Counted as it nears the bound, and not before.
    await caption.fill('x'.repeat(59))
    await expect(message, 'nothing at 59').not.toContainText('of 80')
    await caption.fill('x'.repeat(60))
    await expect(message, 'the count from 60').toContainText('60 of 80')
    await caption.fill('x'.repeat(80))
    await expect(message, 'the 80th character is allowed').toContainText('80 of 80')
    await expect(caption).not.toHaveAttribute('aria-invalid', 'true')

    // The 81st is refused beside the field, in the engine's sentence, as it
    // is typed; nothing is written and nothing is planned for it.
    const planned = received(h, 'export.plan').length
    await caption.fill('x'.repeat(81))
    await expect(message, 'the engine’s sentence for 81').toHaveText(
      'A caption is 1 to 80 characters on one line; this one is 81.',
    )
    await expect(caption, 'and the field says it is invalid').toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await caption.press('Tab')
    await page.waitForTimeout(SETTLE_MS)
    expect(readRecord(h).export.options.caption, 'the record keeps the last good one').toBe(
      'Rush hour on the Red Line',
    )
    expect(received(h, 'export.plan').length, 'no plan was asked for 81 characters').toBe(planned)

    // A line break is refused the same way. A single-line field strips the
    // two a keyboard makes, so the one that reaches it is the Unicode one.
    await caption.fill('one two')
    await expect(message, 'the engine’s sentence for a line break').toHaveText(
      'A caption is 1 to 80 characters on one line; this one has a line break.',
    )
    await caption.press('Tab')
    await page.waitForTimeout(SETTLE_MS)
    expect(readRecord(h).export.options.caption).toBe('Rush hour on the Red Line')
    expect(received(h, 'export.plan').length, 'no plan was asked for the line break').toBe(planned)

    // The export carries it: the plan handed back to the encode names it,
    // and so does the address the capture navigates to.
    await caption.fill('Rush hour on the Red Line')
    await caption.press('Tab')
    await expect
      .poll(async () => (await frameQuery(page)).get('caption'), { timeout: 20_000 })
      .toBe('Rush hour on the Red Line')
    await exportButton(page).click()
    await expect(panel.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
    const { plan } = lastEncode(h)
    expect(plan.caption, 'CaptureJob.caption').toBe('Rush hour on the Red Line')
    expect(new URL(plan.url).searchParams.get('caption'), 'the capture’s address').toBe(
      'Rush hour on the Red Line',
    )

    // Emptied, it is no caption: not an empty one.
    await caption.fill('')
    await caption.press('Tab')
    await expect
      .poll(() => readRecord(h).export.options, { message: 'the key is gone from the record' })
      .not.toHaveProperty('caption')
    await expect
      .poll(async () => (await frameQuery(page)).get('caption'), { timeout: 20_000 })
      .toBeNull()
  })
})

test('the clock’s corner offers what the preset and the options allow, and the one chosen is on the address and in the plan', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    const panel = exportPanel(page)

    // The reel draws the platform's buttons over its bottom right: two
    // corners, the top right chosen, and the note about the bottom zone.
    await expect
      .poll(async () => (await frameQuery(page)).get('frame'), { timeout: 20_000 })
      .toBe('1080:1920')
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'the reel offers two' })
      .toEqual(['top-right', 'bottom-left'])
    await expect(cornerSelect(page), 'and the top right is chosen').toHaveValue('top-right')
    await expect(
      panel.getByText(/Bottom left is inside its bottom zone/),
      'with the note about the bottom zone',
    ).toBeVisible()
    // And a project that has set none of the three has asked for none of
    // them: the plans so far name no corner and no caption, which is what
    // the pin branch planned.
    for (const request of received(h, 'export.plan')) {
      expect(request.params.options, 'nothing set, nothing planned').not.toHaveProperty(
        'clock_corner',
      )
      expect(request.params.options).not.toHaveProperty('caption')
    }

    // The bottom left is on the address at once, and the engine's own note
    // arrives with its plan.
    await cornerSelect(page).selectOption('bottom-left')
    await expect
      .poll(async () => (await frameQuery(page)).get('corner'), {
        message: 'the chosen corner is on the preview’s address',
        timeout: 20_000,
      })
      .toBe('bottom-left')
    await expect(panel.getByText(/the clock sits bottom left/)).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(() => readRecord(h).export.options.clock_corner, { message: 'and in the record' })
      .toBe('bottom-left')
    // Back to the reel's own corner: it is removed rather than sent.
    await cornerSelect(page).selectOption('top-right')
    await expect
      .poll(() => readRecord(h).export.options, { message: 'the default is not stored' })
      .not.toHaveProperty('clock_corner')

    // A LinkedIn video has nothing over its bottom right: three corners
    // while the title sits top left, the bottom right chosen, and no note.
    await presetSelect(page).selectOption('linkedin-video')
    await expect
      .poll(async () => (await frameQuery(page)).get('frame'), { timeout: 20_000 })
      .toBe('1200:1200')
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'the title sits top left' })
      .toEqual(['top-right', 'bottom-left', 'bottom-right'])
    await expect(cornerSelect(page)).toHaveValue('bottom-right')
    await expect(panel.getByText(/bottom zone/), 'no zone, no note').toHaveCount(0)
    expect((await frameQuery(page)).get('corner'), 'the default is not on the address').toBeNull()

    // With the title off, and no caption, all four.
    await panel.getByRole('checkbox', { name: /^The title/ }).uncheck()
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'with the title off, all four' })
      .toEqual(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    await expect(cornerSelect(page)).toHaveValue('bottom-right')

    // The top left chosen, planned, and carried into the export.
    await cornerSelect(page).selectOption('top-left')
    await expect
      .poll(async () => (await frameQuery(page)).get('corner'), { timeout: 20_000 })
      .toBe('top-left')
    await exportButton(page).click()
    await expect(panel.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
    const { plan } = lastEncode(h)
    expect(plan.clock_corner, 'CaptureJob.clock_corner').toBe('top-left')
    expect(new URL(plan.url).searchParams.get('corner'), 'the capture’s address').toBe('top-left')

    // The title back on puts the name block where the clock was: the top
    // left is no longer offered, and the corner chosen goes with it.
    await panel.getByRole('checkbox', { name: /^The title/ }).check()
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'the title sits top left again' })
      .not.toContain('top-left')
    await expect(cornerSelect(page), 'back to the preset’s own').toHaveValue('bottom-right')
    await expect
      .poll(() => readRecord(h).export.options, { message: 'a refused corner is dropped' })
      .toEqual({})

    // And a caption does the same without the title: set one, and the top
    // left is not offered.
    await panel.getByRole('checkbox', { name: /^The title/ }).uncheck()
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'with the title off again' })
      .toContain('top-left')
    await captionField(page).fill('Rush hour')
    await captionField(page).press('Tab')
    await expect
      .poll(() => readRecord(h).export.options.caption, { timeout: 20_000 })
      .toBe('Rush hour')
    await expect
      .poll(() => optionValues(cornerSelect(page)), { message: 'a caption sits top left too' })
      .not.toContain('top-left')

    // No clock, no corner to choose.
    await panel.getByRole('checkbox', { name: 'The clock' }).uncheck()
    await expect(cornerSelect(page), 'the clock is off').toBeDisabled()
  })
})

test('the alt text is in the sidecar as typed, trimmed, and the engine writes its own when it is left blank', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    await choosePreset(page, 'instagram-post', '1080:1350')
    const panel = exportPanel(page)
    const alt = altField(page)
    // Read where the stand-in writes it, and read again if a read lands
    // while it is being written.
    const sidecarOf = (): Record<string, unknown> => {
      try {
        return JSON.parse(
          readFileSync(
            join(h.exportFolder, 'Los Angeles', 'la-metro-rail-instagram-post.png.json'),
            'utf8',
          ),
        ) as Record<string, unknown>
      } catch {
        return {}
      }
    }

    await expect(
      panel.getByText(
        'Describes the map for someone who cannot see it, in your words. Left blank, the engine writes its own sentence.',
      ),
      'one sentence says what it is for',
    ).toBeVisible()

    // Left blank, nothing is sent and the sidecar carries the engine's
    // own sentence.
    await exportButton(page).click()
    await expect(panel.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
    expect(lastEncode(h).provenance, 'no alt in the provenance').not.toHaveProperty('alt')
    expect(sidecarOf().alt, 'the engine’s sentence').toBe("The stand-in's la-metro-rail map.")

    // Typed with spaces around it, it is trimmed in the record and sent as
    // the trimmed text.
    await alt.fill('   A schematic of the Los Angeles rail lines.  ')
    await alt.blur()
    await expect
      .poll(() => readRecord(h).export.alt, { message: 'trimmed in the record' })
      .toBe('A schematic of the Los Angeles rail lines.')
    expect(readRecord(h).export.options, 'and not among the plan’s options').not.toHaveProperty(
      'alt',
    )
    const before = received(h, 'export.encode').length
    await exportButton(page).click()
    await expect
      .poll(() => sidecarOf().alt, { message: 'the sidecar carries it', timeout: 60_000 })
      .toBe('A schematic of the Los Angeles rail lines.')
    await expect(panel.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
    const encodes = received(h, 'export.encode')
    expect(encodes.length).toBe(before + 1)
    expect(lastEncode(h).provenance.alt, 'sent trimmed, and as typed otherwise').toBe(
      'A schematic of the Los Angeles rail lines.',
    )
    expect(
      received(h, 'export.plan').every((r) => !('alt' in (r.params.options ?? {}))),
      'no plan carried the alt',
    ).toBe(true)

    // 1,001 characters are refused beside the field, and not written.
    await alt.fill('x'.repeat(1001))
    await expect(panel.locator('#export-alt-message')).toHaveText(
      'The alt text is 1,001 characters; it may be at most 1,000.',
    )
    await expect(alt).toHaveAttribute('aria-invalid', 'true')
    await alt.blur()
    await page.waitForTimeout(SETTLE_MS)
    expect(readRecord(h).export.alt, 'the record keeps the last good one').toBe(
      'A schematic of the Los Angeles rail lines.',
    )

    // Blanked, it is none: the key is gone, and the engine writes its own.
    await alt.fill('   ')
    await alt.blur()
    await expect
      .poll(() => readRecord(h).export, { message: 'the key is gone from the record' })
      .not.toHaveProperty('alt')
    await exportButton(page).click()
    await expect
      .poll(() => sidecarOf().alt, { timeout: 60_000 })
      .toBe("The stand-in's la-metro-rail map.")
  })
})

test('the three are the project’s own, and are there when it is opened again', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExportTab(page)
    await choosePreset(page, 'linkedin-video', '1200:1200')
    const panel = exportPanel(page)
    await panel.getByRole('checkbox', { name: /^The title/ }).uncheck()
    await cornerSelect(page).selectOption('top-right')
    await captionField(page).fill('Rush hour')
    await captionField(page).press('Tab')
    // Setting the caption took the top left out of the corner's list as
    // focus moved on to the select: the select must be the same one, with
    // focus, and not one made afresh under it.
    await expect(cornerSelect(page), 'focus went on to the clock corner').toBeFocused()
    await expect(cornerSelect(page)).toHaveValue('top-right')
    await altField(page).fill('A map in words.')
    await altField(page).blur()
    await expect
      .poll(() => readRecord(h).export, { timeout: 20_000 })
      .toEqual({
        preset: 'linkedin-video',
        options: { title: false, clock_corner: 'top-right', caption: 'Rush hour' },
        alt: 'A map in words.',
      })
  })
  await withApp(h, async (page) => {
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await openExportTab(page)
    await expect(captionField(page)).toHaveValue('Rush hour')
    await expect(altField(page)).toHaveValue('A map in words.')
    await expect(cornerSelect(page)).toHaveValue('top-right')
  })
})
