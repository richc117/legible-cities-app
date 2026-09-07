import { useEffect, useRef, useState, type JSX } from 'react'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  /** Performs the action; a rejection's message is shown and the dialog stays open. */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
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
      aria-labelledby="confirm-title"
      aria-describedby="confirm-desc"
      onCancel={() => onCancel()}
      onClose={() => setMessage(null)}
    >
      <h2 id="confirm-title">{title}</h2>
      <p id="confirm-desc">{description}</p>
      {message && (
        <p className="message error" role="alert">
          {message}
        </p>
      )}
      <div className="actions">
        <button type="button" ref={cancelRef} autoFocus onClick={() => onCancel()}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
