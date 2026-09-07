import { useEffect, useRef, type JSX } from 'react'
import type { EnginePin } from '../../shared/engine'

interface Props {
  open: boolean
  expected: EnginePin
  found: { version: string; protocol: number }
  onClose: () => void
}

// The engine the app found is not the one it was built for. Said once, in
// the page's own modal dialog: the browser owns the focus trap, Escape and
// the return of focus, and a screen reader reads it. (A native message box
// would block the main process on macOS and hold a quit on Linux.) The
// status line keeps saying it after this is dismissed.
export default function MismatchDialog({ open, expected, found, onClose }: Props): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const okRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      okRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="mismatch-title"
      aria-describedby="mismatch-desc"
      onCancel={() => onClose()}
      onClose={() => onClose()}
    >
      <h2 id="mismatch-title">Engine version mismatch</h2>
      <p id="mismatch-desc">
        This version of Legible Cities needs engine {expected.version} (protocol {expected.protocol}
        ) and found engine {found.version} (protocol {found.protocol}). The engine's features are
        off until the versions match: reinstall the app, or point LEGIBLE_ENGINE_PYTHON at an
        environment with engine {expected.version}.
      </p>
      <div className="actions">
        <button type="button" className="primary" ref={okRef} autoFocus onClick={() => onClose()}>
          OK
        </button>
      </div>
    </dialog>
  )
}
