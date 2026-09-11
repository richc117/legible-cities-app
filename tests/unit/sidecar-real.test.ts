// The supervisor against the real engine, where a checkout with an
// environment exists (LEGIBLE_ENGINE_CHECKOUT in .env.local or the
// environment); skips, saying so, elsewhere. Docker is not needed: the
// handshake and a refused map.build never reach LOOM.

import { existsSync, readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EngineError, EnginePin } from '../../src/shared/engine'

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
    baseDir: repo,
  })
  const resolution = resolveInterpreter({
    config: { enginePython: null, engineCheckout: config.engineCheckout },
    packaged: false,
    resourcesPath: '',
    platform: process.platform,
    exists: existsSync,
  })
  return resolution.interpreter
}

const INTERPRETER = realInterpreter()

describe.skipIf(INTERPRETER === null)('Sidecar against the real engine', () => {
  it('handshakes with the pinned version, passes an error through, and stops clean', async () => {
    const home = mkdtempSync(join(tmpdir(), 'lc-real-'))
    const log: string[] = []
    const sidecar = new Sidecar({
      command: engineCommand(INTERPRETER as string),
      env: engineEnvironment({
        config: { home, loomBin: null, ffmpeg: null },
        base: process.env,
        development: true,
      }),
      pin: pins.engine,
      log: (m) => log.push(m),
      bounds: { handshakeMs: 20_000 },
    })
    try {
      sidecar.start()
      const ready = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(log.join('\n'))), 25_000)
        sidecar.onState((s) => {
          if (
            s.state === 'ready' ||
            s.state === 'mismatched' ||
            s.state === 'stopped' ||
            s.state === 'unavailable'
          ) {
            clearTimeout(timer)
            resolve(s)
          }
        })
      })
      expect(ready).toEqual({
        state: 'ready',
        version: pins.engine.version,
        protocol: pins.engine.protocol,
      })

      const info = (await sidecar.request('engine.info').result) as Record<string, unknown>
      expect(info.engine).toBe(pins.engine.version)
      expect(info.protocol).toBe(1)
      expect(info.home).toBe(home)

      const error = (await sidecar
        .request('map.build', { key: 'la-metro-rail' })
        .result.catch((e: EngineError) => e)) as EngineError
      expect(error.code).toBe(-32602)
      expect(error.data?.kind).toBe('params')
      expect(error.data?.hint.startsWith('date is required')).toBe(true)

      const pid = sidecar.pid as number
      await sidecar.stop()
      expect(() => process.kill(pid, 0)).toThrow()
      expect(log.some((l) => l.startsWith('ended on request'))).toBe(true)
    } finally {
      await sidecar.stop()
      rmSync(home, { recursive: true, force: true })
    }
  }, 40_000)
})
