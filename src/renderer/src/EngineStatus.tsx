import { useEffect, useState, type JSX } from 'react'
import { describeState, type EngineState } from '../../shared/engine'

// One line, on every screen, saying what the engine is doing. A polite live
// region: a screen reader announces each change once without interrupting;
// nothing here moves. The sentences are the shared ones the log uses, so a
// person and a log line agree.
export default function EngineStatus(): JSX.Element {
  const [state, setState] = useState<EngineState | null>(null)

  useEffect(() => {
    let cancelled = false
    const off = window.api.engine.onState((next) => {
      if (!cancelled) setState(next)
    })
    // The change that happened before this screen existed.
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

  return (
    <p className="engine-status" role="status" aria-live="polite" aria-label="Engine">
      {state === null ? 'Checking the engine…' : describeState(state)}
    </p>
  )
}
