import type { JSX } from 'react'
import { describeState, type EngineState } from '../../shared/engine'

// One line, on every screen, saying what the engine is doing. A polite live
// region: a screen reader announces each change once without interrupting;
// nothing here moves. The sentences are the shared ones the log uses, so a
// person and a log line agree.
export default function EngineStatus({ state }: { state: EngineState | null }): JSX.Element {
  return (
    <p className="engine-status" role="status" aria-live="polite" aria-label="Engine">
      {state === null ? 'Checking the engine…' : describeState(state)}
    </p>
  )
}
