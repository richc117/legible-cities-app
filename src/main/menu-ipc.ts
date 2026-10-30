// The menu's commands on their way to the page (issue 554), main side.
//
// A command can be chosen when no page is there to hear it: on macOS with
// no window open, where the choice opens one, and in the moment between a
// window's load and the page subscribing. So main holds the last command
// until the page says it listens, and sends it then, on the same channel as
// every other command: the page sees one ordered stream of events and never
// an invoke's reply racing them (rules/main.md, "Ordering over the bridge").
//
// Who listens is the frame that said so, and a command is sent only while
// the window's main frame is still that frame. A page stops listening when
// a navigation of its main frame to another document commits - not when one
// starts, since the window refuses a navigation away (a file dropped on it,
// an outside address) after it has started, and the page that stays would
// never say again that it listens - and when its renderer dies or its
// window closes. A held command is a choice made a moment ago: one older
// than `HELD_MS` is dropped rather than acted on, and one made over a crash
// is not meant for the page that replaces it.
//
// No Electron import beyond types, so the rule is tested without a session.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import type { MenuCommand } from '../shared/menu'
import { guardedHandle } from './ipc-shape'

/** How long a held command waits for a page to listen before it is dropped. */
export const HELD_MS = 10_000

export interface MenuCommandsDeps {
  /** Deliver to the app's window. */
  send: (command: MenuCommand) => void
  /** Whether the frame that said it listens is still the window's main frame. */
  current: (frame: unknown) => boolean
  /** The clock, in milliseconds. */
  now: () => number
}

export class MenuCommands {
  readonly #deps: MenuCommandsDeps
  /** The frame that said it listens, or null. */
  #listener: unknown = null
  #pending: { command: MenuCommand; at: number } | null = null

  constructor(deps: MenuCommandsDeps) {
    this.#deps = deps
  }

  /** A command chosen: sent now if the page listens, else held, the latest winning. */
  command(command: MenuCommand): void {
    if (this.#listener !== null && this.#deps.current(this.#listener)) {
      this.#deps.send(command)
      return
    }
    this.#pending = { command, at: this.#deps.now() }
  }

  /** A page subscribed, from this frame: whatever was held, if still fresh, is sent once. */
  listening(frame: unknown): void {
    this.#listener = frame
    const pending = this.#pending
    this.#pending = null
    if (pending === null || this.#deps.now() - pending.at > HELD_MS) return
    if (this.#deps.current(frame)) this.#deps.send(pending.command)
    else this.#pending = pending
  }

  /** The page's main frame went to another document, or its window closed. */
  gone(): void {
    this.#listener = null
  }

  /** The page's renderer died: nothing held is meant for the page that replaces it. */
  crashed(): void {
    this.#listener = null
    this.#pending = null
  }
}

/**
 * The page's word that it listens, from the interface's own top frame only,
 * through the one guard every handler has. The held command goes out as an
 * event, before the reply, which carries nothing.
 */
export function registerMenuHandlers(
  ipcMain: IpcMain,
  commands: MenuCommands,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = guardedHandle(ipcMain, isTopFrame)
  handle(CHANNELS.menuListening, async (event) => {
    commands.listening(event.senderFrame)
  })
}
