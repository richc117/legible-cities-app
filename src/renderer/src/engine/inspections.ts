import type { FeedRecord, Inspection, Methods } from '../../../shared/protocol'

// One inspection per feed and day per session. Reading a feed is a long
// request (the engine reads its tables, and downloads them first when the
// feed is not on this machine; New York takes a second or two), and the
// answer does not change while the app is open unless the feed is added
// again or removed, which forget it here. The anchor is the machine's
// date, as the first layout's is, so the day shown is the day a layout
// would store; a new day is a new entry.

export interface InspectClient {
  request(
    method: 'feeds.inspect',
    params: Methods['feeds.inspect']['params'],
  ): { result: Promise<Inspection> }
}

export interface ListClient {
  request(method: 'feeds.list'): { result: Promise<{ feeds: FeedRecord[] }> }
}

let listed: Promise<FeedRecord[]> | null = null

/** The registry as the engine lists it, read once per session; a refusal is not kept. */
export function feedRecordFor(client: ListClient, key: string): Promise<FeedRecord | null> {
  listed ??= client.request('feeds.list').result.then((r) => r.feeds)
  const pending = listed
  pending.catch(() => {
    if (listed === pending) listed = null
  })
  return pending.then((feeds) => feeds.find((f) => f.key === key) ?? null)
}

/** The registry may have changed: a feed added or removed. */
export function forgetFeedList(): void {
  listed = null
}

const cache = new Map<string, Promise<Inspection>>()

export function inspectionFor(
  client: InspectClient,
  key: string,
  anchor: string,
): Promise<Inspection> {
  const slot = `${key}@${anchor}`
  const held = cache.get(slot)
  if (held !== undefined) return held
  const pending = client.request('feeds.inspect', { key, anchor }).result
  cache.set(slot, pending)
  // A refusal is not kept: the next opening asks again.
  pending.catch(() => cache.delete(slot))
  return pending
}

/** Forget a feed's inspections, every day's: it was added again, or removed. */
export function forgetInspection(key: string): void {
  for (const slot of [...cache.keys()]) if (slot.startsWith(`${key}@`)) cache.delete(slot)
}

/** For a test: nothing remembered. */
export function forgetAllInspections(): void {
  cache.clear()
  listed = null
}
