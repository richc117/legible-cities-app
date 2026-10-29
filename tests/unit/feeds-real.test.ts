// The registry against the real engine: every preset listed, and a zip
// added from disk appears, is refused when it lacks a table, and is
// removed (specs/014 SC-002); and the inspection the Inspect view reads
// (A2-02), of the BART feed the determinism fixture commits. Skips, saying
// so, where no interpreter with the engine is named, unless the determinism
// workflow opted in, where that fails.
//
// The engine's home is seeded from the fixture, so the one feed it holds is
// BART's and nothing is downloaded. Where an engine checkout is named and
// has them cached, the three feeds the Inspect view's issue names are read
// from it as well.

import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Sidecar } from '../../src/main/sidecar'
import type { FeedRecord, FeedsList, Inspection } from '../../src/shared/protocol'
import { ANCHOR } from '../support/determinism'
import { gtfsZip } from '../support/gtfs-zip'
import {
  BART,
  ENGINE_TEST_MS,
  NO_ENGINE,
  bartHome,
  failIfRequired,
  localConfig,
  noLoom,
  realInterpreter,
  startRealEngine,
} from '../support/real-engine'

const CONFIG = localConfig()
// The checkout's own feed cache, when the environment names one; null on a
// runner, which has none.
const CHECKOUT = CONFIG.engineCheckout
const INTERPRETER = realInterpreter(CONFIG)
const WHY = INTERPRETER === null ? NO_ENGINE : ''

failIfRequired('the registry against the real engine', INTERPRETER === null, 'no engine')

describe.skipIf(INTERPRETER === null)(`the registry against the real engine${WHY}`, () => {
  it(
    'lists the presets, adds a zip from disk, refuses one without a table, and removes it',
    async () => {
      const home = bartHome('lc-feeds-real-')
      let sidecar: Sidecar | undefined
      try {
        sidecar = await startRealEngine(INTERPRETER as string, home, { loomBin: noLoom(home) })
        const listed = (await sidecar.request('feeds.list').result) as FeedsList
        const presets = listed.feeds.filter((f) => f.source === 'preset')
        expect(presets).toHaveLength(22)
        expect(presets.map((f) => f.key)).toContain('la-metro-rail')
        expect(listed.feeds.every((f) => typeof f.cached === 'boolean')).toBe(true)
        // The seeded home holds BART's zip and no other: the engine reads the
        // home it was given, and nothing else is cached in it.
        expect(
          listed.feeds.filter((f) => f.cached).map((f) => f.key),
          'only the fixture is cached',
        ).toEqual([BART])

        const zip = gtfsZip(join(home, 'Metro de Prueba.zip'))
        const added = (await sidecar.request('feeds.add', { source: zip }).result) as FeedRecord
        expect(added).toMatchObject({
          key: 'metro-de-prueba',
          name: 'Metro de Prueba',
          source: 'user',
          cached: true,
          url: '',
        })
        const again = (await sidecar.request('feeds.list').result) as FeedsList
        expect(again.feeds.map((f) => f.key)).toContain('metro-de-prueba')

        const partial = gtfsZip(join(home, 'partial.zip'), ['stop_times'])
        await expect(
          sidecar.request('feeds.add', { source: partial }).result,
        ).rejects.toMatchObject({
          data: {
            kind: 'feed',
            hint: 'partial.zip has no stop_times.txt, so there is no timetable to animate',
          },
        })

        await expect(
          sidecar.request('feeds.remove', { key: 'la-metro-rail' }).result,
        ).rejects.toMatchObject({
          data: { kind: 'feed' },
        })
        expect(await sidecar.request('feeds.remove', { key: 'metro-de-prueba' }).result).toEqual({
          ok: true,
        })
        const after = (await sidecar.request('feeds.list').result) as FeedsList
        expect(after.feeds.map((f) => f.key)).not.toContain('metro-de-prueba')

        // The inspection the Inspect view reads (A2-02), of the fixture's feed:
        // the committed bytes, so every figure is the engine's reading of them
        // at the pin. Twelve subway routes and BART's two airport shuttles, run
        // as buses; one operator; the calendar the fixture's README records.
        const bart = (await sidecar.request('feeds.inspect', { key: BART, anchor: ANCHOR })
          .result) as Inspection
        expect(bart.key).toBe(BART)
        expect(bart.agencies.map((a) => a.agency_name)).toEqual(['Bay Area Rapid Transit'])
        expect(bart.routes).toHaveLength(14)
        expect(bart.route_types.map((t) => [t.route_type, t.mode, t.routes])).toEqual([
          [1, 'subway', 12],
          [3, 'bus', 2],
        ])
        expect(bart.suggested_mode).toBe('subway')
        expect(bart.service).toMatchObject({
          start: '2026-08-10',
          end: '2027-01-10',
          anchor: ANCHOR,
        })
        expect(bart.warnings).toEqual([])
        // Nothing was fetched: the one zip in the home is the fixture's, the
        // user's feed went with its removal, and no other feed was downloaded.
        expect(
          readdirSync(join(home, 'data', 'feeds')).filter((name) => name.endsWith('.zip')),
          'no other feed is in the home',
        ).toEqual([`${BART}.zip`])

        // The three feeds the issue names, where a checkout has them cached.
        if (CHECKOUT !== null) {
          const cachedFeeds = join(CHECKOUT, 'data', 'feeds')
          const inspect = async (key: string): Promise<Inspection> => {
            cpSync(join(cachedFeeds, `${key}.zip`), join(home, 'data', 'feeds', `${key}.zip`))
            return (await (sidecar as Sidecar).request('feeds.inspect', {
              key,
              anchor: '2026-09-11',
            }).result) as Inspection
          }
          if (existsSync(join(cachedFeeds, 'la-metro-rail.zip'))) {
            const la = await inspect('la-metro-rail')
            expect(la.routes).toHaveLength(6)
            expect(la.route_types.map((t) => [t.route_type, t.mode])).toEqual([
              [0, 'tram'],
              [1, 'subway'],
            ])
          }
          if (existsSync(join(cachedFeeds, 'cdmx-metro.zip'))) {
            const cdmx = await inspect('cdmx-metro')
            expect(cdmx.agencies.length).toBeGreaterThan(1)
            expect(cdmx.warnings.some((w) => w.includes('headway-based'))).toBe(true)
          }
          if (existsSync(join(cachedFeeds, 'chicago-l.zip'))) {
            expect((await inspect('chicago-l')).suggested_mode).toBe('subway')
          }
        }
      } finally {
        await sidecar?.stop()
        rmSync(home, { recursive: true, force: true })
      }
    },
    ENGINE_TEST_MS,
  )
})
