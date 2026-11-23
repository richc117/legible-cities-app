// How a capture window is ended on a quit (issue 755): every window is
// destroyed whatever the page inside it does, and every capture is tried
// whatever another one does. It holds only the logic, with no Electron
// import, so that it can be tested with stand-ins; capture-window.ts uses it.

/** The slice of a BrowserWindow that ending a capture needs. */
export interface CaptureWindowLike {
  isDestroyed(): boolean
  webContents: {
    isDestroyed(): boolean
    debugger: { isAttached(): boolean; detach(): void }
  }
  destroy(): void
}

/** Detach the debugger if the page is still there, then destroy the window. */
export function destroyCaptureWindow(window: CaptureWindowLike): void {
  if (window.isDestroyed()) return
  try {
    const contents = window.webContents
    if (!contents.isDestroyed()) {
      const dbg = contents.debugger
      if (dbg.isAttached()) dbg.detach()
    }
  } catch {
    // A page on its way out can refuse any of these reads and calls; the window goes anyway.
  }
  window.destroy()
}

/** Call `destroy` on every page, whatever one of them does; say each failure once. */
export function destroyEach(
  pages: Iterable<{ destroy(): void }>,
  say: (message: string) => void,
): void {
  // Walk a copy: nothing here should depend on whether a page's end changes the set.
  for (const page of [...pages]) {
    try {
      page.destroy()
    } catch (error) {
      try {
        const message = error instanceof Error ? error.message : String(error)
        say(`a capture did not end on quit: ${message}`)
      } catch {
        // A logger that throws, or an error that cannot be put into words, must not stop the walk.
      }
    }
  }
}
