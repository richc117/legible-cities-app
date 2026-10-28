// The export bridge's main side: the handlers over the exporter and two
// events to the window, on the pattern the engine bridge set. The page
// addresses an export by a token it minted; the answer travels as an event
// on the same channel as the progress and after it, because an invoke reply
// is not ordered against events. The reveal takes the token, never a path:
// the main process remembers what it wrote, and the page never sees where.
// The two destination handlers take a project and nothing else: the
// platform's folder chooser is opened here and its answer applied here, so
// no path crosses the bridge inward, which is the rule Settings' two
// folders follow (A1-04, A5.5-19).
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
import { validateId } from './record/validate'
import type { Destinations, Exporter } from './export'
import type { StoreBlocked } from './ipc'
import {
  badCall,
  guardedHandle,
  redactShape,
  refusal,
  TOKEN,
  toShape,
  type PathRoots,
} from './ipc-shape'
import { RESERVED_NAME } from './paths'

export type Send = (channel: string, payload: unknown) => void

/** What the handlers need from the exporter; a test hands in a fake. */
export type ExportSource = Pick<Exporter, 'start' | 'cancel' | 'fileOf' | 'onProgress' | 'preview'>

/** What the two destination handlers need; a test hands in a fake. */
export type DestinationSource = Pick<Destinations, 'choose' | 'useAppFolder'>

export function registerExportHandlers(
  ipcMain: IpcMain,
  exporter: ExportSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
  send: Send,
  /** Show a file in the platform's file browser: `shell.showItemInFolder`. */
  reveal: (path: string) => void,
  /** Where one project's exports go, and the dialog that chooses it (A5.5-19). */
  destinations: DestinationSource,
  /**
   * Why a project's record may not be written right now, or null. Both
   * destination calls write one, and a record lives under the home a reset
   * is removing, so both are held exactly as `registerProjectHandlers`
   * holds its writes (A1-04). The exporter has its own copy of this gate,
   * which is why the other four handlers do not read it here.
   *
   * It is asked twice: here, before the dialog, and by `Destinations` at
   * the write, which is handed this same function (issue 206). Between the
   * two a person chooses a folder and the folder is judged, which can take
   * until its deadline; a reset confirmed in that time must not have the
   * record land in the folder it is removing.
   */
  blocked: StoreBlocked = () => null,
  /**
   * The folders a path in an error can start with, for the door (issue 419).
   * Required: a bridge that named none would be a quieter door.
   */
  roots: PathRoots,
): () => void {
  const handle = guardedHandle(ipcMain, isTopFrame)

  handle(CHANNELS.exportRun, async (_event, token, projectId, choice): Promise<ExportAccepted> => {
    // The token becomes a folder name under the engine home, so a name
    // Windows reserves is refused with the rest.
    if (typeof token !== 'string' || !TOKEN.test(token) || RESERVED_NAME.test(token))
      return badCall('an export needs an id', roots)
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      return badCall('an export needs a project', roots)
    // Every field of the choice against the engine's own rules, and a copy
    // with nothing else on it, before the exporter or the engine sees it.
    const problem = validateExportChoice(choice)
    if (problem !== null) return badCall(problem, roots)
    let started: ReturnType<Exporter['start']>
    try {
      started = exporter.start(token, projectId, copyChoice(choice as ExportChoice))
    } catch (error) {
      return { accepted: false, error: toShape(error, roots) }
    }
    started.result.then(
      (value) => {
        const settled: ExportSettled = { id: token, ok: true, result: value }
        send(CHANNELS.exportSettled, settled)
      },
      (error: unknown) => {
        const settled: ExportSettled = { id: token, ok: false, error: toShape(error, roots) }
        send(CHANNELS.exportSettled, settled)
      },
    )
    return { accepted: true }
  })

  // The preview's plan: answered, never thrown, so the engine's refusal
  // keeps its `data` on the way to the sentence the tab shows.
  handle(CHANNELS.exportPreview, async (_event, projectId, choice): Promise<ExportPreview> => {
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      return { ok: false, error: refusal('a preview needs a project', roots) }
    const problem = validateExportChoice(choice)
    if (problem !== null) return { ok: false, error: refusal(problem, roots) }
    const answer = await exporter.preview(projectId, copyChoice(choice as ExportChoice))
    // The exporter shapes its own refusal with its URLs redacted and its
    // paths left in; the door takes them out here, with the folders (issue
    // 419). A second pass of `redactUrls` changes nothing.
    return answer.ok ? answer : { ...answer, error: redactShape(answer.error, roots) }
  })

  handle(CHANNELS.exportCancel, async (_event, token) => {
    if (typeof token === 'string') exporter.cancel(token)
  })

  // A folder is chosen by naming a project; the dialog and its answer never
  // leave this process. An error is thrown rather than answered, as the
  // project handlers throw theirs: the page shows the sentence beside the
  // control that asked.
  const readProject = (projectId: unknown): string => {
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      throw new Error('a destination needs a project')
    // Before the dialog, not after it: a chooser opened over a reset would
    // be answered into a record being walked away, and a person would have
    // chosen a folder for nothing.
    const why = blocked()
    if (why !== null) throw new Error(why)
    return projectId
  }

  handle(CHANNELS.exportChooseDestination, async (_event, projectId) =>
    destinations.choose(readProject(projectId), blocked),
  )

  handle(CHANNELS.exportUseAppFolder, async (_event, projectId) =>
    destinations.useAppFolder(readProject(projectId), blocked),
  )

  handle(CHANNELS.exportReveal, async (_event, token) => {
    if (typeof token !== 'string') return
    const file = exporter.fileOf(token)
    if (file !== null) reveal(file)
  })

  return exporter.onProgress((progress) => send(CHANNELS.exportProgress, progress))
}
