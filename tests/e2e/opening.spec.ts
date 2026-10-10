// Cell 06's Opening in the built app, against the stand-in engine and the
// stand-in page (issue 392, spec 035): an opening chosen reaches the plan as
// a list of beats and not a storyboard's name; the export runs to its end
// and the capture asked the page for the card and the draw-in in the engine
// recorder's order - the network undrawn after the settle, the card up at
// its beat and down at every later one, and on each frame of the draw-in
// the clock stepped first and then the network drawn to `i / (n - 1)`; an
// opening before a storyboard that opens on the rows is planned and
// exported like any other, as the engine takes it; and None asks what it
// always asked.
//
// What the capture asked is read from the stand-in page itself: while it is
// captured it says each call on its console, one line each, and the test
// listens for those lines in the main process on every window created
// after it starts listening, which here is only the export's offscreen
// window. That window is gone by the time the export ends, so its own
// `__seen` cannot be read.
//
// Every wait is a deadline on what the page or the stand-in shows, never a
// sleep.

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
import { OPENING_SENTENCE, PREVIEW_NOTE, SECONDS_FIELDS } from '../../src/renderer/src/opening'
import { cell, openCell, withoutOpened } from '../support/project'
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
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-opening-'))
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

const projectId = (h: Home): string => readdirSync(join(h.engineHome, 'projects'))[0]

const readRecord = (h: Home): Record<string, unknown> =>
  withoutOpened(
    JSON.parse(readFileSync(join(h.engineHome, 'projects', projectId(h), 'project.json'), 'utf8')),
  )
const exportOf = (h: Home): Record<string, unknown> =>
  readRecord(h).export as Record<string, unknown>

interface Received {
  method?: string
  params?: { preset?: string; options?: { storyboard?: unknown; safe?: boolean } }
}

/** Every message the stand-in read, in order. */
const received = (h: Home): Received[] =>
  readFileSync(join(h.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Received)

const asked = (h: Home, method: string): Received[] =>
  received(h).filter((m) => m.method === method)

/**
 * The export's own plan: the last `export.plan` before the last
 * `export.encode` that does not ask for the safe zones, which only a
 * preview does (FR-006 of spec 022).
 */
function exportPlan(h: Home): Received {
  const all = received(h)
  let encode = -1
  for (let i = all.length - 1; i >= 0 && encode === -1; i--)
    if (all[i].method === 'export.encode') encode = i
  expect(encode, 'an export reached the encode').toBeGreaterThan(-1)
  for (let i = encode - 1; i >= 0; i--)
    if (all[i].method === 'export.plan' && all[i].params?.options?.safe !== true) return all[i]
  throw new Error('no export was planned')
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
const select = (page: Page, name: string): Locator =>
  exportPanel(page).getByRole('combobox', { name })
const frame = (page: Page): Locator => page.locator('iframe.export-frame')

async function openExport(page: Page): Promise<void> {
  await openCell(page, 'export')
  await expect(select(page, 'Preset')).toBeVisible({ timeout: 20_000 })
}

/** The preview has answered for this preset when its frame is at the preset's own frame. */
async function previewedAt(page: Page, frameParam: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await frame(page).count()) === 0) return null
        return new URL((await frame(page).getAttribute('src')) ?? '').searchParams.get('frame')
      },
      { timeout: 20_000 },
    )
    .toBe(frameParam)
}

/** Start listening, in the main process, for what the stand-in page says while it is captured. */
async function listenToTheCapture(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app: electronApp }) => {
    const g = globalThis as { __seam?: string[] }
    g.__seam = []
    electronApp.on('browser-window-created', (_event, win) => {
      win.webContents.on('console-message', (...args: unknown[]) => {
        // An event object with the message since Electron 35; the older
        // positional form carried it third.
        const first = args[0] as { message?: unknown } | undefined
        const message =
          typeof first?.message === 'string'
            ? first.message
            : typeof args[2] === 'string'
              ? args[2]
              : ''
        if (message.startsWith('seam ')) g.__seam?.push(message.slice('seam '.length))
      })
    })
  })
}

/** What the capture asked of the stand-in page, in order: [call, value]. */
const seam = async (app: ElectronApplication): Promise<[string, unknown][]> =>
  (await app.evaluate(() => (globalThis as { __seam?: string[] }).__seam ?? [])).map(
    (line) => JSON.parse(line) as [string, unknown],
  )

test('an opening reaches the plan as a list, and the capture draws the card and the network in, in order', async () => {
  test.setTimeout(180_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOut(page, h)
    await listenToTheCapture(app)
    await openExport(page)

    // A GIF, at twelve frames a second, plays "morph": four beats.
    await select(page, 'Preset').selectOption('linkedin-gif')
    await previewedAt(page, '640:640')
    await expect(select(page, 'Opening')).toHaveValue('none')
    await expect(exportPanel(page).getByText(OPENING_SENTENCE)).toBeVisible()
    await expect(exportPanel(page).getByText(PREVIEW_NOTE)).toHaveCount(0)

    await select(page, 'Opening').selectOption('card-then-draw-in')
    await expect.poll(() => exportOf(h).opening).toBe('card-then-draw-in')
    await expect(exportPanel(page).getByText(PREVIEW_NOTE)).toBeVisible()
    const card = exportPanel(page).getByLabel(SECONDS_FIELDS.cardSecs.label, { exact: true })
    const drawIn = exportPanel(page).getByLabel(SECONDS_FIELDS.drawInSecs.label, { exact: true })
    await expect(card).toHaveValue('2')
    await expect(drawIn).toHaveValue('6')

    // One second of card and two of draw-in: committed on Enter and on leaving.
    await card.fill('1')
    await card.press('Enter')
    await expect.poll(() => exportOf(h).cardSecs).toBe(1)
    await drawIn.fill('2')
    await drawIn.press('Tab')
    await expect.poll(() => exportOf(h).drawInSecs).toBe(2)

    // The preview's plan is a list too, at the durations just committed:
    // the stand-in saw one. Waited for before the press, so no preview of
    // an earlier choice can land between the export's plan and its encode.
    await expect
      .poll(
        () =>
          asked(h, 'export.plan').some((m) => {
            const list = m.params?.options?.storyboard
            return (
              m.params?.preset === 'linkedin-gif' &&
              Array.isArray(list) &&
              (list[0] as { secs?: number }).secs === 1 &&
              (list[1] as { secs?: number }).secs === 2
            )
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    await exportPanel(page).getByRole('button', { name: 'Export', exact: true }).click()
    await expect(
      exportPanel(page).getByText('Exported la-metro-rail-linkedin-gif.gif.'),
    ).toBeVisible({ timeout: 120_000 })

    // The export's plan: the card, then the draw-in, on the map at the page's
    // own start with the clock held, then morph's own beats, its first at its
    // own clock with the tween of 0 it was always played with. Not the name.
    const plan = exportPlan(h)
    expect(plan.params?.preset).toBe('linkedin-gif')
    const list = plan.params?.options?.storyboard as Record<string, unknown>[]
    expect(Array.isArray(list), 'a list, not a name').toBe(true)
    expect(list.slice(0, 3)).toEqual([
      {
        secs: 1,
        view: 'map',
        labels: null,
        at: '07:00',
        speed: 0,
        sweep: false,
        hours: null,
        span: null,
        tween: 0,
        card: true,
      },
      {
        secs: 2,
        view: 'map',
        labels: null,
        at: '07:00',
        speed: 0,
        sweep: false,
        hours: null,
        span: null,
        tween: 0,
        draw_in: true,
      },
      {
        secs: 1.5,
        view: 'map',
        labels: null,
        at: '08:00',
        speed: 120,
        sweep: false,
        hours: null,
        span: null,
        tween: 0,
      },
    ])
    expect(list.map((b) => b.secs)).toEqual([1, 2, 1.5, 2.5, 2.5, 2.5])

    // What the capture asked of the page. Twelve frames a second: the card
    // is twelve frames and the draw-in twenty-four.
    await expect
      .poll(async () => (await seam(app)).filter(([name]) => name === 'setDrawn').at(-1), {
        timeout: 20_000,
        message: 'the page said the last of the draw-in',
      })
      .toEqual(['setDrawn', 1])
    const calls = await seam(app)
    const names = calls.map(([name]) => name)
    const settle = names.indexOf('settle')
    expect(settle, 'the page was settled').toBeGreaterThanOrEqual(0)
    expect(
      names.filter((n) => n === 'settle'),
      'once',
    ).toHaveLength(1)
    // The network undrawn after the settle and before the first beat's card.
    expect(calls[settle + 1]).toEqual(['setDrawn', 0])
    expect(names.indexOf('setCard')).toBeGreaterThan(settle + 1)
    // The card up at its beat and down at each of the five beats after it.
    expect(calls.filter(([name]) => name === 'setCard').map(([, on]) => on)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
    ])
    // The draw-in's beat lies between the second and third card calls:
    // every frame the clock stepped first, then the network drawn.
    const cardAt = names.flatMap((n, i) => (n === 'setCard' ? [i] : []))
    const drawBeat = calls
      .slice(cardAt[1] + 1, cardAt[2])
      .filter(([name]) => name === 'advance' || name === 'setDrawn')
    expect(drawBeat).toHaveLength(48)
    drawBeat.forEach(([name, value], k) => {
      const frameIndex = Math.floor(k / 2)
      if (k % 2 === 0) expect(name, `frame ${frameIndex} steps first`).toBe('advance')
      else {
        expect(name, `frame ${frameIndex} draws second`).toBe('setDrawn')
        expect(value as number).toBeCloseTo(frameIndex / 23, 10)
      }
    })
    // Nowhere else is the network drawn.
    expect(calls.filter(([name]) => name === 'setDrawn')).toHaveLength(1 + 24)
  })
})

test('an opening stands on the ground before a storyboard that opens there, and on the map before the rows, planned and exported', async () => {
  test.setTimeout(180_000)
  // The stand-in's "run" opens on the linear view here; none of the engine's
  // does. The engine takes an opening before one (spec 035, as of 10 Oct
  // 2026), so every opening is offered and sent.
  const h = home({ storyboard_first_view: { run: 'linear' } })
  await withApp(h, async (page) => {
    await laidOut(page, h)
    await openExport(page)
    await select(page, 'Preset').selectOption('linkedin-gif')
    await previewedAt(page, '640:640')

    // Before a storyboard that opens on the ground the opening stands on the
    // ground, so the network draws in on the view the storyboard starts from.
    await select(page, 'Storyboard').selectOption('transform')
    await select(page, 'Opening').selectOption('card-then-draw-in')
    await expect.poll(() => exportOf(h).opening).toBe('card-then-draw-in')
    await expect
      .poll(
        () =>
          asked(h, 'export.plan').some((m) => {
            const list = m.params?.options?.storyboard
            return (
              Array.isArray(list) &&
              list.slice(0, 3).every((b) => (b as { view?: string }).view === 'geographic') &&
              (list[0] as { card?: boolean }).card === true &&
              (list[1] as { draw_in?: boolean }).draw_in === true
            )
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    // Then the storyboard on the rows: the opening is kept, and nothing is
    // disabled.
    await select(page, 'Storyboard').selectOption('run')
    await expect.poll(() => exportOf(h).storyboard).toBe('run')
    await expect(select(page, 'Opening')).toHaveValue('card-then-draw-in')
    expect(exportOf(h).opening, 'the opening is kept on the rows').toBe('card-then-draw-in')
    for (const value of ['none', 'card', 'draw-in', 'card-then-draw-in'])
      await expect(select(page, 'Opening').locator(`option[value="${value}"]`)).not.toHaveAttribute(
        'disabled',
        /.*/,
      )
    const card = exportPanel(page).getByLabel(SECONDS_FIELDS.cardSecs.label, { exact: true })
    const drawIn = exportPanel(page).getByLabel(SECONDS_FIELDS.drawInSecs.label, { exact: true })
    await card.fill('1')
    await card.press('Enter')
    await expect.poll(() => exportOf(h).cardSecs).toBe(1)
    await drawIn.fill('2')
    await drawIn.press('Enter')
    await expect.poll(() => exportOf(h).drawInSecs).toBe(2)

    // The preview's plan at these durations, before the press.
    await expect
      .poll(
        () =>
          asked(h, 'export.plan').some((m) => {
            const list = m.params?.options?.storyboard
            return (
              m.params?.preset === 'linkedin-gif' &&
              Array.isArray(list) &&
              (list[0] as { secs?: number }).secs === 1 &&
              (list[1] as { secs?: number }).secs === 2 &&
              (list[2] as { view?: string }).view === 'linear'
            )
          }),
        { timeout: 20_000 },
      )
      .toBe(true)

    await exportPanel(page).getByRole('button', { name: 'Export', exact: true }).click()
    await expect(
      exportPanel(page).getByText('Exported la-metro-rail-linkedin-gif.gif.'),
    ).toBeVisible({ timeout: 150_000 })

    // The card and the draw-in, on the map before the rows, then the
    // storyboard from the rows, its first beat keeping its view and its clock
    // and sent a tween of 0.
    const list = exportPlan(h).params?.options?.storyboard as Record<string, unknown>[]
    expect(Array.isArray(list), 'a list, not a name').toBe(true)
    expect(list.map((b) => [b.card === true, b.draw_in === true, b.view])).toEqual([
      [true, false, 'map'],
      [false, true, 'map'],
      [false, false, 'linear'],
    ])
    expect(list[2]).toEqual({
      secs: 20,
      view: 'linear',
      labels: null,
      at: '07:30',
      speed: 240,
      sweep: false,
      hours: null,
      span: null,
      tween: 0,
    })
  })
})

test('an opening before tour, whose clock has no trains on the stand-in, is captured from the page’s own start', async () => {
  test.setTimeout(300_000)
  // The stand-in page draws trains from 06:00 to 22:00 and tour opens at
  // 05:30. Asked for by its name, the capture's first look at the page is at
  // the page's own start, where there are trains; an opening must not move
  // that look to 05:30 and refuse an export that succeeds without it
  // (spec 035, FR-004, as of 10 Oct 2026). Mutation: the storyboard's first
  // clock restored for the opening - both exports refused with "no trains
  // at 05:30".
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOut(page, h)
    await listenToTheCapture(app)
    await openExport(page)
    await select(page, 'Preset').selectOption('linkedin-gif')
    await previewedAt(page, '640:640')
    await select(page, 'Storyboard').selectOption('tour')
    await expect.poll(() => exportOf(h).storyboard).toBe('tour')
    const exportButton = exportPanel(page).getByRole('button', { name: 'Export', exact: true })

    const exportWith = async (
      opening: 'card' | 'draw-in',
      field: 'cardSecs' | 'drawInSecs',
      secs: string,
    ): Promise<void> => {
      await select(page, 'Opening').selectOption(opening)
      await expect.poll(() => exportOf(h).opening).toBe(opening)
      const input = exportPanel(page).getByLabel(SECONDS_FIELDS[field].label, { exact: true })
      await input.fill(secs)
      await input.press('Enter')
      await expect.poll(() => exportOf(h)[field]).toBe(Number(secs))
      // The preview of this opening has been planned, at the page's own start.
      await expect
        .poll(
          () =>
            asked(h, 'export.plan').some((m) => {
              const list = m.params?.options?.storyboard
              return (
                Array.isArray(list) &&
                (list[0] as { at?: string }).at === '07:00' &&
                (list[0] as { secs?: number }).secs === Number(secs) &&
                (list[1] as { at?: string }).at === '05:30'
              )
            }),
          { timeout: 20_000 },
        )
        .toBe(true)
      await app.evaluate(() => {
        ;(globalThis as { __seam?: string[] }).__seam = []
      })
      const encodes = asked(h, 'export.encode').length
      await expect(exportButton).toBeEnabled()
      await exportButton.click()
      await expect
        .poll(() => asked(h, 'export.encode').length, { timeout: 240_000 })
        .toBe(encodes + 1)
      await expect(
        exportPanel(page).getByText('Exported la-metro-rail-linkedin-gif.gif.'),
      ).toBeVisible({ timeout: 60_000 })
      await expect(exportPanel(page).getByText(/no trains at/)).toHaveCount(0)
      // The capture's first look at the page read the page's own start.
      const first = (await seam(app)).find(([name]) => name === 'state')
      expect(first, `${opening}: the first state the capture read`).toEqual(['state', '07:00'])
    }

    await exportWith('card', 'cardSecs', '1')
    await exportWith('draw-in', 'drawInSecs', '2')
  })
})

test('None plans by the storyboard’s name as before, and the capture asks nothing of a card or a draw-in', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page, app) => {
    await laidOut(page, h)
    await listenToTheCapture(app)
    await openExport(page)
    await select(page, 'Preset').selectOption('linkedin-video')
    await previewedAt(page, '1200:1200')
    await select(page, 'Storyboard').selectOption('day')
    await expect
      .poll(() => readRecord(h).export)
      .toEqual({
        preset: 'linkedin-video',
        storyboard: 'day',
        options: {},
      })
    await expect(select(page, 'Opening')).toHaveValue('none')
    // The preview for "day" has been asked for, by its name.
    await expect
      .poll(() => asked(h, 'export.plan').some((m) => m.params?.options?.storyboard === 'day'), {
        timeout: 20_000,
      })
      .toBe(true)
    const tablesBefore = asked(h, 'export.storyboards').length

    await exportPanel(page).getByRole('button', { name: 'Export', exact: true }).click()
    await expect(exportPanel(page).getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })

    expect(exportPlan(h).params?.options?.storyboard, 'the name, as before').toBe('day')
    expect(
      asked(h, 'export.storyboards').length,
      'the export did not ask for the storyboards',
    ).toBe(tablesBefore)
    await expect
      .poll(async () => (await seam(app)).some(([name]) => name === 'settle'), { timeout: 20_000 })
      .toBe(true)
    const names = (await seam(app)).map(([name]) => name)
    expect(names.filter((n) => n === 'setCard' || n === 'setDrawn')).toEqual([])
    expect(names.filter((n) => n === 'settle')).toHaveLength(1)
  })
})
