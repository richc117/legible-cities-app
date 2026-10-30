import { useRef, useState, type JSX } from 'react'
import { isDown, QUITTING_REASON, type EngineState } from '../../shared/engine'
import { messageOf } from '../../shared/errors'
import { installGuideNotOpened } from './FirstRunDialog'
import Button from './kit/Button'
import { SAMPLES_HEADING_ID } from './SampleCities'

// Something to press when the engine is down (issue 562), under the Sample
// cities heading and the sentence that says why they are not listed: the
// next step first, then help (DESIGN.md section 11). "Try again" where a
// start can work, "Copy diagnostics" here rather than two screens away in
// Settings, and the first-run dialog's "How to install", drawn as a link
// because it leaves the app for the install document.
//
// Only the line under the buttons is new speech, and only for what a press
// here did: a copy, a refused retry, an install document that would not
// open. A retry that starts is said by the header's status line, which
// reads "Starting the engine.", so nothing here says it again.

/** Which of the actions the region offers, or null for none. */
export interface DownActions {
  /** Whether "Try again" is offered: only where the state says a start can help. */
  retry: boolean
}

/**
 * What the samples region offers while the engine is not coming back by
 * itself, or null while it is on its way, up, or stopping for the app's own
 * quit, which is no failure and has nothing to offer. "Try again" follows
 * the state's own `retryable`: never with no interpreter at all, never for a
 * mismatch, which would find the same version, and never for the quit.
 */
export function downActions(engine: EngineState | null): DownActions | null {
  if (engine === null || !isDown(engine)) return null
  if (engine.state === 'stopped' && engine.reason === QUITTING_REASON) return null
  if (engine.state === 'stopped' || engine.state === 'unavailable')
    return { retry: engine.retryable }
  return { retry: false }
}

/** What the line says when the bridge itself failed the retry, not the supervisor. */
export const retryNotAsked = (why: string): string =>
  `The engine could not be asked to start again: ${why}.`

interface Props {
  actions: DownActions
  /** The bridge's retry: null once the engine is starting, else why not. */
  onRetry: () => Promise<string | null>
  /** `copyDiagnostics` from Settings, over the bridge: the sentence to say, either way. */
  onCopyDiagnostics: () => Promise<string>
  onOpenInstallGuide: () => Promise<void>
}

export default function EngineDownActions({
  actions,
  onRetry,
  onCopyDiagnostics,
  onOpenInstallGuide,
}: Props): JSX.Element {
  const [said, setSaid] = useState<string | null>(null)
  // A second press while the first is on its way would copy, or start, twice.
  const copying = useRef(false)
  const retrying = useRef(false)

  const retry = (): void => {
    if (retrying.current) return
    retrying.current = true
    setSaid(null)
    // A retry that starts takes this region's buttons with the state that
    // drew them, and Chromium drops focus from a removed element to the
    // body (rules/renderer.md): it is handed to the region's heading first,
    // which stays.
    document.getElementById(SAMPLES_HEADING_ID)?.focus()
    void onRetry()
      .then(
        (why) => {
          if (why !== null) setSaid(why)
        },
        (error: unknown) => setSaid(retryNotAsked(messageOf(error))),
      )
      .finally(() => {
        retrying.current = false
      })
  }

  const copy = (): void => {
    if (copying.current) return
    copying.current = true
    setSaid(null)
    void onCopyDiagnostics()
      .then(setSaid)
      .finally(() => {
        copying.current = false
      })
  }

  const openGuide = (): void => {
    setSaid(null)
    onOpenInstallGuide().catch((error: unknown) => {
      setSaid(installGuideNotOpened(messageOf(error)))
    })
  }

  return (
    <>
      <div className="toolbar">
        {actions.retry && (
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
        )}
        <Button onClick={copy}>Copy diagnostics</Button>
        <button type="button" className="inline-link" onClick={openGuide}>
          How to install
        </button>
      </div>
      <p className="message" role="status" aria-live="polite">
        {said}
      </p>
    </>
  )
}
