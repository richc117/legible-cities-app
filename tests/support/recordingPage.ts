// A capture page that records every call the capture makes of it, exactly:
// each script it is asked to evaluate, word for word, and each DevTools
// Protocol command with its parameters. Answers as a project page would,
// from a clock it keeps itself, so two runs of one job record the same
// calls. Used by `tests/unit/capture-opening.test.ts` (issue 392, spec 035
// FR-008) to hold the capture's calls for a job with no title card and no
// draw-in to the transcript the capture made before it could drive either.

import type { CapturePage } from '../../src/main/capture'

// A 1x1 PNG, which is all a frame needs to be.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** One thing the capture did with the page, as it did it. */
export type Recorded =
  | { kind: 'navigate'; url: string }
  | { kind: 'attach' }
  | { kind: 'send'; method: string; params?: Record<string, unknown> }
  | { kind: 'evaluate'; code: string }
  /** Not a call: the moment the page's own settle promise resolved. */
  | { kind: 'settled' }

const hhmm = (seconds: number): string =>
  `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(
    Math.floor((seconds % 3600) / 60),
  ).padStart(2, '0')}`

export class RecordingPage implements CapturePage {
  readonly calls: Recorded[] = []
  now = 8 * 3600
  /** Simulated seconds a second, for `advance`. */
  speed = 120
  bounds = { t0: 6 * 3600, t1: 22 * 3600 }
  clip = { x: 10, y: 20, width: 540, height: 960 }
  /** What `!!(setCard && setDrawn)`-style questions are answered: whether the page has the calls. */
  hasOpening = true
  destroyed = false

  navigate(url: string): Promise<void> {
    this.calls.push({ kind: 'navigate', url })
    return Promise.resolve()
  }

  attach(): void {
    this.calls.push({ kind: 'attach' })
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.calls.push(
      params === undefined ? { kind: 'send', method } : { kind: 'send', method, params },
    )
    return Promise.resolve(method === 'Page.captureScreenshot' ? { data: PNG } : {})
  }

  evaluate(code: string): Promise<unknown> {
    this.calls.push({ kind: 'evaluate', code })
    if (code.startsWith('!!(window.__present && window.__present.state)'))
      return Promise.resolve(true)
    if (code.includes('typeof window.__present.set')) return Promise.resolve(this.hasOpening)
    if (code === 'window.__present.bounds()') return Promise.resolve(this.bounds)
    if (code === 'window.__present.state()')
      return Promise.resolve({ now: this.now, clock: hhmm(this.now), shown: 1, viewName: 'map' })
    if (code.includes('getElementById("stage")')) return Promise.resolve(this.clip)
    // The page's settle answers a promise now (engine v0.15.0): resolved a
    // turn later, and said when, so a test sees whether the capture waited.
    if (code.includes('window.__present.settle()') && code.includes('.then('))
      return new Promise((resolve) =>
        setTimeout(() => {
          this.calls.push({ kind: 'settled' })
          resolve(true)
        }, 0),
      )
    const advance = /^window\.__present\.advance\(([^)]+)\); true$/.exec(code)
    if (advance !== null) this.now += Number(advance[1]) * this.speed
    const seek = /^window\.__present\.seek\(([^)]+)\); true$/.exec(code)
    if (seek !== null) this.now = Number(seek[1])
    return Promise.resolve(true)
  }

  onGone(): void {}

  destroy(): void {
    this.destroyed = true
  }
}

/** A recorded call in a line a person can read: what the capture asked of the page. */
export function named(call: Recorded): string {
  switch (call.kind) {
    case 'navigate':
      return 'navigate'
    case 'attach':
      return 'attach'
    case 'settled':
      return 'settled'
    case 'send':
      return call.method === 'Page.captureScreenshot' ? 'frame' : `send ${call.method}`
    case 'evaluate': {
      const code = call.code
      if (code.includes('requestAnimationFrame')) return 'paint'
      if (code.includes('typeof window.__present.set')) return 'has the opening?'
      if (code.includes('settle()')) return code.includes('.then(') ? 'settle, awaited' : 'settle'
      const card = /^window\.__present\.setCard\((true|false)\); true$/.exec(code)
      if (card !== null) return `setCard ${card[1]}`
      const drawn = /^window\.__present\.setDrawn\(([^)]+)\); true$/.exec(code)
      if (drawn !== null) return `setDrawn ${Number(drawn[1])}`
      if (code.includes('P.setPlaying')) return 'beat'
      if (code.startsWith('window.__present.advance(')) return 'advance'
      if (code.startsWith('window.__present.seek(')) return 'seek'
      if (code.includes('setCapture(true)')) return 'setCapture'
      return 'other'
    }
  }
}
