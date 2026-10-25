// One of the bridge's record writes, held in the main process until a test
// lets it through (issue 388), so a test can press a button while a write
// to the record is still on its way.
//
// The store answers a write in a few milliseconds, and what a test wants to
// see is a press landing inside them: a field committed by leaving it for
// "Lay out", whose write the run must see. Without a hold the press lands
// inside them only some of the time, and a test of it passes by luck as
// often as by right.
//
// The handler is replaced where Electron keeps it, `ipcMain`'s own map of
// invoke handlers. That is not a public API: Electron has kept the map under
// that name since `ipcMain.handle` came in, and the 44.7.1 framework this runs
// against still names it. A release that moves it fails here, by
// name, rather than letting a test go on without a hold and pass for the
// wrong reason. The app's own handler still runs, with every check it
// makes, once the write is let through, and is put back as it is.
//
// **A held write holds the reads sent after it** (spec 037). In the app a
// write reaches the store's per-project queue in the turn its message
// arrives, and `projects.get` - what a run reads its inputs by - waits in
// that queue behind it. A write held here has not reached the queue, so a
// read sent after it would otherwise go ahead of it, which the app never
// does. So while a held write has arrived and not been let through, a read
// waits for it too, and is handed to the app's own handler after it, in the
// order the two arrived. A read sent before any held write arrived goes at
// once, as it would in the app.

import type { ElectronApplication } from '@playwright/test'
import { CHANNELS } from '../../src/shared/api'

export interface HeldWrites {
  /** How many writes on the channel have arrived and been held. */
  arrived(): Promise<number>
  /** Let every held write through to the app's own handler, which answers the rest at once. */
  release(): Promise<void>
}

export async function holdWrites(app: ElectronApplication, channel: string): Promise<HeldWrites> {
  await app.evaluate(
    ({ ipcMain }, [name, getChannel]) => {
      type Handler = (...args: unknown[]) => unknown
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })
        ._invokeHandlers
      const own = handlers?.get(name)
      if (handlers === undefined || own === undefined)
        throw new Error(`ipcMain keeps no handler for ${name} where this test holds one`)
      type Hold = { arrived: number; released: boolean; opened: Promise<void>; release: () => void }
      const state = globalThis as unknown as {
        heldWrites?: Record<string, Hold>
        heldReadsInstalled?: boolean
      }
      const holds = (state.heldWrites ??= {})
      let open!: () => void
      const opened = new Promise<void>((resolve) => {
        open = resolve
      })
      holds[name] = {
        arrived: 0,
        released: false,
        opened,
        release: () => {
          holds[name].released = true
          handlers.set(name, own)
          open()
        },
      }
      handlers.set(name, async (...args: unknown[]) => {
        holds[name].arrived += 1
        await opened
        return own(...args)
      })
      // The reads, once: each waits for every held write that has arrived
      // before it and not yet been let through, and then goes to the app's
      // own handler (see the note at the top).
      if (state.heldReadsInstalled !== true) {
        const read = handlers.get(getChannel)
        if (read === undefined)
          throw new Error(`ipcMain keeps no handler for ${getChannel} where this test holds one`)
        handlers.set(getChannel, async (...args: unknown[]) => {
          const ahead = Object.values(holds)
            .filter((hold) => hold.arrived > 0 && !hold.released)
            .map((hold) => hold.opened)
          if (ahead.length > 0) await Promise.all(ahead)
          return read(...args)
        })
        state.heldReadsInstalled = true
      }
    },
    [channel, CHANNELS.projectsGet] as const,
  )
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
