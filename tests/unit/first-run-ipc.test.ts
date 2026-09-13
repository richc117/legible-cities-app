// The first-run check's bridge, main side (A6-02, specs/026): the top-frame
// guard on both handlers, the install document's address held here whatever
// the page sends, and every change forwarded to the window.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { INSTALL_GUIDE_URL, registerFirstRunHandlers } from '../../src/main/first-run-ipc'
import { CHANNELS } from '../../src/shared/api'
import { RUNNING_RESULT, type FirstRunResult } from '../../src/shared/first-run'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function setUp(topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  const listeners = new Set<(r: FirstRunResult) => void>()
  let result: FirstRunResult = RUNNING_RESULT
  const sent: [string, FirstRunResult][] = []
  const opened: string[] = []
  const off = registerFirstRunHandlers(
    ipc,
    {
      check: {
        get result() {
          return result
        },
        onChange: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      send: (channel, payload) => sent.push([channel, payload]),
      openExternal: async (url) => {
        opened.push(url)
      },
      log: () => undefined,
    },
    () => topFrame,
  )
  const call = (channel: string, ...args: unknown[]): Promise<unknown> =>
    handlers.get(channel)!({} as IpcMainInvokeEvent, ...args)
  const change = (next: FirstRunResult): void => {
    result = next
    for (const listener of listeners) listener(next)
  }
  return { call, change, sent, opened, off, handlers }
}

const PASSED: FirstRunResult = {
  finished: true,
  loom: { outcome: 'passed', ms: 10 },
  ffmpeg: { outcome: 'passed', ms: 12 },
}

describe('the first-run bridge', () => {
  it('registers its two handlers on the shared channel names', () => {
    const { handlers } = setUp()
    expect([...handlers.keys()].sort()).toEqual(
      [CHANNELS.firstRunGet, CHANNELS.firstRunOpenInstallGuide].sort(),
    )
    expect(Object.values(CHANNELS).filter((c) => c.startsWith('first-run:'))).toHaveLength(3)
  })

  it('answers the current result', async () => {
    const { call, change } = setUp()
    expect(await call(CHANNELS.firstRunGet)).toEqual(RUNNING_RESULT)
    change(PASSED)
    expect(await call(CHANNELS.firstRunGet)).toEqual(PASSED)
  })

  it('forwards each change to the window until unsubscribed', () => {
    const { change, sent, off } = setUp()
    change(PASSED)
    expect(sent).toEqual([[CHANNELS.firstRunChanged, PASSED]])
    off()
    change(RUNNING_RESULT)
    expect(sent).toHaveLength(1)
  })

  it('opens the address it holds, whatever the page sends', async () => {
    const { call, opened } = setUp()
    await call(CHANNELS.firstRunOpenInstallGuide, 'https://elsewhere.example/')
    expect(opened).toEqual([INSTALL_GUIDE_URL])
    expect(INSTALL_GUIDE_URL).toMatch(
      /^https:\/\/github\.com\/[^/]+\/legible-cities-app\/blob\/main\/docs\/install\.md$/,
    )
  })

  it('refuses a frame that is not the interface’s own top frame, and opens nothing', async () => {
    const { call, opened } = setUp(false)
    await expect(call(CHANNELS.firstRunGet)).rejects.toThrow('forbidden')
    await expect(call(CHANNELS.firstRunOpenInstallGuide)).rejects.toThrow('forbidden')
    expect(opened).toEqual([])
  })
})
