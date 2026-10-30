// The menu's commands on their way to the page (issue 554): a command
// chosen before the page listens is held, the latest winning, and sent once
// it says it listens; a page that goes stops hearing until the next one
// says so; and only the interface's own top frame can say it listens.

import type { IpcMain, IpcMainEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { MenuCommands, registerMenuHandlers } from '../../src/main/menu-ipc'
import { CHANNELS } from '../../src/shared/api'
import type { MenuCommand } from '../../src/shared/menu'

function commands() {
  const sent: MenuCommand[] = []
  return { sent, menu: new MenuCommands((command) => sent.push(command)) }
}

describe('the menu’s commands', () => {
  it('holds a command chosen before the page listens, and sends it once it does', () => {
    // Mutation (`menu-ipc.mutations.json`): `listening` sends nothing it
    // held - a command chosen with no window open is lost.
    const { sent, menu } = commands()
    menu.command('settings')
    expect(sent).toEqual([])
    menu.listening()
    expect(sent).toEqual(['settings'])
    // Once: a second word that the page listens sends nothing again.
    menu.listening()
    expect(sent).toEqual(['settings'])
  })

  it('keeps only the latest of several held', () => {
    const { sent, menu } = commands()
    menu.command('settings')
    menu.command('new-project')
    menu.listening()
    expect(sent).toEqual(['new-project'])
  })

  it('sends at once while the page listens, and holds again once it has gone', () => {
    const { sent, menu } = commands()
    menu.listening()
    menu.command('about')
    expect(sent).toEqual(['about'])
    menu.gone()
    menu.command('copy-diagnostics')
    expect(sent).toEqual(['about'])
    menu.listening()
    expect(sent).toEqual(['about', 'copy-diagnostics'])
  })

  it('hears that the page listens from the interface’s own top frame only', () => {
    const handlers = new Map<string, (event: IpcMainEvent) => void>()
    const ipc = {
      on: (channel: string, handler: (event: IpcMainEvent) => void) =>
        handlers.set(channel, handler),
    } as unknown as IpcMain
    const { sent, menu } = commands()
    let top = false
    registerMenuHandlers(ipc, menu, () => top)
    expect([...handlers.keys()]).toEqual([CHANNELS.menuListening])
    menu.command('settings')
    handlers.get(CHANNELS.menuListening)!({} as IpcMainEvent)
    expect(sent, 'a frame that is not the top frame is not heard').toEqual([])
    top = true
    handlers.get(CHANNELS.menuListening)!({} as IpcMainEvent)
    expect(sent).toEqual(['settings'])
  })
})
