import { useEffect, useId, useRef, useState, type JSX } from 'react'
import Button from './kit/Button'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  /** Performs the action; a rejection's message is shown and the dialog stays open. */
  onConfirm: () => Promise<void>
  onCancel: () => void
  /** The confirm button's look: destructive for a delete, primary for a re-layout. */
  variant?: 'destructive' | 'primary'
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  variant = 'destructive',
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // Ids of this dialog's own: a screen can hold two of these (the delete and
  // the re-layout), and a shared id would name the wrong one.
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // While the action runs, neither button takes a press and Escape does not
  // cancel: the action cannot be taken back, and a dialog that closed
  // saying "cancelled" over a project already deleted would be a lie. Read
  // in the same tick as a press, so a held Enter's repeats are refused too.
  // Both buttons stay focusable (`aria-disabled`, not `disabled`), because
  // Chromium blurs a disabled element and a modal would be left with focus
  // nowhere for a refusal's alert to be read against (A6-07).
  const busyRef = useRef(false)
  const closedWhileBusy = useRef(false)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })

  // showModal() makes the browser own modality, the focus trap, Escape and
  // the return of focus to the opener; the open prop only drives it.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
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
    busyRef.current = true
    closedWhileBusy.current = false
    setBusy(true)
    setMessage(null)
    try {
      await onConfirm()
    } catch (error) {
      // The platform may have closed the dialog while the request was in
      // flight (a second Escape closes a modal whatever its cancel says).
      if (dialogRef.current?.open) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      busyRef.current = false
      setBusy(false)
      // Closed on its own while the action ran, and the parent still holds
      // it open: now that the action has finished, the parent is told, so
      // its state and the element agree again.
      if (closedWhileBusy.current && openRef.current && dialogRef.current?.open !== true) onCancel()
      closedWhileBusy.current = false
    }
  }

  const cancel = (): void => {
    if (!busyRef.current) onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        if (busyRef.current) {
          event.preventDefault()
          return
        }
        onCancel()
      }}
      onClose={() => {
        setMessage(null)
        if (busyRef.current) closedWhileBusy.current = true
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
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
