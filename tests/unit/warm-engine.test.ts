// The e2e suite's warm-up of the stand-in engine (issue 529): it must
// really start the stand-in and get engine.info answered, leave nothing
// running or behind, and do the one thing that makes the next start
// cheaper, which is to leave compiled bytecode where the next start looks.
// Needs a Python 3 on the PATH; skips, saying so, without one.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_BOUNDS } from '../../src/main/sidecar'
import { findPython } from '../support/python'
import { READY_DEADLINE_MS, WINDOW_MARGIN_MS } from '../support/ready'
import { WARM_PREFIX, warmEngine } from '../support/warm-engine'

const PYTHON = findPython()
const made: string[] = []
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** The folders of the warm-up's own kind in the temporary folder. */
const homes = (): string[] => readdirSync(tmpdir()).filter((name) => name.startsWith(WARM_PREFIX))

describe.skipIf(PYTHON === null)('warmEngine', { timeout: 30_000 }, () => {
  it('has the stand-in answer engine.info, leaves bytecode behind and removes its own home', async () => {
    // The cache pointed at a folder of this test's, so the claim is about
    // this run and not about a cache an earlier one left in the checkout.
    const cache = mkdtempSync(join(tmpdir(), 'lc-warm-cache-'))
    made.push(cache)
    const before = homes()
    const { ms } = await warmEngine(PYTHON as string, { env: { PYTHONPYCACHEPREFIX: cache } })
    expect(Number.isInteger(ms) && ms > 0).toBe(true)
    // The stand-in's module was compiled and kept: the cost the next start does not pay.
    const compiled = (function find(folder: string): string[] {
      return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? find(join(folder, entry.name))
          : entry.name.startsWith('serve.') && entry.name.endsWith('.pyc')
            ? [entry.name]
            : [],
      )
    })(cache)
    expect(compiled, 'serve.<tag>.pyc under the cache').toHaveLength(1)
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

  it('rejects with the reason when there is no such interpreter', async () => {
    await expect(warmEngine('no-such-interpreter-529')).rejects.toThrow()
  })
})

// The helpers' wait for "ready" covers a restart because it is built from
// the supervisor's bounds (issue 529).
describe('READY_DEADLINE_MS', () => {
  it('holds a handshake, the first restart delay and a second handshake, with room over', () => {
    const { handshakeMs, restartDelaysMs } = DEFAULT_BOUNDS
    expect(READY_DEADLINE_MS).toBeGreaterThan(handshakeMs + restartDelaysMs[0] + handshakeMs)
    expect(READY_DEADLINE_MS).toBe(
      handshakeMs + restartDelaysMs[0] + handshakeMs + WINDOW_MARGIN_MS,
    )
  })
})
