// The registry against the real engine: every preset listed, and a zip
// added from disk appears, is refused when it lacks a table, and is
// removed (specs/014 SC-002). Skips without an engine checkout.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin } from '../../src/shared/engine'
import type { FeedRecord, FeedsList, Inspection } from '../../src/shared/protocol'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(join(repo, 'vendor/pins.json'), 'utf8')) as {
  engine: EnginePin
}

function realInterpreter(): string | null {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  const config = resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin: '',
    baseDir: repo,
  })
  return resolveInterpreter({
    config: { enginePython: null, engineCheckout: config.engineCheckout },
    packaged: false,
    resourcesPath: '',
    platform: process.platform,
    exists: existsSync,
  }).interpreter
}

const INTERPRETER = realInterpreter()

// A small GTFS zip, stored entries; the same shape the end-to-end suite writes.
function gtfsZip(path: string, without: string[] = []): string {
  const entries: { name: string; body: Buffer }[] = []
  for (const stem of ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar']) {
    if (without.includes(stem)) continue
    const body =
      stem === 'agency'
        ? 'agency_id,agency_name\nM,Metro de Prueba\n'
        : stem === 'calendar'
          ? 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20260101,20261231\n'
          : `${stem}_id\n1\n`
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

describe.skipIf(INTERPRETER === null)('the registry against the real engine', () => {
  it('lists the presets, adds a zip from disk, refuses one without a table, and removes it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'lc-feeds-real-'))
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
      const listed = (await sidecar.request('feeds.list').result) as FeedsList
      const presets = listed.feeds.filter((f) => f.source === 'preset')
      expect(presets).toHaveLength(22)
      expect(presets.map((f) => f.key)).toContain('la-metro-rail')
      expect(listed.feeds.every((f) => typeof f.cached === 'boolean')).toBe(true)

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
      await expect(sidecar.request('feeds.add', { source: partial }).result).rejects.toMatchObject({
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

      // The inspection the Inspect view reads, for the three feeds the
      // issue names, where the checkout has them cached (A2-02).
      const cachedFeeds = join(repo, '..', 'OpenSchematicMaps', 'data', 'feeds')
      const inspect = async (key: string): Promise<Inspection> => {
        cpSync(join(cachedFeeds, `${key}.zip`), join(home, 'data', 'feeds', `${key}.zip`))
        return (await sidecar.request('feeds.inspect', { key, anchor: '2026-09-11' })
          .result) as Inspection
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
    } finally {
      await sidecar.stop()
      rmSync(home, { recursive: true, force: true })
    }
  }, 60_000)
})
