// Where the stand-in engine lives and which Python runs it, for the unit
// tests and the end-to-end test alike. The app spawns `<interpreter> -m
// schematic.serve`; with PYTHONPATH at this directory that is the stand-in.

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export const FAKE_ENGINE = resolve(__dirname, '../fake-engine')

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
