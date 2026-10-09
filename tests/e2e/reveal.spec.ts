// The layout as it solves (issue 382, specs/032), against the stand-in
// engine: cell 01's "Where the routes run" draws each stage of a layout run
// as the run reports it, asks again for a stage refused as not yet at the
// report of the stage it waited on, clears what it drew when the run is
// cancelled, reads the store once the run has ended, and during a re-layout
// draws the new build while the stored set's drawings stay as they were.
//
// The stand-in reports slowly (`progress_delay_ms`), so each stage is on
// screen long enough to be read, and names its build on every drawing
// (`data-build`), so a re-layout's stages can be told from the stored set's.
// Its `stage_waits_on` has loom wait on octi, as the engine's answer with a
// day waits on octi: the app asks for each stage at its report, so nothing
// else it asks is ever refused as not yet. Every wait is a deadline on what
// the page shows.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import {
  cellLabel,
  createProject,
  openCell,
  openProject,
  panel,
  withoutOpened,
} from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

/** How long the stand-in takes between two reports: long enough to read each stage. */
const STEP_MS = 1500

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-reveal-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({
      version: PINNED_ENGINE,
      map_draws: true,
      progress_delay_ms: STEP_MS,
      ...control,
    }),
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

const readRecord = (engineHome: string): Record<string, unknown> => {
  const [id] = readdirSync(join(engineHome, 'projects'))
  return withoutOpened(
    JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')),
  )
}

interface Sent {
  method?: string
  params?: Record<string, unknown>
}

/** Every request of one method the stand-in read, in order, as it was sent. */
const received = (engineHome: string, method: string): Sent[] =>
  readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Sent)
    .filter((message) => message.method === method)

const stageView = (page: Page): Locator => panel(page, 'Where the routes run')
const frameOf = (view: Locator): Locator => view.locator('iframe.stage-frame')
/** The polite region that says each stage once as it is drawn. */
const liveRegion = (view: Locator): Locator => view.locator('p.visually-hidden[role="status"]')
const sentence = (view: Locator, text: string): Locator => view.getByText(text, { exact: true })
const stageButton = (view: Locator, name: 'gtfs2graph' | 'loom'): Locator =>
  view.getByRole('group', { name: 'Stage', exact: true }).getByRole('button', { name })
const processCell = (page: Page): Locator =>
  page.getByRole('group', { name: cellLabel('process'), exact: true })

async function newProject(page: Page, name: string): Promise<void> {
  await createProject(page, 'LA Metro Rail', name)
  await openProject(page, name)
}

/** Every stage the run's own reveal asked for, without a day, in order. */
const revealAsks = (engineHome: string, layout: string): string[] =>
  received(engineHome, 'render.stage')
    .filter((m) => m.params?.layout === layout && !('date' in (m.params ?? {})))
    .map((m) => String(m.params?.stage))

test('a first layout is drawn stage by stage, a stage refused as not yet is drawn at the report it waits on, and the store is read once it ends', async () => {
  test.setTimeout(180_000)
  const engineHome = home({ stage_waits_on: { loom: 'octi' } })
  await withApp(engineHome, async (page) => {
    await newProject(page, 'Los Angeles')
    const view = stageView(page)
    await expect(view, 'no stages to draw before a layout').toHaveCount(0)
    await processCell(page).getByRole('button', { name: 'Lay out', exact: true }).click()

    // gtfs2graph drawn while topo is still running: the build's, not the store's.
    await expect(sentence(view, 'gtfs2graph drawn; topo running.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /gtfs2graph: A, B/)
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /data-build="1"/)
    await expect(liveRegion(view), 'said once, as it is drawn').toHaveText('gtfs2graph drawn.')
    await expect(stageButton(view, 'gtfs2graph')).toHaveAttribute('aria-pressed', 'true')
    await expect(stageButton(view, 'loom')).toHaveAttribute('aria-pressed', 'false')
    await expect(stageButton(view, 'loom'), 'a stage not reached is not disabled').toBeEnabled()

    // A press on a stage not drawn yet says so and presses nothing.
    await stageButton(view, 'loom').click()
    await expect(sentence(view, 'loom is not drawn yet.')).toBeVisible()
    await expect(liveRegion(view)).toHaveText('loom is not drawn yet.')
    await expect(stageButton(view, 'loom')).toHaveAttribute('aria-pressed', 'false')

    await expect(sentence(view, 'topo drawn; loom running.')).toBeVisible({ timeout: 20_000 })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /topo: A, B/)
    await expect(liveRegion(view)).toHaveText('topo drawn.')

    // loom is reported and asked for, and refused as not yet: it waits on
    // octi. No failure is shown, and the sentence still names topo.
    await expect(sentence(view, 'topo drawn; octi running.')).toBeVisible({ timeout: 20_000 })
    await expect(view.getByRole('alert')).toHaveCount(0)
    await expect(sentence(view, 'loom is not drawn yet.')).toBeVisible()

    // At octi's report loom is asked for again and drawn, and so is octi.
    await expect(sentence(view, 'octi drawn; the layout’s four stages are done.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(sentence(view, 'loom is not drawn yet.')).toHaveCount(0)
    await stageButton(view, 'loom').click()
    await expect(stageButton(view, 'loom')).toHaveAttribute('aria-pressed', 'true')
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /loom: A, B/)

    // The run asked for each stage at its report, with no day, and for loom
    // a second time at octi's; it asked for nothing else.
    const asks = received(engineHome, 'render.stage').filter((m) => !('date' in (m.params ?? {})))
    expect(asks.map((m) => m.params?.stage)).toEqual(['gtfs2graph', 'topo', 'loom', 'loom', 'octi'])
    expect(new Set(asks.map((m) => m.params?.layout)).size, 'all of one layout').toBe(1)

    // The run ends: nothing of it is left, and the store is read for the
    // day drawn, in the stage last chosen.
    await expect(processCell(page).getByText(/^Laid out/)).toBeVisible({ timeout: 60_000 })
    await expect(sentence(view, 'octi drawn; the layout’s four stages are done.')).toHaveCount(0)
    await expect(liveRegion(view)).toHaveCount(0)
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /loom: A, B/)
    const record = readRecord(engineHome)
    await expect
      .poll(() => received(engineHome, 'render.stage').pop()?.params, {
        message: 'the store is read for the day drawn',
      })
      .toMatchObject({ layout: record.layout, stage: 'loom', date: record.date })
    expect(revealAsks(engineHome, record.layout as string)).toEqual([
      'gtfs2graph',
      'topo',
      'loom',
      'loom',
      'octi',
    ])
    // The reveal drew and wrote nothing: one layout, one map, the record
    // as any run writes it.
    expect(received(engineHome, 'graph.build')).toHaveLength(1)
    expect(received(engineHome, 'map.build')).toHaveLength(1)
  })
})

test('a run cancelled after its first stage leaves nothing it drew, and says so', async () => {
  test.setTimeout(120_000)
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await newProject(page, 'Los Angeles')
    const before = JSON.stringify(readRecord(engineHome))
    const view = stageView(page)
    await processCell(page).getByRole('button', { name: 'Lay out', exact: true }).click()
    await expect(sentence(view, 'gtfs2graph drawn; topo running.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /gtfs2graph/)

    await processCell(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      sentence(view, 'The layout run was cancelled, so its stages are no longer drawn.'),
    ).toBeVisible({ timeout: 20_000 })
    await expect(frameOf(view), 'the build is gone, and so is its drawing').toHaveCount(0)
    await expect(view.getByText(/ drawn; /)).toHaveCount(0)
    await expect(liveRegion(view)).toHaveCount(0)
    await expect(sentence(view, 'Lay the project out to see where its routes run.')).toBeVisible()
    expect(JSON.stringify(readRecord(engineHome)), 'the record is untouched').toBe(before)
  })
})

test('a re-layout draws its new build while the stored set’s drawings stay as they were', async () => {
  test.setTimeout(240_000)
  // Quicker reports for the first layout would leave the re-layout too
  // quick to read, so the same pace throughout.
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await newProject(page, 'Los Angeles')
    await processCell(page).getByRole('button', { name: 'Lay out', exact: true }).click()
    await expect(processCell(page).getByText(/^Laid out/)).toBeVisible({ timeout: 90_000 })
    await openCell(page, 'data')
    const view = stageView(page)
    await expect(frameOf(view), 'the stored set is build 1').toHaveAttribute(
      'srcdoc',
      /data-build="1"/,
    )
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /gtfs2graph: A, B/)
    const stored = readRecord(engineHome)

    const relayout = async (): Promise<void> => {
      await page.getByRole('button', { name: 'Re-layout', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Lay this project out from scratch?' })
        .getByRole('button', { name: 'Re-layout' })
        .click()
    }

    // The new build's first stage, under the same layout id and the stored
    // `made`: drawn from the build, never answered from the stored set.
    await relayout()
    await expect(sentence(view, 'gtfs2graph drawn; topo running.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /data-build="2"/)

    // Cancelled: the build is gone, and the stored set is drawn as it was.
    await processCell(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(
      sentence(
        view,
        'The layout run was cancelled, so its stages are no longer drawn. The stored layout is shown as it was.',
      ),
    ).toBeVisible({ timeout: 20_000 })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /data-build="1"/)
    expect(JSON.stringify(readRecord(engineHome)), 'the record is as it was').toBe(
      JSON.stringify(stored),
    )

    // Again, to its end: the next build is its own, never the cancelled one's.
    await relayout()
    await expect(sentence(view, 'gtfs2graph drawn; topo running.')).toBeVisible({
      timeout: 20_000,
    })
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /data-build="3"/)
    await expect(processCell(page).getByText(/^Laid out again from scratch/)).toBeVisible({
      timeout: 90_000,
    })
    // Read from the store under the new `made`, the new build is what it holds.
    await expect(frameOf(view)).toHaveAttribute('srcdoc', /data-build="3"/)
    await expect(view.getByText(/no longer drawn/)).toHaveCount(0)
    const after = readRecord(engineHome)
    expect(after.layout, 'the same inputs name the same layout').toBe(stored.layout)
    expect(after.made, 'laid out again').not.toBe(stored.made)
    await expect
      .poll(() => received(engineHome, 'render.stage').pop()?.params, {
        message: 'the store is read for the day drawn',
      })
      .toMatchObject({ layout: after.layout, date: after.date })
  })
})
