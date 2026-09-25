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

/**
 * The largest sidecar worth opening. The engine's own is a few hundred
 * bytes, and this is a hundredfold that; anything bigger is somebody else's
 * file that happens to share the extension, and is passed over on its size
 * rather than read to find out.
 */
export const SIDECAR_MAX = 64 * 1024

/**
 * How many sidecars one read opens at most, whatever they turn out to be.
 * `OUTPUTS_MAX` bounds the answer; this bounds the work when the newest
 * files in the folder are not exports at all.
 */
export const SCAN_MAX = OUTPUTS_MAX * 4

/** A sidecar the folder holds, named and timed, with nothing of it read. */
interface Candidate {
  /** The deliverable's own name: the sidecar's, without the suffix. */
  file: string
  /** The sidecar's own name. */
  sidecar: string
  /** When the sidecar was written, which is when the export finished. */
  made: string
  /** Its size, so an enormous one is passed over unopened. */
  bytes: number
}

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

  /**
   * What the folder holds that could be an export, newest first, with
   * nothing of any of them read yet.
   *
   * The names and the times, and no contents. That order is the whole
   * reason this is a step of its own: it is what lets the cap bound the
   * *work* and not only the answer. A `stat` is a syscall; a `readFile` and
   * a `JSON.parse` are as big as the file, on the process that owns the
   * engine's framing, the window and any running export. A person may point
   * a project's destination at a folder they already use, and one 200 MB
   * `.json` in it would be a multi-second freeze of the whole app - on
   * every mount, on every change of the export run's state, and under the
   * finger on every press of Reveal.
   */
  async #candidates(projectId: string): Promise<{ folder: string; candidates: Candidate[] }> {
    const why = this.#options.blocked?.() ?? null
    if (why !== null) throw new Error(why)
    const folder = await this.#folder(projectId)
    let names: string[]
    try {
      names = await readdir(folder)
    } catch (error) {
      if (absent(error)) return { folder, candidates: [] }
      const code = reasonOf(error)
      this.#options.log(`the project's export folder could not be read (${code})`)
      // The code and not the error: Node writes the path it failed on into
      // the message ("EACCES: permission denied, scandir '/Users/…'"), and
      // the preload hands a rejection's message to the page verbatim.
      // Nothing this side sends outward names a folder. The original stays
      // as the `cause`, which is this process's to read and never crosses:
      // what is serialised over the bridge is the thrown error itself.
      throw new Error(code, { cause: error })
    }
    const candidates: Candidate[] = []
    for (const sidecar of names) {
      if (!sidecar.endsWith(SIDECAR_SUFFIX) || sidecar.length === SIDECAR_SUFFIX.length) continue
      try {
        const stamp = await stat(join(folder, sidecar))
        if (!stamp.isFile()) continue
        candidates.push({
          file: sidecar.slice(0, -SIDECAR_SUFFIX.length),
          sidecar,
          made: stamp.mtime.toISOString(),
          bytes: stamp.size,
        })
      } catch {
        // Gone between the listing and the stat, or unreadable. Not a row.
      }
    }
    // Newest first, and by name where two share a moment, so two reads of
    // one folder answer in the same order - and so the cap below takes the
    // newest exactly rather than whatever the filesystem listed first.
    candidates.sort((a, b) =>
      a.made === b.made ? a.file.localeCompare(b.file) : b.made < a.made ? -1 : 1,
    )
    return { folder, candidates }
  }

  /**
   * One row, or null where this is not an export of ours.
   *
   * The sidecar has to name the deliverable it sits beside. That is what the
   * engine writes, and it is the only thing that tells our sidecars from
   * whatever else a person keeps in a folder they chose: a `notes.json`
   * beside a `notes.md` would otherwise become an export of a preset the
   * app cannot name.
   */
  async #rowOf(folder: string, candidate: Candidate): Promise<ExportOutput | null> {
    // Passed over unread. The engine's sidecar is a few hundred bytes - the
    // file, the feed, the preset, the caveats and the alt text - so nothing
    // near this is one, and deciding that from the size costs no read.
    if (candidate.bytes > SIDECAR_MAX) return null
    let meta: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(await readFile(join(folder, candidate.sidecar), 'utf8'))
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
      meta = parsed as Record<string, unknown>
    } catch {
      // Unreadable, or not JSON: not an export of ours, and not worth a
      // sentence in a list that is about what was made.
      return null
    }
    if (meta.file !== candidate.file) return null
    let present = false
    try {
      present = (await stat(join(folder, candidate.file))).isFile()
    } catch {
      // Moved or deleted since. The sidecar stays, so the row stays and
      // reads as gone; a press on it is not offered at all.
    }
    return {
      file: candidate.file,
      preset: typeof meta.preset === 'string' ? meta.preset : null,
      made: candidate.made,
      present,
    }
  }

  /**
   * What the rail lists: the newest `OUTPUTS_MAX` exports.
   *
   * Newest first is exact, because the order is settled from the times
   * before anything is opened. What the cap bounds is the reading: it stops
   * at `OUTPUTS_MAX` rows, and at `SCAN_MAX` sidecars opened whatever they
   * turn out to be, so a folder of somebody else's JSON cannot make this
   * walk it all.
   */
  async list(projectId: string): Promise<ExportOutput[]> {
    const { folder, candidates } = await this.#candidates(projectId)
    const rows: ExportOutput[] = []
    let opened = 0
    for (const candidate of candidates) {
      if (rows.length >= OUTPUTS_MAX || opened >= SCAN_MAX) break
      if (candidate.bytes > SIDECAR_MAX) continue
      opened += 1
      const row = await this.#rowOf(folder, candidate)
      if (row !== null) rows.push(row)
    }
    return rows
  }

  /**
   * Show one output in the platform's file browser. False when the folder
   * no longer holds it, which the page reads as a row gone stale.
   *
   * The lookup is the guard: the name is an equality key against what
   * `readdir` answered, never joined to the folder on trust, so a name the
   * page invented fails the match rather than escaping the folder. One
   * sidecar is opened, whichever row was pressed, so a press costs the same
   * whether it is the first row or the fiftieth.
   *
   * The folder is resolved once and the same one is shown: resolving it
   * twice would let a destination changed in between send the platform to a
   * file this never checked.
   */
  async reveal(projectId: string, file: string): Promise<boolean> {
    const { folder, candidates } = await this.#candidates(projectId)
    const candidate = candidates.find((c) => c.file === file)
    if (candidate === undefined) return false
    const row = await this.#rowOf(folder, candidate)
    if (row === null || !row.present) return false
    this.#options.show(join(folder, row.file))
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
