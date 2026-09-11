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

// Anything with a web scheme is judged as an address, whatever follows.
const URL_PATTERN = /^https?:\/\//i

/**
 * Hosts a feed address may not name: the machine itself and the networks
 * around it. The engine fetches what it is told and answers whether it got
 * a zip and how big, which is an oracle on the local network for a page
 * that has gone hostile; a person's feed is published on a public host.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '' || host === '0.0.0.0')
    return true
  if (
    host === '::1' ||
    host === '::' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  )
    return true
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (v4 === null) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** What is wrong with a feed address, or null. */
export function refuseUrl(source: string): string | null {
  let url: URL
  try {
    url = new URL(source)
  } catch {
    return 'a feed address must be a URL with its scheme'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return 'a feed address starts with http:// or https://'
  if (isLocalHost(url.hostname))
    return 'a feed address must name a public host, not this machine or its network'
  return null
}

/**
 * The paths the chooser answered, each good for one accepted add: a page
 * that repeats the add with a fresh key each time would otherwise copy the
 * zip into the engine's home without bound on one consent.
 */
export class PickedPaths {
  readonly #paths = new Set<string>()

  remember(path: string): void {
    this.#paths.add(path)
  }

  has(path: string): boolean {
    return this.#paths.has(path)
  }

  /** Spend the path: true when it was remembered, and now is not. */
  take(path: string): boolean {
    return this.#paths.delete(path)
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
      if (URL_PATTERN.test(source)) return refuseUrl(source)
      if (!picked.take(source))
        return 'a feed is added from a file chosen in the app, or from a URL'
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
