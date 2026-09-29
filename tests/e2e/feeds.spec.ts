// The Library's feeds, against the stand-in engine: the list, a project
// from a feed, an add from a file and from a URL, a refused zip, a
// cancelled add, a remove, a refused remove, a remove the engine does not
// answer in time, and the empty state's two steps. The stand-in keeps what was added in the home, as the engine
// does, so a relaunch sees it.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
  env: Record<string, string> = {},
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...env,
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

/**
 * The New project sheet (A5.6-05), opened on a source: a listed feed, a zip
 * or an address. The toolbar's button when there are projects, the empty
 * state's when there are none; either opens the same sheet.
 */
async function openSheet(page: Page, source: 'feed' | 'zip' | 'address'): Promise<Locator> {
  await page.getByRole('button', { name: 'New project' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await expect(dialog).toBeVisible()
  if (source === 'zip')
    await dialog.getByRole('radio', { name: 'A GTFS zip on this computer' }).check()
  if (source === 'address')
    await dialog.getByRole('radio', { name: 'A feed at an address' }).check()
  return dialog
}

/** The sheet's message that has something to say: each field has its own line. */
const sheetAlert = (dialog: Locator): Locator => dialog.getByRole('alert').filter({ hasText: /\S/ })

test('lists the presets and lets a project start from one, in two steps from empty', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await expect(page.getByRole('heading', { name: 'Sample cities' })).toBeVisible()
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
    await expect(empty.getByRole('status')).toContainText(/start from a sample city below/i)
    await empty.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await expect(dialog.getByRole('combobox', { name: 'Feed' })).toHaveValue('la-metro-rail')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
    await expect(page.locator('.empty')).toHaveCount(0)

    // Another, on a feed chosen in the sheet. (A sample city's card opens
    // the sample outright; its own test is below.)
    await page.getByRole('button', { name: 'New project' }).click()
    await dialog.getByRole('combobox', { name: 'Feed' }).selectOption('cdmx-metro')
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Mexico City Metro')
    await dialog.getByLabel('Name', { exact: true }).fill('CDMX')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    // The Library lists it once the record is on disk; read after that,
    // not after the click, or a slow rename (Windows) is read mid-write.
    await expect(page.getByRole('button', { name: 'Open CDMX' })).toBeVisible()
    const records = readdirSync(join(engineHome, 'projects')).map(
      (id) =>
        JSON.parse(readFileSync(join(engineHome, 'projects', id, 'project.json'), 'utf8')).feed,
    )
    expect(records.sort()).toEqual(['cdmx-metro', 'la-metro-rail'])
  })
})

// The front door (A5.6-01): a first start is the sample cities under one
// sentence saying what the app is; a start with a project is the projects
// list, with the samples still below it. One first-level heading, and each
// region named by its own.
test('the front door shows the samples first, then the projects above them', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    const projects = page.getByRole('region', { name: 'Your projects' })
    const samples = page.getByRole('region', { name: 'Sample cities' })
    await expect(samples.getByRole('list', { name: 'Presets' })).toBeVisible()
    await expect(projects).toHaveCount(0)
    await expect(page.locator('.empty').getByRole('status')).toContainText(
      'Legible Cities draws a transit network as a schematic map',
    )
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)

    await page.locator('.empty').getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(projects.getByRole('button', { name: 'Open Los Angeles' })).toBeVisible()
    await expect(samples).toBeVisible()
    await expect(page.locator('.empty')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    // The projects first, in the document and so in reading order.
    const projectsFirst = await page.evaluate(() => {
      const [a, b] = ['projects-heading', 'samples-heading'].map((id) =>
        document.getElementById(id),
      )
      return a !== null && b !== null && (a.compareDocumentPosition(b) & 4) !== 0
    })
    expect(projectsFirst, 'the projects come before the samples').toBe(true)
  })
})

// The sample cities (A5.6-02): every preset as a card, from `feeds.list`
// alone, before anything is downloaded; each card one button named by what
// it shows, whether it is downloaded included.
test('every preset is a card named by its facts, and nothing is fetched to draw them', async () => {
  const engineHome = home({ presets_cached: ['la-metro-rail'] })
  await withApp(engineHome, async (page) => {
    const cards = page.getByRole('list', { name: 'Presets' })
    await expect(cards.getByRole('listitem')).toHaveCount(2)
    await expect(cards.getByRole('button')).toHaveCount(2)
    // A preset cannot be removed, and nothing on its card says it can (A5.6-06).
    await expect(cards.getByRole('button', { name: /Remove/ })).toHaveCount(0)
    await expect(feedRow(page, 'LA Metro Rail').getByRole('button')).toHaveAccessibleName(
      'LA Metro Rail, Los Angeles · Metro Rail, keeps every mode, downloaded',
    )
    await expect(feedRow(page, 'Mexico City Metro').getByRole('button')).toHaveAccessibleName(
      /^Mexico City Metro, .*keeps subway, not downloaded yet$/,
    )
    // Drawn from the list alone: no feed was inspected, downloaded or laid
    // out. Read after the screen has been left and opened again, so its
    // second feeds.list has been answered: anything the first opening set
    // off after its cards were drawn has had its turn by then.
    const received = (): string => readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    const lists = (): number => received().split('"feeds.list"').length - 1
    const before = lists()
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await expect(cards.getByRole('button')).toHaveCount(2)
    await expect.poll(lists).toBeGreaterThan(before)
    const asked = received()
    for (const method of ['feeds.inspect', 'feeds.add', 'graph.build', 'map.build'])
      expect(asked, method).not.toContain(`"${method}"`)
  })
})

test('adds a feed from a file, and it survives a relaunch', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'Metro de Prueba.zip'))
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    const dialog = await openSheet(page, 'zip')
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await expect(dialog).toContainText('Metro de Prueba.zip')
    await expect(dialog, 'the name, never the folder').not.toContainText(engineHome)
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    // The feed is in: the name is filled from it, and the next press would
    // make a project. Cancel leaves the feed listed without one.
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Metro de Prueba', {
      timeout: 20_000,
    })
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    expect(await page.locator('body').innerText()).not.toContain(engineHome)
    const added = page.getByRole('list', { name: 'Added' })
    await expect(added.getByRole('listitem', { name: 'Metro de Prueba' })).toBeVisible()
    // Exactly "downloaded": the words "not downloaded yet" contain it too.
    await expect(
      feedRow(page, 'Metro de Prueba').getByText('downloaded', { exact: true }),
    ).toBeVisible()
    await expect(feedRow(page, 'Metro de Prueba')).not.toContainText('not downloaded')
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

// The sheet fills what it knows (A5.6-05): a listed feed's name as it is
// chosen, never over a name a person typed; and a finished add does not
// outlive a change of source, or the same add would be offered again with
// a file the main process has already forgotten.
test('the new project sheet fills the name it knows, and forgets a finished add on a change', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'Metro de Prueba.zip'))
  await withApp(engineHome, async (page, app) => {
    const dialog = await openSheet(page, 'feed')
    const name = dialog.getByLabel('Name', { exact: true })
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
    await expect(name).toHaveValue('LA Metro Rail')
    await dialog.getByRole('combobox', { name: 'Feed' }).selectOption('cdmx-metro')
    await expect(name, 'another feed, another name').toHaveValue('Mexico City Metro')
    await name.fill('My map')
    await dialog.getByRole('combobox', { name: 'Feed' }).selectOption('la-metro-rail')
    await expect(name, 'a typed name is the person’s').toHaveValue('My map')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    await chooserAnswers(app, zip)
    await openSheet(page, 'zip')
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(name, 'the feed’s own name, once it is in').toHaveValue('Metro de Prueba')
    // Away and back: the add is finished with, the file spent.
    await dialog.getByRole('radio', { name: 'A feed at an address' }).check()
    await dialog.getByRole('radio', { name: 'A GTFS zip on this computer' }).check()
    await expect(dialog.getByRole('region', { name: 'Adding the feed' })).toHaveCount(0)
    await expect(dialog).toContainText('No file chosen.')
    await expect(dialog.getByRole('button', { name: 'Add the feed' })).toBeVisible()
  })
})

test("a zip without a timetable is refused with the engine's sentence, and nothing is kept", async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'partial.zip'), ['stop_times'])
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    const dialog = await openSheet(page, 'zip')
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    // Said on the field that caused it: the zip's.
    await expect(sheetAlert(dialog)).toHaveText(
      'partial.zip has no stop_times.txt, so there is no timetable to animate',
    )
    await expect(dialog.getByRole('button', { name: 'Choose a zip' })).toHaveAccessibleDescription(
      /partial\.zip has no stop_times\.txt/,
    )
    await expect(dialog, 'the dialog stays, to try again').toBeVisible()
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)
    expect(readdirSync(join(engineHome, 'data', 'feeds'))).toEqual([])
  })
})

test('a feed address on this machine is refused before the engine sees it', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    const dialog = await openSheet(page, 'address')
    await dialog.getByLabel('Feed address').fill('http://127.0.0.1:631/')
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    await expect(sheetAlert(dialog)).toContainText('must name a public host')
    const received = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    expect(received.includes('feeds.add')).toBe(false)
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
    const dialog = await openSheet(page, 'address')
    await dialog.getByLabel('Feed address').fill('https://agency.example/gtfs.zip')
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    const run = dialog.getByRole('region', { name: 'Adding the feed' })
    await expect(run.getByText('download', { exact: true })).toBeVisible()
    await expect(run.getByRole('status')).toContainText(/downloaded [\d,]+ of 10,240 bytes/)
    await expect(dialog.getByRole('button', { name: 'Cancel the add' })).toBeFocused()
    await dialog.getByRole('button', { name: 'Cancel the add' }).click()
    await expect(run.getByRole('status')).toContainText(/^Cancelled\./)
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)
    // The engine was told, and kept nothing.
    const received = readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    expect(received).toContain('$/cancelRequest')
    expect(
      readdirSync(join(engineHome, 'data', 'feeds')).filter((f) => f.endsWith('.zip')),
    ).toEqual([])

    // Again, to the end: the feed carries the address it came from, and a
    // name typed before it arrived is the person's and stays.
    await dialog.getByLabel('Name', { exact: true }).fill('My transit')
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('My transit')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Open My transit' })).toBeVisible()
    await expect(feedRow(page, 'Remote Transit')).toBeVisible()
    await expect(
      feedRow(page, 'Remote Transit').getByText('downloaded', { exact: true }),
    ).toBeVisible()
    await expect(feedRow(page, 'Remote Transit')).not.toContainText('not downloaded')
    const records = JSON.parse(
      readFileSync(join(engineHome, 'data', 'feeds', 'user-feeds.json'), 'utf8'),
    ) as { url: string }[]
    expect(records.map((r) => r.url)).toEqual(['https://agency.example/gtfs.zip'])
  })
})

// Issue 207. Until v0.10.1 a failed download's error was the engine's
// `FeedError` with the address whole: "{url} could not be fetched: ...",
// message, hint and detail alike, and the stand-in engine still answers
// that way here. A key in the address a person typed must not come back
// onto the screen in it - not in the dialog, and not in the jobs
// inspector - whichever engine wrote the sentence.
test('a failed download keeps the key in its address off the screen', async () => {
  // A made-up value, planted so it can be looked for on the screen.
  const planted = 'planted207'
  const address = `https://agency.example/gtfs.zip?api_key=${planted}`
  const engineHome = home({
    add_refuses: `${address} could not be fetched: HTTP Error 403: Forbidden`,
  })
  await withApp(engineHome, async (page) => {
    const dialog = await openSheet(page, 'address')
    await dialog.getByLabel('Feed address').fill(address)
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    await expect(dialog).toContainText(
      'https://agency.example/gtfs.zip?api_key=<redacted> could not be fetched: HTTP Error 403: Forbidden',
    )
    // What the dialog drew, the sentence and anything behind it.
    expect(await dialog.innerText()).not.toContain(planted)
    // The dialog is modal; the inspector is behind it.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: /^Jobs, / }).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector).toContainText('Feed add from a web address')
    // The detail is the one field the dialog never draws, and it sits
    // behind a closed disclosure, which `innerText` does not read - so it
    // is opened, and shown to hold the address, redacted.
    await inspector.getByText('Details', { exact: true }).click()
    await expect(inspector.locator('.job-detail')).toContainText(
      'FeedError: https://agency.example/gtfs.zip?api_key=<redacted> could not be fetched',
    )
    // Everything drawn, the inspector included. The field the person typed
    // into still holds what they typed, which is theirs and not drawn text.
    expect(await page.locator('body').innerText()).not.toContain(planted)
  })
})

test('removes an added feed behind a confirmation, and refuses one a project uses', async () => {
  const engineHome = home()
  const zip = gtfsZip(join(engineHome, 'Metro de Prueba.zip'))
  await withApp(engineHome, async (page, app) => {
    await chooserAnswers(app, zip)
    const dialog = await openSheet(page, 'zip')
    await dialog.getByRole('button', { name: 'Choose a zip' }).click()
    await dialog.getByRole('button', { name: 'Add the feed' }).click()
    await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeVisible({
      timeout: 20_000,
    })
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

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
      'The project “Prueba” uses this feed; delete it first.',
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

/** A feed a person added, written into the stand-in's registry before the app starts. */
function addedFeed(engineHome: string, key: string, name: string): void {
  const folder = join(engineHome, 'data', 'feeds')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'user-feeds.json'),
    JSON.stringify([
      {
        key,
        name,
        city: '',
        network: '',
        url: null,
        mode: 'all',
        label_pattern: null,
        label_strip: null,
        agency: null,
        geographic: true,
        notes: [],
        source: 'user',
      },
    ]),
  )
}

/** The keys in the stand-in's registry of added feeds, as it has them on disk now. */
function addedKeys(engineHome: string): string[] {
  const records = JSON.parse(
    readFileSync(join(engineHome, 'data', 'feeds', 'user-feeds.json'), 'utf8'),
  ) as { key: string }[]
  return records.map((r) => r.key)
}

/** How many requests of one method the stand-in has read. */
function received(engineHome: string, method: string): number {
  return readFileSync(join(engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`)).length
}

test('a removal the engine does not answer in time ends with a sentence, and the list shows the truth once it does', async () => {
  test.setTimeout(120_000)
  // The stand-in blocks on the removal for eight seconds before doing it,
  // reading nothing else meanwhile, as the pinned engine runs feeds.remove
  // on its one reader thread; the app stops waiting after one (issue 107).
  const engineHome = home({ remove_blocks_ms: 8_000 })
  addedFeed(engineHome, 'metro-de-prueba', 'Metro de Prueba')
  const userData = mkdtempSync(join(tmpdir(), 'legible-cities-feeds-profile-'))
  await withApp(
    engineHome,
    async (page) => {
      await feedRow(page, 'Metro de Prueba')
        .getByRole('button', { name: 'Remove Metro de Prueba' })
        .click()
      const confirm = page.getByRole('dialog', { name: 'Remove Metro de Prueba?' })
      const remove = confirm.getByRole('button', { name: 'Remove' })
      const cancel = confirm.getByRole('button', { name: 'Cancel' })
      const listsBefore = received(engineHome, 'feeds.list')
      await remove.click()
      await expect(remove).toHaveAttribute('aria-disabled', 'true')

      // The deadline releases the dialog: the sentence, and the buttons
      // taking presses again, while the engine is still in the removal.
      await expect(confirm.getByRole('alert')).toHaveText(
        'The engine did not answer in time, so the feed may or may not have been removed. The list of feeds is read again to show what the engine has now.',
        { timeout: 6_000 },
      )
      expect(addedKeys(engineHome), 'the engine has not done the removal yet').toEqual([
        'metro-de-prueba',
      ])
      await expect(confirm, 'the dialog stays open with its sentence').toBeVisible()
      await expect(remove).not.toHaveAttribute('aria-disabled', 'true')
      await expect(cancel).not.toHaveAttribute('aria-disabled', 'true')
      // The busy line is gone. Located by attribute: an empty status line has
      // no size, and `getByRole` passes over an element with none.
      await expect(confirm.locator('[role="status"]')).toHaveText('')

      // The list is unchanged while the engine is in the removal: the read
      // the app sent waits behind it.
      await expect(feedRow(page, 'Metro de Prueba')).toHaveCount(1)

      // The engine finishes the removal regardless. The read queued behind
      // it lands, and closing the dialog reads the list once more; either
      // way the feed has gone from it.
      await expect.poll(() => addedKeys(engineHome), { timeout: 20_000 }).toEqual([])
      await expect
        .poll(() => received(engineHome, 'feeds.list'), { timeout: 10_000 })
        .toBeGreaterThan(listsBefore)
      await cancel.click()
      await expect(confirm).toBeHidden()
      await expect(feedRow(page, 'Metro de Prueba')).toHaveCount(0, { timeout: 10_000 })
      await expect(page.getByRole('list', { name: 'Added' })).toHaveCount(0)
      // The row whose Remove opened the dialog went with the feed, and the
      // last added feed took its region with it: the samples' heading.
      await expect(page.getByRole('heading', { name: 'Sample cities' })).toBeFocused()
      // The engine read the app's cancel only after the removal, and it
      // changed nothing; read on a poll, since a slow runner records late.
      await expect.poll(() => received(engineHome, '$/cancelRequest')).toBe(1)
      expect(received(engineHome, 'feeds.remove'), 'one removal was sent').toBe(1)
    },
    { LEGIBLE_USER_DATA: userData, LEGIBLE_FEEDS_REMOVE_DEADLINE_MS: '1000' },
  )
})

test('without an engine the New project sheet takes a typed key, as before', async () => {
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
    // The samples' region is there, and says why it lists nothing.
    await expect(page.getByRole('region', { name: 'Sample cities' }).getByRole('list')).toHaveCount(
      0,
    )
    await expect(page.getByRole('region', { name: 'Sample cities' })).toContainText(
      'listed once the engine is ready',
    )
    await page.locator('.empty').getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await expect(dialog.getByLabel('Feed key')).toHaveValue('la-metro-rail')
    await expect(dialog).toContainText('not ready to list the feeds')
    // A zip or an address needs the engine to add it, so neither is offered.
    await expect(dialog.getByRole('radio', { name: 'A GTFS zip on this computer' })).toBeDisabled()
    await expect(dialog.getByRole('radio', { name: 'A feed at an address' })).toBeDisabled()
  } finally {
    await app.close()
  }
})
