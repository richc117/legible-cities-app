// The menu's commands on their way to the page (issue 554): a command
// chosen before the page listens is held, the latest winning, and sent once
// it says it listens, unless it has waited too long; a page that goes stops
// hearing until the next one says so, and a renderer that dies takes the
// held command with it; a command goes only to the frame that said it
// listens, while it is still the window's main frame; and only the
// interface's own top frame can say it listens.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { HELD_MS, MenuCommands, registerMenuHandlers } from '../../src/main/menu-ipc'
import { CHANNELS } from '../../src/shared/api'
import type { MenuCommand } from '../../src/shared/menu'

/** Two of the window's main frames, as Electron would hand them: one, and the next. */
const PAGE = { frame: 'the page' }
const NEXT = { frame: 'the next page' }

function commands() {
  const sent: MenuCommand[] = []
  const clock = { now: 1_000 }
  const window = { frame: PAGE as unknown }
  const menu = new MenuCommands({
    send: (command) => sent.push(command),
    current: (frame) => frame === window.frame,
    now: () => clock.now,
  })
  return { sent, clock, window, menu }
}

describe('the menu’s commands', () => {
  it('holds a command chosen before the page listens, and sends it once it does', () => {
    // Mutation (`menu-ipc.mutations.json`): `listening` sends nothing it
    // held - a command chosen with no window open is lost.
    const { sent, menu } = commands()
    menu.command('settings')
    expect(sent).toEqual([])
    menu.listening(PAGE)
    expect(sent).toEqual(['settings'])
    // Once: a second word that the page listens sends nothing again.
    menu.listening(PAGE)
    expect(sent).toEqual(['settings'])
  })

  it('keeps only the latest of several held', () => {
    const { sent, menu } = commands()
    menu.command('settings')
    menu.command('new-project')
    menu.listening(PAGE)
    expect(sent).toEqual(['new-project'])
  })

  it('drops a held command that has waited longer than it may', () => {
    // Mutation (`menu-ipc.mutations.json`): the age is not looked at - a
    // choice made long ago is acted on when a page next listens.
    const { sent, clock, menu } = commands()
    menu.command('settings')
    clock.now += HELD_MS + 1
    menu.listening(PAGE)
    expect(sent).toEqual([])
    // At the limit it is still a choice made a moment ago.
    menu.gone()
    menu.command('about')
    clock.now += HELD_MS
    menu.listening(PAGE)
    expect(sent).toEqual(['about'])
  })

  it('sends at once while the page listens, and holds again once it has gone', () => {
    const { sent, menu } = commands()
    menu.listening(PAGE)
    menu.command('about')
    expect(sent).toEqual(['about'])
    menu.gone()
    menu.command('copy-diagnostics')
    expect(sent).toEqual(['about'])
    menu.listening(PAGE)
    expect(sent).toEqual(['about', 'copy-diagnostics'])
  })

  it('forgets what it held when the renderer dies', () => {
    const { sent, window, menu } = commands()
    menu.listening(PAGE)
    menu.crashed()
    menu.command('settings')
    expect(sent).toEqual([])
    menu.crashed()
    window.frame = NEXT
    menu.listening(NEXT)
    expect(sent, 'a choice made over a crash is not the next page’s').toEqual([])
    menu.command('about')
    expect(sent).toEqual(['about'])
  })

  it('sends only to the frame that said it listens while it is still the main frame', () => {
    const { sent, window, menu } = commands()
    menu.listening(PAGE)
    // The window has another main frame that has not said it listens.
    window.frame = NEXT
    menu.command('settings')
    expect(sent).toEqual([])
    menu.listening(NEXT)
    expect(sent).toEqual(['settings'])
    // A word from a frame that is no longer the main one holds what it is given.
    menu.gone()
    menu.command('about')
    menu.listening(PAGE)
    expect(sent).toEqual(['settings'])
    menu.listening(NEXT)
    expect(sent).toEqual(['settings', 'about'])
  })

  it('keeps listening through a navigation that never committed', () => {
    // A navigation the window refused starts and goes nowhere: nothing
    // calls `gone`, the frame is still the main one, and the page hears.
    const { sent, menu } = commands()
    menu.listening(PAGE)
    menu.command('settings')
    expect(sent).toEqual(['settings'])
  })

  it('hears that the page listens from the interface’s own top frame only', async () => {
    type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>
    const handlers = new Map<string, Handler>()
    const ipc = {
      handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    } as unknown as IpcMain
    const { sent, menu } = commands()
    let top = false
    registerMenuHandlers(ipc, menu, () => top)
    expect([...handlers.keys()]).toEqual([CHANNELS.menuListening])
    menu.command('settings')
    const listening = handlers.get(CHANNELS.menuListening)!
    const event = { senderFrame: PAGE } as unknown as IpcMainInvokeEvent
    await expect(listening(event)).rejects.toThrow('forbidden')
    expect(sent, 'a frame that is not the top frame is not heard').toEqual([])
    top = true
    await listening(event)
    expect(sent).toEqual(['settings'])
    // The frame recorded is the event's: another frame's word sends nothing.
    menu.gone()
    menu.command('about')
    await listening({ senderFrame: NEXT } as unknown as IpcMainInvokeEvent)
    expect(sent).toEqual(['settings'])
  })
})
