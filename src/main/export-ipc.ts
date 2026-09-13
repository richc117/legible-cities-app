// The export bridge's main side: four handlers over the exporter and two
// events to the window, on the pattern the engine bridge set. The page
// addresses an export by a token it minted; the answer travels as an event
// on the same channel as the progress and after it, because an invoke reply
// is not ordered against events. The reveal takes the token, never a path:
// the main process remembers what it wrote, and the page never sees where.
// Contract: specs/010-export/contracts/bridge.md.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import {
  copyChoice,
  validateExportChoice,
  type ExportAccepted,
  type ExportChoice,
  type ExportPreview,
  type ExportSettled,
} from '../shared/export'
import { EngineError, ERROR_CODES, type EngineErrorShape } from '../shared/engine'
import { validateId } from '../shared/project'
import type { Exporter } from './export'
import { badCall, TOKEN, toShape } from './ipc-shape'
import { RESERVED_NAME } from './paths'

export type Send = (channel: string, payload: unknown) => void

/** A refusal in the engine's shape, for an answer that is not an `Accepted`. */
const refusal = (what: string): EngineErrorShape =>
  new EngineError(ERROR_CODES.badCall, what, { kind: 'params', detail: what, hint: what }).toJSON()

/** What the handlers need from the exporter; a test hands in a fake. */
export type ExportSource = Pick<Exporter, 'start' | 'cancel' | 'fileOf' | 'onProgress' | 'preview'>

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

  handle(CHANNELS.exportRun, async (token, projectId, choice): Promise<ExportAccepted> => {
    // The token becomes a folder name under the engine home, so a name
    // Windows reserves is refused with the rest.
    if (typeof token !== 'string' || !TOKEN.test(token) || RESERVED_NAME.test(token))
      return badCall('an export needs an id')
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      return badCall('an export needs a project')
    // Every field of the choice against the engine's own rules, and a copy
    // with nothing else on it, before the exporter or the engine sees it.
    const problem = validateExportChoice(choice)
    if (problem !== null) return badCall(problem)
    let started: ReturnType<Exporter['start']>
    try {
      started = exporter.start(token, projectId, copyChoice(choice as ExportChoice))
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

  // The preview's plan: answered, never thrown, so the engine's refusal
  // keeps its `data` on the way to the sentence the tab shows.
  handle(CHANNELS.exportPreview, async (projectId, choice): Promise<ExportPreview> => {
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      return { ok: false, error: refusal('a preview needs a project') }
    const problem = validateExportChoice(choice)
    if (problem !== null) return { ok: false, error: refusal(problem) }
    return exporter.preview(projectId, copyChoice(choice as ExportChoice))
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
