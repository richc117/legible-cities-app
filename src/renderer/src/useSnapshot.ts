import { useCallback, useSyncExternalStore } from 'react'

/** Something with a current value and a way to hear it change: a run. */
export interface Observable<S> {
  readonly snapshot: S
  subscribe(listener: (snapshot: S) => void): () => void
}

/**
 * A run's snapshot as React reads an outside store: the current one on
 * every render, and a render for every change (issue 433). Every source
 * replaces its snapshot object when it changes and hands back the same one
 * otherwise, which is what lets React compare two reads; a source that built
 * a fresh object on each read would render for ever. The first render after
 * a source is swapped is already the new source's.
 *
 * The same read serves as the server's snapshot, which only the tests that
 * draw to static markup ask for: the app never renders on a server.
 */
export function useSnapshot<S>(source: Observable<S>): S {
  const subscribe = useCallback(
    (listener: () => void): (() => void) => source.subscribe(() => listener()),
    [source],
  )
  const read = (): S => source.snapshot
  return useSyncExternalStore(subscribe, read, read)
}
