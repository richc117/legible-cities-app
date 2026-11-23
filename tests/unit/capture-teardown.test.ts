// Ending the captures on a quit (issue 755): a window whose web contents are
// already gone is still destroyed, and one capture that throws does not stop
// the rest. Stand-ins only; the mutations are in capture-teardown.mutations.json.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  destroyCaptureWindow,
  destroyEach,
  type CaptureWindowLike,
} from '../../src/main/capture-teardown'

function windowLike(
  over: {
    webContents?: () => CaptureWindowLike['webContents']
    calls?: string[]
  } = {},
): { window: CaptureWindowLike; calls: string[] } {
  const calls = over.calls ?? []
  const window: CaptureWindowLike = {
    isDestroyed: () => false,
    get webContents() {
      if (over.webContents) return over.webContents()
      return {
        isDestroyed: () => false,
        debugger: { isAttached: () => false, detach: () => calls.push('detach') },
      }
    },
    destroy: () => {
      calls.push('destroy')
    },
  }
  return { window, calls }
}

describe('destroyCaptureWindow', () => {
  it('destroys a window whose web contents are already gone', () => {
    let read = false
    const { window, calls } = windowLike({
      webContents: () => ({
        isDestroyed: () => true,
        get debugger(): never {
          read = true
          throw new Error('Object has been destroyed')
        },
      }),
    })
    expect(() => destroyCaptureWindow(window)).not.toThrow()
    expect(read).toBe(false)
    expect(calls).toEqual(['destroy'])
  })

  it('destroys the window when reading its web contents throws', () => {
    const { window, calls } = windowLike({
      webContents: () => {
        throw new Error('Object has been destroyed')
      },
    })
    expect(() => destroyCaptureWindow(window)).not.toThrow()
    expect(calls).toEqual(['destroy'])
  })

  it('detaches an attached debugger before it destroys the window', () => {
    const calls: string[] = []
    const { window } = windowLike({
      calls,
      webContents: () => ({
        isDestroyed: () => false,
        debugger: { isAttached: () => true, detach: () => calls.push('detach') },
      }),
    })
    destroyCaptureWindow(window)
    expect(calls).toEqual(['detach', 'destroy'])
  })

  it('destroys the window when the detach throws', () => {
    const { window, calls } = windowLike({
      webContents: () => ({
        isDestroyed: () => false,
        debugger: {
          isAttached: () => true,
          detach: () => {
            throw new Error('detach refused')
          },
        },
      }),
    })
    expect(() => destroyCaptureWindow(window)).not.toThrow()
    expect(calls).toEqual(['destroy'])
  })

  it('asks a destroyed window nothing more', () => {
    const destroy = vi.fn()
    const refuse = (): never => {
      throw new Error('touched')
    }
    const window = {
      isDestroyed: () => true,
      get webContents(): never {
        return refuse()
      },
      destroy,
    } as unknown as CaptureWindowLike
    expect(() => destroyCaptureWindow(window)).not.toThrow()
    expect(destroy).not.toHaveBeenCalled()
  })
})

describe('destroyEach', () => {
  it('goes on to the next capture when one throws, and says so once', () => {
    const destroy = [
      vi.fn(),
      vi.fn(() => {
        throw new Error('gone')
      }),
      vi.fn(),
    ]
    const say = vi.fn()
    destroyEach(
      destroy.map((d) => ({ destroy: d })),
      say,
    )
    for (const d of destroy) expect(d).toHaveBeenCalledTimes(1)
    expect(say).toHaveBeenCalledTimes(1)
    expect(say).toHaveBeenCalledWith('a capture did not end on quit: gone')
  })

  it('says a thrown non-error as its string', () => {
    const say = vi.fn()
    destroyEach(
      [
        {
          destroy: () => {
            throw 'odd'
          },
        },
      ],
      say,
    )
    expect(say).toHaveBeenCalledWith('a capture did not end on quit: odd')
  })

  it('walks a copy: a page that empties the set as it ends skips nobody', () => {
    const set = new Set<{ destroy(): void }>()
    let calls = 0
    for (let i = 0; i < 3; i++) {
      const page = {
        destroy: () => {
          calls++
          set.clear()
        },
      }
      set.add(page)
    }
    destroyEach(set, vi.fn())
    expect(calls).toBe(3)
  })

  it('goes on when the error cannot be put into words', () => {
    let calls = 0
    const page = {
      destroy: () => {
        calls++
        if (calls === 2)
          throw {
            toString() {
              throw new Error('no words')
            },
          }
      },
    }
    expect(() => destroyEach([page, page, page], vi.fn())).not.toThrow()
    expect(calls).toBe(3)
  })

  it('goes on when the logger throws', () => {
    let calls = 0
    const boom = {
      destroy: () => {
        calls++
        throw new Error('gone')
      },
    }
    const say = vi.fn(() => {
      throw new Error('logger down')
    })
    expect(() => destroyEach([boom, boom, boom], say)).not.toThrow()
    expect(calls).toBe(3)
  })
})

describe('capture-window.ts', () => {
  it('ends its captures through the two functions', () => {
    const source = readFileSync(join(__dirname, '../../src/main/capture-window.ts'), 'utf8')
    expect(source).toContain('destroyCaptureWindow(this.#window)')
    expect(source).toContain('destroyEach(live,')
    expect(source).not.toContain('for (const page of live) page.destroy()')
    expect(source).not.toContain('dbg.isAttached()')
  })
})
