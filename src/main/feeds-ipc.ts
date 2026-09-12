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
import { PickedPaths } from './picked'

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

const IPV4_DOTTED = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/

/** Whether an IPv4 address, given its two leading octets, is this machine's or its network's. */
function isPrivateIPv4(a: number, b: number): boolean {
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/**
 * Parse an IPv6 literal, already bracket-stripped and lowercased the way
 * `URL.hostname` hands one back, into its eight 16-bit groups. Expands one
 * `::` run and a trailing embedded IPv4 address alike (`::ffff:127.0.0.1`,
 * mapped or the deprecated compatible form), because that is the shape an
 * IPv4-mapped address keeps even after `new URL()` has normalised it to
 * hex groups. Null for anything that is not a well-formed IPv6 literal;
 * this parses `URL.hostname`'s own output, not arbitrary text.
 */
function parseIPv6(host: string): number[] | null {
  if (!host.includes(':')) return null
  const sides = host.split('::')
  if (sides.length > 2) return null
  const side = (text: string): number[] | null => {
    if (text === '') return []
    const parts = text.split(':')
    const last = parts[parts.length - 1]
    if (parts.slice(0, -1).some((p) => p.includes('.'))) return null
    if (last.includes('.')) {
      const v4 = IPV4_DOTTED.exec(last)
      if (v4 === null) return null
      const octets = v4.slice(1).map(Number)
      if (octets.some((n) => n > 255)) return null
      const [a, b, c, d] = octets
      parts.splice(-1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16))
    }
    if (parts.some((p) => !HEX_GROUP.test(p))) return null
    return parts.map((p) => parseInt(p, 16))
  }
  const head = side(sides[0])
  const tail = sides.length === 2 ? side(sides[1]) : []
  if (head === null || tail === null) return null
  const missing = 8 - head.length - tail.length
  if (sides.length === 1 ? missing !== 0 : missing < 0) return null
  return [...head, ...Array(missing).fill(0), ...tail]
}

/**
 * Hosts a feed address may not name: the machine itself and the networks
 * around it. The engine fetches what it is told and answers whether it got
 * a zip and how big, which is an oracle on the local network for a page
 * that has gone hostile; a person's feed is published on a public host.
 *
 * An IPv6 literal is resolved to its full address rather than matched by
 * prefix, because an IPv4-mapped address names the same machine a plain
 * IPv4 one does, in every private range this guards, not only loopback -
 * and `new URL()` normalises a written-out mapped address into exactly
 * that hex form on its own, unasked.
 */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host === '' || host === '0.0.0.0')
    return true
  const v4 = IPV4_DOTTED.exec(host)
  if (v4 !== null) return isPrivateIPv4(Number(v4[1]), Number(v4[2]))
  const groups = parseIPv6(host)
  if (groups === null) return false
  const zero = (n: number): boolean => n === 0
  if (groups.slice(0, 7).every(zero) && groups[7] <= 1) return true // :: and ::1
  if ((groups[0] & 0xfe00) === 0xfc00) return true // fc00::/7, unique local
  if ((groups[0] & 0xffc0) === 0xfe80) return true // fe80::/10, link-local
  const mapped = groups.slice(0, 5).every(zero) && groups[5] === 0xffff
  const compatible = groups.slice(0, 6).every(zero)
  if (mapped || compatible) return isPrivateIPv4(groups[6] >> 8, groups[6] & 0xff)
  return false
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
 * zip into the engine's home without bound on one consent. The class moved
 * to `./picked` when Settings needed the same discipline for its two
 * folders (A1-04); it is re-exported here because it arrived with the
 * feeds and is imported from here.
 */
export { PickedPaths }

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
