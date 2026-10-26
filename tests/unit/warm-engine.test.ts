// The e2e suite's warm-up of the stand-in engine (issue 529): it must
// really start the stand-in and get engine.info answered, leave nothing
// running or behind, never throw from a cleanup that fails, never hang on a
// stand-in that will not leave, and do the one thing that makes the next
// start cheaper, which is to compile the stand-in where a launch reads its
// bytecode: the app's own environment, in the stand-in's `__pycache__`.
// Needs a Python 3 on the PATH; skips, saying so, without one.

import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_BOUNDS } from '../../src/main/sidecar'
import { FAKE_ENGINE, findPython } from '../support/python'
import { READY_DEADLINE_MS, WINDOW_MARGIN_MS } from '../support/ready'
import { WARM_PREFIX, warmEngine } from '../support/warm-engine'

const PYTHON = findPython()

/** The folders of the warm-up's own kind in the temporary folder. */
const homes = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(WARM_PREFIX))

/** The stand-in's compiled module, wherever the interpreter keeps it: the app's environment sets no cache prefix. */
const cache = join(FAKE_ENGINE, 'schematic', '__pycache__')
const compiled = (): string[] => {
  try {
    return readdirSync(cache).filter((n) => n.startsWith('serve.') && n.endsWith('.pyc'))
  } catch {
    return []
  }
}

describe.skipIf(PYTHON === null)('warmEngine', { timeout: 30_000 }, () => {
  it('has the stand-in answer engine.info, compiles it where a launch reads it and removes its own home', async () => {
    // Only the compiled stand-in is removed, so this run's claim is its own
    // and not an earlier run's; another test compiling it meanwhile is harmless.
    for (const name of compiled()) rmSync(join(cache, name), { force: true })
    const before = homes()
    const { ms, leftover } = await warmEngine(PYTHON as string)
    expect(Number.isInteger(ms) && ms > 0).toBe(true)
    expect(leftover).toBeUndefined()
    expect(compiled(), "serve.<tag>.pyc in the stand-in's own __pycache__").toHaveLength(1)
    expect(
      homes().filter((h) => !before.includes(h)),
      'its engine home is removed',
    ).toEqual([])
  })

  it('rejects, and does not hang, when the stand-in never answers', async () => {
    // A deadline shorter than the stand-in's own start cannot be met. The
    // promise settles once the child has closed, and the home goes then, so
    // a home still there would be a child still running.
    const before = homes()
    await expect(warmEngine(PYTHON as string, { deadlineMs: 1 })).rejects.toThrow(/within 1 ms/)
    expect(homes().filter((h) => !before.includes(h))).toEqual([])
  })

  it('rejects with the reason when there is no such interpreter, and leaves no home', async () => {
    const before = homes()
    await expect(warmEngine('no-such-interpreter-529')).rejects.toThrow()
    expect(homes().filter((h) => !before.includes(h))).toEqual([])
  })

  // A scanner or a just-closed handle can hold the folder on Windows; that
  // must not take global setup down, and the warm-up has still happened.
  it('settles, saying what was left, when its folder cannot be removed', async () => {
    const before = homes()
    const refused: string[] = []
    const { ms, leftover } = await warmEngine(PYTHON as string, {
      remove: (path) => {
        refused.push(path)
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      },
    })
    expect(ms).toBeGreaterThan(0)
    expect(refused).toHaveLength(1)
    expect(leftover).toContain('EBUSY')
    // And a failed warm-up with a folder that stays still rejects with its own reason.
    await expect(
      warmEngine(PYTHON as string, {
        deadlineMs: 1,
        remove: () => {
          throw new Error('EPERM')
        },
      }),
    ).rejects.toThrow(/within 1 ms/)
    for (const h of homes().filter((name) => !before.includes(name)))
      rmSync(join(tmpdir(), h), { recursive: true, force: true })
  })

  // POSIX alone can ignore a terminate; on Windows the terminate is already forceful.
  it.skipIf(process.platform === 'win32')(
    'kills a stand-in that ignores both the shutdown and the terminate',
    { timeout: 10_000 },
    async () => {
      const before = homes()
      const started = Date.now()
      await warmEngine(PYTHON as string, {
        control: { ignore_shutdown: true, ignore_sigterm: true },
        shutdownMs: 200,
        terminateMs: 200,
      })
      expect(Date.now() - started).toBeLessThan(8_000)
      expect(homes().filter((h) => !before.includes(h))).toEqual([])
    },
  )
})

// The helpers' wait for "ready" covers a restart because it is built from
// the supervisor's bounds (issue 529): the handshake that missed, the failed
// engine's ending (`failed()` awaits it, up to `shutdownMs`, before the
// back-off), the first back-off, and the second handshake.
describe('READY_DEADLINE_MS', () => {
  it('holds one missed handshake, the engine ending, the back-off and a second handshake, with room over', () => {
    const { handshakeMs, shutdownMs, restartDelaysMs } = DEFAULT_BOUNDS
    const restart = handshakeMs + shutdownMs + restartDelaysMs[0] + handshakeMs
    expect(READY_DEADLINE_MS).toBeGreaterThan(restart)
    expect(READY_DEADLINE_MS).toBe(restart + WINDOW_MARGIN_MS)
  })
})
