// The two rules that look at the app's own window (issue 537). An export's
// capture window is a window too, and the handlers used to count every one:
// closing the app's window during an export left macOS with no window to
// come back from the Dock, and Windows and Linux windowless until the
// capture ended. The tests keep a capture window open throughout and move
// the app's window, which is what the old rule could not see.

import { describe, expect, it, vi } from 'vitest'
import { onActivate, onAppWindowClosed, quitGate, shutDown } from '../../src/main/window-lifecycle'

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

  it('does nothing past the aborts when there is no engine', async () => {
    const { order, deps } = setup({ noEngine: true })
    shutDown(deps)
    await settle()
    expect(order).toEqual(['the export', 'the capture', 'the first-run check'])
  })
})
