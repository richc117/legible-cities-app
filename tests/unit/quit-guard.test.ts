// Asking before a quit or a close throws a run away (issue 552,
// specs/039-quit-guard), main side: what the rule is asked with and how its
// answer is carried out (`src/main/quit-guard.ts`). The rule's own table is
// in `window-lifecycle.test.ts`.
//
// What is held here: the question is sent, numbered, with the store's names,
// only to a page that listens and answers; the app's own quits and a quit
// already under way are never asked about; "Keep working" leaves everything
// as it was; "Quit anyway" quits as the app did before, through the gate's
// first pass and the engine's stop; a second quit or close is an answer;
// "Close anyway" stops the exports and then closes the window, and the close
// it makes is not asked about; the page's report is heard from the listening
// frame only and goes with the page; and the three handlers take the top
// frame's word and refuse a wrong shape. Each was watched failing under its
// mutation in `quit-guard.mutations.json`.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  BAD_ANSWER,
  BAD_REPORT,
  MAX_REPORTED_LAYOUTS,
  onAppWindowClose,
  onBeforeQuit,
  QuitGuard,
  readLayoutReport,
  registerQuitHandlers,
  type UnnamedRun,
} from '../../src/main/quit-guard'
import { quitGate, shutDown } from '../../src/main/window-lifecycle'
import { CHANNELS } from '../../src/shared/api'
import { UNNAMED_PROJECT, type AskedQuit } from '../../src/shared/quit'

/** Two of the window's main frames, as Electron would hand them: one, and the next. */
const PAGE = { frame: 'the page' }
const NEXT = { frame: 'the next page' }

const PARIS = 'paris0000001'
const LYON = 'lyon00000001'

/** An event that records whether Electron was told to stop. */
const event = () => ({ preventDefault: vi.fn() })

/** The guard over a world a test can move: the exports, the names, the window's frame, and what was done. */
function world() {
  const did: string[] = []
  const asked: AskedQuit[] = []
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
    close: () => did.push('close'),
    quit: () => did.push('quit'),
  })
  /** A page that listens, with an export of Paris running. */
  const exporting = (): void => {
    guard.listening(PAGE)
    state.exports = [{ project: PARIS, started: 1_000 }]
  }
  return { guard, state, did, asked, exporting }
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

  it('takes a second quit as the answer while the question is open, and takes the dialog back', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.beforeQuit(event(), false)
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
    const quit = event()
    expect(guard.beforeQuit(quit, false)).toBe(false)
    expect(quit.preventDefault).not.toHaveBeenCalled()
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

  it('takes a second close as the answer, and stops the exports itself', () => {
    const { guard, did, exporting } = world()
    exporting()
    guard.closing(event(), false)
    const second = event()
    expect(guard.closing(second, false)).toBe(false)
    expect(second.preventDefault).not.toHaveBeenCalled()
    expect(did).toEqual(['ask close', 'stop exports'])
    guard.answer(PAGE, 1, 'anyway')
    expect(did, 'the page’s late answer does nothing').toEqual(['ask close', 'stop exports'])
  })

  it('lets a quit answer a close’s question, and a close answer a quit’s', () => {
    const one = world()
    one.exporting()
    one.guard.closing(event(), false)
    expect(one.guard.beforeQuit(event(), false)).toBe(false)
    expect(one.did).toEqual(['ask close', 'withdraw'])

    const two = world()
    two.exporting()
    two.guard.beforeQuit(event(), false)
    expect(two.guard.closing(event(), false)).toBe(false)
    expect(two.did).toEqual(['ask quit', 'stop exports'])
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
    await expect(call(CHANNELS.quitListening, PAGE)).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.quitLayouts, PAGE, [])).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.quitAnswer, PAGE, 1, 'anyway')).rejects.toThrow('forbidden')
    expect(guard.beforeQuit(event(), false), 'nobody listens yet').toBe(false)

    frames.top = true
    await call(CHANNELS.quitListening, PAGE)
    expect(guard.beforeQuit(event(), false)).toBe(true)
    await call(CHANNELS.quitAnswer, PAGE, 1, 'anyway')
    expect(did).toEqual(['ask quit', 'quit'])
  })

  it('takes the report through its shape, and refuses one that is not a report', async () => {
    const { call, guard, asked } = bridge()
    await call(CHANNELS.quitListening, PAGE)
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
