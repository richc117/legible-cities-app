// The two rules that look at the app's own window (issue 537). An export's
// capture window is a window too, and the handlers used to count every one:
// closing the app's window during an export left macOS with no window to
// come back from the Dock, and Windows and Linux windowless until the
// capture ended. The tests keep a capture window open throughout and move
// the app's window, which is what the old rule could not see.

import { describe, expect, it, vi } from 'vitest'
import { onActivate, onAppWindowClosed } from '../../src/main/window-lifecycle'

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
