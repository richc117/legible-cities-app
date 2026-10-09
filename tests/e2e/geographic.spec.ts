// The geographic view against the stand-in engine: the two stages and
// their counts, the toggle, the frame's sandbox, pan and zoom by keyboard,
// a refused stage, and fewer lines after a narrower mode and a re-run.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { cell, createProject, layOut, openCell, openProject, panel } from '../support/project'
import { STAGE_SANDBOX } from '../../src/renderer/src/engine/stages'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-geo-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

async function withApp(engineHome: string, run: (page: Page) => Promise<void>): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
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
    await run(page)
  } finally {
    await app.close()
  }
}

async function laidOutProject(page: Page): Promise<void> {
  await createProject(page, 'LA Metro Rail', 'Los Angeles')
  await openProject(page, 'Los Angeles')
  await layOut(page)
}

const counts = (page: Page) => panel(page, 'Where the routes run').getByRole('definition')

test("draws the two stages in a frame with no permissions, with the engine's counts", async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page)
    const view = panel(page, 'Where the routes run')
    const frame = view.locator('iframe.stage-frame')
    await expect(frame).toHaveAttribute('sandbox', STAGE_SANDBOX)
    await expect(frame).toHaveAttribute('srcdoc', /<svg/)
    expect(await frame.getAttribute('srcdoc')).toContain('gtfs2graph')
    // The counts are the engine's for the stage, as graph.build reported them.
    await expect(counts(page).nth(0)).toHaveText('3')
    await expect(counts(page).nth(4)).toHaveText('2')
    await expect(view.getByRole('button', { name: 'gtfs2graph', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // One sentence says what the two are (issue 282), and the group of
    // buttons is described by it, so a screen reader hears it on entering.
    const explain = view.locator('#stage-explain')
    await expect(explain).toBeVisible()
    await expect(explain).toContainText('the same network after the engine has sorted the lines')
    const group = view.getByRole('group', { name: 'Stage', exact: true })
    await expect(group).toHaveAttribute('aria-describedby', 'stage-explain')
    // A native div, so the description resolves in the ordinary tree.
    await expect(group).toHaveAccessibleDescription(/the same network after the engine/)
    // The section reads: heading, the sentence, the buttons.
    const order = await view.evaluate((section) =>
      ['h3', '#stage-explain', '.toolbar'].map((selector) =>
        [...section.children].indexOf(section.querySelector(selector) as Element),
      ),
    )
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order.every((i) => i >= 0)).toBe(true)

    await view.getByRole('button', { name: 'loom', exact: true }).click()
    await expect(view.getByRole('button', { name: 'loom', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(frame).toHaveAttribute('srcdoc', /loom/)
    await expect(counts(page).nth(0)).toHaveText('3')
    // Nothing in the frame runs, and it is not the interface's document.
    const inside = await frame.evaluate((el) => {
      const doc = (el as HTMLIFrameElement).contentDocument
      return { reachable: doc !== null, svgs: doc?.querySelectorAll('svg').length ?? -1 }
    })
    expect(inside.reachable, 'an opaque origin cannot be read from here').toBe(false)
    // The interface's own icons are inline SVGs; the engine's drawing is
    // not among them: its text is nowhere in the interface's document.
    expect(await page.getByText(/^loom: /).count(), 'no drawing inline in the interface').toBe(0)
  })
})

test('pans and zooms by keyboard on the frame, not inside it', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page)
    const pane = page.getByRole('group', { name: /gtfs2graph stage/ })
    const frame = page.locator('iframe.stage-frame')
    await expect(frame).toBeVisible()
    const transform = () => frame.evaluate((el) => (el as HTMLElement).style.transform)
    const before = await transform()
    // The pane sits below the fold of a long screen, and the pinned map
    // covers the top half of the window (issue 213): the pointer has to be
    // over a part of the pane the map does not cover, so the pane is
    // scrolled to the foot of the window and the pointer put in its lower
    // part. It is scrolled there again whenever the page may have moved: an
    // unfocused wheel scrolls the page, which drops the pane by the step and
    // would leave the pointer at, or past, the window's foot. Focus is given
    // without scrolling, which would put the top back behind the map.
    const lower = async (): Promise<{ x: number; y: number; left: number }> => {
      await pane.evaluate((el) => el.scrollIntoView({ block: 'end' }))
      const b = (await pane.boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height - 60, left: b.x }
    }
    // The wheel does nothing until the pane has focus. The pointer sits
    // over the drawing, where the glass takes the event for the pane.
    const first = await lower()
    await page.mouse.move(first.x, first.y)
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(100)
    expect(await transform()).toBe(before)
    const second = await lower()
    await page.mouse.move(second.x, second.y)
    await pane.evaluate((el) => (el as HTMLElement).focus({ preventScroll: true }))
    await page.mouse.wheel(0, -120)
    await expect.poll(transform).not.toBe(before)
    const wheeled = await transform()
    await page.keyboard.press('+')
    const zoomed = await transform()
    expect(zoomed).not.toBe(wheeled)
    expect(zoomed).toMatch(/scale\(/)
    await page.keyboard.press('ArrowRight')
    const panned = await transform()
    expect(panned).not.toBe(zoomed)
    // A drag pans too. It starts in the pane's lower part, which the map
    // never covers (issue 213), read again now that the page may have moved.
    const at = await lower()
    const grab = at.y - 60
    await page.mouse.move(at.left + 100, grab)
    await page.mouse.down()
    await page.mouse.move(at.left + 160, grab + 30, { steps: 4 })
    await page.mouse.up()
    await expect.poll(transform).not.toBe(panned)
    await page.keyboard.press('0')
    await expect.poll(transform).toBe(before)
    // A toggle keeps the view; only a new set refits.
    await page.keyboard.press('+')
    const kept = await transform()
    await page.getByRole('button', { name: 'loom', exact: true }).click()
    await expect(frame).toHaveAttribute('srcdoc', /loom/)
    expect(await transform()).toBe(kept)
  })
})

test('without the engine the view says so, and the rest of the screen works', async () => {
  const engineHome = home()
  const id = 'geoprojectx1'
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(engineHome, 'projects', id), { recursive: true })
  const now = new Date().toISOString()
  writeFileSync(
    join(engineHome, 'projects', id, 'project.json'),
    JSON.stringify({
      version: 1,
      id,
      name: 'Alone',
      feed: 'la-metro-rail',
      mode: 'all',
      agency: null,
      layout: '0'.repeat(64),
      date: '2026-06-16',
      created: now,
      modified: now,
    }),
  )
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_ENGINE_PYTHON: join(engineHome, 'no-such-python'),
      LEGIBLE_ENGINE_CHECKOUT: '',
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/unavailable/i, {
      timeout: 20_000,
    })
    await page.getByRole('button', { name: 'Open Alone' }).click()
    // A laid-out project opens with cell 01 collapsed (ADR-046).
    await openCell(page, 'data')
    const view = panel(page, 'Where the routes run')
    await expect(view.getByRole('status')).toContainText('not ready')
    await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeEnabled()
  } finally {
    await app.close()
  }
})

test('a refused stage says so, and the rest of the screen works', async () => {
  const engineHome = home({ stage_refuses: 'The stand-in draws no stage today.' })
  await withApp(engineHome, async (page) => {
    await laidOutProject(page)
    const view = panel(page, 'Where the routes run')
    await expect(view.getByRole('alert')).toHaveText('The stand-in draws no stage today.')
    await expect(page.getByRole('button', { name: 'Re-layout' })).toBeEnabled()
  })
})

test('a narrower mode and a re-run draw fewer lines', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page)
    await expect(counts(page).nth(4)).toHaveText('2')
    const inspect = cell(page, 'data')
    await inspect.getByRole('combobox', { name: 'Mode' }).selectOption('subway')
    await expect(page.getByText(/the choice has changed since/)).toBeVisible()
    await page.getByRole('button', { name: 'Lay out again' }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    await expect(counts(page).nth(4)).toHaveText('1')
    expect(await page.locator('iframe.stage-frame').getAttribute('srcdoc')).toContain(
      'gtfs2graph: B',
    )
  })
})
