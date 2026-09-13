// The Electron defect the capture's order exists to avoid, reproduced: a
// real Electron, emulating before it has navigated, dies. Opt-in, because
// it takes the process down on purpose and macOS then writes a crash report
// that can stall the next Electron launch for a minute and a half
// (docs/adr/spikes/offscreen-capture.md, session three). Run it once, by
// hand, when Electron is upgraded:
//
//   LEGIBLE_CRASH_TEST=1 npx vitest run tests/unit/capture-crash.test.ts

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(__dirname, '../fixtures/emulate-order.cjs')
const opted = process.env.LEGIBLE_CRASH_TEST === '1'

function run(order: 'emulate-first' | 'navigate-first'): {
  status: number | null
  signal: string | null
  out: string
} {
  // Loaded from Node rather than Electron, the electron package resolves to the binary's path.
  const load = createRequire(__filename)
  const electron = load('electron') as unknown as string
  const result = spawnSync(electron, [script, order], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '0' },
  })
  return { status: result.status, signal: result.signal, out: `${result.stdout}${result.stderr}` }
}

describe.skipIf(!opted)('emulating a web contents (opt in with LEGIBLE_CRASH_TEST=1)', () => {
  it('after a document loads, works', () => {
    const r = run('navigate-first')
    expect(r.out).toContain('reached: no crash')
    expect(r.status).toBe(0)
  })

  it('before any document, takes the process down', () => {
    const r = run('emulate-first')
    expect(r.out).not.toContain('reached: no crash')
    expect(r.status === 0, `exit ${r.status} signal ${r.signal}`).toBe(false)
  })
})
