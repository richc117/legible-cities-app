// One of the bridge's record writes, held in the main process until a test
// lets it through (issue 388), so a test can press a button while a write
// to the record is still on its way.
//
// The store answers a write in a few milliseconds, and what a test wants to
// see is a press landing inside them: a field committed by leaving it for
// "Lay out", whose write the run must wait for. Without a hold the press
// lands inside them only some of the time, and a test of it passes by luck
// as often as by right.
//
// The handler is replaced where Electron keeps it, `ipcMain`'s own map of
// invoke handlers. That is not a public API: Electron has kept the map under
// that name since `ipcMain.handle` came in, and the 44.5.1 framework this was
// written against still names it. A release that moves it fails here, by
// name, rather than letting a test go on without a hold and pass for the
// wrong reason. The app's own handler still runs, with every check it
// makes, once the write is let through, and is put back as it is.

import type { ElectronApplication } from '@playwright/test'

export interface HeldWrites {
  /** How many writes on the channel have arrived and been held. */
  arrived(): Promise<number>
  /** Let every held write through to the app's own handler, which answers the rest at once. */
  release(): Promise<void>
}

export async function holdWrites(app: ElectronApplication, channel: string): Promise<HeldWrites> {
  await app.evaluate(({ ipcMain }, name) => {
    type Handler = (...args: unknown[]) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })
      ._invokeHandlers
    const own = handlers?.get(name)
    if (handlers === undefined || own === undefined)
      throw new Error(`ipcMain keeps no handler for ${name} where this test holds one`)
    const holds = ((
      globalThis as unknown as {
        heldWrites?: Record<string, { arrived: number; release: () => void }>
      }
    ).heldWrites ??= {})
    let open!: () => void
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    holds[name] = {
      arrived: 0,
      release: () => {
        handlers.set(name, own)
        open()
      },
    }
    handlers.set(name, async (...args: unknown[]) => {
      holds[name].arrived += 1
      await opened
      return own(...args)
    })
  }, channel)
  return {
    arrived: () =>
      app.evaluate(
        (_electron, name) =>
          (globalThis as unknown as { heldWrites?: Record<string, { arrived: number }> })
            .heldWrites?.[name]?.arrived ?? 0,
        channel,
      ),
    release: () =>
      app.evaluate((_electron, name) => {
        ;(
          globalThis as unknown as { heldWrites?: Record<string, { release: () => void }> }
        ).heldWrites?.[name]?.release()
      }, channel),
  }
}
