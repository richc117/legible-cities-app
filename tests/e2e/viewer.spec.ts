// The viewer, and the boundary around it.
//
// The second test is the one that matters. It puts a hostile page where the
// engine's would be and tries every route out of the frame, because that is
// the threat ADR-028 exists for: the engine embeds a feed's line and station
// names in the page, and a name containing a closing script tag becomes live
// markup (engine issue E17). The sandbox holds whether or not that is fixed,
// and this is what says so.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, findPython } from '../support/python'
import { VIEWER_SANDBOX } from '../../src/shared/viewer'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-viewer-'))
  writeFileSync(
    join(dir, 'fake-engine.json'),
    JSON.stringify({ map_draws: true, progress_delay_ms: 5 }),
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

/** A laid-out project, which is what puts a viewer on the screen. */
async function laidOutProject(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  const entry = page.getByRole('button', { name: 'Open Los Angeles' })
  await expect(entry).toBeVisible()
  await entry.click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
  await page.getByRole('button', { name: /lay out/i }).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
}

test('shows the generated page once a project has a layout, and not before', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await page.getByRole('button', { name: 'New project' }).click()
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await dialog.getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Los Angeles')
    await expect(page.getByRole('region', { name: 'Map' })).toHaveCount(0)

    await page.getByRole('button', { name: /lay out/i }).click()
    await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
    const viewer = page.getByRole('region', { name: 'Map' })
    await expect(viewer).toBeVisible()
    const frame = page.locator('iframe.viewer-frame')
    await expect(frame).toHaveAttribute('src', /projects\/[a-z0-9]+\/.+\.html\?present=1/)
    await expect(frame, 'the theme rides on the address').toHaveAttribute('src', /theme=/)
  })
})

// The whole of ADR-028, asserted. If this ever fails, the app is back to
// where a feed's text could call the bridge.
test('a hostile page in the viewer cannot reach the app', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page, app) => {
    await laidOutProject(page)
    const id = readdirSync(join(engineHome, 'projects'))[0]
    const out = join(engineHome, 'out', id)
    expect(existsSync(out)).toBe(true)
    mkdirSync(out, { recursive: true })

    // What the engine's page would be, if a route in the feed were named
    // with a closing script tag.
    writeFileSync(
      join(out, 'la-metro-rail.html'),
      [
        '<!doctype html><meta charset="utf-8"><title>hostile</title><body>',
        '<a id="lnk" href="app://local/ui/#taken" target="_top">go</a>',
        '<script>',
        'window.__present = { state: function () { return { viewName: "schematic" } } };',
        'var tried = {};',
        'function attempt(n, f) { try { tried[n] = String(f()) } catch (e) { tried[n] = "REFUSED" } }',
        'attempt("readParentApi", function () { return typeof parent.api });',
        'attempt("callParentApi", function () { parent.api.projects.list(); return "reached" });',
        'attempt("parentDocument", function () { return String(parent.document.title) });',
        'attempt("parentEval", function () { return String(parent.eval("1+1")) });',
        'attempt("injectIntoParent", function () { parent.document.body.appendChild(parent.document.createElement("script")); return "appended" });',
        'attempt("topAssign", function () { top.location.href = "app://local/ui/"; return "assigned" });',
        'attempt("topReplace", function () { top.location.replace("app://local/ui/"); return "replaced" });',
        'attempt("openTop", function () { return String(window.open("app://local/ui/", "_top")) });',
        'attempt("open", function () { return String(window.open("app://local/ui/")) });',
        'attempt("nodeRequire", function () { return typeof window.require });',
        'setTimeout(function () { try { document.getElementById("lnk").click() } catch (e) {} }, 100);',
        'window.__tried = tried;',
        '</script></body>',
      ].join('\n'),
    )

    // Reopen so the viewer loads what was just written.
    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
    const topUrl = page.url()
    await page.waitForTimeout(2000)

    // The exact sandbox, and no second flag. This assertion is the boundary.
    await expect(page.locator('iframe.viewer-frame')).toHaveAttribute('sandbox', VIEWER_SANDBOX)

    // Read what the page managed, from the only place that can reach in.
    const tried = (await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const main = win.webContents.mainFrame
      const frame = main.frames.find((f) => f !== main)
      return frame ? ((await frame.executeJavaScript('window.__tried')) as unknown) : null
    })) as Record<string, string> | null

    expect(
      Object.keys(tried ?? {}),
      'the hostile page ran and tried every route, so its refusals mean something',
    ).toHaveLength(10)
    for (const route of [
      'readParentApi',
      'callParentApi',
      'parentDocument',
      'parentEval',
      'injectIntoParent',
      'topAssign',
      'topReplace',
    ]) {
      expect(tried?.[route], route).toBe('REFUSED')
    }
    expect(tried?.openTop, 'no window opens, so none can be targeted').toBe('null')
    expect(tried?.open).toBe('null')
    expect(tried?.nodeRequire, 'no Node in a sandboxed frame').toBe('undefined')

    expect(page.url(), 'the window did not move').toBe(topUrl)
    expect(app.windows(), 'no second window opened').toHaveLength(1)
  })
})

test('the app can still drive the page it cannot be reached from', async () => {
  const engineHome = home()
  await withApp(engineHome, async (page) => {
    await laidOutProject(page)
    const id = readdirSync(join(engineHome, 'projects'))[0]
    writeFileSync(
      join(engineHome, 'out', id, 'la-metro-rail.html'),
      [
        '<!doctype html><meta charset="utf-8"><title>stand-in map</title><body>',
        '<script>',
        'var shown = "schematic", labels = true, routes = null, at = 0, speed = 60, playing = true;',
        'window.__present = {',
        '  showView: function (name) { shown = name },',
        '  setLabels: function (on) { labels = !!on },',
        '  setRoutes: function (keep) { routes = keep },',
        '  seek: function (sec) { at = sec },',
        '  setSpeed: function (x) { speed = x },',
        '  setPlaying: function (on) { playing = !!on },',
        '  hasGeo: function () { return true },',
        '  state: function () { return { viewName: shown, labels: labels, routes: routes, at: at, speed: speed, playing: playing } },',
        '  bounds: function () { return { t0: 0, t1: 3600 } },',
        '};',
        '</script></body>',
      ].join('\n'),
    )
    await page.getByRole('button', { name: /back to library/i }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(page.getByRole('region', { name: 'Map' })).toBeVisible()
    await page.waitForTimeout(1500)

    const drive = (method: string, ...args: unknown[]): Promise<unknown> =>
      page.evaluate(
        ([m, a]) =>
          (
            globalThis as unknown as {
              api: { viewer: { call(m: string, ...a: unknown[]): Promise<unknown> } }
            }
          ).api.viewer.call(m as string, ...(a as unknown[])),
        [method, args] as [string, unknown[]],
      )

    await expect(drive('state')).resolves.toMatchObject({ viewName: 'schematic', labels: true })
    await drive('showView', 'linear')
    await drive('setLabels', false)
    await expect(drive('state')).resolves.toMatchObject({ viewName: 'linear', labels: false })
    await expect(drive('bounds')).resolves.toEqual({ t0: 0, t1: 3600 })

    // Every method the app offers, not just the four that are easy: the
    // specification says each one reaches the page and takes effect.
    await drive('setRoutes', ['A'])
    await drive('seek', 1800)
    await drive('setSpeed', 30)
    await drive('setPlaying', false)
    await expect(drive('state')).resolves.toMatchObject({
      routes: ['A'],
      at: 1800,
      speed: 30,
      playing: false,
    })
    await expect(drive('hasGeo')).resolves.toBe(true)

    // A method the page does not expose is refused before anything is sent.
    await expect(drive('setCapture', true)).rejects.toThrow()
  })
})
