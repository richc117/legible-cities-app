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
import { PickedPaths } from './picked'
import {
  contains,
  folderSize,
  realOrResolved,
  refuseReset,
  resetContents,
  RESET_FOLDERS,
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
  log: (message: string) => void
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
    const stored = this.#deps.store.current
    if (stored.theme !== theme) await this.#deps.store.write({ ...stored, theme })
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
    const stored = this.#deps.store.current
    await this.#deps.store.write(
      which === 'engine' ? { ...stored, engineFolder: path } : { ...stored, exportFolder: path },
    )
    // The export folder moves at once; the engine's waits for a start.
    if (which === 'export') this.#exportFolder = path
    return this.view()
  }

  /** Forget the stored folder and take the default again. */
  async useDefault(which: Which): Promise<SettingsView> {
    if (this.locked(which)) throw new Error(refusalForLocked(which))
    const stored = this.#deps.store.current
    await this.#deps.store.write(
      which === 'engine' ? { ...stored, engineFolder: null } : { ...stored, exportFolder: null },
    )
    if (which === 'export') this.#exportFolder = this.#deps.defaults.export
    return this.view()
  }

  engineSize(): Promise<FolderSize> {
    return folderSize(this.#deps.engineHome)
  }

  async openLogsFolder(): Promise<void> {
    await this.#deps.openFolder(this.#deps.logsFolder())
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
   * reach - because the confirmation promises that exported files are not
   * touched.
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
    const exportFolder = await realOrResolved(this.#exportFolder)
    if (contains(exportFolder, home)) {
      throw new Error(
        'your export folder holds the engine data folder; choose another one first, or the reset would reach your exports',
      )
    }
    for (const folder of RESET_FOLDERS) {
      if (contains(join(home, folder), exportFolder)) {
        throw new Error(
          `your export folder is inside the ${folder} folder, which the reset removes; choose another one first`,
        )
      }
    }
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
 * one except the theme, whose value is checked against the three names.
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
}
