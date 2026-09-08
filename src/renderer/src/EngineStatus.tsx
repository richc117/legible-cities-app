import type { JSX } from 'react'
import { describeState, type EngineState } from '../../shared/engine'
import Icon, { type IconName } from './icons/Icon'

// One line, on every screen, saying what the engine is doing. A polite live
// region: a screen reader announces each change once without interrupting
// and never hears the icon; nothing here moves. The sentences are the
// shared ones the log uses, so a person and a log line agree.
const ICONS: Record<EngineState['state'], IconName> = {
  starting: 'spinner',
  ready: 'check',
  restarting: 'warning',
  unavailable: 'warning',
  mismatched: 'warning',
  stopped: 'close',
}

export default function EngineStatus({ state }: { state: EngineState | null }): JSX.Element {
  const sentence = state === null ? 'Checking the engine…' : describeState(state)
  return (
    <p
      className="engine-status"
      role="status"
      aria-live="polite"
      aria-label="Engine"
      data-state={state?.state ?? 'starting'}
    >
      <Icon name={state ? ICONS[state.state] : 'spinner'} />
      <span>{sentence}</span>
    </p>
  )
}
