import type { Inspection, Methods } from '../../../shared/protocol'

// One inspection per feed per session. Reading a feed is a long request
// (the engine reads its tables; New York takes a second or two), and the
// answer does not change while the app is open unless the feed is added
// again, which forgets it here. The anchor is the machine's date, as the
// first layout's is, so the day shown is the day a layout would store.

export interface InspectClient {
  request(
    method: 'feeds.inspect',
    params: Methods['feeds.inspect']['params'],
  ): { result: Promise<Inspection> }
}

const cache = new Map<string, Promise<Inspection>>()

export function inspectionFor(
  client: InspectClient,
  key: string,
  anchor: string,
): Promise<Inspection> {
  const held = cache.get(key)
  if (held !== undefined) return held
  const pending = client.request('feeds.inspect', { key, anchor }).result
  cache.set(key, pending)
  // A refusal is not kept: the next opening asks again.
  pending.catch(() => cache.delete(key))
  return pending
}

/** Forget a feed's inspection: it was added again, or removed. */
export function forgetInspection(key: string): void {
  cache.delete(key)
}

/** For a test: nothing remembered. */
export function forgetAllInspections(): void {
  cache.clear()
}
