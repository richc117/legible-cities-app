// The settings file, the engine home's size, and the reset.
//
// The file is one small JSON object beside the engine's home under the
// user-data folder, written the way a project record is - a fresh
// temporary name, then a rename over the old file - so a crash mid-write
// leaves the previous settings whole, and read the way a record is read:
// every field that is missing or wrong takes its default and the app
// starts (specs/019-settings, FR-001). No filesystem error leaves this
// module with its own message, because a Node fs message names the path
// and an error thrown here is what the renderer shows.

import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import {
  DEFAULT_SETTINGS,
  parseSettings,
  SETTINGS_VERSION,
  type AppSettings,
  type FolderSize,
} from '../shared/settings'

export const SETTINGS_FILE = 'settings.json'

// A fresh temporary name per write, as the project record's is, so two
// overlapping writes cannot share a file. Readers open only settings.json.
const tempFile = (): string => `${SETTINGS_FILE}.${randomBytes(4).toString('hex')}.tmp`

/** The code of a filesystem failure, never its message, which names the path. */
function reasonOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  return typeof code === 'string' ? code : 'unknown error'
}

export class SettingsStore {
  #settings: AppSettings = { ...DEFAULT_SETTINGS }
  #loaded = false

  /** The folder is Electron's userData; the file sits directly beneath it. */
  constructor(
    private readonly dir: string,
    private readonly log: (message: string) => void,
  ) {}

  private get file(): string {
    return join(this.dir, SETTINGS_FILE)
  }

  /** What was last read or written. Defaults before the first load. */
  get current(): AppSettings {
    return this.#settings
  }

  /**
   * Read the file. Missing is not a fault: a first run has no settings. A
   * file that is not JSON, or not an object, or whose fields are wrong, is
   * one log line and the defaults - never a refusal to start.
   */
  async load(): Promise<AppSettings> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      const code = reasonOf(error)
      if (code !== 'ENOENT') this.log(`settings unreadable (${code}); using the defaults`)
      this.#loaded = true
      this.#settings = { ...DEFAULT_SETTINGS }
      return this.#settings
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      this.log('settings are not JSON; using the defaults')
      this.#loaded = true
      this.#settings = { ...DEFAULT_SETTINGS }
      return this.#settings
    }
    const parsed = parseSettings(json)
    // Say what was dropped, once, so a hand-edited file is diagnosable
    // without showing the value, which is a path.
    const raw = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {}
    for (const field of ['engineFolder', 'exportFolder', 'theme'] as const) {
      if (raw[field] != null && parsed[field] !== raw[field]) {
        this.log(`settings: ${field} was not usable; its default is in force`)
      }
    }
    this.#loaded = true
    this.#settings = parsed
    return parsed
  }

  /**
   * Write the settings, whole, in the current form. The folder is made
   * first: on a first run the user-data folder exists, but a person who
   * pointed the app at a fresh one has not made it.
   */
  async write(next: AppSettings): Promise<AppSettings> {
    if (!this.#loaded) await this.load()
    const settings: AppSettings = { ...next, version: SETTINGS_VERSION }
    const text = JSON.stringify(settings, null, 2) + '\n'
    const temp = join(this.dir, tempFile())
    try {
      await mkdir(this.dir, { recursive: true })
      await writeFile(temp, text, 'utf8')
      await rename(temp, this.file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      this.log(`settings: write failed (${reasonOf(error)})`)
      throw new Error('the settings could not be saved', { cause: error })
    }
    this.#settings = settings
    return settings
  }
}

/** How much of a folder the walk will look at before it reports a floor. */
export const WALK_CAP = 200_000

/**
 * A folder's size and file count, walked breadth-first with a cap.
 * Symbolic links are never followed: a link out of the engine's home would
 * count another disk, and a link that points at its own parent would not
 * finish. A folder that is not there is reported as missing, not as an
 * error: it is made when something first writes to it.
 */
export async function folderSize(root: string, cap = WALK_CAP): Promise<FolderSize> {
  const size: FolderSize = { bytes: 0, files: 0, partial: false, missing: false }
  let seen = 0
  const queue: string[] = [root]
  while (queue.length > 0) {
    const dir = queue.shift() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      // The root's absence is one thing and a folder nobody may read is
      // another: the first is an empty home, the second is a count that is
      // a floor. A folder that vanished mid-walk is simply not counted.
      if (dir === root && reasonOf(error) === 'ENOENT') size.missing = true
      else size.partial = true
      continue
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      seen += 1
      if (seen > cap) {
        size.partial = true
        return size
      }
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        queue.push(path)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const info = await stat(path)
        size.bytes += info.size
        size.files += 1
      } catch {
        // A file removed between the listing and the measurement is not
        // this walk's business; it simply is not counted.
      }
    }
  }
  return size
}

/**
 * Whether `parent` holds `child`, or is it, through the platform's own
 * comparison. The reset's guard uses it, and so does the refusal of a
 * folder inside the app's own bundle.
 */
export function contains(parent: string, child: string): boolean {
  const insensitive = process.platform === 'win32' || process.platform === 'darwin'
  const norm = (p: string): string => {
    const resolved = resolve(p)
    return insensitive ? resolved.toLowerCase() : resolved
  }
  const a = norm(parent)
  const b = norm(child)
  return b === a || b.startsWith(a.endsWith(sep) ? a : a + sep)
}

export interface ResetGuards {
  /** Electron's userData folder: the engine's home may sit inside it, never above it. */
  userData: string
  /** The person's home folder. */
  homeDir: string
}

/**
 * What the app and the engine keep under the home, and the only things a
 * reset removes. The engine's are `data/` (`data/feeds`, which also holds
 * `user-feeds.json`, and `data/graphs`) and `out/`, from its own
 * `config.py`; the app's are `projects/` and, while an export runs,
 * `frames/`, and its output shares the engine's `out/`.
 *
 * The home is a folder a person can point anywhere in one click, so
 * everything else in it is somebody's and is left alone. Read the engine's
 * `config.py` before adding to this list, not this comment.
 */
export const RESET_FOLDERS = ['data', 'out', 'projects', 'frames'] as const

/** What a reset did, by folder role; no path, because this is shown to a person. */
export interface ResetOutcome {
  removed: string[]
  /** A folder that would not go, and why: a filesystem code, or a link the app will not follow. */
  failed: { folder: string; reason: string }[]
}

/**
 * Why the engine's home may not be reset, or null. The folder itself is the
 * configuration's own, never a path from the page, so this is not a check
 * on a caller: it is a check on a *setting*, which a person or an
 * environment variable can point anywhere, including at their whole home
 * folder. The reset removes only `RESET_FOLDERS` beneath the home, so what
 * is left to refuse is a home so high up that those names mean something
 * else entirely - `/data` and `/out` at the root of a disk, say (FR-009).
 */
export function refuseReset(home: string, guards: ResetGuards): string | null {
  if (!isAbsolute(home)) return 'the engine data folder is not a folder the app can reset'
  const resolved = resolve(home)
  if (resolved === parse(resolved).root) {
    return 'the engine data folder is the whole disk; the app will not reset that'
  }
  if (resolve(guards.homeDir) === resolved) {
    return 'the engine data folder is your home folder; the app will not reset that'
  }
  if (contains(resolved, guards.homeDir)) {
    return 'the engine data folder holds your home folder; the app will not reset that'
  }
  if (contains(resolved, guards.userData)) {
    return "the engine data folder holds the app's own settings; the app will not reset that"
  }
  return null
}

/**
 * Remove what the app and the engine keep under the home, and nothing else.
 *
 * The home itself is never removed. A person can point it at `~/Documents`
 * or an external drive in one click, and weeks later press a button whose
 * confirmation talks about projects and feeds; taking the folder whole
 * would take everything else in it with them. So the four folders go and
 * the home stays, with whatever else is in it.
 *
 * A folder that is a symbolic link is left alone and reported: removing it
 * would unlink it rather than empty it, so the screen would say the data
 * was gone while it sat where the link pointed.
 *
 * Each folder is attempted whatever happened to the last, so the reset gets
 * as far as it can and the person hears about the rest, as a project's
 * delete does. A failure is reported by its code; the message would name
 * the path.
 */
export async function resetContents(home: string): Promise<ResetOutcome> {
  const outcome: ResetOutcome = { removed: [], failed: [] }
  try {
    await mkdir(home, { recursive: true })
  } catch (error) {
    throw new Error(`the engine data folder could not be made (${reasonOf(error)})`, {
      cause: error,
    })
  }
  for (const folder of RESET_FOLDERS) {
    const path = join(home, folder)
    let info
    try {
      info = await lstat(path)
    } catch {
      // Not there: nothing to remove, and not worth saying.
      continue
    }
    if (info.isSymbolicLink()) {
      outcome.failed.push({ folder, reason: 'a symbolic link, which the app will not follow' })
      continue
    }
    try {
      await rm(path, { recursive: true, force: true })
      outcome.removed.push(folder)
    } catch (error) {
      outcome.failed.push({ folder, reason: reasonOf(error) })
    }
  }
  return outcome
}
