// The inspector's jobs in the built app, against the stand-in engine
// (A1-03, specs/024-jobs): an export followed from Settings, a layout run
// and an export of two projects listed together, a cancel from the
// inspector during octi that ends the stand-in's child, the engine's
// route-type sentence with its detail behind a disclosure, "Copy log" with
// a feed key and the home folder taken out, twenty finished jobs kept of
// twenty-one, and the keyboard.
//
// Every test has a profile of its own through LEGIBLE_USER_DATA. The
// stand-in reads its control file once, at start, so each test that needs
// a slow stage is slow from the first call. No test makes two writing
// changes back to back: the only writes here are a project's creation and
// a finished run's record, each waited for before the next step.

import {
  copyFileSync,
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
  userData: string
}

function home(control: Record<string, unknown> = {}): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-jobs-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5, ...control }),
  )
  return { engineHome, exportFolder: join(dir, 'exports'), userData: join(dir, 'profile') }
}

async function withApp(
  h: Home,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await electron.launch({
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
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 20_000,
    })
    await run(page, app)
  } finally {
    await app.close()
  }
}

/** Create a project from the Library and open it, once the Library lists it. */
async function openNewProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const entry = page.getByRole('button', { name: `Open ${name}` })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name)
}

/** The only project's id, while there is only one. */
const onlyProjectId = (h: Home): string => {
  const ids = readdirSync(join(h.engineHome, 'projects'))
  expect(ids).toHaveLength(1)
  return ids[0]
}

/** Lay the open project out and give it the stand-in page that animates, for an export. */
async function layOutForExport(page: Page, h: Home): Promise<void> {
  const id = onlyProjectId(h)
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
  copyFileSync(fixture, join(h.engineHome, 'out', id, 'la-metro-rail.html'))
}

async function startExport(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Export' }).click()
  const panel = page.getByRole('tabpanel', { name: 'Export' })
  await expect(panel.getByRole('combobox', { name: 'Preset' })).toBeVisible({ timeout: 20_000 })
  await panel.getByRole('button', { name: 'Export', exact: true }).click()
}

const toggle = (page: Page): Locator => page.getByRole('button', { name: /^Jobs, / })
const inspector = (page: Page): Locator => page.getByRole('complementary', { name: 'Inspector' })
const jobs = (page: Page): Locator => inspector(page).getByRole('listitem')
const jobNamed = (page: Page, name: string | RegExp): Locator =>
  inspector(page).getByRole('listitem', { name })
const announcement = (page: Page): Locator => page.locator('.visually-hidden[role="status"]')

async function openInspector(page: Page): Promise<void> {
  await toggle(page).click()
  await expect(inspector(page)).toBeVisible()
}

test('an export started in a project is followed from Settings, to its end', async () => {
  const h = home({ encode_delay_ms: 600 })
  await withApp(h, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await layOutForExport(page, h)
    // The layout run is the session's first job, and it has ended.
    await expect(announcement(page)).toHaveText('Los Angeles: Layout run, finished.')

    await startExport(page)
    await expect(toggle(page)).toHaveAccessibleName('Jobs, 1 running', { timeout: 20_000 })
    await expect(toggle(page)).toContainText('1 running')

    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings')
    await openInspector(page)

    const job = jobNamed(page, 'Los Angeles Export as instagram-reel')
    await expect(job).toBeVisible()
    await expect(job.getByRole('img')).toHaveAccessibleName(/^Running (plan|capture|encode)\.$/)
    for (const stage of ['plan', 'capture', 'encode'])
      await expect(job.getByText(stage, { exact: true })).toBeVisible()
    await expect(
      job.getByRole('button', { name: /^Cancel: Export as instagram-reel/ }),
    ).toBeVisible()

    // It moves as the export moves, and ends where the project screen would say it did.
    await expect(job.getByRole('img')).toHaveAccessibleName('Export as instagram-reel finished.', {
      timeout: 60_000,
    })
    await expect(job.getByRole('button', { name: /^Cancel:/ })).toHaveCount(0)
    await expect(toggle(page)).toHaveAccessibleName('Jobs, none running')
    await expect(announcement(page)).toHaveText('Los Angeles: Export as instagram-reel, finished.')
    // The finished layout run is listed after it: running first, then newest first.
    await expect(jobs(page)).toHaveCount(2)
    await expect(jobs(page).nth(0)).toHaveAccessibleName('Los Angeles Export as instagram-reel')
    await expect(jobs(page).nth(1)).toHaveAccessibleName('Los Angeles Layout run')
  })
})

test('jobs in two projects are listed together, running ones first', async () => {
  // A long encode and a long octi, so the two overlap.
  const h = home({ encode_delay_ms: 1_500, octi_child: true, octi_ms: 1_500 })
  await withApp(h, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await layOutForExport(page, h)
    await startExport(page)
    await expect(toggle(page)).toHaveAccessibleName('Jobs, 1 running', { timeout: 20_000 })

    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openNewProject(page, 'Bart')
    await page.getByRole('button', { name: /lay out/i }).click()
    await openInspector(page)

    await expect(jobNamed(page, 'Los Angeles Export as instagram-reel')).toBeVisible()
    await expect(jobNamed(page, 'Bart Layout run')).toBeVisible()
    await expect(jobNamed(page, 'Los Angeles Layout run')).toBeVisible()
    // Whatever each has reached, no finished job is listed above a running one.
    await expect(async () => {
      const states = await jobs(page).evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-state')),
      )
      const firstFinished = states.findIndex((s) => s !== 'running')
      const lastRunning = states.lastIndexOf('running')
      expect(firstFinished === -1 || lastRunning === -1 || lastRunning < firstFinished).toBe(true)
    }).toPass({ timeout: 10_000 })
    // Both end, and are still both listed.
    await expect(toggle(page)).toHaveAccessibleName('Jobs, none running', { timeout: 90_000 })
    await expect(jobs(page)).toHaveCount(3)
  })
})

test('Cancel in the inspector during octi cancels the run and ends the layout tool', async () => {
  const h = home({ octi_child: true, octi_ms: 60_000 })
  await withApp(h, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await openInspector(page)

    const job = jobNamed(page, 'Los Angeles Layout run')
    await expect(job.getByRole('img')).toHaveAccessibleName('Running octi.', { timeout: 20_000 })
    const pidFile = join(h.engineHome, 'fake-engine.octi.pid')
    await expect.poll(() => existsSync(pidFile), { timeout: 10_000 }).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(() => process.kill(pid, 0), 'the stand-in started its octi child').not.toThrow()

    await job.getByRole('button', { name: 'Cancel: Layout run, Los Angeles' }).click()
    // The button is about to go; the job's heading has the focus.
    await expect(job.getByRole('heading', { level: 3 })).toBeFocused()

    await expect(job).toHaveAttribute('data-state', 'cancelled', { timeout: 20_000 })
    // The project screen agrees: one cancel, two views.
    await expect(page.getByText('The run was cancelled. The project is as it was.')).toBeVisible()
    const ended = join(h.engineHome, 'fake-engine.octi-ended')
    await expect.poll(() => existsSync(ended), { timeout: 10_000 }).toBe(true)
    expect(Number(readFileSync(ended, 'utf8'))).toBe(pid)
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0)
            return 'alive'
          } catch {
            return 'gone'
          }
        },
        { timeout: 10_000 },
      )
      .toBe('gone')
    await expect(announcement(page)).toHaveText('Los Angeles: Layout run, cancelled.')
  })
})

test("a mode the feed's route types do not carry fails with the engine's sentence, and its detail behind Details", async () => {
  const h = home({ empty_modes: ['all'] })
  await withApp(h, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/matched no routes/).first()).toBeVisible({ timeout: 20_000 })
    await openInspector(page)

    const job = jobNamed(page, 'Los Angeles Layout run')
    await expect(job).toHaveAttribute('data-state', 'failed')
    const hint = job.locator('.message.error')
    await expect(hint).toHaveText(
      "la-metro-rail: the line graph is empty -- gtfs2graph -m 'all' matched no routes. Check the feed's route_type values; agencies disagree about which of tram/subway/rail their network is.",
    )
    const details = job.locator('details')
    await expect(details).not.toHaveAttribute('open', /.*/)
    await expect(job.getByText(/^ValueError:/)).toBeHidden()
    await job.getByText('Details', { exact: true }).click()
    await expect(job.getByText(/^ValueError: .*\(pipeline\.py:403\)$/)).toBeVisible()
    // No absolute path anywhere in the inspector.
    expect(await inspector(page).innerText()).not.toMatch(/(^|\s)(\/|[A-Za-z]:\\)\S/)
    await expect(announcement(page)).toHaveText('Los Angeles: Layout run, failed.')
  })
})

test('Copy log puts the job on the clipboard with the feed key and the home folder taken out', async () => {
  const key = ['s3cr3t', 'jobs', 'key'].join('-')
  const h = home({
    empty_modes: ['all'],
    build_log_lines: [
      `fetching https://agency.example/gtfs.zip?api_key=${key}`,
      'reading {home}/feeds/gtfs.zip',
    ],
  })
  await withApp(h, async (page, app) => {
    await openNewProject(page, 'Los Angeles')
    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/matched no routes/).first()).toBeVisible({ timeout: 20_000 })
    await openInspector(page)

    const job = jobNamed(page, 'Los Angeles Layout run')
    await job.getByRole('button', { name: 'Copy log: Layout run, Los Angeles' }).click()
    await expect(job.getByRole('status')).toHaveText(/^The log is on the clipboard/)
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toContain('# Layout run, Los Angeles')
    expect(copied).toContain('State: failed')
    expect(copied).toContain('gtfs2graph: failed')
    expect(copied).toContain('matched no routes')
    expect(copied).toContain('https://agency.example/gtfs.zip?api_key=')
    expect(copied).not.toContain(key)
    expect(copied).not.toContain(homedir())
    expect(copied).toMatch(/reading ~[\\/]feeds[\\/]gtfs\.zip/)
  })
})

test('twenty-one finished jobs keep the newest twenty', async () => {
  // A run that fails writes nothing, so twenty-one of them make no write to
  // race; each is waited for in the list before the next is started.
  const h = home({ empty_modes: ['all'] })
  await withApp(h, async (page) => {
    await openNewProject(page, 'Los Angeles')
    await openInspector(page)
    await expect(inspector(page).getByText('There are no jobs this session.')).toBeVisible()
    const layOut = page.getByRole('main').getByRole('button', { name: 'Lay out', exact: true })
    // Each job is told apart by the id its heading carries, so a count that
    // has not moved yet cannot pass for one that has.
    let newest: string | null = null
    for (let i = 1; i <= 21; i++) {
      await layOut.click()
      await expect(async () => {
        const first = jobs(page).first()
        expect(await first.getAttribute('aria-labelledby')).not.toBe(newest)
        expect(await first.getAttribute('data-state')).toBe('failed')
      }).toPass({ timeout: 20_000 })
      newest = await jobs(page).first().getAttribute('aria-labelledby')
      await expect(toggle(page)).toHaveAccessibleName('Jobs, none running')
      await expect(jobs(page)).toHaveCount(Math.min(i, 20))
    }
  })
})

test('the inspector from the keyboard: opened to its heading, closed with Escape back to the toggle', async () => {
  const h = home()
  await withApp(h, async (page, app) => {
    await expect(toggle(page)).toHaveAccessibleName('Jobs, none running')
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(inspector(page)).toHaveCount(0)

    await toggle(page).focus()
    await page.keyboard.press('Enter')
    await expect(inspector(page)).toBeVisible()
    await expect(inspector(page).getByRole('heading', { name: 'Jobs' })).toBeFocused()
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(inspector(page).getByText('There are no jobs this session.')).toBeVisible()

    // Beside the main region on a wide window.
    expect(await inspector(page).evaluate((el) => getComputedStyle(el).position)).toBe('sticky')

    await page.keyboard.press('Escape')
    await expect(inspector(page)).toHaveCount(0)
    await expect(toggle(page)).toBeFocused()

    // Below 900px it covers the main region, and Escape still closes it.
    // The window itself is made narrower, as a person would drag it, rather
    // than the page emulated at another size.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(800, 600)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(900)
    await toggle(page).focus()
    await page.keyboard.press('Enter')
    await expect(inspector(page)).toBeVisible()
    expect(await inspector(page).evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
    await page.keyboard.press('Escape')
    await expect(inspector(page)).toHaveCount(0)
    await expect(toggle(page)).toBeFocused()

    // The close button does the same for a pointer.
    await toggle(page).click()
    await inspector(page).getByRole('button', { name: 'Close the inspector' }).click()
    await expect(inspector(page)).toHaveCount(0)
    await expect(toggle(page)).toBeFocused()
  })
})
