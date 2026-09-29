// The settings bridge's main side, and the gate in front of the two
// folders and the reset.
//
// No method here takes a path. A folder is chosen in the platform's own
// dialog - one of the two things only the operating system can do - and
// applied in the same call, so the page never holds a path it could hand
// back. The remembered-path guard A2-01 built for the feeds sits behind
// that anyway, with an instance per folder: a path reaches the settings
// file only if this process's own dialog answered it and no earlier change
// has spent it (specs/019-settings/contracts/bridge.md).
//
// The reset is the one destructive act. Its gate is here rather than on
// the screen, because only this side knows what is running: an export the
// exporter holds, or a request the engine is answering, which is what a
// layout run is.

import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { CHANNELS } from '../shared/api'
import {
  isAppTheme,
  isStorableFolder,
  type FolderSize,
  type FolderSource,
  type SettingsView,
} from '../shared/settings'
import type { FirstRunResult } from '../shared/first-run'
import { areReports, diagnosticsText, tailLog, type DiagnosticsInput } from './diagnostics-text'
import { LOG_WAIT_MS, within } from './log-file'
import { PickedPaths } from './picked'
import {
  contains,
  destinationsInTheWay,
  destinationsSentence,
  folderSize,
  realOrResolved,
  refuseReset,
  resetContents,
  RESET_FOLDERS,
  type DestinationDoor,
  type ProjectDestination,
  type ResetGuards,
  type ResetOutcome,
  type SettingsStore,
} from './settings'

/** Which folder a call is about. */
export type Which = 'engine' | 'export'

export interface SettingsDeps {
  store: SettingsStore
  /** The engine home in force for this run, as the configuration resolved it. */
  engineHome: string
  /** The export folder the configuration resolved at start. */
  exportFolder: string
  /** Where each folder came from, as `resolveConfig` decided. */
  sources: Record<Which, FolderSource>
  /** The defaults, so "Use the default" has something to show before a restart. */
  defaults: Record<Which, string>
  /**
   * The platform's folder chooser, parented to the window; null when the
   * person cancelled or there is no window to parent to.
   */
  chooseFolder: (which: Which, current: string) => Promise<string | null>
  /** Why a reset may not run now, or null: an export or an engine request in flight. */
  busy: () => string | null
  /**
   * Every project that exports to a folder of its own, from the records
   * under the home in force: the project store's answer, injected so this
   * service never holds the store. Asked once at each press that needs it.
   * Records left behind in a home the app used before are not in it, and
   * neither is a record the store could not read, which it skips and
   * answers without; only a rejection refuses what asked.
   */
  destinations: () => Promise<ProjectDestination[]>
  /** Make a folder if it is missing and show it in the platform's file browser. */
  openFolder: (path: string) => Promise<void>
  /**
   * Electron's own log folder for this app, asked for when it is wanted: a
   * path Electron cannot answer would otherwise take the whole startup down
   * with an unhandled rejection rather than one dead button.
   */
  logsFolder: () => string
  /**
   * Folders nothing may be stored inside: the app's own bundle, which is
   * read-only on macOS and wiped on update (ADR-016), and its resources.
   * The chooser can make a folder anywhere, this one included.
   */
  bundleRoots: string[]
  /** What a reset must never remove: these come from Electron, not from the page. */
  guards: ResetGuards
  /** What "Copy diagnostics" gathers, injected so the whole copy is asserted in a unit test. */
  diagnostics: DiagnosticsDeps
  log: (message: string) => void
}

/** How long the copy waits for the home folders' real and short forms before hiding the home as named. */
export const HOMES_TIMEOUT_MS = 2_000

/** How long the copy waits for the engine's `engine.info` before saying it did not answer. */
export const ENGINE_INFO_TIMEOUT_MS = 5_000

export interface DiagnosticsDeps {
  /** The app's version, the runtime's versions and the operating system. */
  about: () => Pick<DiagnosticsInput, 'app' | 'versions' | 'os'>
  /** The engine's `engine.info`; rejects with the engine's own sentence when it is not ready. */
  engineInfo: () => Promise<unknown>
  /** The first-run check's result as it stands (A6-02). */
  firstRun: () => FirstRunResult
  /** Every line logged so far on disk, so the tail read next is current; waited for at most `LOG_WAIT_MS`. */
  flushLogs: () => Promise<void>
  /** The home folder as the platform names it. */
  home: string
  /**
   * The home folder through its links. Asked when a copy is made, because
   * it touches the disk; a copy is refused if it does not answer in time,
   * since a home reached through a link would otherwise survive the copy.
   */
  realHome: () => Promise<string>
  /**
   * On Windows, the home in 8.3 short form as each temporary folder writes
   * it, or null where it does not; one lookup each, and whichever answer in
   * time are used. Elsewhere, none.
   */
  shortHomes: () => Promise<string | null>[]
  platform: string
  /** The system clipboard, the same writer the diagnostics panel's handler uses. */
  writeText: (text: string) => void
}

/**
 * The settings, as the screen sees them and as the rest of the main
 * process asks them. Everything Electron - the dialog, the shell, the
 * paths - is injected, so every rule here is asserted in a unit test.
 */
export class SettingsService {
  readonly #deps: SettingsDeps
  /** One remembered-path set per folder: a folder chosen for one is never the other's. */
  readonly #picked: Record<Which, PickedPaths> = {
    engine: new PickedPaths(),
    export: new PickedPaths(),
  }
  /** The export folder in force right now: the start's, until a person changes it. */
  #exportFolder: string
  #resetting = false
  /**
   * The engine folder's changes, one after another. Each asks where the
   * projects export before it writes, which reads the disk, so two presses
   * a moment apart could otherwise be written in the order their reads
   * finished rather than the order they were made, and the folder left
   * waiting for a restart would be the one from the press before the last.
   */
  #engineChanges: Promise<unknown> = Promise.resolve()

  constructor(deps: SettingsDeps) {
    this.#deps = deps
    this.#exportFolder = deps.exportFolder
  }

  /** Where an export goes. Read at each export, so a change needs no restart. */
  exportFolderNow(): string {
    return this.#exportFolder
  }

  /**
   * The engine's home is being removed right now. Nothing that writes under
   * it may start: the export's frames live there, and so does everything a
   * layout run produces. The gate is here rather than on the screen because
   * the page could ask again while the removal is walking the folder.
   */
  get resetting(): boolean {
    return this.#resetting
  }

  /** Why no work may start, or null; for the exporter and the engine's guard. */
  refuseWhileResetting(): string | null {
    return this.#resetting ? 'The engine data is being reset; wait for it to finish.' : null
  }

  private locked(which: Which): boolean {
    return this.#deps.sources[which] === 'environment'
  }

  view(): SettingsView {
    const { store, engineHome, defaults } = this.#deps
    const stored = store.current
    // What the engine's home would be if the app started now. It differs
    // from the one in force whenever a person has just chosen one, or has
    // just gone back to the default: either way the app has to start again
    // before the engine, the store, the served roots and the capture's
    // session move with it.
    const nextStart = this.locked('engine') ? engineHome : (stored.engineFolder ?? defaults.engine)
    return {
      theme: stored.theme,
      engine: {
        path: engineHome,
        source: this.#deps.sources.engine,
        pending: nextStart === engineHome ? null : nextStart,
        locked: this.locked('engine'),
      },
      export: {
        path: this.#exportFolder,
        source: this.locked('export')
          ? 'environment'
          : stored.exportFolder === null
            ? 'default'
            : 'settings',
        pending: null,
        locked: this.locked('export'),
      },
    }
  }

  async setTheme(theme: unknown): Promise<SettingsView> {
    if (!isAppTheme(theme)) throw new Error('that is not a theme')
    // Compared in the store's queue, against the theme every earlier press
    // left, not against `current`, which a press still being written has
    // not changed yet.
    await this.#deps.store.update((stored) =>
      stored.theme === theme ? null : { ...stored, theme },
    )
    return this.view()
  }

  /**
   * Open the chooser for one folder and apply what it answered. The path
   * never reaches the page: it is remembered here, spent here, and only the
   * view goes back.
   */
  async choose(which: Which): Promise<SettingsView> {
    if (this.locked(which)) throw new Error(refusalForLocked(which))
    const answer = await this.#deps.chooseFolder(which, this.#folderOf(which))
    if (answer === null) return this.view()
    this.#picked[which].remember(answer)
    return this.apply(which, answer)
  }

  /**
   * Store a folder. Exported past `choose` so the rule is testable on its
   * own: a path this process's own dialog did not answer, or has already
   * spent, is refused before the settings file is touched. Nothing on the
   * bridge reaches this with a path of its own choosing.
   */
  async apply(which: Which, path: unknown): Promise<SettingsView> {
    if (this.locked(which)) throw new Error(refusalForLocked(which))
    if (!isStorableFolder(path)) throw new Error("a folder is chosen in the app's own dialog")
    if (!this.#picked[which].take(path)) {
      throw new Error("a folder is chosen in the app's own dialog")
    }
    // The chooser will make a folder anywhere the platform lets it, the
    // app's own bundle included; the bundle is read-only on macOS and wiped
    // on update, so nothing may be kept there whoever chose it (ADR-016).
    if (this.#deps.bundleRoots.some((root) => contains(root, path))) {
      throw new Error('that folder is inside the app itself; nothing can be kept there')
    }
    if (which === 'engine') return this.#changeEngineFolder(path, 'chosen')
    // Changed in the store's queue, so a theme or the other folder written
    // at the same moment is kept rather than put back.
    await this.#deps.store.update((stored) => ({ ...stored, exportFolder: path }))
    // The export folder moves at once; the engine's waits for a start.
    this.#exportFolder = path
    return this.view()
  }

  /** Forget the stored folder and take the default again. */
  async useDefault(which: Which): Promise<SettingsView> {
    if (this.locked(which)) throw new Error(refusalForLocked(which))
    if (which === 'engine') return this.#changeEngineFolder(null, 'default')
    await this.#deps.store.update((stored) => ({ ...stored, exportFolder: null }))
    this.#exportFolder = this.#deps.defaults.export
    return this.view()
  }

  /**
   * Store the engine's folder, or null for the default, unless a project's
   * own export folder is inside it or around it (issue 206).
   *
   * This is the door that can still see the conflict. The records live
   * under the home in force and nothing moves them when the home does, so
   * once the app has started on the new folder the project that exports
   * there is a record in the folder before, which no reset will read. Here
   * the store is still on the home in force and holds it.
   *
   * What it cannot see is a record in a home the app used before this
   * one. A destination a project is given after this press and before the
   * restart is the other half of the same rule, and is kept where it is
   * chosen: `destinationRefusal` in `export.ts` judges a project's folder
   * against the folder waiting here as well as the home in force.
   */
  #changeEngineFolder(folder: string | null, door: DestinationDoor): Promise<SettingsView> {
    const change = async (): Promise<SettingsView> => {
      const inTheWay = await this.#projectsInTheWay(
        await realOrResolved(folder ?? this.#deps.defaults.engine),
      )
      if (inTheWay.length > 0) {
        this.#deps.log(
          `an engine data folder was refused: ${inTheWay.length} of the projects export inside it or around it`,
        )
        throw new Error(destinationsSentence(inTheWay, door))
      }
      // Changed in the store's queue, so a theme or the other folder
      // written at the same moment is kept rather than put back. The
      // engine's folder waits for a start.
      await this.#deps.store.update((stored) => ({ ...stored, engineFolder: folder }))
      return this.view()
    }
    const run = this.#engineChanges.then(change)
    this.#engineChanges = run.catch(() => undefined)
    return run
  }

  /**
   * The names of the projects whose own export folder is inside `home` or
   * around it; `home` is already a real path. The list is read once, and
   * every destination in it is resolved through its links before the
   * comparison, which is textual: a destination that is a link into the
   * home would otherwise pass.
   *
   * **Which failure refuses, and which does not.** Two different things
   * can go wrong with the read, and they end differently on purpose.
   *
   * - *Refused:* the read itself rejecting - `destinations()` throwing
   *   rather than answering. Whatever asked is refused, in this side's own
   *   sentence, since a filesystem message names the path. The project
   *   store never does this over anything a disk does, so it is the
   *   unforeseen, and the unforeseen in front of a removal stops.
   * - *Not refused:* everything the store itself survives, which it
   *   answers as fewer projects and a line in the log. A projects folder
   *   that is not there, or that cannot be listed; a record that cannot be
   *   read or is not JSON or fails the parser; a record carrying another
   *   folder's identity; a folder that is a link or is not named as an
   *   identifier. Their export folders are not seen, and the choice or
   *   the reset goes ahead. Refusing over those would block the reset in
   *   exactly the case it exists for, a home whose contents have gone
   *   wrong (decided on issue 206).
   */
  async #projectsInTheWay(home: string): Promise<string[]> {
    let stored: ProjectDestination[]
    try {
      stored = await this.#deps.destinations()
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      this.#deps.log(
        `the projects' export folders could not be read (${typeof code === 'string' ? code : 'unknown error'})`,
      )
      throw new Error(
        'the projects could not be read, so the app cannot tell whether one of them exports there; try again',
        { cause: error },
      )
    }
    const real: ProjectDestination[] = []
    for (const project of stored) {
      real.push({ ...project, destination: await realOrResolved(project.destination) })
    }
    return destinationsInTheWay(home, real).map((project) => project.name)
  }

  engineSize(): Promise<FolderSize> {
    return folderSize(this.#deps.engineHome)
  }

  async openLogsFolder(): Promise<void> {
    await this.#deps.openFolder(this.#deps.logsFolder())
  }

  /**
   * Put what a bug report needs on the clipboard: the versions, the
   * engine's own answer, the end of both logs and the reports of the maps
   * drawn this session, with the home folder written as `~` and checked for
   * afterwards. The reports come from the page, so they are checked first;
   * everything else is this process's own. Nothing is sent anywhere
   * (specs/023, FR-005 to FR-008).
   */
  async copyDiagnostics(reports: unknown): Promise<void> {
    if (!areReports(reports)) {
      throw new Error('the reports to copy are not a short list of text')
    }
    const d = this.#deps.diagnostics
    const engine = await this.#engineInfo()
    // Bounded: a log that cannot be flushed costs the newest lines of the
    // tail, never the copy.
    await within(d.flushLogs(), LOG_WAIT_MS)
    let folder: string | null
    try {
      folder = this.#deps.logsFolder()
    } catch {
      folder = null
    }
    const [mainLog, engineLog] =
      folder === null
        ? ['The log folder could not be found.', 'The log folder could not be found.']
        : await Promise.all([tailLog(folder, 'main'), tailLog(folder, 'engine')])
    const text = diagnosticsText(
      { ...d.about(), engine, firstRun: d.firstRun(), mainLog, engineLog, reports },
      await this.#homes(),
      d.platform,
    )
    d.writeText(text)
    this.#deps.log(`copied diagnostics (${Buffer.byteLength(text, 'utf8')} bytes) to the clipboard`)
  }

  /**
   * The home folder in every form a copy must hide, for another copy made
   * in this process: a job's log (A1-03) goes through the same lookup, with
   * the same deadline and the same refusal, rather than a second one.
   */
  homesToHide(): Promise<string[]> {
    return this.#homes()
  }

  /**
   * Every form of the home folder the copy must hide. The home through its
   * links is bounded at `HOMES_TIMEOUT_MS` and fails closed: a home that does
   * not answer in time - on a network mount, say - refuses the copy, because
   * its real path could be in the text and nothing would find it. A lookup
   * that answers with an error has answered, and the home as named stands.
   * The short forms are bounded the same way, separately, and whichever
   * answered are used.
   */
  async #homes(): Promise<string[]> {
    const { home, realHome, shortHomes } = this.#deps.diagnostics
    const found = new Set([home])
    const shorts = shortHomes().map((lookup) =>
      lookup.then(
        (short) => {
          if (short !== null) found.add(short)
        },
        () => undefined,
      ),
    )
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = Symbol('late')
    const deadline = new Promise<typeof late>((resolve) => {
      timer = setTimeout(() => resolve(late), HOMES_TIMEOUT_MS)
    })
    try {
      const [real] = await Promise.all([
        Promise.race([realHome().catch(() => home), deadline]),
        within(Promise.all(shorts), HOMES_TIMEOUT_MS),
      ])
      if (real === late) {
        throw new Error('the home folder did not answer in time, so nothing was copied')
      }
      found.add(real)
      return [...found]
    } finally {
      clearTimeout(timer)
    }
  }

  async #engineInfo(): Promise<DiagnosticsInput['engine']> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no answer within ${ENGINE_INFO_TIMEOUT_MS / 1000} s`)),
        ENGINE_INFO_TIMEOUT_MS,
      )
    })
    try {
      const info = await Promise.race([this.#deps.diagnostics.engineInfo(), timeout])
      return { info }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'object' && error !== null && 'message' in error
            ? String((error as { message: unknown }).message)
            : String(error)
      return { absent: `The engine did not give its engine.info: ${message}` }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Remove what the app and the engine keep under the home. The home itself
   * stays, and so does anything else in it: a person can point it at a
   * folder of their own in one click, and the button's confirmation talks
   * about projects and feeds, not about that folder's other contents.
   *
   * The folder is the configuration's own; nothing from the page reaches
   * it. Every comparison is made on real paths, because the checks are
   * textual and a home that is a link would pass all of them and then
   * remove four folders from wherever it points.
   *
   * Refused while a reset is already running, while anything else is
   * writing under the home, for a home so high up that these folder names
   * would mean something else, and for an export folder that a reset would
   * reach - the app's own, or one a project in this home chose for itself -
   * because the confirmation promises that exported files are not touched.
   * A project whose record was left behind in a home the app used before
   * is not seen: its record is not under this home, so nothing here reads
   * it (issue 206).
   *
   * The flag is raised for the length of the removal, so no engine request,
   * no export and no write to a project record can begin while it runs.
   */
  async resetEngineData(): Promise<ResetOutcome> {
    // A reset already running is the first thing asked. Two at once both
    // pass every other check, and the first to finish lowers the flag while
    // the second is still walking the folders - letting every writer back
    // in, after the screen has said the data is gone. The renderer disables
    // the button, which is exactly what this side may not rely on.
    const running = this.refuseWhileResetting() ?? this.#deps.busy()
    if (running !== null) throw new Error(running)
    // Raised here, before the first await and before any check that needs
    // one, because a second call arriving while this one resolves paths
    // would find the flag still down and there is no other moment that is
    // safe. It covers the checks as well as the removal, which costs a few
    // refused requests in the milliseconds a refusal takes to decide.
    this.#resetting = true
    try {
      return await this.#reset()
    } finally {
      this.#resetting = false
    }
  }

  async #reset(): Promise<ResetOutcome> {
    const home = await realOrResolved(this.#deps.engineHome)
    const guards = {
      userData: await realOrResolved(this.#deps.guards.userData),
      homeDir: await realOrResolved(this.#deps.guards.homeDir),
    }
    const refusal = refuseReset(home, guards)
    if (refusal !== null) throw new Error(refusal)
    // Only what the promise needs. An export folder that holds the home, or
    // is it, is refused too: an export writes to <folder>/<project name>/,
    // so a project called "out" under a folder that is the home would land
    // in one of the four.
    //
    // Each sentence asks for two things, the files before the folder
    // (issue 206): choosing another export folder moves nothing, so a
    // person who did only that would lose what they had exported to the
    // reset that then ran.
    const exportFolder = await realOrResolved(this.#exportFolder)
    if (contains(exportFolder, home)) {
      throw new Error(
        'Your export folder holds the engine data folder, so the reset could remove your exported files; move them out of the engine data folder and choose another export folder first.',
      )
    }
    for (const folder of RESET_FOLDERS) {
      if (contains(join(home, folder), exportFolder)) {
        throw new Error(
          `Your export folder is inside the ${folder} folder, which the reset removes, so your exported files would go with it; move them out of the engine data folder and choose another export folder first.`,
        )
      }
    }
    // And the folders the projects chose for themselves (issue 206). The
    // records are the ones under this home: the flag is up, so no record is
    // being written while they are read, and the read is the last thing
    // before the removal that takes them.
    const inTheWay = await this.#projectsInTheWay(home)
    if (inTheWay.length > 0) throw new Error(destinationsSentence(inTheWay, 'reset'))
    const outcome = await resetContents(home)
    this.#deps.log(
      `reset removed ${outcome.removed.join(', ') || 'nothing'}` +
        (outcome.failed.length > 0
          ? `; kept ${outcome.failed.map((f) => `${f.folder} (${f.reason})`).join(', ')}`
          : ''),
    )
    return outcome
  }

  #folderOf(which: Which): string {
    return which === 'engine' ? this.#deps.engineHome : this.#exportFolder
  }
}

function refusalForLocked(which: Which): string {
  const key = which === 'engine' ? 'SCHEMATIC_HOME' : 'LEGIBLE_EXPORT_FOLDER'
  return `${key} names this folder; the app does not change it here`
}

/**
 * The handlers. Each is registered for the interface's own top frame only,
 * and each ignores whatever arguments it is given: no settings call takes
 * one except the theme, whose value is checked against the three names,
 * and the diagnostics copy, whose reports are checked as bounded text.
 */
export function registerSettingsHandlers(
  ipcMain: IpcMain,
  settings: SettingsService,
  isTopFrame: (event: IpcMainInvokeEvent) => boolean,
): void {
  const handle = (channel: string, handler: (...args: unknown[]) => Promise<unknown>): void => {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      if (!isTopFrame(event)) throw new Error('forbidden')
      return handler(...args)
    })
  }

  handle(CHANNELS.settingsRead, async () => settings.view())
  handle(CHANNELS.settingsSetTheme, async (theme) => settings.setTheme(theme))
  handle(CHANNELS.settingsChooseEngineFolder, async () => settings.choose('engine'))
  handle(CHANNELS.settingsChooseExportFolder, async () => settings.choose('export'))
  handle(CHANNELS.settingsDefaultEngineFolder, async () => settings.useDefault('engine'))
  handle(CHANNELS.settingsDefaultExportFolder, async () => settings.useDefault('export'))
  handle(CHANNELS.settingsEngineSize, async () => settings.engineSize())
  handle(CHANNELS.settingsOpenLogs, async () => {
    await settings.openLogsFolder()
  })
  handle(CHANNELS.settingsResetEngineData, async () => settings.resetEngineData())
  // The one settings call that takes something from the page: the reports
  // of the maps it drew, as text, checked in the service before use.
  handle(CHANNELS.settingsCopyDiagnostics, async (reports) => {
    await settings.copyDiagnostics(reports)
  })
}
