import { useEffect, useState } from 'react'

/** Something with a current value and a way to hear it change: a run. */
export interface Observable<S> {
  readonly snapshot: S
  subscribe(listener: (snapshot: S) => void): () => void
}

/** A run's snapshot as React state: the current one on mount, then every change. */
export function useSnapshot<S>(source: Observable<S>): S {
  const [snapshot, setSnapshot] = useState(source.snapshot)
  useEffect(() => {
    setSnapshot(source.snapshot)
    return source.subscribe(setSnapshot)
  }, [source])
  return snapshot
}
