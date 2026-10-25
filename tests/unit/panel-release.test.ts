// When the cheap edits put their control back to the record (issue 360): on
// the change of the run into `failed` or `cancelled`, and never because the
// record was written.
//
// What is held here is the pure rules inside the cheap edits' one hook
// (`notebook/useCheapEdit.ts`, issue 490): `stoppedNow`, `mustWait` and
// `refusedAtStart`, and the hook that remembers the state the first compares
// with (`usePutBack`), run for real through the least of React that lets a
// hook be called outside a component. How the four panels use them - the
// wait, the hold, the put-back, adoption and the flush as a panel goes - is
// `cheap-edit.test.tsx`, which renders each panel through its cell. The
// source-shape guards that stood in for that until then are gone (spec 038
// FR-006), but for the two below that no rendered test can stand in for,
// each with its reason.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mustWait,
  refusedAtStart,
  stoppedNow,
  type Seen,
} from '../../src/renderer/src/panelRelease'
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

/** What a panel sees of the run at one render. */
const seen = (state: RunState, own: boolean): Seen => ({ state, own })

describe('when the run has just stopped, for a panel', () => {
  it('is the change into failed or cancelled, from whatever state the run was in', () => {
    for (const now of STOPS)
      for (const before of EVERY_STATE.filter((state) => state !== now))
        expect(stoppedNow(seen(before, true), seen(now, true)), `${before} to ${now}`).toBe(true)
  })

  it('is nothing for a change into any other state', () => {
    for (const now of NOT_STOPS)
      for (const before of EVERY_STATE)
        expect(stoppedNow(seen(before, true), seen(now, true)), `${before} to ${now}`).toBe(false)
  })

  it('is nothing for a run the panel did not start', () => {
    // A layout, a day or another panel's redraw stopping leaves this panel's
    // control where it is: its own change was never part of it.
    for (const now of STOPS)
      for (const before of EVERY_STATE)
        for (const wasOwn of [false, true])
          expect(
            stoppedNow(seen(before, wasOwn), seen(now, false)),
            `${before} to ${now}, not its own`,
          ).toBe(false)
  })

  it('is not true again for as long as the run stays stopped', () => {
    // The run keeps `failed` or `cancelled` until the next run starts, and a
    // record written for another reason - a rename, a theme press, an export
    // option, a chosen day - is a new reference on the render of a run that
    // has not moved. Acting on that would drop, and snap back, the change a
    // person made after the failure and left waiting for an export to let go
    // of the page.
    for (const state of STOPS)
      expect(stoppedNow(seen(state, true), seen(state, true)), state).toBe(false)
  })

  it('is true when a start is refused at once for a run that was already stopped for another kind', () => {
    // `LayoutRun.#begin` sets `failed` and the new kind in one change when
    // the engine is not ready, and never passes through `running`. A layout
    // run that failed, then a colour refused at its start: the state is
    // `failed` before and after, and only the kind of run moved. The
    // colour's swatch holds a colour the record does not, and nothing will
    // ever build it, so the panel has to go back. The effect this rule
    // replaced listed the kind among its dependencies and did.
    for (const state of STOPS)
      expect(stoppedNow(seen(state, false), seen(state, true)), state).toBe(true)
    expect(stoppedNow(seen('failed', false), seen('cancelled', true))).toBe(true)
  })

  it('is not true when the kind moves away from the panel’s, or never reaches it', () => {
    for (const state of STOPS) {
      expect(
        stoppedNow(seen(state, true), seen(state, false)),
        `${state}, its own to another`,
      ).toBe(false)
      expect(stoppedNow(seen(state, false), seen(state, false)), `${state}, never its own`).toBe(
        false,
      )
    }
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

  it('puts the panel back for a start refused at once while the run sat failed for another kind', () => {
    const calls: string[] = []
    const at = (record: string) => (): void => {
      calls.push(record)
    }
    // A layout run fails: not this panel's, so it does nothing. A colour is
    // then held for an export, and the retry's start is refused because the
    // engine is not ready: the run is `failed` again, now the colour panel's
    // own, and never passed through `running`.
    render('running', false, at('while the layout ran'))
    render('failed', false, at('after the layout failed'))
    expect(calls).toEqual([])
    render('failed', true, at('after the start was refused'))
    expect(calls).toEqual(['after the start was refused'])
    // And a record written afterwards is not another stop.
    render('failed', true, at('after a rename'))
    expect(calls).toHaveLength(1)
  })

  it('does not put the panel back for a run it did not start', () => {
    const putBack = vi.fn()
    render('running', false, putBack)
    render('failed', false, putBack)
    expect(putBack).not.toHaveBeenCalled()
  })
})

// Issue 399: whether a cheap edit waits, asked before its own rule compares
// the change with the record. Each case was watched failing with its own
// clause taken out of `mustWait`.
describe('whether a change must wait before it is compared', () => {
  const at = (state: RunState): { state: RunState } => ({ state })
  const runAt = (snapshot: { state: RunState }): { snapshot: { state: RunState } } => ({ snapshot })

  it('does not wait when nothing holds the page and the run is as the render saw it', () => {
    const rendered = at('done')
    expect(mustWait({ held: false, rendered, run: runAt(rendered) })).toBe(false)
    expect(mustWait({ held: false, rendered, run: runAt(rendered), busyNow: () => false })).toBe(
      false,
    )
  })

  it('waits for what the render saw holding the page or the record', () => {
    // Mutation: `held` left out - an export, the read-back or a hand on a
    // gesture would no longer hold a change.
    const rendered = at('idle')
    expect(mustWait({ held: true, rendered, run: runAt(rendered) })).toBe(true)
  })

  it('waits for a run going at this instant, though the render saw it idle', () => {
    // Mutation: the run's own state left out. The snapshot object is the
    // rendered one, so only the state can say it.
    const rendered = { state: 'idle' as RunState }
    const run = { snapshot: rendered }
    rendered.state = 'running'
    expect(mustWait({ held: false, rendered, run })).toBe(true)
  })

  it('waits for what only this instant can answer, an export begun since the render', () => {
    // Mutation: `busyNow` left out.
    const rendered = at('idle')
    expect(mustWait({ held: false, rendered, run: runAt(rendered), busyNow: () => true })).toBe(
      true,
    )
  })

  it('waits for a run that has moved on since the render, whose record the render has not read', () => {
    // Mutation: the snapshot's identity left out. The run ended in the gap
    // between the render and this call: it is not running and nothing holds
    // the page, but the record in hand is from before it.
    expect(mustWait({ held: false, rendered: at('running'), run: runAt(at('done')) })).toBe(true)
    expect(mustWait({ held: false, rendered: at('idle'), run: runAt(at('failed')) })).toBe(true)
  })
})

// Kept as a read of the source, with its reason: it is cell 02's sentence,
// not the cheap edits' hook's, and spec 038's T014 replaces it with cell 02's
// own rendered tests rather than this file.
describe('cell 02 tells a redraw whose record was refused from one that was not drawn', () => {
  it('hands `unkept` to the stopped sentence', () => {
    // Mutation: the eighth argument left out - the sentence would then say
    // the map was not drawn when it was (issue 399).
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src/LayoutRun.tsx'), 'utf8')
    expect(source).toMatch(
      /stoppedSentence\(\s*state,\s*replaced,\s*rebuilt,\s*recoloured,\s*reordered,\s*restyled,\s*optioned,\s*unkept,?\s*\)/,
    )
  })
})

// Issue 399: a start refused at once after a stop of the panel's own kind,
// `failed` to `failed` with the kind unmoved, which `stoppedNow` cannot see.
describe('a start refused at once, where the next render will not see it', () => {
  type Snap = { state: RunState; own: boolean }
  /** A run whose start moves it to `to`, or leaves it alone for null. */
  const runFrom = (from: Snap) => {
    const run = { snapshot: from }
    const startTo = (to: Snap | null) => (): void => {
      if (to !== null) run.snapshot = to
    }
    return { run, startTo }
  }
  const own = (snapshot: Snap): boolean => snapshot.own
  const refused = (from: Snap, to: Snap | null): boolean => {
    const { run, startTo } = runFrom(from)
    return refusedAtStart(run, own, startTo(to))
  }

  it('is the panel’s own redraw failed, then its own start refused', () => {
    // A colours redraw failed when the engine went; a colour chosen while it
    // restarts is refused at its start. Mutation: `refusedAtStart` answering
    // false (the panels as they were) - the colour would stay on screen,
    // neither drawn nor written.
    expect(refused({ state: 'failed', own: true }, { state: 'failed', own: true })).toBe(true)
  })

  it('is nothing for a refusal the next render sees, so nothing is put back twice', () => {
    // Mutation: the `stoppedNow` clause left out - each of these would be put
    // back here and again by `usePutBack`.
    for (const before of ['idle', 'done', 'cancelled'] as const)
      expect(refused({ state: before, own: true }, { state: 'failed', own: true }), before).toBe(
        false,
      )
    expect(
      refused({ state: 'failed', own: false }, { state: 'failed', own: true }),
      'after another kind',
    ).toBe(false)
  })

  it('is nothing for a start that started, or one that did nothing', () => {
    expect(refused({ state: 'failed', own: true }, { state: 'running', own: true })).toBe(false)
    // Mutation: the identity check left out - a run left exactly as it was
    // would read as refused.
    expect(refused({ state: 'failed', own: true }, null)).toBe(false)
  })

  it('is nothing for a start that left a run of another kind', () => {
    expect(refused({ state: 'failed', own: true }, { state: 'failed', own: false })).toBe(false)
  })

  it('starts the redraw it is given, once', () => {
    const start = vi.fn()
    refusedAtStart({ snapshot: { state: 'idle' as RunState } }, () => true, start)
    expect(start).toHaveBeenCalledTimes(1)
  })
})

// Kept as a read of the source, with its reason: that no panel carries a
// copy of the machinery is an absence, and an absence is not behaviour, so
// no rendered test can see it. A copy beside the hook would pass every row of
// `cheap-edit.test.tsx` until it drifted, which is how issue 399 happened
// twice. Mutation: `LineOrder.tsx` importing `debounce` and arming its own
// timer beside the hook, as it did.
describe('no cheap edit keeps a copy of the hook', () => {
  const panels = ['LineColours.tsx', 'LineOrder.tsx', 'StyleFields.tsx', 'useLineOptions.ts']
  for (const file of panels) {
    const source = readFileSync(resolve(__dirname, '../../src/renderer/src', file), 'utf8')
    it(`${file} draws through useCheapEdit and asks none of its rules for itself`, () => {
      expect(source).toMatch(/import \{ useCheapEdit \} from '\.\/notebook\/useCheapEdit'/)
      for (const internal of ['./panelRelease', './usePutBack', './debounce'])
        expect(source.includes(`from '${internal}'`), `no import of ${internal}`).toBe(false)
      expect(
        /runState === '(cancelled|failed)'/.test(source),
        'no test of the stopped states',
      ).toBe(false)
      expect(/setTimeout\(/.test(source), 'no timer of its own').toBe(false)
    })
  }
})
