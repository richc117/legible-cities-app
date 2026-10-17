// The failures nobody caught (issue 432, R5-04, R5-06): logged, and for an
// exception one quit, once; a rejection never quits; a renderer that dies is
// offered a reload once and then only the quit.

import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { log, setSink, toStderr } from '../../src/main/log'
import {
  crashBox,
  RELOAD_GRACE_MS,
  registerProcessHandlers,
  watchRendererCrash,
  type CrashChoice,
} from '../../src/main/process-handlers'

let lines: string[] = []
function capture(): void {
  lines = []
  setSink((line) => lines.push(line))
}
afterEach(() => setSink(toStderr))

describe('registerProcessHandlers', () => {
  it('logs an exception and quits once, even when a second follows', () => {
    capture()
    const proc = new EventEmitter()
    const quit = vi.fn()
    registerProcessHandlers(proc as never, quit)
    proc.emit('uncaughtException', new TypeError('first'))
    proc.emit('uncaughtException', new Error('during the quit'))
    expect(quit).toHaveBeenCalledTimes(1)
    expect(lines).toEqual([
      '[process] error: uncaught exception: TypeError: first',
      '[process] error: uncaught exception: Error: during the quit',
    ])
  })

  it('names a system error by its code and never by its message, which holds a path', () => {
    capture()
    const proc = new EventEmitter()
    registerProcessHandlers(proc as never, vi.fn())
    const fs = Object.assign(new Error("ENOENT: no such file, open '/data/someone/x.json'"), {
      code: 'ENOENT',
    })
    proc.emit('unhandledRejection', fs)
    proc.emit('unhandledRejection', new Error('x'.repeat(500)))
    expect(lines[0]).toBe('[process] error: unhandled rejection: Error (ENOENT)')
    expect(lines[1].length, 'a message with no code is cut').toBeLessThan(300)
  })

  it('still quits once when logging itself throws on the first line', () => {
    const proc = new EventEmitter()
    const quit = vi.fn()
    // The logger swallows a failing sink, so the line is made to throw here.
    const spy = vi.spyOn(log, 'error').mockImplementationOnce(() => {
      throw new Error('log down')
    })
    registerProcessHandlers(proc as never, quit)
    expect(() => proc.emit('uncaughtException', new Error('x'))).not.toThrow()
    expect(quit).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('does not throw for a thrown object whose getters throw', () => {
    capture()
    const proc = new EventEmitter()
    const quit = vi.fn()
    registerProcessHandlers(proc as never, quit)
    const hostile = Object.create(Error.prototype, {
      name: {
        get() {
          throw new Error('no name')
        },
      },
      message: {
        get() {
          throw new Error('no message')
        },
      },
    })
    expect(() => proc.emit('uncaughtException', hostile)).not.toThrow()
    expect(() => proc.emit('unhandledRejection', hostile)).not.toThrow()
    expect(quit).toHaveBeenCalledTimes(1)
    expect(lines[0]).toContain('an error that could not be read')
  })

  it('logs a rejection and does not quit', () => {
    capture()
    const proc = new EventEmitter()
    const quit = vi.fn()
    registerProcessHandlers(proc as never, quit)
    proc.emit('unhandledRejection', new Error('late'))
    proc.emit('unhandledRejection', 'a string')
    expect(quit).not.toHaveBeenCalled()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('unhandled rejection: Error: late')
  })

  it('a quit that throws is logged and does not escape the handler', () => {
    capture()
    const proc = new EventEmitter()
    registerProcessHandlers(proc as never, () => {
      throw new Error('no app')
    })
    expect(() => proc.emit('uncaughtException', new Error('x'))).not.toThrow()
    expect(lines.some((l) => l.includes('quit after an exception failed'))).toBe(true)
  })
})

describe('watchRendererCrash', () => {
  function setup(choices: CrashChoice[]) {
    capture()
    const contents = Object.assign(new EventEmitter(), { reload: vi.fn() })
    const asked: boolean[] = []
    const quit = vi.fn()
    let clock = 1_000_000
    watchRendererCrash(
      contents as never,
      async (canReload) => {
        asked.push(canReload)
        return choices.shift() ?? 'quit'
      },
      quit,
      () => clock,
    )
    const crash = async (reason: string): Promise<void> => {
      contents.emit('render-process-gone', {}, { reason })
      await new Promise((r) => setTimeout(r, 0))
    }
    return { contents, asked, quit, crash, advance: (ms: number) => (clock += ms) }
  }

  it('logs the reason and asks nothing for a clean exit', async () => {
    const t = setup([])
    await t.crash('clean-exit')
    expect(t.asked).toEqual([])
    expect(lines[0]).toContain('(clean-exit)')
  })

  it('offers a reload once, and reloads when chosen', async () => {
    const t = setup(['reload'])
    await t.crash('crashed')
    expect(t.asked).toEqual([true])
    expect(t.contents.reload).toHaveBeenCalledTimes(1)
    expect(t.quit).not.toHaveBeenCalled()
  })

  it('a crash straight after the reload offers only the quit', async () => {
    const t = setup(['reload', 'reload'])
    await t.crash('crashed')
    await t.crash('crashed')
    expect(t.asked).toEqual([true, false])
    expect(t.contents.reload).toHaveBeenCalledTimes(1)
    expect(t.quit).toHaveBeenCalledTimes(1)
  })

  it('a crash long after a reload is a new one and offers the reload again', async () => {
    const t = setup(['reload', 'reload'])
    await t.crash('crashed')
    t.advance(RELOAD_GRACE_MS + 1)
    await t.crash('oom')
    expect(t.asked).toEqual([true, true])
  })

  it('does not stack a second box while one is open', async () => {
    const t = setup([])
    t.contents.emit('render-process-gone', {}, { reason: 'crashed' })
    t.contents.emit('render-process-gone', {}, { reason: 'crashed' })
    await new Promise((r) => setTimeout(r, 0))
    expect(t.asked).toHaveLength(1)
  })

  it('quits when the box itself fails', async () => {
    capture()
    const contents = Object.assign(new EventEmitter(), { reload: vi.fn() })
    const quit = vi.fn()
    watchRendererCrash(contents as never, () => Promise.reject(new Error('no box')), quit)
    contents.emit('render-process-gone', {}, { reason: 'crashed' })
    await new Promise((r) => setTimeout(r, 0))
    // Quitting is the only thing a failed box can lead to: the choice path
    // never ran, so this call is the .catch's.
    expect(quit).toHaveBeenCalledTimes(1)
    expect(contents.reload).not.toHaveBeenCalled()
    expect(lines.some((l) => l.includes('the crash box failed'))).toBe(true)
  })
})

describe('crashBox', () => {
  it('is shown with the options alone, never with a parent window', async () => {
    const show = vi.fn(async () => ({ response: 0 })) as unknown as ReturnType<typeof vi.fn>
    const choice = await crashBox(show as never, 'Legible Cities')(true)
    expect(choice).toBe('reload')
    expect(show.mock.calls[0] as unknown[]).toHaveLength(1)
    expect(show.mock.calls[0][0]).toMatchObject({ buttons: ['Reload', 'Quit'] })
  })

  it('offers only Quit when a reload is not offered', async () => {
    const show = vi.fn(async () => ({ response: 0 })) as unknown as ReturnType<typeof vi.fn>
    expect(await crashBox(show as never, 'Legible Cities')(false)).toBe('quit')
    expect(show.mock.calls[0][0]).toMatchObject({ buttons: ['Quit'] })
  })
})
