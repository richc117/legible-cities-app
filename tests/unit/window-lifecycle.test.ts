// The two rules that look at the app's own window (issue 537). An export's
// capture window is a window too, and the handlers used to count every one:
// closing the app's window during an export left macOS with no window to
// come back from the Dock, and Windows and Linux windowless until the
// capture ended. The tests keep a capture window open throughout and move
// the app's window, which is what the old rule could not see.
//
// And the rule for the question a quit or a close asks first while a run is
// going (issue 552): `quitQuestion`, further down, with its own note.

import { describe, expect, it, vi } from 'vitest'
import {
  onActivate,
  onAppWindowClosed,
  QUESTION_MIN_AGE_MS,
  quitGate,
  quitQuestion,
  shutDown,
  type QuitFacts,
  type Run,
} from '../../src/main/window-lifecycle'

/** The app as the handlers see it: the windows open, and which one is the app's own. */
function app() {
  const capture = { name: 'capture' }
  const world = {
    open: [capture] as { name: string }[],
    appWindow: null as { name: string } | null,
    windowsMade: 0,
  }
  const make = (): void => {
    world.appWindow = { name: 'app' }
    world.open.push(world.appWindow)
    world.windowsMade += 1
  }
  const close = (): void => {
    world.open = world.open.filter((w) => w !== world.appWindow)
    world.appWindow = null
  }
  make()
  world.windowsMade = 0
  return { world, capture, make, close }
}

describe('onAppWindowClosed', () => {
  it.each(['win32', 'linux'])(
    'quits on %s when the app window closes with a capture window still open',
    (platform) => {
      const { world, close } = app()
      const quit = vi.fn()
      const handler = onAppWindowClosed({ platform, quit })
      close()
      expect(
        world.open.map((w) => w.name),
        'the capture is the window left',
      ).toEqual(['capture'])
      handler()
      expect(quit).toHaveBeenCalledTimes(1)
    },
  )

  it('stays running on macOS when the app window closes with a capture window open', () => {
    const { close } = app()
    const quit = vi.fn()
    const handler = onAppWindowClosed({ platform: 'darwin', quit })
    close()
    handler()
    expect(quit).not.toHaveBeenCalled()
  })
})

describe('onActivate', () => {
  it('makes a window when the app has none of its own, though a capture window is open', () => {
    const { world, make, close } = app()
    const handler = onActivate({ appWindow: () => world.appWindow, open: make })
    close()
    expect(world.open).toHaveLength(1)
    handler()
    expect(world.windowsMade).toBe(1)
    expect(world.appWindow).not.toBeNull()
  })

  it('makes none while the app window is open', () => {
    const { world, make } = app()
    const handler = onActivate({ appWindow: () => world.appWindow, open: make })
    handler()
    expect(world.windowsMade).toBe(0)
  })
})

// Asking before a quit or a close throws a run away (issue 552,
// specs/039-quit-guard, SC-001). The table: nothing running; an export; a
// layout; both; two of one; the renderer gone; the renderer unresponsive; the
// app's own quit; a question already open, too young to have been read and
// old enough; quit and close. Each row's rule has a mutation in
// `window-lifecycle.mutations.json` that turns it red.
describe('quitQuestion', () => {
  const run = (project: string, name: string, started: number): Run => ({ project, name, started })
  const PARIS = run('paris0000001', 'Paris', 1_000)
  const LYON = run('lyon00000001', 'Lyon', 2_000)
  const LILLE = run('lille0000001', 'Lille', 3_000)

  /** A person's quit, with a page that can be asked and nothing on the screen. */
  const facts = (over: Partial<QuitFacts> = {}): QuitFacts => ({
    kind: 'quit',
    exports: [],
    layouts: [],
    renderer: 'ready',
    own: false,
    open: null,
    ...over,
  })
  /** Go ahead, asking nothing; and hold, asking nothing. */
  const GO = { ask: false, hold: false }
  const HELD = { ask: false, hold: true }

  it('goes ahead with nothing running, as every quit and close did before', () => {
    expect(quitQuestion(facts())).toEqual(GO)
    expect(quitQuestion(facts({ kind: 'close' }))).toEqual(GO)
  })

  it('asks before a quit during an export, naming its project', () => {
    expect(quitQuestion(facts({ exports: [PARIS] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 1, layouts: 0, names: ['Paris'] },
    })
  })

  it('asks before a quit during a layout, which only the report from the page shows', () => {
    expect(quitQuestion(facts({ layouts: [PARIS] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 0, layouts: 1, names: ['Paris'] },
    })
  })

  it('counts an export and a layout as two runs', () => {
    expect(quitQuestion(facts({ exports: [PARIS], layouts: [LYON] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 1, layouts: 1, names: ['Paris', 'Lyon'] },
    })
  })

  it('counts two of one kind as two runs', () => {
    expect(quitQuestion(facts({ exports: [PARIS, LYON] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 2, layouts: 0, names: ['Paris', 'Lyon'] },
    })
    expect(quitQuestion(facts({ layouts: [PARIS, LYON] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 0, layouts: 2, names: ['Paris', 'Lyon'] },
    })
  })

  it('names the projects in the order their runs started, whichever kind each is', () => {
    // The layout began first, though exports are handed in first; and the
    // lists themselves need not be in order.
    const decision = quitQuestion(facts({ exports: [LILLE, LYON], layouts: [PARIS] }))
    expect(decision).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 2, layouts: 1, names: ['Paris', 'Lyon', 'Lille'] },
    })
  })

  it('names a project once, however many of its runs are going', () => {
    // Its export and its layout: two runs, one name. Two projects that share
    // a name are two projects, and each is named.
    const again = run(PARIS.project, 'Paris', 5_000)
    const namesake = run('paris0000002', 'Paris', 6_000)
    expect(quitQuestion(facts({ exports: [PARIS], layouts: [again] }))).toEqual({
      ask: true,
      question: { kind: 'quit', exports: 1, layouts: 1, names: ['Paris'] },
    })
    expect(quitQuestion(facts({ exports: [PARIS, namesake] }))).toMatchObject({
      question: { names: ['Paris', 'Paris'] },
    })
  })

  it('does not ask when the renderer is gone, so a person can always quit', () => {
    expect(quitQuestion(facts({ exports: [PARIS], renderer: 'gone' }))).toEqual(GO)
    expect(quitQuestion(facts({ kind: 'close', layouts: [PARIS], renderer: 'gone' }))).toEqual(GO)
  })

  it('does not ask when the renderer is unresponsive', () => {
    expect(quitQuestion(facts({ exports: [PARIS], renderer: 'unresponsive' }))).toEqual(GO)
    expect(
      quitQuestion(facts({ kind: 'close', layouts: [PARIS], renderer: 'unresponsive' })),
    ).toEqual(GO)
  })

  it('never asks about a quit of the app itself', () => {
    expect(quitQuestion(facts({ exports: [PARIS], layouts: [LYON], own: true }))).toEqual(GO)
    // Nor about the windows such a quit closes on its way out.
    expect(quitQuestion(facts({ kind: 'close', exports: [PARIS], own: true }))).toEqual(GO)
    // Nor is it held by a question that has only just been asked.
    expect(quitQuestion(facts({ exports: [PARIS], own: true, open: 0 }))).toEqual(GO)
  })

  it('lets a second quit go ahead once the question has been open a second: it is an answer', () => {
    for (const open of [QUESTION_MIN_AGE_MS, QUESTION_MIN_AGE_MS + 1, 60_000]) {
      expect(quitQuestion(facts({ exports: [PARIS], open })), `${open} ms`).toEqual(GO)
      expect(quitQuestion(facts({ kind: 'close', exports: [PARIS], open })), `${open} ms`).toEqual(
        GO,
      )
    }
    // An answer though the run has ended meanwhile, and nothing is left to ask about.
    expect(quitQuestion(facts({ open: QUESTION_MIN_AGE_MS }))).toEqual(GO)
  })

  it('holds a second quit that comes before the question could have been read', () => {
    // The repeat of a held shortcut, or the second click of a double click:
    // cancelled, with nothing asked again and the question left as it is.
    expect(QUESTION_MIN_AGE_MS).toBe(1_000)
    for (const open of [0, 1, 400, QUESTION_MIN_AGE_MS - 1]) {
      expect(quitQuestion(facts({ exports: [PARIS], open })), `${open} ms`).toEqual(HELD)
      expect(quitQuestion(facts({ kind: 'close', layouts: [PARIS], open })), `${open} ms`).toEqual(
        HELD,
      )
    }
    // Held for the question's sake, whatever has become of the run.
    expect(quitQuestion(facts({ open: 0 }))).toEqual(HELD)
  })

  it('does not hold a second quit for a page that can no longer show the question', () => {
    // A person can always quit: a page gone or reported unresponsive with
    // the question a moment old is not waited for.
    expect(quitQuestion(facts({ exports: [PARIS], renderer: 'gone', open: 0 }))).toEqual(GO)
    expect(quitQuestion(facts({ exports: [PARIS], renderer: 'unresponsive', open: 0 }))).toEqual(GO)
  })

  it('asks before a close during an export too, on macOS as everywhere', () => {
    // The rule takes no platform. The approach first decided let macOS close
    // its window silently during an export, which carries on there; the
    // spec's close asks on every platform (a window reopened from the Dock
    // cannot see or stop that export, issue 556), so an export counts for a
    // close exactly as it does for a quit.
    expect(quitQuestion(facts({ kind: 'close', exports: [PARIS] }))).toEqual({
      ask: true,
      question: { kind: 'close', exports: 1, layouts: 0, names: ['Paris'] },
    })
    expect(quitQuestion(facts({ kind: 'close', exports: [PARIS], layouts: [LYON] }))).toEqual({
      ask: true,
      question: { kind: 'close', exports: 1, layouts: 1, names: ['Paris', 'Lyon'] },
    })
  })

  it('asks before a close during a layout, and says which was asked for', () => {
    expect(quitQuestion(facts({ kind: 'close', layouts: [PARIS] }))).toEqual({
      ask: true,
      question: { kind: 'close', exports: 0, layouts: 1, names: ['Paris'] },
    })
  })

  it('leaves what it was handed as it was', () => {
    const exports = [LILLE, LYON]
    quitQuestion(facts({ exports, layouts: [PARIS] }))
    expect(exports).toEqual([LILLE, LYON])
  })
})

describe('quitGate', () => {
  /** An event that records whether Electron was told to stop the quit. */
  const event = () => ({ cancelled: false, preventDefault: vi.fn() })

  it('keeps cancelling every quit until the engine has stopped, then lets go', () => {
    const gate = quitGate()
    // The sequence of a window close on Windows and Linux: the window's
    // closed handler quits, then window-all-closed quits again behind it.
    const first = event()
    expect(gate.beforeQuit(first, true)).toBe('first')
    expect(first.preventDefault).toHaveBeenCalledTimes(1)
    expect(gate.quitting).toBe(true)

    const second = event()
    expect(gate.beforeQuit(second, true)).toBe('later')
    expect(second.preventDefault, 'the engine is still stopping').toHaveBeenCalledTimes(1)

    // An exception or the crash box's Quit, mid-stop, is held as well.
    const third = event()
    expect(gate.beforeQuit(third, true)).toBe('later')
    expect(third.preventDefault).toHaveBeenCalledTimes(1)

    gate.finished()
    const last = event()
    expect(gate.beforeQuit(last, true)).toBe('later')
    expect(last.preventDefault, 'the stop is done: Electron goes').not.toHaveBeenCalled()
  })

  it('cancels nothing when there is no engine to stop', () => {
    const gate = quitGate()
    const first = event()
    expect(gate.beforeQuit(first, false)).toBe('first')
    expect(first.preventDefault).not.toHaveBeenCalled()
    const next = event()
    expect(gate.beforeQuit(next, false)).toBe('later')
    expect(next.preventDefault).not.toHaveBeenCalled()
  })

  it('reports a quit under way only after the first pass', () => {
    const gate = quitGate()
    expect(gate.quitting).toBe(false)
    gate.beforeQuit(event(), true)
    expect(gate.quitting).toBe(true)
  })
})

describe('shutDown', () => {
  /** What the first pass is handed, with the order things happened in. */
  function setup(options: { throwing?: string[]; stopFails?: boolean; noEngine?: boolean } = {}) {
    const order: string[] = []
    const gate = quitGate()
    const deps = {
      aborts: ['the export', 'the capture', 'the first-run check'].map((name) => ({
        name,
        run: () => {
          order.push(name)
          if (options.throwing?.includes(name)) throw new Error(`${name} broke`)
        },
      })),
      stop: options.noEngine
        ? null
        : () => {
            order.push('stop')
            return options.stopFails ? Promise.reject(new Error('no answer')) : Promise.resolve()
          },
      finished: () => {
        order.push('finished')
        gate.finished()
      },
      quit: () => order.push('quit'),
      error: (message: string) => order.push(`error: ${message}`),
    }
    return { order, gate, deps }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('ends what runs, stops the engine, then lets the gate go and quits', async () => {
    const { order, deps } = setup()
    shutDown(deps)
    await settle()
    expect(order).toEqual([
      'the export',
      'the capture',
      'the first-run check',
      'stop',
      'finished',
      'quit',
    ])
  })

  it('still stops the engine and quits when an abort throws, and the others still run', async () => {
    const { order, gate, deps } = setup({ throwing: ['the export', 'the capture'] })
    gate.beforeQuit({ preventDefault: () => undefined }, true)
    shutDown(deps)
    await settle()
    expect(order).toEqual([
      'the export',
      'error: the export did not end on quit: the export broke',
      'the capture',
      'error: the capture did not end on quit: the capture broke',
      'the first-run check',
      'stop',
      'finished',
      'quit',
    ])
    // The gate was let go, so the final quit passes.
    const last = { preventDefault: vi.fn() }
    gate.beforeQuit(last, true)
    expect(last.preventDefault).not.toHaveBeenCalled()
  })

  it('lets go and quits when the stop itself fails', async () => {
    const { order, deps } = setup({ stopFails: true })
    shutDown(deps)
    await settle()
    expect(order.slice(-3)).toEqual(['error: stop failed: no answer', 'finished', 'quit'])
  })

  it('reaches the stop and the final quit when the logger throws, or the failure cannot be read', async () => {
    const { order, gate, deps } = setup({ throwing: ['the export'], stopFails: true })
    gate.beforeQuit({ preventDefault: () => undefined }, true)
    shutDown({
      ...deps,
      error: () => {
        throw new Error('the log is gone')
      },
    })
    await settle()
    expect(order).toEqual([
      'the export',
      'the capture',
      'the first-run check',
      'stop',
      'finished',
      'quit',
    ])

    // A thrown value whose string form throws.
    const unreadable = {
      toString() {
        throw new Error('no string')
      },
    }
    const again = setup()
    again.deps.aborts[0].run = () => {
      throw unreadable
    }
    shutDown(again.deps)
    await settle()
    expect(again.order).toEqual(['the capture', 'the first-run check', 'stop', 'finished', 'quit'])
  })

  it('does nothing past the aborts when there is no engine', async () => {
    const { order, deps } = setup({ noEngine: true })
    shutDown(deps)
    await settle()
    expect(order).toEqual(['the export', 'the capture', 'the first-run check'])
  })
})
