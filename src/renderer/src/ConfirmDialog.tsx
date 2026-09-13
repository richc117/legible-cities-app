import { useEffect, useId, useRef, useState, type JSX } from 'react'
import Button from './kit/Button'

interface Props {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  /** Performs the action; a rejection's message is shown and the dialog stays open. */
  onConfirm: () => Promise<void>
  /** The dialog is gone without the action being taken, or with it still running. */
  onCancel: () => void
  /** The confirm button's look: destructive for a delete, primary for a re-layout. */
  variant?: 'destructive' | 'primary'
  /** What is happening while the action runs, in the caller's words: "Removing Metro de Prueba…". */
  busyLabel: string
  /**
   * A refusal that arrived after the dialog was closed while the action ran,
   * for the caller to say where it can; without one it is not shown.
   */
  onLateError?: (message: string) => void
}

/** The sentence a running confirmation says after its busy label. */
export const BUSY_SENTENCE = 'It cannot be stopped; closing this leaves it running.'

/** What a press on the secondary button does: cancel before the action, close while it runs. */
export function secondaryPress(busy: boolean): 'cancel' | 'close' {
  return busy ? 'close' : 'cancel'
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
  // While the action runs (A6-07):
  //
  // - The confirm button takes no press, a held Enter's repeats included,
  //   and stays focusable (`aria-disabled`, not `disabled`): Chromium blurs
  //   a disabled element, and a modal would be left with focus nowhere. It
  //   looks unavailable, and a sentence says what is running and that it
  //   cannot be stopped.
  // - The secondary button is "Close", never "Cancel": the action cannot be
  //   taken back, so closing claims nothing about it. It closes the dialog,
  //   the action carries on, and a refusal that arrives later goes to the
  //   caller through `onLateError`. A stalled engine can hold a request for
  //   minutes, and a dialog nobody can leave with a pointer for that long is
  //   worse than one that closes and says afterwards what happened.
  // - Escape closes it the same way.
  //
  // `busyRef` is read in the same tick as a press. `generation` counts
  // openings, so an action that finishes after its dialog was closed and
  // opened again - for another feed - touches nothing of the new one.
  const busyRef = useRef(false)
  const generation = useRef(0)
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
      if (generation.current === mine && dialogRef.current?.open === true) setMessage(said)
      else onLateError?.(said)
    } finally {
      if (generation.current === mine) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }

  const secondary = (): void => {
    if (secondaryPress(busyRef.current) === 'close') dialogRef.current?.close()
    else onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={() => {
        // Before the action, Escape is a cancel; while it runs the dialog
        // simply closes, and the close below tells the caller.
        if (!busyRef.current) onCancel()
      }}
      onClose={() => {
        // Closed on its own - Escape, Close, or the platform - while the
        // caller still holds it open: the caller is told at once, so its
        // state and the element agree and the next opening opens.
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
        <Button ref={cancelRef} onClick={secondary}>
          {busy ? 'Close' : 'Cancel'}
        </Button>
        <Button variant={variant} aria-disabled={busy} onClick={() => void confirm()}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
