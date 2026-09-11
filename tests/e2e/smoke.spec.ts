// The end-to-end checks: launch the built app, find the window, read the
// Library, prove the origin, quit, and see the process end; then the
// project lifecycle from the Library, across a relaunch, and the served
// output of a real project. Runs on the three runners; on Linux under
// xvfb-run (research.md section 3).

import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import electronPath from 'electron'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'

const repoRoot = resolve(__dirname, '../..')

function launch(home: string): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, SCHEMATIC_HOME: home },
    timeout: 30_000,
  })
}

// One launch of the built app against an engine home, closed afterwards
// whatever happens, and not returned from until the process has ended: a
// relaunch on the same home must never meet the single-instance lock of a
// process still quitting.
async function withApp(home: string, run: (window: Page) => Promise<void>): Promise<void> {
  const app = await launch(home)
  // Taken now: the application object is disposed by close().
  const child = app.process()
  try {
    await run(await app.firstWindow())
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

// A fetch from inside the page: the origin's answer as the renderer sees it.
function probe(
  window: Page,
  path: string,
): Promise<{ status: number; body: string; type: string | null }> {
  return window.evaluate(async (p) => {
    const r = await fetch(p)
    return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }
  }, path)
}

// The <dd> paired with a <dt> in the project view's definition list. The
// term is anchored so a short one never matches a longer one.
function definition(window: Page, term: string): Locator {
  return window
    .locator('dl dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]')
}

test('opens to an empty Library on the app://local origin, and quits', async () => {
  // A fresh engine home, so the test never touches the developer's data,
  // with one project page to serve.
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-e2e-'))
  mkdirSync(join(home, 'out', 'p1'), { recursive: true })
  writeFileSync(join(home, 'out', 'p1', 'index.html'), '<!doctype html><title>p1</title>')
  // A file outside the project, and a symbolic link to it from inside: the
  // handler must refuse the link. Symlink creation can be refused on a
  // locked-down Windows account, in which case that one probe is skipped.
  writeFileSync(join(home, 'secret.txt'), 'outside')
  let linked = true
  try {
    symlinkSync(join(home, 'secret.txt'), join(home, 'out', 'p1', 'link.txt'), 'file')
  } catch {
    linked = false
  }

  const app = await launch(home)
  // Taken now: the application object is disposed by close().
  const child = app.process()
  try {
    const window = await app.firstWindow()
    // Two titles: the page's, which toHaveTitle reads, and the window's,
    // which is the contract (FR-003) and which the main process owns.
    await expect(window).toHaveTitle('Legible Cities')
    expect(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle()),
    ).toBe('Legible Cities')
    await expect(window.getByRole('heading', { level: 1 })).toHaveText('Library')
    await expect(window.getByRole('status').filter({ hasText: /projects/i })).toContainText(
      /no projects/i,
    )

    // The origin, and the refusals, from inside the page (User Story 2).
    expect(
      await window.evaluate(
        () => (globalThis as unknown as { location: { origin: string } }).location.origin,
      ),
    ).toBe('app://local')

    const ok = await probe(window, '/projects/p1/index.html')
    expect(ok.status).toBe(200)
    expect(ok.type).toMatch(/^text\/html/)

    // A dot-dot the browser normalises away never reaches the project: 404.
    const normalised = await probe(window, '/projects/p1/%2e%2e/%2e%2e/x')
    expect(normalised.status).toBe(404)
    expect(normalised.body).not.toContain('/')
    // Escapes that survive normalisation are refused by the handler: 403.
    for (const path of ['/projects/p1/..%2fsecret.txt', '/projects/p1/..%5csecret.txt']) {
      const escape = await probe(window, path)
      expect(escape.status, path).toBe(403)
      expect(escape.body).not.toContain('/')
    }
    if (linked) {
      const viaLink = await probe(window, '/projects/p1/link.txt')
      expect(viaLink.status).toBe(403)
      expect(viaLink.body).not.toContain('outside')
    }
    const missing = await probe(window, '/projects/nope/a.html')
    expect(missing.status).toBe(404)
    expect(missing.body).not.toContain('/')
    const listing = await probe(window, '/projects/p1/')
    expect(listing.status).toBe(404)

    // A second launch while the first runs must exit on its own and leave
    // the first with its one window (FR-035, the single-instance lock).
    const second = spawn(electronPath as unknown as string, ['.'], {
      cwd: repoRoot,
      env: { ...process.env, SCHEMATIC_HOME: home },
      stdio: 'ignore',
    })
    const secondExit = await new Promise<number | null>((done) => {
      const timer = setTimeout(() => {
        second.kill()
        done(null)
      }, 15_000)
      second.once('exit', (code) => {
        clearTimeout(timer)
        done(code)
      })
    })
    expect(secondExit, 'the second instance exits by itself').not.toBeNull()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

    // Nothing in the renderer reaches Node.
    expect(await window.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe(
      'undefined',
    )
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
})

test('creates, opens, renames and deletes a project, and serves its output', async () => {
  // Two launches in one test: the project has to survive a relaunch.
  test.slow()
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-e2e-'))
  let id = ''

  // Create one from the empty Library, and read the record it left on disk
  // (User Story 1).
  await withApp(home, async (window) => {
    await expect(window.getByRole('status').filter({ hasText: /projects/i })).toContainText(
      /no projects/i,
    )
    // Keyboard first (User Story 4): Enter opens the dialog from the button,
    // Escape closes it and returns focus to the button.
    const newProject = window.getByRole('button', { name: 'New project' })
    await newProject.focus()
    await window.keyboard.press('Enter')
    await expect(window.getByRole('dialog')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByRole('dialog')).toBeHidden()
    await expect(newProject).toBeFocused()
    await window.getByRole('button', { name: 'New project' }).click()
    const dialog = window.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const name = dialog.getByLabel('Name', { exact: true })
    await expect(name).toBeFocused()
    await name.fill('Los Angeles')
    // A typed key when no engine lists the feeds (as on the runners), the
    // engine's list as a select when one does (as on a developer's machine).
    await expect(
      dialog.getByLabel('Feed key').or(dialog.getByRole('combobox', { name: 'Feed' })),
    ).toHaveValue('la-metro-rail')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(dialog).toBeHidden()

    const entry = window.getByRole('button', { name: 'Open Los Angeles' })
    await expect(entry).toBeVisible()
    await expect(entry).toContainText('la-metro-rail')
    await expect(entry).toContainText('not yet chosen')
    await expect(window.getByRole('list', { name: 'Projects' })).toBeVisible()
    await expect(window.getByText(/no projects yet/i)).toHaveCount(0)

    // One folder, named by the identifier, holding a version-1 record with
    // nothing chosen or laid out yet.
    const folders = readdirSync(join(home, 'projects'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    expect(folders).toHaveLength(1)
    id = folders[0]
    const record: unknown = JSON.parse(
      readFileSync(join(home, 'projects', id, 'project.json'), 'utf8'),
    )
    expect(record).toMatchObject({
      version: 1,
      id,
      name: 'Los Angeles',
      feed: 'la-metro-rail',
      date: null,
      layout: null,
    })
  })

  // Relaunch on the same home: the project survived. Open, rename, serve
  // its output, and delete it (User Stories 1 to 3).
  await withApp(home, async (window) => {
    const entry = window.getByRole('button', { name: 'Open Los Angeles' })
    await expect(entry).toBeVisible()
    await entry.click()
    const heading = window.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText('Los Angeles')
    await expect(definition(window, 'Feed')).toHaveText('la-metro-rail')
    await expect(definition(window, 'Mode')).toHaveText('all')
    await expect(definition(window, 'Service day')).toHaveText('not yet chosen')
    await expect(definition(window, 'Layout')).toHaveText('not laid out yet')

    // Rename: the heading follows, and so does the Library's entry.
    await window.getByRole('button', { name: 'Rename', exact: true }).click()
    const newName = window.getByLabel('New name')
    await expect(newName).toHaveValue('Los Angeles')
    await newName.fill('LA Metro')
    await window.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(heading).toHaveText('LA Metro')
    await window.getByRole('button', { name: 'Back to Library' }).click()
    const renamed = window.getByRole('button', { name: 'Open LA Metro' })
    await expect(renamed).toBeVisible()

    // The project's output is served under its identifier and nowhere
    // else (User Story 3). The file stands in for what a layout run writes.
    mkdirSync(join(home, 'out', id), { recursive: true })
    writeFileSync(join(home, 'out', id, 'index.html'), '<!doctype html><title>output</title>')
    const served = await probe(window, `/projects/${id}/index.html`)
    expect(served.status).toBe(200)
    expect(served.type).toMatch(/^text\/html/)
    const escape = await probe(window, `/projects/${id}/..%2fsecret.txt`)
    expect(escape.status).toBe(403)
    expect(escape.body).not.toContain('/')
    const unknown = await probe(window, `/projects/${id}x/index.html`)
    expect(unknown.status).toBe(404)
    expect(unknown.body).not.toContain('/')

    // Delete: the confirmation names the project and lands on Cancel, the
    // safe default; Cancel keeps everything; Delete removes the project
    // and its output (User Story 2).
    await renamed.click()
    await expect(heading).toHaveText('LA Metro')
    const deleteProject = window.getByRole('button', { name: 'Delete project' })
    await deleteProject.click()
    const confirm = window.getByRole('dialog')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('heading', { level: 2 })).toHaveText('Delete LA Metro?')
    const cancel = confirm.getByRole('button', { name: 'Cancel', exact: true })
    await expect(cancel).toBeFocused()
    await cancel.click()
    await expect(confirm).toBeHidden()
    await expect(heading).toHaveText('LA Metro')
    expect(existsSync(join(home, 'projects', id, 'project.json'))).toBe(true)

    await deleteProject.click()
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(heading).toHaveText('Library')
    await expect(window.getByRole('status').filter({ hasText: /projects/i })).toContainText(
      /no projects yet/i,
    )

    // On disk, the project folder and its output are gone; the origin no
    // longer serves the file.
    const projects = join(home, 'projects')
    expect(existsSync(projects) ? readdirSync(projects) : []).toEqual([])
    expect(existsSync(join(home, 'out', id))).toBe(false)
    const gone = await probe(window, `/projects/${id}/index.html`)
    expect(gone.status).toBe(404)
  })
})
