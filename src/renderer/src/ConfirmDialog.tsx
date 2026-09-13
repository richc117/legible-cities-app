import { useEffect, useId, useRef, useState, type JSX } from 'react'
import Button from './kit/Button'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  /** Performs the action; a rejection's message is shown and the dialog stays open. */
  onConfirm: () => Promise<void>
  /** Cancelled before the action, or the element closed on its own (the platform's second Escape). */
  onCancel: () => void
  /** The confirm button's look: destructive for a delete, primary for a re-layout. */
  variant?: 'destructive' | 'primary'
  /** What is happening while the action runs, in the caller's words: "Removing Metro de Prueba…". */
  busyLabel: string
  /**
   * A refusal that arrived after the platform closed the dialog while the
   * action ran, for the caller to say beneath; never called once the
   * dialog, and so the screen that asked, is gone.
   */
  onLateError?: (message: string) => void
}

/** The sentence a running confirmation says after its busy label. */
export const BUSY_SENTENCE = 'It cannot be stopped.'

/** What a press on Cancel does: cancels before the action, nothing while it runs. */
export function cancelPress(busy: boolean): 'cancel' | 'refuse' {
  return busy ? 'refuse' : 'cancel'
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = 'destructive',
  busyLabel,
  onLateError,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Ids of this dialog's own: a screen can hold two of these (the delete and
  // the re-layout), and a shared id would name the wrong one.
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // While the action runs (A6-07) the dialog stays modal and takes nothing:
  // both buttons keep their names and their focus (`aria-disabled`, not
  // `disabled`, which Chromium blurs, leaving a modal with focus nowhere),
  // are drawn unavailable, and refuse every press, a held Enter's repeats
  // included; the first Escape is refused too; and a status line says
  // what is running and that it cannot be stopped. The action cannot be
  // taken back, so nothing here may look as if it had been.
  //
  // The platform still closes a modal on a second Escape whatever its
  // cancel event says. The caller is told at once, so its state and the
  // element agree and the next opening opens; `generation` counts openings,
  // so an action that finishes after that touches nothing of a dialog opened
  // since, and a refusal it brings is handed to the caller only while this
  // dialog is still mounted.
  const busyRef = useRef(false)
  const generation = useRef(0)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // showModal() makes the browser own modality, the focus trap, Escape and
  // the return of focus to the opener; the open prop only drives it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      generation.current += 1
      busyRef.current = false
      setBusy(false)
      setMessage(null)
      dialog.showModal()
      // Cancel is the safe default, and React's autoFocus only acts at
      // mount, when the dialog is still hidden.
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const confirm = async (): Promise<void> => {
    if (busyRef.current) return
    const mine = generation.current
    busyRef.current = true
    setBusy(true)
    setMessage(null)
    try {
      await onConfirm()
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      if (!mounted.current) return
      if (generation.current === mine && dialogRef.current?.open === true) setMessage(said)
      else onLateError?.(said)
    } finally {
      if (mounted.current && generation.current === mine) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  const cancel = (): void => {
    if (cancelPress(busyRef.current) === 'cancel') onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Before the action, Escape is a cancel; while it runs it is refused.
        if (busyRef.current) {
          event.preventDefault()
          return
        }
        onCancel()
      }}
      onClose={() => {
        // Closed on its own - the platform's second Escape - while the
        // caller still holds it open: the caller is told at once.
        if (openRef.current) onCancel()
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <p className="message" role="status">
        {busy ? `${busyLabel} ${BUSY_SENTENCE}` : ''}
      </p>
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <Button ref={cancelRef} aria-disabled={busy} onClick={cancel}>
          Cancel
        </Button>
        <Button variant={variant} aria-disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
