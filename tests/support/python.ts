// Where the stand-in engine lives and which Python runs it, for the unit
// tests and the end-to-end test alike. The app spawns `<interpreter> -m
// schematic.serve`; with PYTHONPATH at this directory that is the stand-in.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const FAKE_ENGINE = resolve(__dirname, '../fake-engine')

/**
 * The engine version the app pins. The handshake refuses any other, so a
 * stand-in that is meant to be accepted has to answer with this.
 *
 * Read from the pin rather than written out, because a literal in a test is
 * one that has to be found and changed on every engine bump - and until it
 * is, the failure reads as a broken handshake rather than a stale test.
 * That is exactly what happened on the move from 0.2.0 to 0.2.1.
 */
export const PINNED_ENGINE: string = (
  JSON.parse(readFileSync(resolve(__dirname, '../../vendor/pins.json'), 'utf8')) as {
    engine: { version: string }
  }
).engine.version

/** `python3` or `python` if one on the PATH is a Python 3; null otherwise. */
export function findPython(): string | null {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    })
    if (probe.status === 0 && /^Python 3/.test(probe.stdout + probe.stderr)) return candidate
  }
  return null
}
