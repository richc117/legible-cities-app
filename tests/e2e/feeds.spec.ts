// The Library's feeds, against the stand-in engine: the list, a project
// from a feed, an add from a file and from a URL, a refused zip, a
// cancelled add, a remove, a refused remove, and the empty state's two
// steps. The stand-in keeps what was added in the home, as the engine
// does, so a relaunch sees it.

import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

function home(control: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-feeds-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return dir
}

async function withApp(
  engineHome: string,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
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
    await run(page, app)
  } finally {
    await app.close()
  }
}

/** A zip with the tables the engine requires, or without one of them. */
function gtfsZip(path: string, without: string[] = []): string {
  // Stored entries, no compression: a zip is a local header, the bytes, a
  // central directory and an end record; enough for the stand-in's check.
  const entries: { name: string; body: Buffer }[] = []
  for (const stem of ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar']) {
    if (without.includes(stem)) continue
    const body =
      stem === 'agency' ? 'agency_id,agency_name\nM,Metro de Prueba\n' : `${stem}_id\n1\n`
    entries.push({ name: `${stem}.txt`, body: Buffer.from(body) })
  }
  const crc = (buf: Buffer): number => {
    let c = ~0
    for (const b of buf) {
      c ^= b
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, body } of entries) {
    const n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc(body), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc(body), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, body)
    centrals.push(central, n)
    offset += local.length + n.length + body.length
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(path, Buffer.concat([...locals, ...centrals, end]))
  return path
}

const feedRow = (page: Page, name: string) => page.getByRole('listitem', { name, exact: true })

/**
 * The platform's file chooser cannot be driven from a test, so Electron's
 * dialog is replaced in the main process itself, through Playwright's
 * hold on it: the app's own handler still runs, remembers the path, and
 * the guard sees a path the chooser answered, as in use.
 */
async function chooserAnswers(app: ElectronApplication, path: string | null): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () =>
      p === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [p] }) as never
  }, path)
}

test('lists the presets and lets a project start from one, in two steps from empty', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await expect(page.getByRole('heading', { name: 'Feeds' })).toBeVisible()
    const presets = page.getByRole('list', { name: 'Presets' })
    await expect(presets.getByRole('listitem')).toHaveCount(2)
    await expect(feedRow(page, 'LA Metro Rail')).toContainText('Los Angeles · Metro Rail')
    await expect(feedRow(page, 'LA Metro Rail')).toContainText('downloaded')
    await expect(
      feedRow(page, 'LA Metro Rail').getByRole('button', { name: /^Remove/ }),
    ).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)

    // Step one: the empty state's action. Step two: Create.
    const empty = page.locator('.empty')
    await expect(empty.getByRole('status')).toContainText(/pick one of the feeds/i)
    await empty.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await expect(dialog.getByRole('combobox', { name: 'Feed' })).toHaveValue('la-metro-rail')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
    await expect(page.locator('.empty')).toHaveCount(0)

    // From a row: the dialog opens on that feed.
    await feedRow(page, 'Mexico City Metro')
      .getByRole('button', { name: /Start a project/ })
      .click()
    await expect(dialog.getByRole('combobox', { name: 'Feed' })).toHaveValue('cdmx-metro')
    await dialog.getByLabel('Name', { exact: true }).fill('CDMX')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    const records = readdirSync(join(engineHome, 'projects')).map(
      (id) =>
        JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')).feed,
    )
    expect(records.sort()).toEqual(['cdmx-metro', 'la-metro-rail'])
  })
})

test('adds a feed from a file, and it survives a relaunch', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'Metro de Prueba.zip'))
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    await page.getByRole('button', { name: 'Add feed' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed' })
    await expect(dialog.getByRole('button', { name: 'Choose a zip' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await expect(dialog).toContainText('Metro de Prueba.zip')
    await dialog.getByRole('button', { name: 'Add feed' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    const added = page.getByRole('list', { name: 'Added' })
    await expect(added.getByRole('listitem', { name: 'Metro de Prueba' })).toBeVisible()
    await expect(feedRow(page, 'Metro de Prueba')).toContainText('downloaded')
    // The record is the engine's, under its home.
    const records = JSON.parse(
      readFileSync(join(engineHome, 'data', 'feeds', 'user-feeds.json'), 'utf8'),
    ) as { key: string }[]
    expect(records.map((r) => r.key)).toEqual(['metro-de-prueba'])
  })
  await withApp(engineHome, async (page) => {
    await expect(feedRow(page, 'Metro de Prueba')).toBeVisible()
  })
})

test("a zip without a timetable is refused with the engine's sentence, and nothing is kept", async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'partial.zip'), ['stop_times'])
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    await page.getByRole('button', { name: 'Add feed' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed' })
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await dialog.getByRole('button', { name: 'Add feed' }).click()
    await expect(dialog.getByRole('alert')).toHaveText(
      'partial.zip has no stop_times.txt, so there is no timetable to animate',
    )
    await expect(dialog, 'the dialog stays, to try again').toBeVisible()
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)
    expect(readdirSync(join(engineHome, 'data', 'feeds'))).toEqual([])
  })
})

test('a path no chooser answered is refused before the engine sees it', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'sneaky.zip'))
  await withApp(engineHome, async (page) => {
    const refused = await page.evaluate(async (p) => {
      const api = (
        globalThis as unknown as {
          api: { engine: { request(m: string, params: unknown): { result: Promise<unknown> } } }
        }
      ).api
      try {
        await api.engine.request('feeds.add', { source: p }).result
        return null
      } catch (e) {
        const error = e as { code: number; data?: { hint: string } }
        return { code: error.code, hint: error.data?.hint }
      }
    }, zip)
    expect(refused?.code).toBe(-32600)
    expect(refused?.hint).toMatch(/chosen in the app, or from a URL/)
    const received = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    expect(received.includes('feeds.add'), 'the engine never saw it').toBe(false)
  })
})

test('adds a feed from a URL with its download on the line, and a cancel keeps nothing', async () => {
  const engineHome = home({ add_delay_ms: 150 })
  await withApp(engineHome, async (page) => {
    await page.getByRole('button', { name: 'Add feed' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed' })
    await dialog.getByLabel('Or from an address').fill('https://agency.example/gtfs.zip')
    await dialog.getByRole('button', { name: 'Add feed' }).click()
    const run = dialog.getByRole('region', { name: 'Adding the feed' })
    await expect(run.getByText('download', { exact: true })).toBeVisible()
    await expect(run.getByRole('status')).toContainText(/downloaded [\d,]+ of 10,240 bytes/)
    await dialog.getByRole('button', { name: 'Cancel the add' }).click()
    await expect(run.getByRole('status')).toContainText('Cancelled. Nothing was kept.')
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)

    // Again, to the end.
    await dialog.getByRole('button', { name: 'Add feed' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })
    await expect(feedRow(page, 'Remote Transit')).toBeVisible()
    await expect(feedRow(page, 'Remote Transit')).toContainText('downloaded')
  })
})

test('removes an added feed behind a confirmation, and refuses one a project uses', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'Metro de Prueba.zip'))
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    await page.getByRole('button', { name: 'Add feed' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add a feed' })
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await dialog.getByRole('button', { name: 'Add feed' }).click()
    await expect(dialog).toBeHidden({ timeout: 20_000 })

    // A project on it: the main process refuses the removal, naming it.
    await feedRow(page, 'Metro de Prueba')
      .getByRole('button', { name: /Start a project/ })
      .click()
    const create = page.getByRole('dialog', { name: 'New project' })
    await create.getByLabel('Name', { exact: true }).fill('Prueba')
    await create.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Prueba' })).toBeVisible()
    await feedRow(page, 'Metro de Prueba')
      .getByRole('button', { name: 'Remove Metro de Prueba' })
      .click()
    const confirm = page.getByRole('dialog', { name: 'Remove Metro de Prueba?' })
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await confirm.getByRole('button', { name: 'Remove' }).click()
    await expect(confirm.getByRole('alert')).toHaveText(
      'One project uses this feed; delete the project first.',
    )
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(feedRow(page, 'Metro de Prueba')).toBeVisible()

    // Delete the project, then the feed goes.
    await page.getByRole('button', { name: 'Open Prueba' }).click()
    await page.getByRole('button', { name: 'Delete project' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Library')
    await feedRow(page, 'Metro de Prueba')
      .getByRole('button', { name: 'Remove Metro de Prueba' })
      .click()
    await page
      .getByRole('dialog', { name: 'Remove Metro de Prueba?' })
      .getByRole('button', { name: 'Remove' })
      .click()
    await expect(page.getByRole('status').filter({ hasText: 'was removed' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)
    expect(
      readdirSync(join(engineHome, 'data', 'feeds')).filter((f) => f.endsWith('.zip')),
    ).toEqual([])
  })
})

test('without an engine the create dialog takes a typed key, as before', async () => {
  const engineHome = home()
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
    await expect(page.getByRole('button', { name: 'Add feed' })).toBeDisabled()
    await expect(page.getByRole('heading', { name: 'Feeds' })).toHaveCount(0)
    await page.locator('.empty').getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await expect(dialog.getByLabel('Feed key')).toHaveValue('la-metro-rail')
    await expect(dialog).toContainText('not ready to list the feeds')
  } finally {
    await app.close()
  }
})
