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
    setBusy(true)
    setMessage(null)
    try {
      await onConfirm()
    } catch (error) {
      // Escape may have closed the dialog while the request was in flight.
      if (dialogRef.current?.open) {
        setMessage(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={() => onCancel()}
      onClose={() => setMessage(null)}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <Button ref={cancelRef} onClick={() => onCancel()}>
          Cancel
        </Button>
        <Button variant={variant} disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
