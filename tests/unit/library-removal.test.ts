// A feed's removal that the app stopped waiting for (issue 107): only an
// ending that leaves the outcome unknown says so, and the sentence claims
// neither outcome. The dialog showing it, the list read again and the truth
// once the engine has finished are driven in the built app
// (tests/e2e/feeds.spec.ts).

import { describe, expect, it } from 'vitest'
import { UNANSWERED_REMOVAL, unanswered } from '../../src/renderer/src/Library'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'

const shape = (code: number, kind: string) =>
  new EngineError(code, 'said', { kind: kind as never, detail: 'said', hint: 'said' }).toJSON()

describe('a removal the engine did not answer', () => {
  it('is an ending by a deadline or the inactivity bound, and nothing else', () => {
    expect(unanswered(shape(ERROR_CODES.inactive, 'inactive'))).toBe(true)
    expect(unanswered(shape(-32000, 'feed'))).toBe(false)
    expect(unanswered(shape(ERROR_CODES.badCall, 'params'))).toBe(false)
    expect(unanswered(shape(ERROR_CODES.engineExited, 'exit'))).toBe(false)
    expect(unanswered(shape(ERROR_CODES.notReady, 'state'))).toBe(false)
    expect(unanswered(new Error('not a shape'))).toBe(false)
  })

  it('says the outcome is unknown and that the list is read again', () => {
    expect(UNANSWERED_REMOVAL).toMatch(/did not answer in time/)
    expect(UNANSWERED_REMOVAL).toMatch(/may or may not have been removed/)
    expect(UNANSWERED_REMOVAL).toMatch(/list of feeds is read again/)
  })
})
