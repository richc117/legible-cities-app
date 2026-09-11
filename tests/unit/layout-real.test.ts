// The one coupling this feature cannot avoid, checked against the engine
// that is actually installed: the app declares the eight stages it draws
// before anything has finished, and the engine has to report exactly those,
// in that order. A pipeline that changes shape fails here rather than
// drawing a wrong picture.
//
// Gated twice. Without an engine checkout it skips, as the other real-engine
// tests do. It also skips when the checkout has no cached stage graphs for
// the feed, because a cold run needs Docker, a download and about thirteen
// seconds, and a test nobody can rely on finishing is worse than one that
// says why it did not run.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin } from '../../src/shared/engine'
import { GRAPH_STAGES, LAYOUT_STAGES } from '../../src/shared/layout'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(join(repo, 'vendor/pins.json'), 'utf8')) as {
  engine: EnginePin
}
const FEED = 'la-metro-rail'

function local() {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  return resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin: '',
    baseDir: repo,
  })
}

const CHECKOUT = local().engineCheckout
const INTERPRETER = resolveInterpreter({
  config: { enginePython: null, engineCheckout: CHECKOUT },
  packaged: false,
  resourcesPath: '',
  platform: process.platform,
  exists: existsSync,
}).interpreter

// The engine's own home is its checkout, so that is where a developer's
// stored layouts are: one folder per layout id under the feed's, each with
// its four stage graphs and a .meta.json (engine v0.5.0).
const CACHED =
  CHECKOUT !== null &&
  existsSync(join(CHECKOUT, 'data', 'graphs', FEED)) &&
  readdirSync(join(CHECKOUT, 'data', 'graphs', FEED)).some(
    (name) =>
      /^[0-9a-f]{64}$/.test(name) &&
      existsSync(join(CHECKOUT, 'data', 'graphs', FEED, name, '03_octi.json')) &&
      existsSync(join(CHECKOUT, 'data', 'graphs', FEED, name, '.meta.json')),
  )

const WHY =
  INTERPRETER === null
    ? ' (skipped: LEGIBLE_ENGINE_CHECKOUT names no engine)'
    : CACHED
      ? ''
      : ` (skipped: the checkout has no cached layout for ${FEED}; run the engine once)`

/** A home seeded from the checkout's caches, so nothing runs LOOM. */
function seededHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'lc-layout-real-'))
  mkdirSync(join(home, 'data', 'graphs'), { recursive: true })
  mkdirSync(join(home, 'data', 'feeds'), { recursive: true })
  cpSync(join(CHECKOUT as string, 'data', 'graphs', FEED), join(home, 'data', 'graphs', FEED), {
    recursive: true,
  })
  // The feed's zip and its normalised copies; the id hashes the zip's bytes,
  // so the copy names the same layout the checkout stored.
  const feeds = join(CHECKOUT as string, 'data', 'feeds')
  for (const file of readdirSync(feeds).filter((f) => f.startsWith(FEED))) {
    cpSync(join(feeds, file), join(home, 'data', 'feeds', file), { recursive: true })
  }
  return home
}

describe.skipIf(INTERPRETER === null || !CACHED)(`the real engine's layout${WHY}`, () => {
  it('reports exactly the stages the app draws, in that order', async () => {
    const home = seededHome()
    const reported: string[] = []
    const log: string[] = []
    const sidecar = new Sidecar({
      command: engineCommand(INTERPRETER as string),
      env: engineEnvironment({
        config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
        base: process.env,
        development: true,
      }),
      pin: pins.engine,
      log: (m) => log.push(m),
      bounds: { handshakeMs: 20_000 },
    })
    try {
      sidecar.start()
      await new Promise<void>((ready, reject) => {
        const timer = setTimeout(() => reject(new Error(log.join('\n'))), 25_000)
        sidecar.onState((s) => {
          if (s.state === 'ready') {
            clearTimeout(timer)
            ready()
          } else if (s.state !== 'starting') {
            clearTimeout(timer)
            reject(new Error(`${s.state}: ${log.join('\n')}`))
          }
        })
      })
      sidecar.onNotification((n) => {
        if (n.method === 'job/progress') {
          reported.push((n.params as { stage: string }).stage)
        }
      })

      const built = (await sidecar.request('graph.build', { key: FEED }).result) as {
        layout: string
        paths: Record<string, string>
      }
      expect(reported, 'the layout call reports the four layout stages').toEqual([...GRAPH_STAGES])
      expect(built.layout, "the engine's own id").toMatch(/^[0-9a-f]{64}$/)

      const map = (await sidecar.request('map.build', {
        key: FEED,
        layout: built.layout,
        date: '2026-09-02',
        out: 'a-project',
      }).result) as { files: { html: string }; date: string; layout: string }

      // The map call repeats the four and adds its own four, which is the
      // whole sequence the app declares.
      expect(reported.slice(GRAPH_STAGES.length)).toEqual([...LAYOUT_STAGES])
      expect(map.date).toBe('2026-09-02')
      expect(map.layout, 'the map names the layout it was drawn from').toBe(built.layout)
      expect(existsSync(join(home, 'out', 'a-project', `${FEED}.html`))).toBe(true)

      // The same inputs name the same layout, and asking again runs nothing.
      const again = (await sidecar.request('graph.build', { key: FEED }).result) as {
        layout: string
      }
      expect(again.layout, 'reproducible').toBe(built.layout)
    } finally {
      await sidecar.stop()
      rmSync(home, { recursive: true, force: true })
    }
  }, 90_000)
})
