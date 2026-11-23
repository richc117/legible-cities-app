// A capture asked for a run already cancelled makes no window (issue 754).
// `capture-window.ts` imports Electron, so its order is read from the source,
// as `quit-guard.test.ts` reads `index.ts`. Each was watched failing under
// its mutation in `capture-cancelled.mutations.json`: the check removed; the
// check after the window is made.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(join(__dirname, '../../src/main/capture-window.ts'), 'utf8')

function captureFunction(): string {
  const start = SOURCE.indexOf('export async function capture(')
  expect(start, 'capture() is in the file').toBeGreaterThanOrEqual(0)
  const end = SOURCE.indexOf('\n}\n', start)
  expect(end, 'capture() ends').toBeGreaterThan(start)
  return SOURCE.slice(start, end)
}

describe('capture-window', () => {
  it('capture() refuses a signal already aborted before it makes a window', () => {
    const text = captureFunction()
    const check =
      "if (options.signal?.aborted) throw new CaptureError('the capture was cancelled', true)"
    expect(text).toContain(check)
    expect(text.indexOf(check)).toBeLessThan(text.indexOf('new ElectronCapturePage('))
  })
})
