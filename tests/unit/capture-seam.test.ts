// The capture's calls of the page's seam, typed by the schema (issue 607).
//
// The capture used to write each call as a string of its own. They are now
// built by one helper, `seamCall`, whose method name and arguments are the
// engine's `PageSeam`, so a method renamed or reshaped in the schema is a
// build error rather than a script error halfway through an export. Nothing
// on the wire may change for that: every row below holds a script to the
// exact string the capture sent before, written here as a literal from the
// code as it stood on `main` (edbdc7a). The transcript in
// `capture-opening.test.ts` holds the same scripts in the order a capture
// sends them; this holds each one alone, the coercions included.

import { describe, expect, it } from 'vitest'
import { SEAM_SCRIPTS, seamCall } from '../../src/main/capture'

describe("the capture's calls of the seam", () => {
  it('are the scripts it sent before they were typed, byte for byte', () => {
    const rows: [string, string, string][] = [
      ['the page ready', SEAM_SCRIPTS.ready, '!!(window.__present && window.__present.state)'],
      [
        'the frame counter asked for',
        SEAM_SCRIPTS.stripTaken,
        '(function () { var counts = false; try { counts = typeof window.__present.state().draws === "number" } catch (e) {} return { strip: document.documentElement.getAttribute("data-strip"), band: !!document.getElementById("present-strip"), counts: counts } })()',
      ],
      ['the clock stopped', SEAM_SCRIPTS.stopClock, 'window.__present.setCapture(true); true'],
      ['the bounds', SEAM_SCRIPTS.bounds, 'window.__present.bounds()'],
      ['the state', SEAM_SCRIPTS.state, 'window.__present.state()'],
      ['the frame count', SEAM_SCRIPTS.draws, 'window.__present.state().draws'],
      [
        'the settle, awaited',
        SEAM_SCRIPTS.settle,
        'Promise.resolve(window.__present.settle()).then(function () { return true })',
      ],
      [
        'the opening asked for, a card',
        SEAM_SCRIPTS.hasOpening(true, false),
        '!!(window.__present && typeof window.__present.setCard === "function")',
      ],
      [
        'the opening asked for, a draw-in',
        SEAM_SCRIPTS.hasOpening(false, true),
        '!!(window.__present && typeof window.__present.setDrawn === "function")',
      ],
      [
        'the opening asked for, both',
        SEAM_SCRIPTS.hasOpening(true, true),
        '!!(window.__present && typeof window.__present.setCard === "function" && typeof window.__present.setDrawn === "function")',
      ],
      ['the card up', SEAM_SCRIPTS.setCard(true), 'window.__present.setCard(true); true'],
      ['the card down', SEAM_SCRIPTS.setCard(false), 'window.__present.setCard(false); true'],
      // `=== true`: anything but true is the card down, as it was.
      [
        'the card, from a value that is not true',
        SEAM_SCRIPTS.setCard('yes' as never),
        'window.__present.setCard(false); true',
      ],
      ['the network undrawn', SEAM_SCRIPTS.setDrawn(0), 'window.__present.setDrawn(0); true'],
      [
        'the network half drawn',
        SEAM_SCRIPTS.setDrawn(0.5),
        'window.__present.setDrawn(0.5); true',
      ],
      [
        'the network a third drawn',
        SEAM_SCRIPTS.setDrawn(1 / 3),
        'window.__present.setDrawn(0.3333333333333333); true',
      ],
      ['the network whole', SEAM_SCRIPTS.setDrawn(1), 'window.__present.setDrawn(1); true'],
      // `Number(...)`: a string that slipped through is written as a number.
      [
        'the network drawn, from a string',
        SEAM_SCRIPTS.setDrawn('0.25' as never),
        'window.__present.setDrawn(0.25); true',
      ],
      ['a sweep at 08:00', SEAM_SCRIPTS.seek(28_800), 'window.__present.seek(28800); true'],
      [
        'a sweep between seconds',
        SEAM_SCRIPTS.seek(28_800 + 37.5),
        'window.__present.seek(28837.5); true',
      ],
      // A clock the page said was not a number: written as script writes
      // it, as the template literal did, and never as JSON's `null`.
      ['a sweep from a NaN clock', SEAM_SCRIPTS.seek(NaN), 'window.__present.seek(NaN); true'],
      ['a step at 4 fps', SEAM_SCRIPTS.advance(1 / 4), 'window.__present.advance(0.25); true'],
      [
        'a step at 24 fps',
        SEAM_SCRIPTS.advance(1 / 24),
        'window.__present.advance(0.041666666666666664); true',
      ],
      ['a step at 25 fps', SEAM_SCRIPTS.advance(1 / 25), 'window.__present.advance(0.04); true'],
      [
        'a step at 30 fps',
        SEAM_SCRIPTS.advance(1 / 30),
        'window.__present.advance(0.03333333333333333); true',
      ],
      [
        'a step at 60 fps',
        SEAM_SCRIPTS.advance(1 / 60),
        'window.__present.advance(0.016666666666666666); true',
      ],
      [
        'a step at 120 fps',
        SEAM_SCRIPTS.advance(1 / 120),
        'window.__present.advance(0.008333333333333333); true',
      ],
    ]
    for (const [what, after, before] of rows) expect(after, what).toBe(before)
  })

  it('writes a call as the page’s script names it, each argument as JSON or as a number', () => {
    expect(seamCall('hasGeo')).toBe('window.__present.hasGeo()')
    expect(seamCall('setFrame', 0.5625, 0.5, 0)).toBe('window.__present.setFrame(0.5625, 0.5, 0)')
    expect(seamCall('setView', 'map', null)).toBe('window.__present.setView("map", null)')
    expect(seamCall('setTrip', 'a"b</script>')).toBe('window.__present.setTrip("a\\"b</script>")')
    expect(seamCall('setRoutes', ['A', 'B'])).toBe('window.__present.setRoutes(["A","B"])')
    expect(seamCall('advance', -0)).toBe('window.__present.advance(0)')
    expect(seamCall('advance', Infinity)).toBe('window.__present.advance(Infinity)')
  })

  it('refuses an argument JSON cannot write, rather than sending nothing in its place', () => {
    // `onDraw` takes a function, which no script can carry into the page.
    expect(() => seamCall('onDraw', (() => undefined) as never)).toThrow(
      /onDraw's argument 1 cannot be written into the page's script/,
    )
    expect(() => seamCall('setTrip', Symbol('a') as never)).toThrow(/setTrip's argument 1/)
  })

  // Held by the typecheck, which runs over the tests: each line is an error
  // the build must report, and `@ts-expect-error` fails the build where it
  // is not. They run, harmlessly, as calls that are never sent anywhere.
  it('is a build error for a method the seam does not have, or an argument it does not take', () => {
    // @ts-expect-error no method of that name on the seam
    expect(seamCall('setDrawnX', 1)).toBe('window.__present.setDrawnX(1)')
    // @ts-expect-error setCard takes a boolean
    expect(seamCall('setCard', 'yes')).toBe('window.__present.setCard("yes")')
    // @ts-expect-error advance takes its seconds
    expect(seamCall('advance')).toBe('window.__present.advance()')
    // @ts-expect-error state takes nothing
    expect(seamCall('state', 1)).toBe('window.__present.state(1)')
  })
})
