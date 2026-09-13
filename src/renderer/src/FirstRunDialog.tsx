import { useEffect, useRef, useState, type JSX } from 'react'
import { failedTools, TOOL_NAMES, type FirstRunResult } from '../../shared/first-run'
import Button from './kit/Button'

// The first-run check of the bundled tools (A6-02, specs/026): a tool the
// app carries would not run. Said once per start, in the page's own modal
// dialog, as the engine mismatch is: the browser owns the focus trap,
// Escape and the return of focus, and a screen reader reads it. The Library
// is open behind it and everything that does not need the tool still works;
// Settings keeps saying what the check found after this is dismissed.

/**
 * The check's result as the main process reports it: every change as it
 * happens, and the current one for a screen that mounted after a change.
 * Null until the first answer.
 */
export function useFirstRun(): FirstRunResult | null {
  const [result, setResult] = useState<FirstRunResult | null>(null)
  useEffect(() => {
    let cancelled = false
    const off = window.api.firstRun.onChanged((next) => {
      if (!cancelled) setResult(next)
    })
    // A change that arrived first is newer than this answer.
    window.api.firstRun
      .get()
      .then((current) => {
        if (!cancelled) setResult((known) => known ?? current)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return result
}

/** The dialog's title: the tools that will not run, by name. */
export function firstRunTitle(result: FirstRunResult): string {
  const names = failedTools(result).map((tool) => TOOL_NAMES[tool])
  return `${names.join(' and ')} will not run`
}

interface Props {
  open: boolean
  result: FirstRunResult
  /** "Copy diagnostics", as Settings copies them; answers the sentence to show. */
  onCopyDiagnostics: () => Promise<string>
  onClose: () => void
}

export default function FirstRunDialog({
  open,
  result,
  onCopyDiagnostics,
  onClose,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const okRef = useRef<HTMLElement>(null)
  const copying = useRef(false)
  // Set while this component closes the dialog itself, so that close is not
  // taken for a person dismissing it: a dialog put away because another
  // must come first has not been seen.
  const closingItself = useRef(false)
  const [said, setSaid] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      okRef.current?.focus()
    } else if (!open && dialog.open) {
      closingItself.current = true
      dialog.close()
    }
  }, [open])

  const failed = failedTools(result)

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="first-run-title"
      aria-describedby="first-run-desc"
      onCancel={() => onClose()}
      onClose={() => {
        // Escape and OK both end here; only a close of the component's own
        // making is not the person's.
        if (closingItself.current) {
          closingItself.current = false
          return
        }
        onClose()
      }}
    >
      <h2 id="first-run-title">{firstRunTitle(result)}</h2>
      <div id="first-run-desc">
        {failed.map((tool) => {
          const check = result[tool]
          return check.outcome === 'failed' ? <p key={tool}>{check.sentence}</p> : null
        })}
        <p>
          The Library still opens, and everything that does not need{' '}
          {failed.map((tool) => TOOL_NAMES[tool]).join(' or ')} still works. Reinstalling the app
          usually puts it right; the install document says how.
        </p>
      </div>
      {failed.map((tool) => {
        const check = result[tool]
        return check.outcome === 'failed' && check.detail !== '' ? (
          <details key={tool} className="job-detail">
            <summary>Details: {TOOL_NAMES[tool]}</summary>
            <p>{check.detail}</p>
          </details>
        ) : null
      })}
      <p className="message" role="status" aria-live="polite">
        {said}
      </p>
      <div className="actions">
        <Button
          onClick={() => {
            // A second press while the first is gathering would copy twice.
            if (copying.current) return
            copying.current = true
            setSaid(null)
            void onCopyDiagnostics()
              .then(setSaid)
              .finally(() => {
                copying.current = false
              })
          }}
        >
          Copy diagnostics
        </Button>
        <Button
          onClick={() => {
            setSaid(null)
            window.api.firstRun.openInstallGuide().catch((error: unknown) => {
              setSaid(
                `The install document could not be opened: ${error instanceof Error ? error.message : String(error)}.`,
              )
            })
          }}
        >
          How to install
        </Button>
        <Button variant="primary" ref={okRef} onClick={() => onClose()}>
          OK
        </Button>
      </div>
    </dialog>
  )
}
