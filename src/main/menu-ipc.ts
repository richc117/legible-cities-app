// The menu's commands on their way to the page (issue 554), main side.
//
// A command can be chosen when no page is there to hear it: on macOS with
// no window open, where the choice opens one, and in the moment between a
// window's load and the page subscribing. So main holds the last command
// until the page says it listens, and sends it then, on the same channel as
// every other command: the page sees one ordered stream of events and never
// an invoke's reply racing them (rules/main.md, "Ordering over the bridge").
// A page that goes - its main frame navigates, or its renderer dies, or the
// window closes - is not listening any more, until its successor says so.
//
// No Electron import beyond types, so the rule is tested without a session.

import type { IpcMain, IpcMainEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import type { MenuCommand } from '../shared/menu'

export class MenuCommands {
  readonly #send: (command: MenuCommand) => void
  #listening = false
  #pending: MenuCommand | null = null

  /** `send` delivers to the app's window, which is there whenever the page listens. */
  constructor(send: (command: MenuCommand) => void) {
    this.#send = send
  }

  /** A command chosen: sent now if the page listens, else held, the latest winning. */
  command(command: MenuCommand): void {
    if (!this.#listening) {
      this.#pending = command
      return
    }
    this.#send(command)
  }

  /** The page subscribed: whatever was held is sent, once. */
  listening(): void {
    this.#listening = true
    const pending = this.#pending
    this.#pending = null
    if (pending !== null) this.#send(pending)
  }

  /** The page went; commands are held until the next one listens. */
  gone(): void {
    this.#listening = false
  }
}

/**
 * The page's word that it listens, from the interface's own top frame only;
 * any other frame's is ignored, as every handler refuses one.
 */
export function registerMenuHandlers(
  ipcMain: IpcMain,
  commands: MenuCommands,
  isTopFrame: (event: IpcMainEvent) => boolean,
): void {
  ipcMain.on(CHANNELS.menuListening, (event) => {
    if (isTopFrame(event)) commands.listening()
  })
}
