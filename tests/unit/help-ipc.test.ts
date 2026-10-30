// The Help pages' bridge, main side (issue 554): a page is asked for by
// name, from a closed set, and the address is this side's. An address, a
// name the table does not hold and a name an object inherits are refused
// alike, nothing is opened, and a frame that is not the interface's own top
// frame is refused before anything is read.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { INSTALL_GUIDE_URL } from '../../src/main/first-run-ipc'
import { HELP_PAGES, registerHelpHandlers, UNKNOWN_HELP_PAGE } from '../../src/main/help-ipc'
import { CHANNELS } from '../../src/shared/api'
import { HELP_PAGE_KEYS } from '../../src/shared/menu'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>

function setUp(topFrame = true) {
  const handlers = new Map<string, Handler>()
  const ipc = { handle: (c: string, h: Handler) => handlers.set(c, h) } as unknown as IpcMain
  const opened: string[] = []
  registerHelpHandlers(
    ipc,
    {
      openExternal: async (url) => {
        opened.push(url)
      },
      log: () => undefined,
    },
    () => topFrame,
  )
  const call = (...args: unknown[]): Promise<unknown> =>
    handlers.get(CHANNELS.helpOpen)!({} as IpcMainInvokeEvent, ...args)
  return { call, opened, handlers }
}

describe('the Help pages', () => {
  it('registers one handler, on the shared channel', () => {
    const { handlers } = setUp()
    expect([...handlers.keys()]).toEqual([CHANNELS.helpOpen])
  })

  it.each(HELP_PAGE_KEYS)('opens the address it holds for "%s"', async (page) => {
    const { call, opened } = setUp()
    await call(page)
    expect(opened).toEqual([HELP_PAGES[page]])
  })

  it('holds an https address on the project’s own repository for every page', () => {
    const repository = new URL(INSTALL_GUIDE_URL).pathname.split('/').slice(0, 3).join('/')
    expect(Object.keys(HELP_PAGES).sort()).toEqual([...HELP_PAGE_KEYS].sort())
    for (const url of Object.values(HELP_PAGES)) {
      const parsed = new URL(url)
      expect(parsed.protocol).toBe('https:')
      expect(parsed.host === 'github.com' || parsed.host === 'gtfs.org', url).toBe(true)
      if (parsed.host === 'github.com') expect(`${parsed.pathname}/`).toMatch(`${repository}/`)
    }
    expect(HELP_PAGES.install).toBe(INSTALL_GUIDE_URL)
    expect(HELP_PAGES.report).toMatch(/\/issues\/new\?template=bug\.yml$/)
  })

  it.each([
    ['an address', 'https://example.org'],
    ['a name an object inherits', '__proto__'],
    ['another inherited name', 'toString'],
    ['a name it does not hold', 'settings'],
    ['a number', 42],
    ['nothing', undefined],
    ['an object', { page: 'guide' }],
  ])('refuses %s and opens nothing', async (_what, page) => {
    // Mutation (`help-ipc.mutations.json`): the handler passes its argument
    // through to the browser in place of the table's address.
    const { call, opened } = setUp()
    await expect(call(page)).rejects.toThrow(UNKNOWN_HELP_PAGE)
    expect(opened).toEqual([])
  })

  it('refuses a frame that is not the interface’s own top frame, and opens nothing', async () => {
    const { call, opened } = setUp(false)
    await expect(call('guide')).rejects.toThrow('forbidden')
    expect(opened).toEqual([])
  })
})
