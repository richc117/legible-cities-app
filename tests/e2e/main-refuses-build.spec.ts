// Main refuses a map.build for a project with no record (issue 505), in the
// built app, over the bridge the page really has: what the unit tests cannot
// show is the wiring in `index.ts`, that the store handed to the bridge is the
// store the records are in. The project is deleted between the layout's
// graph.build and its closing map.build, where nothing in main holds the
// deletion back; that map.build is refused with the sentence and makes no
// `out/<id>`, and one for a project that is still there draws as before.
// The stand-in takes a graph.build with only a key and draws a map.build
// into `out/<out>` under its home (`tests/fake-engine/schematic/serve.py`,
// `judge_graph_build`, `draw`).
// Needs a Python 3 on the PATH for the stand-in; skips, saying so, without
// one.

import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { REQUEST_FOR_NO_PROJECT } from '../../src/shared/activity'
import type { Api } from '../../src/shared/api'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

// Inside page.evaluate the code runs in the renderer, where the preload put
// `api` on the window; the test's own scope has no DOM types.
type Bridge = { api: Api }

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

test('refuses the closing map.build of a layout whose project was deleted, and draws a kept one', async () => {
  const home = mkdtempSync(join(tmpdir(), 'legible-cities-505-e2e-'))
  writeFileSync(
    join(home, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true }),
  )
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: home,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toHaveText(
      `Engine ready (${PINNED_ENGINE}).`,
      { timeout: 20_000 },
    )
    const answers = await page.evaluate(async () => {
      const { api } = globalThis as unknown as Bridge
      const gone = await api.projects.create({ name: 'Gone', feed: 'la-metro-rail' })
      const kept = await api.projects.create({ name: 'Kept', feed: 'la-metro-rail' })
      // The layout's long step names a feed, which nothing in main can tie to
      // a project, so the deletion it overlaps is let through.
      const built = (await api.engine.request('graph.build', { key: 'la-metro-rail' }).result) as {
        layout: string
      }
      await api.projects.delete(gone.id)
      const draw = async (out: string): Promise<string> => {
        try {
          await api.engine.request('map.build', {
            key: 'la-metro-rail',
            layout: built.layout,
            date: '2026-06-15',
            out,
          }).result
          return 'drawn'
        } catch (e) {
          return (e as { data?: { hint?: string } }).data?.hint ?? String(e)
        }
      }
      return {
        gone: gone.id,
        kept: kept.id,
        refused: await draw(gone.id),
        drawn: await draw(kept.id),
      }
    })
    expect(answers.refused).toBe(REQUEST_FOR_NO_PROJECT)
    expect(existsSync(join(home, 'out', answers.gone)), 'out/<id> not made again').toBe(false)
    expect(answers.drawn).toBe('drawn')
    expect(existsSync(join(home, 'out', answers.kept))).toBe(true)
  } finally {
    await app.close()
  }
})
