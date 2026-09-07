// The built app against the stand-in engine: the status line, a request
// from the page with the engine's answer and its error intact, a restart
// after the engine is killed from outside, nothing left after quit, and the
// app still usable with no engine at all. Needs a Python 3 on the PATH for
// the stand-in; skips, saying so, without one.

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import type { Api } from '../../src/shared/api'
import { FAKE_ENGINE, findPython } from '../support/python'

// Inside page.evaluate the code runs in the renderer, where the preload
// put `api` on the window; the test's own scope has no DOM types.
type Bridge = { api: Api }

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

function launch(env: Record<string, string>): Promise<ElectronApplication> {
  return electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, ...env } as Record<string, string>,
    timeout: 30_000,
  })
}

async function withApp(
  env: Record<string, string>,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
): Promise<void> {
  const app = await launch(env)
  const child = app.process()
  try {
    await run(await app.firstWindow(), app)
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function fakeHome(control: Record<string, unknown> = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-engine-e2e-'))
  writeFileSync(join(home, 'fake-engine.json'), JSON.stringify(control))
  return home
}

const pidIn = (home: string): number => Number(readFileSync(join(home, 'fake-engine.pid'), 'utf8'))

test('shows the engine ready, answers a request from the page, restarts, and leaves nothing', async () => {
  const home = fakeHome()
  const env = {
    SCHEMATIC_HOME: home,
    LEGIBLE_ENGINE_PYTHON: PYTHON as string,
    PYTHONPATH: FAKE_ENGINE,
  }
  let pid = 0
  await withApp(env, async (page) => {
    const status = page.getByRole('status', { name: 'Engine' })
    await expect(status).toHaveText('Engine ready (0.2.0).')
    await expect.poll(() => existsSync(join(home, 'fake-engine.pid'))).toBe(true)
    pid = pidIn(home)
    expect(alive(pid)).toBe(true)

    // The engine's answer, exactly, and its error with the data intact.
    const info = await page.evaluate(async () => {
      const r = (globalThis as unknown as Bridge).api.engine.request('engine.info')
      return (await r.result) as { engine: string; protocol: number }
    })
    expect(info.engine).toBe('0.2.0')
    expect(info.protocol).toBe(1)
    const refused = await page.evaluate(async () => {
      const r = (globalThis as unknown as Bridge).api.engine.request('map.build', {
        key: 'la-metro-rail',
      })
      try {
        await r.result
        return null
      } catch (e) {
        const error = e as { code: number; data?: { hint: string; kind: string } }
        return { code: error.code, kind: error.data?.kind, hint: error.data?.hint }
      }
    })
    expect(refused?.code).toBe(-32602)
    expect(refused?.kind).toBe('params')
    expect(refused?.hint?.startsWith('date is required')).toBe(true)

    // Progress reaches the page with the page's own id for the request.
    const progress = await page.evaluate(async () => {
      const seen: { id: string; stage: string }[] = []
      const off = (globalThis as unknown as Bridge).api.engine.onProgress((p) =>
        seen.push({ id: p.id, stage: p.stage }),
      )
      const r = (globalThis as unknown as Bridge).api.engine.request('graph.build', {
        key: 'la-metro-rail',
      })
      await r.result
      off()
      return { id: r.id, stages: seen.filter((s) => s.id === r.id).map((s) => s.stage) }
    })
    expect(progress.stages).toEqual(['gtfs2graph', 'topo', 'loom', 'octi'])

    // Killed from outside: the line says so, then says ready again (SC-002).
    process.kill(pid, 'SIGKILL')
    await expect(status).toContainText(/restarting/i, { timeout: 2_000 })
    await expect(status).toHaveText('Engine ready (0.2.0).', { timeout: 10_000 })
    await expect.poll(() => pidIn(home)).not.toBe(pid)
    pid = pidIn(home)
    expect(alive(pid)).toBe(true)
  })
  // Quit ends the engine (SC-003).
  await expect.poll(() => alive(pid), { timeout: 3_000 }).toBe(false)
})

test('says the engine is unavailable when no interpreter exists, and still works', async () => {
  const home = fakeHome()
  const missing = join(home, 'nowhere', process.platform === 'win32' ? 'python.exe' : 'python')
  await withApp({ SCHEMATIC_HOME: home, LEGIBLE_ENGINE_PYTHON: missing }, async (page) => {
    const status = page.getByRole('status', { name: 'Engine' })
    await expect(status).toContainText(/engine unavailable/i)
    await expect(status).toContainText('LEGIBLE_ENGINE_PYTHON')
    await expect(status).not.toContainText('nowhere')
    const refused = await page.evaluate(async () => {
      try {
        await (globalThis as unknown as Bridge).api.engine.request('engine.info').result
        return null
      } catch (e) {
        return (e as { code: number }).code
      }
    })
    expect(refused).toBe(-32001)
    const created = await page.evaluate(() =>
      (globalThis as unknown as Bridge).api.projects.create({
        name: 'Still works',
        feed: 'la-metro-rail',
      }),
    )
    expect(created.name).toBe('Still works')
    expect(
      await page.evaluate(() => (globalThis as unknown as Bridge).api.projects.list()),
    ).toHaveLength(1)
  })
})

test('shows the mismatch after the dialog when the engine is the wrong version', async () => {
  // The native dialog is modal to the window but not to the test: the state
  // behind it is what the page shows once it is dismissed, and what the
  // bridge answers meanwhile.
  const home = fakeHome({ version: '0.1.0' })
  const env = {
    SCHEMATIC_HOME: home,
    LEGIBLE_ENGINE_PYTHON: PYTHON as string,
    PYTHONPATH: FAKE_ENGINE,
  }
  await withApp(env, async (page, app) => {
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (globalThis as unknown as Bridge).api.engine.state())).state,
        { timeout: 10_000 },
      )
      .toBe('mismatched')
    const state = await page.evaluate(() => (globalThis as unknown as Bridge).api.engine.state())
    expect(state).toMatchObject({ state: 'mismatched', found: { version: '0.1.0', protocol: 1 } })
    await expect.poll(() => alive(pidIn(home)), { timeout: 5_000 }).toBe(false)
    // The quit that follows dismisses the dialog itself (before-quit aborts it).
    void app
  })
})
