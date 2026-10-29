import { describe, expect, it } from 'vitest'
import {
  capitalised,
  fullStopped,
  isObject,
  messageOf,
  unwrapIpcError,
} from '../../src/shared/errors'
import { openFailed } from '../../src/renderer/src/Library'
import { lookLabel } from '../../src/renderer/src/looks'
import { engineReason } from '../../src/renderer/src/notebook/olderPage'
import { reasonSentence } from '../../src/renderer/src/tripWords'

describe('unwrapIpcError', () => {
  it("strips Electron's remote-method wrapper and the Error: prefix", () => {
    expect(
      unwrapIpcError(
        "Error invoking remote method 'projects:create': Error: Give the project a name.",
      ),
    ).toBe('Give the project a name.')
    expect(unwrapIpcError("Error invoking remote method 'projects:get': not found")).toBe(
      'not found',
    )
  })
  it('leaves a bare message alone', () => {
    expect(unwrapIpcError('read-only')).toBe('read-only')
    expect(unwrapIpcError('')).toBe('')
  })
})

describe('messageOf', () => {
  it("says an error's message, without its name", () => {
    expect(messageOf(new Error('The engine stopped.'))).toBe('The engine stopped.')
    expect(messageOf(new TypeError('not a function'))).toBe('not a function')
  })
  it('says anything else that was thrown as a string', () => {
    expect(messageOf('a bare string')).toBe('a bare string')
    expect(messageOf(42)).toBe('42')
    expect(messageOf(undefined)).toBe('undefined')
    expect(messageOf({ message: 'not an Error' })).toBe('[object Object]')
  })
})

describe('isObject', () => {
  it('is an object with fields to read', () => {
    expect(isObject({})).toBe(true)
    expect(isObject({ a: 1 })).toBe(true)
    expect(isObject(Object.create(null))).toBe(true)
  })
  it('is not null, an array, or anything that is not an object', () => {
    for (const value of [null, undefined, [], [1], 'x', 1, true, () => ({})])
      expect(isObject(value), String(value)).toBe(false)
  })
})

/**
 * The four first-letter capitalisers (`tripWords.ts`, `looks.ts`,
 * `lineOptions.ts`, `licences-ipc.ts`) before they were one, and what each
 * said. Three were `charAt(0).toUpperCase() + slice(1)`; the licences' was
 * `words[0].toUpperCase()` and `words.slice(1)`, which differs from them
 * only on the empty text, where `words[0]` is undefined and it threw. Its
 * words are one of two fixed phrases, never empty, so no person could see
 * the difference.
 */
const CAPITALS: { input: string; three: string; licences: string; now: string }[] = [
  { input: 'beck', three: 'Beck', licences: 'Beck', now: 'Beck' },
  { input: 'bold, dashed', three: 'Bold, dashed', licences: 'Bold, dashed', now: 'Bold, dashed' },
  {
    input: "the licence texts' folder",
    three: "The licence texts' folder",
    licences: "The licence texts' folder",
    now: "The licence texts' folder",
  },
  { input: 'éclair', three: 'Éclair', licences: 'Éclair', now: 'Éclair' },
  { input: 'Already', three: 'Already', licences: 'Already', now: 'Already' },
  { input: '1 stop', three: '1 stop', licences: '1 stop', now: '1 stop' },
  { input: '', three: '', licences: 'threw a TypeError', now: '' },
]

describe('capitalised', () => {
  it.each(CAPITALS)('makes "$input" "$now"', ({ input, three, now }) => {
    expect(capitalised(input)).toBe(now)
    // Where the three agreed, the one function says what they said.
    expect(now).toBe(three)
  })
  it('is what a look is called', () => {
    expect(lookLabel('beck')).toBe('Beck')
  })
})

/**
 * Where the full-stop copies disagreed, one row per input. Cell 03's two
 * (`reasonSentence` in `tripWords.ts`, `engineReason` in `olderPage.ts`)
 * took `/[.!?]$/` as already stopped; the Library's (`openFailed`) took
 * `/[.!?…][”’")]*$/`, which issue 598 makes the rule. So a reason ending in
 * an ellipsis, or a stop inside closing quotes or a bracket, no longer gets
 * a second stop in cell 03, as it already did not in the Library.
 */
const STOPS: { input: string; cell03: string; library: string; now: string }[] = [
  { input: 'No trip.', cell03: 'No trip.', library: 'No trip.', now: 'No trip.' },
  { input: 'No trip', cell03: 'No trip.', library: 'No trip.', now: 'No trip.' },
  { input: 'Really?', cell03: 'Really?', library: 'Really?', now: 'Really?' },
  { input: 'Stop!', cell03: 'Stop!', library: 'Stop!', now: 'Stop!' },
  { input: 'Wait…', cell03: 'Wait….', library: 'Wait…', now: 'Wait…' },
  {
    input: 'It said “wait…”',
    cell03: 'It said “wait…”.',
    library: 'It said “wait…”',
    now: 'It said “wait…”',
  },
  {
    input: 'It said “done.”',
    cell03: 'It said “done.”.',
    library: 'It said “done.”',
    now: 'It said “done.”',
  },
  {
    input: 'It said ‘done.’',
    cell03: 'It said ‘done.’.',
    library: 'It said ‘done.’',
    now: 'It said ‘done.’',
  },
  {
    input: 'It said "done?"',
    cell03: 'It said "done?".',
    library: 'It said "done?"',
    now: 'It said "done?"',
  },
  {
    input: 'See the log (it ends.)',
    cell03: 'See the log (it ends.).',
    library: 'See the log (it ends.)',
    now: 'See the log (it ends.)',
  },
  // Agreed: a straight single quote is not a closing quote to either rule,
  // and neither is a quote with no stop inside it.
  {
    input: "It said 'done.'",
    cell03: "It said 'done.'.",
    library: "It said 'done.'.",
    now: "It said 'done.'.",
  },
  {
    input: 'It said “done”',
    cell03: 'It said “done”.',
    library: 'It said “done”.',
    now: 'It said “done”.',
  },
]

describe('fullStopped', () => {
  it.each(STOPS)('ends "$input" as "$now"', ({ input, library, now }) => {
    expect(fullStopped(input)).toBe(now)
    // The Library's rule is the rule: it says what the Library said.
    expect(now).toBe(library)
  })

  it.each(STOPS)('is what cell 03 and the Library say for "$input"', ({ input, now }) => {
    expect(engineReason(input)).toBe(now)
    expect(reasonSentence(input)).toBe(now)
    expect(openFailed('LA Metro Rail', new Error(input))).toBe(
      `Try again. LA Metro Rail could not be opened: ${now}`,
    )
  })

  it('leaves the empty reason to the caller, as each did before', () => {
    expect(engineReason('  ')).toBe('')
    expect(reasonSentence('')).toBe('')
    expect(openFailed('LA Metro Rail', new Error(''))).toBe(
      'Try again. LA Metro Rail could not be opened.',
    )
  })
})
