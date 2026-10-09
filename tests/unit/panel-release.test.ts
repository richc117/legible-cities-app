// When the colour, order and size panels put their control back to the record
// (issue 360): on the change of the run into `failed` or `cancelled`, and
// never because the record was written.
//
// Three things are held here. The pure rule (`stoppedNow`). The hook that
// remembers the state the rule compares with (`usePutBack`), run for real
// through the least of React that lets a hook be called outside a component:
// nothing in this suite renders to a DOM, and a rule that is right while the
// hook around it forgets, or never forgets, is the defect itself. And that
// the three panels call that one hook and keep no copy of the rule.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { stoppedNow } from '../../src/renderer/src/panelRelease'
import { usePutBack } from '../../src/renderer/src/usePutBack'
import type { RunState } from '../../src/shared/layout'

// React's `useRef` and `useEffect` and nothing else: a ref is a cell that
// lives as long as the "component" does, and an effect runs after the render
// that declared it. There are no dependencies to honour because the hook
// under test declares none.
const harness = vi.hoisted(() => {
  const refs: Array<{ current: unknown }> = []
  const effects: Array<() => void> = []
  let cursor = 0
  return {
    nextRef: (initial: unknown): { current: unknown } => {
      const at = cursor++
      return (refs[at] ??= { current: initial })
    },
    queue: (effect: () => void): void => {
      effects.push(effect)
    },
    startRender: (): void => {
      cursor = 0
    },
    // A new panel: nothing remembered from the last test.
    mount: (): void => {
      refs.length = 0
      effects.length = 0
    },
    runEffects: (): void => {
      for (const effect of effects.splice(0)) effect()
    },
  }
})
vi.mock('react', () => ({ useRef: harness.nextRef, useEffect: harness.queue }))

/** One render of a panel whose run is in `state`; `putBack` is the closure that render made, over the record it was drawn with. */
function render(state: RunState, own: boolean, putBack: () => void): void {
  harness.startRender()
  usePutBack(state, own, putBack)
  harness.runEffects()
}

const STOPS = ['failed', 'cancelled'] as const
const NOT_STOPS = ['idle', 'running', 'done'] as const
const EVERY_STATE = [...NOT_STOPS, ...STOPS] as const

describe('when the run has just stopped, for a panel', () => {
  it('is the change into failed or cancelled, from whatever state the run was in', () => {
    for (const now of STOPS)
      for (const before of EVERY_STATE.filter((state) => state !== now))
        expect(stoppedNow(before, now, true), `${before} to ${now}`).toBe(true)
  })

  it('is nothing for a change into any other state', () => {
    for (const now of NOT_STOPS)
      for (const before of EVERY_STATE)
        expect(stoppedNow(before, now, true), `${before} to ${now}`).toBe(false)
  })

  it('is nothing for a run the panel did not start', () => {
    // A layout, a day or another panel's redraw stopping leaves this panel's
    // control where it is: its own change was never part of it.
    for (const now of STOPS)
      for (const before of EVERY_STATE)
        expect(stoppedNow(before, now, false), `${before} to ${now}, not its own`).toBe(false)
  })

  it('is not true again for as long as the run stays stopped', () => {
    // The run keeps `failed` or `cancelled` until the next run starts, and a
    // record written for another reason - a rename, a theme press, an export
    // option, a chosen day - is a new reference on the render of a run that
    // has not moved. Acting on that would drop, and snap back, the change a
    // person made after the failure and left waiting for an export to let go
    // of the page.
    for (const state of STOPS) expect(stoppedNow(state, state, true), state).toBe(false)
  })
})

describe('the hook the panels put themselves back through', () => {
  beforeEach(harness.mount)

  it('puts the panel back once for each release that stops, and for nothing the record does', () => {
    const calls: string[] = []
    const withRecord = (record: string) => (): void => {
      calls.push(record)
    }

    render('idle', true, withRecord('the first record'))
    render('running', true, withRecord('the first record'))
    // The first release fails: put back, to the record as it stood then.
    render('failed', true, withRecord('the record after the first stop'))
    expect(calls).toEqual(['the record after the first stop'])

    // A rename, a theme press, an export option and a chosen day: each is a
    // render with a new record and a run that is still failed.
    render('failed', true, withRecord('after a rename'))
    render('failed', true, withRecord('after a theme press'))
    render('failed', true, withRecord('after an export option'))
    render('failed', true, withRecord('after a chosen day'))
    expect(calls, 'nothing the record did put the panel back').toEqual([
      'the record after the first stop',
    ])

    // The second release fails: failed, then running, then failed. It is a
    // transition of its own, and the panel goes back again.
    render('running', true, withRecord('the record while it ran'))
    expect(calls).toHaveLength(1)
    render('failed', true, withRecord('the record after the second stop'))
    expect(calls).toEqual(['the record after the first stop', 'the record after the second stop'])

    render('failed', true, withRecord('after another rename'))
    expect(calls, 'and again nothing the record did').toHaveLength(2)
  })

  it('puts the panel back for a cancel as for a failure, and not for a run that finished', () => {
    const putBack = vi.fn()
    render('running', true, putBack)
    render('done', true, putBack)
    expect(putBack).not.toHaveBeenCalled()
    render('running', true, putBack)
    render('cancelled', true, putBack)
    expect(putBack).toHaveBeenCalledTimes(1)
  })

  it('does not put the panel back for a run it did not start', () => {
    const putBack = vi.fn()
    render('running', false, putBack)
    render('failed', false, putBack)
    expect(putBack).not.toHaveBeenCalled()
  })
})

describe('the three panels share the one shape', () => {
  const panels = [
    { file: 'LineColours.tsx', own: 'recoloured' },
    { file: 'LineOrder.tsx', own: 'reordered' },
    { file: 'StyleFields.tsx', own: 'restyled' },
  ]
  for (const { file, own } of panels) {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src', file), 'utf8')

    it(`${file} calls usePutBack with the run's state and its own kind of run`, () => {
      expect(source.includes("import { usePutBack } from './usePutBack'"), 'imports the hook').toBe(
        true,
      )
      expect(source.includes(`usePutBack(runState, ${own}, () => {`), 'and calls it').toBe(true)
    })

    it(`${file} keeps no reading of the run's state of its own for this`, () => {
      // The old shape: an effect that tested the stopped states and listed
      // the record's fields among its dependencies, so that a new record was
      // a trigger. Any copy of the test is a way back to it.
      expect(
        /runState === '(cancelled|failed)'/.test(source),
        'no test of the stopped states',
      ).toBe(false)
      expect(source.includes('was.current'), 'no ref of its own for the last state').toBe(false)
    })
  }
})
