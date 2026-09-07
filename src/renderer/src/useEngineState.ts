import { useEffect, useState } from 'react'
import type { EngineState } from '../../shared/engine'

// The engine's state as the main process reports it: every change as it
// happens, and the current one for a screen that mounted after a change.
export function useEngineState(): EngineState | null {
  const [state, setState] = useState<EngineState | null>(null)

  useEffect(() => {
    let cancelled = false
    const off = window.api.engine.onState((next) => {
      if (!cancelled) setState(next)
    })
    window.api.engine
      .state()
      .then((current) => {
        if (!cancelled) setState((known) => known ?? current)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      off()
    }
  }, [])

  return state
}
