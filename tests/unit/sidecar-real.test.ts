// The supervisor against the real engine, where an interpreter with the
// engine is named (LEGIBLE_ENGINE_PYTHON, or LEGIBLE_ENGINE_CHECKOUT's
// virtual environment, in the environment or .env.local); skips, saying so,
// elsewhere, and fails instead where the determinism workflow opts in.
// Docker is not needed: the handshake and a refused map.build never reach
// LOOM.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { engineCommand, engineEnvironment } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EngineError } from '../../src/shared/engine'
import {
  ENGINE_TEST_MS,
  HANDSHAKE_MS,
  NO_ENGINE,
  PINS,
  READY_MS,
  failIfRequired,
  realInterpreter,
} from '../support/real-engine'

const INTERPRETER = realInterpreter()
const WHY = INTERPRETER === null ? NO_ENGINE : ''

failIfRequired('the supervisor against the real engine', INTERPRETER === null, 'no engine')

describe.skipIf(INTERPRETER === null)(`Sidecar against the real engine${WHY}`, () => {
  it(
    'handshakes with the pinned version, passes an error through, and stops clean',
    async () => {
      const home = mkdtempSync(join(tmpdir(), 'lc-real-'))
      const log: string[] = []
      const sidecar = new Sidecar({
        command: engineCommand(INTERPRETER as string),
        env: engineEnvironment({
          config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
          base: process.env,
          development: true,
        }),
        pin: PINS.engine,
        log: (m) => log.push(m),
        bounds: { handshakeMs: HANDSHAKE_MS },
      })
      try {
        sidecar.start()
        const ready = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(log.join('\n'))), READY_MS)
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
          version: PINS.engine.version,
          protocol: PINS.engine.protocol,
        })

        const info = (await sidecar.request('engine.info').result) as Record<string, unknown>
        expect(info.engine).toBe(PINS.engine.version)
        expect(info.protocol).toBe(1)
        expect(info.home).toBe(home)

        const error = (await sidecar
          .request('map.build', { key: 'la-metro-rail', layout: '0'.repeat(64) })
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
    },
    ENGINE_TEST_MS,
  )
})
