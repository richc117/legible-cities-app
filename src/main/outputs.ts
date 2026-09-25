// What a project has produced, read from disk (A5.5-21, docs/DESIGN.md
// 8.2, "Outputs"): the rail's Outputs list and the Reveal beside each row.
//
// It reads the sidecar the engine already writes beside every deliverable
// and nothing else. That is the whole point of the feature: until now a
// finished export was findable only in the inspector, and only until the
// app was closed, because the only record of it was the session's. A
// folder full of sidecars survives a restart, a crash and a second
// machine, and it is the engine's own writing rather than a second ledger
// this app would have to keep in step.
//
// Two rules it keeps, both of them the export's already. No path crosses
// the bridge outward: a row carries the file's own bare name and the main
// process works out the folder each time. And no path crosses it inward
// either: `reveal` takes a name, checks it against what the folder
// actually holds, and joins it here, so a name the page invented resolves
// to nothing rather than to somewhere else.
//
// Contract: specs/010-export/contracts/bridge.md, which the export's own
// two handlers already follow.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { CHANNELS } from '../shared/api'
import { OUTPUTS_MAX, type ExportOutput } from '../shared/export'
import { validateId, type ProjectRecord } from '../shared/project'
import { folderName } from './export'

/** What the engine names a sidecar: the deliverable's own name and this. */
export const SIDECAR_SUFFIX = '.json'

/** A filesystem error's code, or a word when it carries none. */
function reasonOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unknown error'
}

/** A folder that is not there, or is not a folder: no outputs, not a failure. */
function absent(error: unknown): boolean {
  const code = reasonOf(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export interface OutputsOptions {
  projects: { get(id: string): Promise<ProjectRecord & { readOnly: boolean }> }
  /** Where a project that has chosen no folder of its own exports to. */
  exportFolder: () => string
  /** Show a file in the platform's file browser: `shell.showItemInFolder`. */
  show: (path: string) => void
  /**
   * Why nothing may be read right now, or null. Settings sets this while it
   * is removing the engine's home; a project's record lives under it, and
   * this reads one.
   */
  blocked?: () => string | null
  log: (message: string) => void
}

export class Outputs {
  readonly #options: OutputsOptions

  constructor(options: OutputsOptions) {
    this.#options = options
  }

  /**
   * Where this project's exports go now: its own destination, or the app's
   * folder where it has chosen none, and under it the folder named after
   * the project - exactly what `Exporter` writes into (A5.5-19).
   *
   * Worked out at each read rather than remembered, for the same reason the
   * exporter works it out at each export: the app's folder is a setting and
   * a project's destination is a field, and either can move between one
   * read and the next.
   */
  async #folder(projectId: string): Promise<string> {
    const project = await this.#options.projects.get(projectId)
    const root = project.destination ?? this.#options.exportFolder()
    return join(root, folderName(project.name, project.id))
  }

  /** Every sidecar in the folder, newest first and uncapped. */
  async #read(projectId: string): Promise<ExportOutput[]> {
    const why = this.#options.blocked?.() ?? null
    if (why !== null) throw new Error(why)
    const folder = await this.#folder(projectId)
    let names: string[]
    try {
      names = await readdir(folder)
    } catch (error) {
      if (absent(error)) return []
      this.#options.log(`the project's export folder could not be read (${reasonOf(error)})`)
      throw error
    }
    const rows: ExportOutput[] = []
    for (const name of names) {
      if (!name.endsWith(SIDECAR_SUFFIX) || name.length === SIDECAR_SUFFIX.length) continue
      const file = name.slice(0, -SIDECAR_SUFFIX.length)
      const row = await this.#rowOf(folder, name, file)
      if (row !== null) rows.push(row)
    }
    // Newest first, and by name where two share a moment, so the order is
    // the same on two reads of the same folder.
    rows.sort((a, b) =>
      a.made === b.made ? a.file.localeCompare(b.file) : b.made < a.made ? -1 : 1,
    )
    return rows
  }

  /**
   * One row, or null where the file is not one of ours.
   *
   * The sidecar has to name the deliverable it sits beside. That is what the
   * engine writes, and it is the only thing that tells our sidecars from
   * whatever else a person keeps in a folder they chose: a `notes.json`
   * beside a `notes.md` would otherwise become an export of a preset the
   * app cannot name.
   */
  async #rowOf(folder: string, sidecar: string, file: string): Promise<ExportOutput | null> {
    let meta: Record<string, unknown>
    let made: string
    try {
      const path = join(folder, sidecar)
      const [text, stamp] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      meta = parsed as Record<string, unknown>
      made = stamp.mtime.toISOString()
    } catch {
      // Unreadable, or not JSON: not an export of ours, and not worth a
      // sentence in a list that is about what was made.
      return null
    }
    if (meta.file !== file) return null
    let present = false
    try {
      present = (await stat(join(folder, file))).isFile()
    } catch {
      // Moved or deleted since. The sidecar stays, so the row stays and
      // reads as gone; a press on it is not offered at all.
    }
    return { file, preset: typeof meta.preset === 'string' ? meta.preset : null, made, present }
  }

  /** What the rail lists: the newest `OUTPUTS_MAX`. */
  async list(projectId: string): Promise<ExportOutput[]> {
    return (await this.#read(projectId)).slice(0, OUTPUTS_MAX)
  }

  /**
   * Show one output in the platform's file browser. False when the folder
   * no longer holds it, which the page reads as a row gone stale.
   *
   * The lookup is the guard: the name is matched against what the folder
   * answered, never joined to it on trust, so nothing the page can say
   * reaches a path of its own choosing. Uncapped, so a row a long list cut
   * off is still revealable if it ever shows.
   */
  async reveal(projectId: string, file: string): Promise<boolean> {
    const rows = await this.#read(projectId)
    const row = rows.find((r) => r.file === file)
    if (row === undefined || !row.present) return false
    this.#options.show(join(await this.#folder(projectId), row.file))
    return true
  }
}

/** What the handlers need; a test hands in a fake. */
export type OutputSource = Pick<Outputs, 'list' | 'reveal'>

export function registerOutputHandlers(
  ipcMain: IpcMain,
  outputs: OutputSource,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = (channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler(...args)
    })
  }

  handle(CHANNELS.exportOutputs, async (projectId) => {
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      throw new Error('a list of outputs needs a project')
    return outputs.list(projectId)
  })

  handle(CHANNELS.exportRevealOutput, async (projectId, file) => {
    if (typeof projectId !== 'string' || validateId(projectId) !== null)
      throw new Error('a reveal needs a project')
    // A bare name and nothing else. `Outputs.reveal` checks it against the
    // folder's own contents as well; this refuses the shapes that are not
    // names at all before any of that runs.
    if (typeof file !== 'string' || file === '' || file.length > MAX_NAME) return false
    if (/[\\/]/.test(file) || file === '.' || file === '..') return false
    return outputs.reveal(projectId, file)
  })
}

/**
 * The longest name a reveal will consider. Every filesystem the app runs on
 * refuses a longer one, so a longer string is not a name that was missed.
 */
const MAX_NAME = 255
