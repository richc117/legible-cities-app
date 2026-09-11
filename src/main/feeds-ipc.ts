// The feeds bridge's main side, and the gate in front of the engine's
// registry methods. Two things only the main process can do: open the
// platform's file chooser, the one native dialog the rules keep (a page
// cannot choose a file), and decide what the engine may be asked. A path
// the chooser answered is remembered here, so a feeds.add that names any
// other path is refused before the engine sees it; a feeds.remove of a feed
// a project still names is refused the same way, naming how many.
// Contract: specs/014-feeds/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { basename } from 'node:path'
import { CHANNELS, type PickedZip } from '../shared/api'

/** What the handler needs from Electron's dialog; a test hands in a fake. */
export type OpenZipDialog = () => Promise<string | null>

/** What the guard needs from the project store: the feeds projects name. */
export type FeedsInUse = () => Promise<string[]>

/** A guard's answer: null to let the request through, else the sentence to refuse it with. */
export type Guard = (
  method: string,
  params: Record<string, unknown> | undefined,
) => Promise<string | null>

const URL_PATTERN = /^https?:\/\/\S+$/

export class PickedPaths {
  readonly #paths = new Set<string>()

  remember(path: string): void {
    this.#paths.add(path)
  }

  has(path: string): boolean {
    return this.#paths.has(path)
  }
}

/**
 * The gate for the registry methods. Everything else passes untouched:
 * the typed client is what bounds the rest, and this is about the two
 * requests that reach the filesystem and the registry on a person's behalf.
 */
export function registryGuard(picked: PickedPaths, inUse: FeedsInUse): Guard {
  return async (method, params) => {
    if (method === 'feeds.add') {
      const source = params?.source
      if (typeof source !== 'string' || source === '') return 'a feed needs a source'
      if (URL_PATTERN.test(source)) return null
      if (!picked.has(source)) return 'a feed is added from a file chosen in the app, or from a URL'
      return null
    }
    if (method === 'feeds.remove') {
      const key = params?.key
      if (typeof key !== 'string') return 'a feed to remove needs a key'
      const users = (await inUse()).filter((feed) => feed === key).length
      if (users > 0) {
        return users === 1
          ? 'One project uses this feed; delete the project first.'
          : `${users} projects use this feed; delete them first.`
      }
      return null
    }
    return null
  }
}

export function registerFeedsHandlers(
  ipcMain: IpcMain,
  openZip: OpenZipDialog,
  picked: PickedPaths,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  ipcMain.handle(CHANNELS.feedsPickZip, async (event): Promise<PickedZip | null> => {
    if (!isTopFrame(event)) throw new Error('forbidden')
    const path = await openZip()
    if (path === null) return null
    picked.remember(path)
    // The page shows the name; the path is what it hands back to feeds.add.
    return { path, name: basename(path) }
  })
}
