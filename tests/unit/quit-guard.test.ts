// Asking before a quit or a close throws a run away (issue 552,
// specs/039-quit-guard), main side: what the rule is asked with and how its
// answer is carried out (`src/main/quit-guard.ts`). The rule's own table is
// in `window-lifecycle.test.ts`.
//
// What is held here: the question is sent, numbered, with the store's names,
// only to a page that listens and answers; the app's own quits and a quit
// already under way are never asked about; "Keep working" leaves everything
// as it was; "Quit anyway" quits as the app did before, through the gate's
// first pass and the engine's stop; a second quit or close is an answer once
// the question has been on the screen a second, and held before that;
// "Close anyway" stops the exports and then closes the window, and the close
// it makes is not asked about; a second close also cancels what the page had
// with the engine; the page's report is heard from the listening frame only
// and goes with the page, as it does when the page says it has stopped
// listening; a termination signal is the app's own quit; and the three
// handlers take the top frame's word and refuse a wrong shape. Each was
// watched failing under its mutation in `quit-guard.mutations.json`.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  BAD_ANSWER,
  BAD_LISTENING,
  BAD_REPORT,
  MAX_REPORTED_LAYOUTS,
  onAppWindowClose,
  onBeforeQuit,
  QuitGuard,
  quitOnSignals,
  readLayoutReport,
  registerQuitHandlers,
  TERMINATION_SIGNALS,
  type UnnamedRun,
} from '../../src/main/quit-guard'
import { QUESTION_MIN_AGE_MS, quitGate, shutDown } from '../../src/main/window-lifecycle'
import { CHANNELS } from '../../src/shared/api'
import { UNNAMED_PROJECT, type AskedQuit } from '../../src/shared/quit'

/** Two of the window's main frames, as Electron would hand them: one, and the next. */
const PAGE = { frame: 'the page' }
const NEXT = { frame: 'the next page' }

const PARIS = 'paris0000001'
const LYON = 'lyon00000001'

/** An event that records whether Electron was told to stop. */
const event = () => ({ preventDefault: vi.fn() })

/** The guard over a world a test can move: the exports, the names, the window's frame, the clock, and what was done. */
function world() {
  const did: string[] = []
  const asked: AskedQuit[] = []
  // Not at nought: a question's age is a difference, never the clock itself.
  const clock = { now: 50_000 }
  const state = {
    exports: [] as UnnamedRun[],
    names: new Map<string, string>([
      [PARIS, 'Paris'],
      [LYON, 'Lyon'],
    ]),
    frame: PAGE as unknown,
  }
  const guard = new QuitGuard({
    exports: () => state.exports,
    nameOf: (project) => state.names.get(project) ?? null,
    current: (frame) => frame === state.frame,
    ask: (question) => {
      asked.push(question)
      did.push(`ask ${question.kind}`)
    },
    withdraw: () => did.push('withdraw'),
    stopExports: () => did.push('stop exports'),
    cancelRequests: () => did.push('cancel requests'),
    close: () => did.push('close'),
    quit: () => did.push('quit'),
    now: () => clock.now,
  })
  /** A page that listens, with an export of Paris running. */
  const exporting = (): void => {
    guard.listening(PAGE)
    state.exports = [{ project: PARIS, started: 1_000 }]
  }
  /** Time passes: long enough, by default, for a question on the screen to have been read. */
  const later = (ms = QUESTION_MIN_AGE_MS): void => {
    clock.now += ms
  }
  return { guard, state, did, asked, exporting, later }
}

describe('the quit’s question', () => {
  it('holds a quit during an export and sends the page the question, named by the store', () => {
    const { guard, asked, did, exporting } = world()
    exporting()
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(true)
    expect(quit.preventDefault).toHaveBeenCalledTimes(1)
    expect(asked).toEqual([{ id: 1, kind: 'quit', exports: 1, layouts: 0, names: ['Paris'] }])
    expect(did).toEqual(['ask quit'])
  })

  it('lets a quit go with nothing running, and sends nothing', () => {
    const { guard, did } = world()
    guard.listening(PAGE)
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    const close = event()
    expect(guard.closing(close, false)).toBe(false)
    expect(close.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual([])
  })

  it('asks about a layout once the listening page has reported it', () => {
    const { guard, asked } = world()
    guard.listening(PAGE)
    expect(guard.beforeQuit(event(), false), 'nothing reported yet').toBe(false)
    guard.report(PAGE, [{ project: LYON, started: 2_000 }])
    expect(guard.beforeQuit(event(), false)).toBe(true)
    expect(asked).toEqual([{ id: 1, kind: 'quit', exports: 0, layouts: 1, names: ['Lyon'] }])
  })

  it('stops asking about a layout the page reports ended', () => {
    const { guard } = world()
    guard.listening(PAGE)
    guard.report(PAGE, [{ project: LYON, started: 2_000 }])
    guard.report(PAGE, [])
    expect(guard.beforeQuit(event(), false)).toBe(false)
  })

  it('hears a report from the listening frame only', () => {
    const { guard } = world()
    guard.listening(PAGE)
    guard.report(NEXT, [{ project: LYON, started: 2_000 }])
    expect(guard.beforeQuit(event(), false)).toBe(false)
  })

  it('forgets the report with the page that made it', () => {
    const { guard, state } = world()
    guard.listening(PAGE)
    guard.report(PAGE, [{ project: LYON, started: 2_000 }])
    // The renderer died and its window was loaded again: the next page runs
    // nothing until it says so.
    guard.gone()
    state.frame = NEXT
    guard.listening(NEXT)
    expect(guard.beforeQuit(event(), false)).toBe(false)
    // And a page that listens anew without `gone` having been heard.
    guard.report(NEXT, [{ project: LYON, started: 2_000 }])
    state.frame = PAGE
    guard.listening(PAGE)
    expect(guard.beforeQuit(event(), false)).toBe(false)
  })

  it('names a project the store cannot name as the sentence’s fallback', () => {
    const { guard, state, asked, exporting } = world()
    exporting()
    state.names.clear()
    guard.beforeQuit(event(), false)
    expect(asked[0].names).toEqual([UNNAMED_PROJECT])
  })

  it('does not ask a page that has not said it listens', () => {
    const { guard, state, did } = world()
    state.exports = [{ project: PARIS, started: 1_000 }]
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual([])
  })

  it('does not ask once the listening frame is no longer the window’s', () => {
    const { guard, state, exporting } = world()
    exporting()
    state.frame = NEXT
    expect(guard.beforeQuit(event(), false)).toBe(false)
    expect(guard.closing(event(), false)).toBe(false)
  })

  it('does not ask a page whose renderer has gone, until the next one listens', () => {
    const { guard, exporting } = world()
    exporting()
    guard.gone()
    expect(guard.beforeQuit(event(), false)).toBe(false)
    guard.listening(PAGE)
    expect(guard.beforeQuit(event(), false)).toBe(true)
  })

  it('does not ask an unresponsive page, and asks again once it answers', () => {
    const { guard, exporting } = world()
    exporting()
    guard.unresponsive()
    expect(guard.beforeQuit(event(), false)).toBe(false)
    expect(guard.closing(event(), false)).toBe(false)
    guard.responsive()
    expect(guard.beforeQuit(event(), false)).toBe(true)
  })

  it('never asks about a quit of the app’s own, nor about anything after it', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.quit()
    expect(did).toEqual(['quit'])
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    // The windows that quit closes are not asked about either.
    expect(guard.closing(event(), false)).toBe(false)
    expect(did).toEqual(['quit'])
  })

  it('does not ask about a quit already under way, nor the windows it closes', () => {
    const { guard, did, exporting } = world()
    exporting()
    const later = event()
    expect(guard.beforeQuit(later, true)).toBe(false)
    expect(later.preventDefault).not.toHaveBeenCalled()
    expect(guard.closing(event(), true)).toBe(false)
    expect(did, 'and nothing is stopped by the guard: the quit’s shutdown has that').toEqual([])
  })
})

describe('the answers', () => {
  it('carries on after Keep working: nothing is stopped, and a later quit asks afresh', () => {
    const { guard, did, asked, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
    guard.answer(PAGE, 1, 'keep')
    expect(did).toEqual(['ask quit'])
    expect(guard.beforeQuit(event(), false)).toBe(true)
    expect(asked.map((q) => q.id)).toEqual([1, 2])
  })

  it('quits after Quit anyway, as the app’s own quit, and does not ask again', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit', 'quit'])
    // The quit that answer made comes back through `before-quit`, with the
    // export still running: it goes on to the gate.
    const confirmed = event()
    expect(guard.beforeQuit(confirmed, false)).toBe(false)
    expect(confirmed.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual(['ask quit', 'quit'])
  })

  it('holds a second quit that comes before the question could have been read, and leaves the dialog', () => {
    // The repeat of a held shortcut. Cancelled like the first, but nothing is
    // asked again and nothing is taken back: the one question stays open,
    // and its buttons still answer it.
    const { guard, did, asked, exporting, later } = world()
    exporting()
    guard.beforeQuit(event(), false)
    for (const wait of [0, 400, QUESTION_MIN_AGE_MS - 401]) {
      later(wait)
      const repeat = event()
      expect(guard.beforeQuit(repeat, false), 'held').toBe(true)
      expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    }
    expect(did).toEqual(['ask quit'])
    expect(asked).toHaveLength(1)
    guard.answer(PAGE, 1, 'anyway')
    expect(did, 'the question was still the one open').toEqual(['ask quit', 'quit'])
  })

  it('takes a second quit as the answer once the question has been open a second, and takes the dialog back', () => {
    const { guard, did, exporting, later } = world()
    exporting()
    guard.beforeQuit(event(), false)
    later()
    const second = event()
    expect(guard.beforeQuit(second, false)).toBe(false)
    expect(second.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual(['ask quit', 'withdraw'])
    // The page's own answer, arriving after, is to a question no longer open.
    guard.answer(PAGE, 1, 'anyway')
    guard.answer(PAGE, 1, 'keep')
    expect(did).toEqual(['ask quit', 'withdraw'])
  })

  it('does nothing for an answer to an earlier question', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
    guard.answer(PAGE, 1, 'keep')
    guard.beforeQuit(event(), false)
    // A press that was on its way when the first dialog closed.
    guard.answer(PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit', 'ask quit'])
    guard.answer(PAGE, 2, 'anyway')
    expect(did).toEqual(['ask quit', 'ask quit', 'quit'])
  })

  it('does nothing for an answer from a frame that is not the listening page', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
    guard.answer(NEXT, 1, 'anyway')
    expect(did).toEqual(['ask quit'])
  })

  it('drops the open question when the page goes, so the next quit is not held by it', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
    guard.gone()
    guard.answer(PAGE, 1, 'anyway')
    expect(did, 'an answer from before the crash does nothing').toEqual(['ask quit'])
    // With no question open, a close of the dead window is not an answer to
    // one: it goes ahead as a close that cannot be asked about does, and the
    // guard stops nothing. Nor is there a dialog for a quit to take back.
    const close = event()
    expect(guard.closing(close, false)).toBe(false)
    expect(close.preventDefault).not.toHaveBeenCalled()
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(did, 'nothing was stopped or taken back for a question that went').toEqual(['ask quit'])
  })
})

describe('a page that says it has stopped listening', () => {
  it('is not asked, and what it reported and was asked goes with its word', () => {
    // The dialog was unmounted - an uncaught error took the interface down -
    // in a window that is still there, with a renderer alive and answering.
    const { guard, did, state, exporting } = world()
    exporting()
    guard.report(PAGE, [{ project: LYON, started: 2_000 }])
    guard.beforeQuit(event(), false)
    expect(did).toEqual(['ask quit'])

    guard.notListening(PAGE)
    // The question it was asked is no longer open: its answer does nothing.
    guard.answer(PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit'])
    // And a quit is not held for a dialog nobody will draw.
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(guard.closing(event(), false)).toBe(false)
    expect(did, 'nothing was taken back, and nothing stopped').toEqual(['ask quit'])

    // Listening again, it is asked again, and only about what main holds:
    // the layout it reported went with it.
    guard.listening(PAGE)
    state.exports = []
    expect(guard.beforeQuit(event(), false), 'its old report is not kept').toBe(false)
  })

  it('is heard from the listening frame only', () => {
    const { guard, exporting } = world()
    exporting()
    guard.notListening(NEXT)
    expect(guard.beforeQuit(event(), false), 'the page that listens is still asked').toBe(true)
  })
})

describe('closing the window', () => {
  it('holds a close during a run and asks the close’s question', () => {
    const { guard, asked, exporting } = world()
    exporting()
    const close = event()
    expect(guard.closing(close, false)).toBe(true)
    expect(close.preventDefault).toHaveBeenCalledTimes(1)
    expect(asked).toEqual([{ id: 1, kind: 'close', exports: 1, layouts: 0, names: ['Paris'] }])
  })

  it('stops the exports and then closes the window after Close anyway', () => {
    // On macOS no quit follows the window, so nothing else would stop them.
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    expect(did).toEqual(['ask close', 'stop exports', 'close'])
  })

  it('does not ask about the close it makes itself, with the export still unwinding', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    const own = event()
    expect(guard.closing(own, false)).toBe(false)
    expect(own.preventDefault).not.toHaveBeenCalled()
    // Once: a close after that one, were the window still there, is a
    // person's again.
    expect(guard.closing(event(), false)).toBe(true)
    expect(did).toEqual(['ask close', 'stop exports', 'close', 'ask close'])
  })

  it('leaves the window open after Keep working, and stops nothing', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'keep')
    expect(did).toEqual(['ask close'])
    expect(guard.closing(event(), false), 'a later close asks afresh').toBe(true)
  })

  it('holds a second close that comes before the question could have been read', () => {
    // The second click of a double click on the close button.
    const { guard, did, asked, exporting, later } = world()
    exporting()
    guard.closing(event(), false)
    later(QUESTION_MIN_AGE_MS - 1)
    const again = event()
    expect(guard.closing(again, false), 'held').toBe(true)
    expect(again.preventDefault).toHaveBeenCalledTimes(1)
    expect(did, 'nothing asked again, and nothing stopped').toEqual(['ask close'])
    expect(asked).toHaveLength(1)
  })

  it('takes a second close as the answer once the question has been open a second, and does the page’s part itself', () => {
    // No page is asked to stop anything, so main stops the exports it holds
    // and cancels what that page had with the engine, a layout's request
    // among it: on macOS no quit follows the window to end them.
    const { guard, did, exporting, later } = world()
    exporting()
    guard.closing(event(), false)
    later()
    const second = event()
    expect(guard.closing(second, false)).toBe(false)
    expect(second.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual(['ask close', 'stop exports', 'cancel requests'])
    guard.answer(PAGE, 1, 'anyway')
    expect(did, 'the page’s late answer does nothing').toEqual([
      'ask close',
      'stop exports',
      'cancel requests',
    ])
  })

  it('leaves the page’s requests to the page after Close anyway: it has cancelled its own runs', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    expect(did).not.toContain('cancel requests')
  })

  it('lets a quit answer a close’s question, and a close answer a quit’s', () => {
    const one = world()
    one.exporting()
    one.guard.closing(event(), false)
    one.later()
    expect(one.guard.beforeQuit(event(), false)).toBe(false)
    expect(one.did).toEqual(['ask close', 'withdraw'])

    const two = world()
    two.exporting()
    two.guard.beforeQuit(event(), false)
    two.later()
    expect(two.guard.closing(event(), false)).toBe(false)
    expect(two.did).toEqual(['ask quit', 'stop exports', 'cancel requests'])
  })

  it('does not hold a second quit or close for a page that can no longer show the question', () => {
    // A person can always quit: the page went unresponsive just after it
    // was asked, and is not waited for.
    const quitting = world()
    quitting.exporting()
    quitting.guard.beforeQuit(event(), false)
    quitting.guard.unresponsive()
    const quit = event()
    expect(quitting.guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()

    const closing = world()
    closing.exporting()
    closing.guard.closing(event(), false)
    closing.guard.unresponsive()
    const close = event()
    expect(closing.guard.closing(close, false)).toBe(false)
    expect(close.preventDefault).not.toHaveBeenCalled()
  })

  it('is not asked a second time by the quit that follows the window on Windows and Linux', () => {
    // The whole of "Close anyway" there, in the order index.ts sees it: the
    // window's `close` comes back through the guard, the window goes, and the
    // quit that follows it reaches `before-quit` with the export still
    // unwinding. Two things each keep that quit from being asked about - it
    // is the app's own, and no page is left to ask - so this was watched
    // failing with both taken out (`this.#own = true` from `quit()` and
    // `this.#listener = null` from `gone()`), not as an entry of its own.
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    expect(guard.closing(event(), false), 'the confirmed close goes ahead').toBe(false)
    guard.gone()
    guard.quit()
    const following = event()
    expect(guard.beforeQuit(following, false)).toBe(false)
    expect(following.preventDefault).not.toHaveBeenCalled()
    // And `window-all-closed` behind it, once the gate has the quit.
    expect(guard.beforeQuit(event(), true)).toBe(false)
    expect(did).toEqual(['ask close', 'stop exports', 'close', 'quit'])
  })

  it('forgets the close it was making once the window has gone', () => {
    const { guard, state, exporting } = world()
    exporting()
    guard.closing(event(), false)
    guard.answer(PAGE, 1, 'anyway')
    // The window went without its `close` coming back through here; the
    // next window's first close during a run is asked about.
    guard.gone()
    state.frame = NEXT
    guard.listening(NEXT)
    expect(guard.closing(event(), false)).toBe(true)
  })
})

describe('before-quit: the question, then the gate, then the shutdown', () => {
  /** The handler as `index.ts` composes it, over the real gate and the real shutdown. */
  function quitting() {
    const w = world()
    const gate = quitGate()
    const order: string[] = []
    let stopped!: () => void
    const handler = onBeforeQuit({
      guard: w.guard,
      gate,
      engineRunning: () => true,
      shutDown: () =>
        shutDown({
          aborts: [{ name: 'the export', run: () => order.push('abort the export') }],
          stop: () => {
            order.push('stop the engine')
            return new Promise<void>((resolve) => {
              stopped = resolve
            })
          },
          finished: () => {
            order.push('finished')
            gate.finished()
          },
          quit: () => order.push('quit again'),
          error: (message) => order.push(`error: ${message}`),
        }),
    })
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
    return { ...w, gate, order, handler, stop: () => stopped(), settle }
  }

  it('keeps a quit that is asked about from the gate, so Keep working leaves the app able to quit', () => {
    const { handler, guard, gate, order, state, exporting } = quitting()
    exporting()
    const held = event()
    handler(held)
    expect(held.preventDefault).toHaveBeenCalledTimes(1)
    expect(gate.quitting, 'the gate has not seen a quit').toBe(false)
    expect(order, 'and nothing was stopped').toEqual([])

    guard.answer(PAGE, 1, 'keep')
    expect(gate.quitting).toBe(false)
    // The export ends by itself; the next quit is the gate's first pass,
    // and stops the engine.
    state.exports = []
    const later = event()
    handler(later)
    expect(later.preventDefault, 'cancelled by the gate, for the stop').toHaveBeenCalledTimes(1)
    expect(order).toEqual(['abort the export', 'stop the engine'])
  })

  it('stops the engine exactly as before once the person has said Quit anyway', async () => {
    const { handler, guard, gate, order, did, stop, settle, exporting } = quitting()
    exporting()
    handler(event())
    guard.answer(PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit', 'quit'])

    // The quit that answer made: the gate's first pass, cancelled while the
    // export is aborted and the engine stopped.
    const first = event()
    handler(first)
    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(gate.quitting).toBe(true)
    expect(order).toEqual(['abort the export', 'stop the engine'])

    // A quit made while the stop runs is held by the gate, and starts
    // nothing again.
    const during = event()
    handler(during)
    expect(during.preventDefault).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['abort the export', 'stop the engine'])

    stop()
    await settle()
    expect(order).toEqual(['abort the export', 'stop the engine', 'finished', 'quit again'])
    const last = event()
    handler(last)
    expect(last.preventDefault, 'the stop is done: Electron goes').not.toHaveBeenCalled()
    expect(did, 'and nothing more was asked').toEqual(['ask quit', 'quit'])
  })

  it('keeps a second quit that comes too soon from the gate as well', () => {
    const { handler, gate, order, did, exporting } = quitting()
    exporting()
    handler(event())
    const repeat = event()
    handler(repeat)
    expect(repeat.preventDefault).toHaveBeenCalledTimes(1)
    expect(gate.quitting, 'the gate has not seen a quit').toBe(false)
    expect(order, 'nothing was stopped').toEqual([])
    expect(did, 'and the question is the one question').toEqual(['ask quit'])
  })

  it('goes straight to the gate with nothing running', () => {
    const { handler, guard, gate, order, did } = quitting()
    guard.listening(PAGE)
    const quit = event()
    handler(quit)
    expect(gate.quitting).toBe(true)
    expect(order).toEqual(['abort the export', 'stop the engine'])
    expect(did).toEqual([])
  })
})

describe('the window’s close handler', () => {
  it('keeps the window’s place for a close that goes ahead, and not for one that is held', () => {
    const { guard, exporting } = world()
    const kept = vi.fn()
    const handler = onAppWindowClose({ guard, gate: { quitting: false }, closing: kept })
    exporting()
    const held = event()
    handler(held)
    expect(held.preventDefault).toHaveBeenCalledTimes(1)
    expect(kept).not.toHaveBeenCalled()

    guard.answer(PAGE, 1, 'anyway')
    const confirmed = event()
    handler(confirmed)
    expect(confirmed.preventDefault).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(1)
  })

  it('keeps no place for a second close that comes too soon', () => {
    const { guard, exporting } = world()
    const kept = vi.fn()
    const handler = onAppWindowClose({ guard, gate: { quitting: false }, closing: kept })
    exporting()
    handler(event())
    const again = event()
    handler(again)
    expect(again.preventDefault).toHaveBeenCalledTimes(1)
    expect(kept).not.toHaveBeenCalled()
  })

  it('does not hold a window a quit under way is closing', () => {
    const { guard, exporting } = world()
    const kept = vi.fn()
    const handler = onAppWindowClose({ guard, gate: { quitting: true }, closing: kept })
    exporting()
    const close = event()
    handler(close)
    expect(close.preventDefault).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(1)
  })
})

describe('the report’s shape', () => {
  it('keeps a list of projects and start times, and nothing else of each', () => {
    expect(readLayoutReport([])).toEqual([])
    expect(
      readLayoutReport([
        { project: PARIS, started: 1_000, name: 'anything', extra: true },
        { project: LYON, started: 0 },
      ]),
    ).toEqual([
      { project: PARIS, started: 1_000 },
      { project: LYON, started: 0 },
    ])
  })

  it.each([
    ['not a list', { project: PARIS, started: 1 }],
    ['a string', 'paris0000001'],
    ['an entry that is not an object', [null]],
    ['an identifier no project has', [{ project: '../../etc', started: 1 }]],
    ['an identifier that is not a string', [{ project: 7, started: 1 }]],
    ['a project named twice', [PARIS, PARIS].map((project) => ({ project, started: 1 }))],
    ['a start that is not a number', [{ project: PARIS, started: '1' }]],
    ['a start that is not finite', [{ project: PARIS, started: Number.NaN }]],
    ['a start before the epoch', [{ project: PARIS, started: -1 }]],
    ['no start', [{ project: PARIS }]],
  ])('refuses %s', (_what, value) => {
    expect(readLayoutReport(value)).toBeNull()
  })

  it('refuses a list longer than a page could be running', () => {
    const id = (n: number): string => `p${String(n).padStart(11, '0')}`
    const many = (count: number) =>
      Array.from({ length: count }, (_, n) => ({ project: id(n), started: n }))
    expect(readLayoutReport(many(MAX_REPORTED_LAYOUTS))).toHaveLength(MAX_REPORTED_LAYOUTS)
    expect(readLayoutReport(many(MAX_REPORTED_LAYOUTS + 1))).toBeNull()
  })
})

describe('the page’s three words', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

  function bridge() {
    const w = world()
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain
    const frames = { top: true }
    registerQuitHandlers(ipc, w.guard, () => frames.top)
    const from = (frame: unknown) => ({ senderFrame: frame }) as unknown as IpcMainInvokeEvent
    const call = (channel: string, frame: unknown, ...args: unknown[]) =>
      handlers.get(channel)!(from(frame), ...args)
    return { ...w, handlers, frames, call }
  }

  it('registers the three channels the page speaks on, and not the one main sends on', () => {
    const { handlers } = bridge()
    expect([...handlers.keys()].sort()).toEqual(
      [CHANNELS.quitAnswer, CHANNELS.quitLayouts, CHANNELS.quitListening].sort(),
    )
  })

  it('hears them from the interface’s own top frame only', async () => {
    const { call, frames, guard, state, did } = bridge()
    state.exports = [{ project: PARIS, started: 1_000 }]
    frames.top = false
    await expect(call(CHANNELS.quitListening, PAGE, true)).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.quitLayouts, PAGE, [])).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.quitAnswer, PAGE, 1, 'anyway')).rejects.toThrow('forbidden')
    expect(guard.beforeQuit(event(), false), 'nobody listens yet').toBe(false)

    frames.top = true
    await call(CHANNELS.quitListening, PAGE, true)
    expect(guard.beforeQuit(event(), false)).toBe(true)
    await call(CHANNELS.quitAnswer, PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit', 'quit'])
  })

  it('hears that the page listens and that it has stopped, and refuses a word that says neither', async () => {
    const { call, guard, state } = bridge()
    state.exports = [{ project: PARIS, started: 1_000 }]
    await call(CHANNELS.quitListening, PAGE, true)
    expect(guard.beforeQuit(event(), false), 'a page that listens is asked').toBe(true)
    await call(CHANNELS.quitAnswer, PAGE, 1, 'keep')

    await call(CHANNELS.quitListening, PAGE, false)
    expect(guard.beforeQuit(event(), false), 'one that has stopped is not').toBe(false)

    await call(CHANNELS.quitListening, PAGE, true)
    for (const word of [undefined, null, 'true', 1, 0]) {
      await expect(call(CHANNELS.quitListening, PAGE, word)).rejects.toThrow(BAD_LISTENING)
    }
    expect(guard.beforeQuit(event(), false), 'a refused word changed nothing').toBe(true)
  })

  it('takes the report through its shape, and refuses one that is not a report', async () => {
    const { call, guard, asked } = bridge()
    await call(CHANNELS.quitListening, PAGE, true)
    await call(CHANNELS.quitLayouts, PAGE, [{ project: LYON, started: 2_000, name: '<b>' }])
    await expect(call(CHANNELS.quitLayouts, PAGE, [{ project: 'no such id' }])).rejects.toThrow(
      BAD_REPORT,
    )
    // The refused report changed nothing: the layout reported before stands.
    expect(guard.beforeQuit(event(), false)).toBe(true)
    expect(asked[0]).toMatchObject({ layouts: 1, names: ['Lyon'] })
  })

  it('refuses an answer that names no question or says neither word', async () => {
    const { call, guard, did, exporting } = bridge()
    exporting()
    guard.beforeQuit(event(), false)
    await expect(call(CHANNELS.quitAnswer, PAGE, '1', 'anyway')).rejects.toThrow(BAD_ANSWER)
    await expect(call(CHANNELS.quitAnswer, PAGE, 1.5, 'anyway')).rejects.toThrow(BAD_ANSWER)
    await expect(call(CHANNELS.quitAnswer, PAGE, 1, 'yes')).rejects.toThrow(BAD_ANSWER)
    await expect(call(CHANNELS.quitAnswer, PAGE, 1)).rejects.toThrow(BAD_ANSWER)
    expect(did, 'the question is still open, and nothing was done').toEqual(['ask quit'])
    await call(CHANNELS.quitAnswer, PAGE, 1, 'keep')
    expect(guard.beforeQuit(event(), false), 'answered: a later quit asks afresh').toBe(true)
  })
})

describe('a termination signal', () => {
  /** The slice of `process` the signals use, as a test hears and moves it. */
  function signals(platform: string, quitting = false) {
    const listeners = new Map<string, () => void>()
    const did: string[] = []
    const state = { quitting }
    quitOnSignals({
      platform,
      on: (signal, listener) => listeners.set(signal, listener),
      off: (signal, listener) => {
        // Only the listener that was put on is taken off.
        if (listeners.get(signal) === listener) listeners.delete(signal)
        did.push(`off ${signal}`)
      },
      raise: (signal) => did.push(`raise ${signal}`),
      quitting: () => state.quitting,
      // The quit reaches the gate, as the app's does, unless a test says not.
      quit: () => did.push('quit'),
    })
    return { listeners, did, state }
  }

  it('is the app’s own quit on macOS and Linux: interrupt, terminate and hang up', () => {
    expect([...TERMINATION_SIGNALS]).toEqual(['SIGINT', 'SIGTERM', 'SIGHUP'])
    for (const platform of ['darwin', 'linux']) {
      expect([...signals(platform).listeners.keys()], platform).toEqual([
        'SIGINT',
        'SIGTERM',
        'SIGHUP',
      ])
      // The first signal, whichever it is: the quit, and nothing forced.
      for (const signal of TERMINATION_SIGNALS) {
        const { listeners, did } = signals(platform)
        listeners.get(signal)?.()
        expect(did, `${platform}, ${signal}`).toEqual(['quit'])
        expect([...listeners.keys()], 'every listener is still on').toHaveLength(3)
      }
    }
  })

  it('is left to Windows on Windows', () => {
    const { listeners, did } = signals('win32')
    expect([...listeners.keys()]).toEqual([])
    expect(did).toEqual([])
  })

  it('forces the exit at a second signal while the quit is under way: its listener off, then the signal raised again', () => {
    // The quit the first signal began may be stuck, or the loop wedged. Off
    // first, which gives the signal back its default action; raised again
    // with the listener still on, it would only be heard here once more.
    const { listeners, did, state } = signals('linux')
    listeners.get('SIGTERM')?.()
    state.quitting = true
    listeners.get('SIGTERM')?.()
    expect(did).toEqual(['quit', 'off SIGTERM', 'raise SIGTERM'])
    expect([...listeners.keys()], 'the other signals are still heard').toEqual(['SIGINT', 'SIGHUP'])
  })

  it('forces the exit at a second signal though the gate has not seen the first', () => {
    // A quit that never reached `before-quit` is the stuck quit this is for.
    const { listeners, did } = signals('darwin')
    listeners.get('SIGINT')?.()
    listeners.get('SIGTERM')?.()
    expect(did, 'whichever signal the second is').toEqual(['quit', 'off SIGTERM', 'raise SIGTERM'])
  })

  it('forces the exit at a signal that arrives during a quit begun some other way', () => {
    const { listeners, did } = signals('linux', true)
    listeners.get('SIGHUP')?.()
    expect(did, 'no second quit is asked for').toEqual(['off SIGHUP', 'raise SIGHUP'])
  })

  it('goes on to the gate unasked, with an export running and a page that could be asked', () => {
    // The whole point: whoever sent the signal cannot answer the question.
    const { guard, did, exporting } = world()
    exporting()
    quitOnSignals({
      platform: 'linux',
      on: (signal, listener) => {
        if (signal === 'SIGTERM') listener()
      },
      off: () => undefined,
      raise: () => did.push('raise'),
      quitting: () => false,
      quit: () => guard.quit(),
    })
    expect(did).toEqual(['quit'])
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
  })
})

// `index.ts` imports Electron and cannot be run here, so what it does with
// the guard is read from its text, as `ipc.test.ts` reads the handlers: the
// two handlers are the composed ones tested above, and every quit the main
// process makes itself goes through the guard, or the crash box's Quit and
// the quit that follows the window would be held for a question. The built
// app is quit-guard.spec.ts's.
describe('the guard in index.ts', () => {
  const main = join(__dirname, '..', '..', 'src', 'main')
  const index = readFileSync(join(main, 'index.ts'), 'utf8')
  /** A file's code without its comment lines: the gate's own notes speak of `app.quit()`. */
  const code = (text: string): string =>
    text
      .split('\n')
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
      .join('\n')

  it('quits through the guard everywhere but in the guard’s own quit', () => {
    const direct = [...code(index).matchAll(/\bapp\.(?:quit|exit)\(/g)]
    expect(direct, 'one direct quit: the one the guard is handed').toHaveLength(1)
    expect(index).toContain('  quit: () => app.quit(),\n')
    // The quits that must never be asked about, each by the guard.
    for (const through of [
      // The crash box's Quit.
      /crashBox\([^\n]*\),\n(?:\s*\/\/[^\n]*\n)*\s*\(\) => quitGuard\.quit\(\),/,
      // A second instance.
      /if \(!hasLock\) \{\n\s*quitGuard\.quit\(\)/,
      // An uncaught exception.
      /registerProcessHandlers\(process, \(\) => quitGuard\.quit\(\)\)/,
      // The quit that follows the window on Windows and Linux, twice over.
      /if \(!quit\.quitting\) quitGuard\.quit\(\)/,
      /if \(process\.platform !== 'darwin'\) quitGuard\.quit\(\)/,
    ])
      expect(index).toMatch(through)
    // And no other file of the main process quits the app at all, in any
    // folder of it.
    const others = readdirSync(main, { recursive: true, encoding: 'utf8' }).filter(
      (file) => file.endsWith('.ts') && file !== 'index.ts',
    )
    expect(others.length, 'the folder was read').toBeGreaterThan(20)
    expect(
      others.some((file) => /[\\/]/.test(file)),
      'and its folders with it',
    ).toBe(true)
    for (const file of others)
      expect(code(readFileSync(join(main, file), 'utf8')), file).not.toMatch(
        /\bapp\.(?:quit|exit)\(/,
      )
  })

  it('hands before-quit and the window’s close to the composed handlers, over the one guard', () => {
    expect(index).toMatch(/app\.on\(\s*'before-quit',\s*onBeforeQuit\(\{\s*guard: quitGuard,/)
    expect(index).toMatch(/window\.on\(\s*'close',\s*onAppWindowClose\(\{\s*guard: quitGuard,/)
    // Electron's word that the page is, or is no longer, answering.
    expect(index).toContain("window.on('unresponsive', () => quitGuard.unresponsive())")
    expect(index).toContain("window.on('responsive', () => quitGuard.responsive())")
    // The page going, each way it can go.
    expect(index.match(/quitGuard\.gone\(\)/g), 'closed, navigated, died').toHaveLength(3)
  })

  it('installs the termination signals as the guard’s own quit, once the app is ready', () => {
    // After `whenReady`, so they are installed over Electron's own handlers
    // for the same signals and not under them.
    const ready = index.indexOf('app.whenReady().then(')
    const installed = index.indexOf('quitOnSignals({')
    expect(ready).toBeGreaterThan(-1)
    expect(installed, 'installed, and inside the ready handler').toBeGreaterThan(ready)
    expect(index.indexOf('mainWindow = createWindow()', installed)).toBeGreaterThan(installed)
    // The process's own calls, each as itself: the listener put on and taken
    // off, the signal raised again at this process, the gate's word that a
    // quit is under way, and the guard's own quit.
    expect(index).toMatch(
      /quitOnSignals\(\{\s*platform: process\.platform,\s*on: \(signal, listener\) => process\.on\(signal, listener\),\s*off: \(signal, listener\) => process\.removeListener\(signal, listener\),\s*raise: \(signal\) => process\.kill\(process\.pid, signal\),\s*quitting: \(\) => quit\.quitting,\s*quit: \(\) => quitGuard\.quit\(\),\s*\}\)/,
    )
  })

  it('hands the guard a clock that cannot go back, and the bridge that cancels a page’s requests', () => {
    expect(index).toContain('  now: () => performance.now(),')
    expect(index).toContain('  cancelRequests: () => engineBridge?.cancelAll(),')
    expect(index).toMatch(/engineBridge = registerEngineHandlers\(/)
  })
})
