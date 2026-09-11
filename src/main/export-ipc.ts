// The export bridge's main side: three handlers over the exporter and two
// events to the window, on the pattern the engine bridge set. The page
// addresses an export by a token it minted; the answer travels as an event
// on the same channel as the progress and after it, because an invoke reply
// is not ordered against events. The reveal takes the token, never a path:
// the main process remembers what it wrote, and the page never sees where.
// Contract: specs/010-export/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import { isOfferedPreset, type ExportAccepted, type ExportSettled } from '../shared/export'
import { validateId } from '../shared/project'
import type { Exporter } from './export'
import { badCall, TOKEN, toShape } from './ipc-shape'
import { RESERVED_NAME } from './paths'

export type Send = (channel: string, payload: unknown) => void

/** What the handlers need from the exporter; a test hands in a fake. */
export type ExportSource = Pick<Exporter, 'start' | 'cancel' | 'fileOf' | 'onProgress'>

export function registerExportHandlers(
  ipcMain: IpcMain,
  exporter: ExportSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
  send: Send,
  /** Show a file in the platform's file browser: `shell.showItemInFolder`. */
  reveal: (path: string) => void,
): () => void {
  const handle = (channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler(...args)
    })
  }

  handle(CHANNELS.exportRun, async (token, projectId, preset): Promise<ExportAccepted> => {
    // The token becomes a folder name under the engine home, so a name
    // Windows reserves is refused with the rest.
    if (typeof token !== 'string' || !TOKEN.test(token) || RESERVED_NAME.test(token))
      return badCall('an export needs an id')
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      return badCall('an export needs a project')
    if (!isOfferedPreset(preset)) return badCall('the app does not offer that preset')
    let started: ReturnType<Exporter['start']>
    try {
      started = exporter.start(token, projectId, preset)
    } catch (error) {
      return { accepted: false, error: toShape(error) }
    }
    started.result.then(
      (value) => {
        const settled: ExportSettled = { id: token, ok: true, result: value }
        send(CHANNELS.exportSettled, settled)
      },
      (error: unknown) => {
        const settled: ExportSettled = { id: token, ok: false, error: toShape(error) }
        send(CHANNELS.exportSettled, settled)
      },
    )
    return { accepted: true }
  })

  handle(CHANNELS.exportCancel, async (token) => {
    if (typeof token === 'string') exporter.cancel(token)
  })

  handle(CHANNELS.exportReveal, async (token) => {
    if (typeof token !== 'string') return
    const file = exporter.fileOf(token)
    if (file !== null) reveal(file)
  })

  return exporter.onProgress((progress) => send(CHANNELS.exportProgress, progress))
}
