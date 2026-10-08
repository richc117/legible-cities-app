// A feed's removal and how it ended. Only the engine's own answer says the
// feed is gone or kept (issue 351): a plain ok, or an ok that carries
// cancel_too_late, is gone and the row goes; the cancelled error is kept and
// the row stays. An ending that leaves the outcome unknown says so (issue
// 107), and the sentence claims neither. The dialog showing them, Cancel
// sending the cancel, the list read again and the truth once the engine has
// finished are driven in the built app (tests/e2e/feeds.spec.ts).

import { describe, expect, it } from 'vitest'
import {
  REMOVAL_ASKED,
  REMOVAL_STOPPABLE,
  UNANSWERED_REMOVAL,
  removalOutcome,
  removalTakesTheRow,
  unanswered,
} from '../../src/renderer/src/Library'
import { EngineError, ERROR_CODES } from '../../src/shared/engine'

const shape = (code: number, kind: string) =>
  new EngineError(code, 'said', { kind: kind as never, detail: 'said', hint: 'said' }).toJSON()

describe('a removal the engine did not answer', () => {
  it('is an ending by the inactivity bound, and nothing else', () => {
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

describe('how a removal ended', () => {
  const NAME = 'Metro de Prueba'
  const cancelled = shape(ERROR_CODES.cancelled, 'engine')

  it('is removed when the engine answers a plain ok, and the row goes', () => {
    const outcome = removalOutcome(NAME, { result: { ok: true } })
    expect(outcome).toEqual({ kind: 'removed', sentence: 'Metro de Prueba was removed.' })
    expect(removalTakesTheRow(outcome)).toBe(true)
  })

  it('is removed anyway when the cancel came too late, with its own sentence, and the row goes', () => {
    const outcome = removalOutcome(NAME, { result: { ok: true, cancel_too_late: true } })
    expect(outcome).toEqual({
      kind: 'removed-anyway',
      sentence: 'Metro de Prueba was already forgotten when you cancelled, so it was removed.',
    })
    expect(removalTakesTheRow(outcome), 'the feed is gone, so is its row').toBe(true)
  })

  it('is kept when the engine answers the cancelled error, and the row stays', () => {
    const outcome = removalOutcome(NAME, { error: cancelled })
    expect(outcome).toEqual({
      kind: 'kept',
      sentence: 'The removal was cancelled; Metro de Prueba is still here.',
    })
    expect(removalTakesTheRow(outcome), 'the feed is kept, so is its row').toBe(false)
  })

  it('reads only a true cancel_too_late as too late', () => {
    for (const result of [{ ok: true, cancel_too_late: false }, { ok: true }, null, 'ok']) {
      expect(removalOutcome(NAME, { result }).kind, JSON.stringify(result)).toBe('removed')
    }
  })

  it('never takes the row for an ending that says nothing of the feed', () => {
    const inactive = removalOutcome(NAME, { error: shape(ERROR_CODES.inactive, 'inactive') })
    expect(inactive).toEqual({ kind: 'unanswered', sentence: UNANSWERED_REMOVAL })
    expect(removalTakesTheRow(inactive)).toBe(false)
    const refused = removalOutcome(NAME, {
      error: new EngineError(-32000, 'said', {
        kind: 'feed',
        detail: 'said',
        hint: 'The reason.',
      }).toJSON(),
    })
    expect(refused).toEqual({ kind: 'failed', sentence: 'The reason.' })
    expect(removalTakesTheRow(refused)).toBe(false)
    expect(removalOutcome(NAME, { error: new Error('not a shape') }).kind).toBe('failed')
  })

  it('says what Cancel does while the removal runs, and that it was pressed', () => {
    expect(REMOVAL_STOPPABLE).toMatch(/^Cancel stops it unless the engine has already forgotten/)
    expect(REMOVAL_ASKED).toMatch(/^Cancelling; waiting for the engine/)
  })
})
