// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (projects) and
// specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import type { EngineErrorShape, EngineState, JobLog, JobProgress } from './engine'
import type { ExportProgress, ExportResult, OfferedPreset } from './export'
import type { LayoutDone, LayoutResult } from './layout'
import type { AppTheme, FolderSize, ResetOutcome, SettingsView } from './settings'
import type { ViewerMethod } from './viewer'
import type {
  CreateProjectInput,
  DeleteResult,
  LineOrder,
  Palette,
  ProjectRecord,
  ProjectInputs,
  ProjectSummary,
  RebuildDone,
  Theme,
} from './project'

export type {
  CreateProjectInput,
  DeleteResult,
  Palette,
  ProjectInputs,
  ProjectRecord,
  ProjectSummary,
  RebuildDone,
  ServiceWindow,
} from './project'
export type { EngineState, JobLog, JobProgress } from './engine'
export type { ExportProgress, ExportResult, OfferedPreset } from './export'
export type { LayoutDone, LayoutResult } from './layout'
export type { AppTheme, FolderSize, FolderView, ResetOutcome, SettingsView } from './settings'

/** A zip the platform's file chooser answered: the path the engine is handed, the name the page shows. */
export interface PickedZip {
  path: string
  name: string
}

/** A request in flight: the token the page uses for progress and cancel, and the answer. */
export interface EngineRequest {
  id: string
  result: Promise<unknown>
}

/** What a job's invoke answers at once: started, or refused before it started. */
export type Accepted = { accepted: true } | { accepted: false; error: EngineErrorShape }

/**
 * How a job ends, sent on the same ordered channel as its progress and log
 * lines, so the page never sees the answer before the last notification
 * (an invoke reply is not ordered against events; see specs/004 research.md).
 * The engine's requests and the app's exports both end this way.
 */
export type Settled<T> =
  { id: string; ok: true; result: T } | { id: string; ok: false; error: EngineErrorShape }

export type EngineAccepted = Accepted
export type EngineSettled = Settled<unknown>

/** An export in flight: the token the page uses for progress and cancel, and the outcome. */
export interface ExportRequest {
  id: string
  result: Promise<ExportResult>
}

export interface Api {
  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: string): Promise<ProjectRecord & { readOnly: boolean }>
    create(input: CreateProjectInput): Promise<ProjectRecord>
    rename(id: string, name: string): Promise<ProjectRecord>
    delete(id: string): Promise<DeleteResult>
    /**
     * A layout run finished: the day it was drawn for and the layout's id,
     * as the engine answered it. The main process checks the id's shape and
     * writes the record; nothing is read, and the page never sees a path
     * (specs/007-layout-run/contracts/bridge.md, ADR-033).
     */
    completeLayout(id: string, done: LayoutDone): Promise<LayoutResult>
    /**
     * A rebuild for a chosen day finished: the map was drawn from the
     * stored layout for that day. The main process refuses a day outside
     * the stored window and writes the day (specs/012-service-date/contracts/bridge.md).
     */
    completeRebuild(id: string, done: RebuildDone): Promise<ProjectRecord>
    /**
     * The mode and agency a person chose with the feed in view (A2-02);
     * validated on the main side with the record's own rules. The next
     * layout passes them to the engine, which names a layout for them.
     */
    setInputs(id: string, inputs: ProjectInputs): Promise<ProjectRecord>
    /**
     * The line colours a person chose (A4-01), written once the map has
     * been drawn with them, as a chosen day is: the record and the page on
     * screen always agree. The main process checks every label and every
     * colour before the store sees them
     * (specs/018-colours/contracts/bridge.md).
     */
    completeColors(id: string, palette: Palette): Promise<ProjectRecord>
    /**
     * The order a person arranged the lines in (A4-02), written once the
     * map has been drawn in it, as the colours are. The main process checks
     * every label before the store sees it
     * (specs/020-line-order/contracts/bridge.md).
     */
    completeOrder(id: string, order: LineOrder): Promise<ProjectRecord>
    /**
     * The theme a person chose for this project's map (A4-03), written the
     * moment it is pressed: a theme is neither a layout nor a render, so
     * there is nothing to finish first. The page restyles itself from its
     * own address (specs/021-theme/contracts/bridge.md).
     */
    setTheme(id: string, theme: Theme): Promise<ProjectRecord>
  }
  /**
   * The map on the screen. The page runs in a sandboxed frame at an opaque
   * origin and cannot reach any of this; the app reaches into it from the
   * privileged process instead (ADR-028).
   */
  viewer: {
    /** Hold the frame showing this project. False if it is not there. */
    attach(projectId: string): Promise<boolean>
    release(): Promise<void>
    /** One of the page's own methods, with its arguments. */
    call(method: ViewerMethod, ...args: unknown[]): Promise<unknown>
  }
  // Untyped beyond "a method name and an object" on purpose: the bridge is
  // transport and should not know the engine's methods. The typed client
  // over it is `src/renderer/src/engine/client.ts`, whose types are
  // generated from the engine's own description (A1-02); app code calls
  // that, not this.
  engine: {
    state(): Promise<EngineState>
    request(method: string, params?: Record<string, unknown>): EngineRequest
    cancel(id: string): Promise<void>
    onState(listener: (state: EngineState) => void): () => void
    onProgress(listener: (progress: JobProgress) => void): () => void
    onLog(listener: (line: JobLog) => void): () => void
  }
  /**
   * An export of one preset, run in the main process because the capture
   * lives there (ADR-024): the engine plans it, the app takes the frames,
   * the engine encodes them. The page names a project and a preset, and
   * gets back a file's name; the folder is the export folder from the
   * configuration, and `reveal` opens it (specs/010-export/contracts/bridge.md).
   */
  /**
   * The one thing a page cannot do for a feed: choose a file. The main
   * process opens the platform's chooser, remembers the answer, and refuses
   * a feeds.add that names any other path (specs/014-feeds/contracts/bridge.md).
   */
  feeds: {
    /** Null when the person cancelled the chooser. */
    pickZip(): Promise<PickedZip | null>
  }
  export: {
    run(projectId: string, preset: OfferedPreset): ExportRequest
    cancel(id: string): Promise<void>
    /** Show a finished export's file in the platform's file browser. */
    reveal(id: string): Promise<void>
    onProgress(listener: (progress: ExportProgress) => void): () => void
  }
  /**
   * Put text on the system clipboard, and nothing else: the page may write
   * it, never read it. A page cannot do this for itself, because the app
   * answers every permission request with false and Chromium's own
   * clipboard write is one (specs/017-diagnostics/contracts/bridge.md).
   */
  clipboard: {
    write(text: string): Promise<void>
  }
  /**
   * What the app decides for itself: where the engine keeps its data, where
   * exports go, which theme the interface wears. No method takes a path.
   * A folder is chosen in the platform's own dialog, which only the main
   * process can open, and applied there; the page asks for the dialog and
   * is told the new state (specs/019-settings/contracts/bridge.md).
   */
  settings: {
    read(): Promise<SettingsView>
    setTheme(theme: AppTheme): Promise<SettingsView>
    /** Opens the chooser and applies the answer; the view is unchanged when it was cancelled. */
    chooseEngineFolder(): Promise<SettingsView>
    chooseExportFolder(): Promise<SettingsView>
    useDefaultEngineFolder(): Promise<SettingsView>
    useDefaultExportFolder(): Promise<SettingsView>
    /** Walk the engine's home. Bounded, and never through a symbolic link. */
    engineSize(): Promise<FolderSize>
    openLogsFolder(): Promise<void>
    /**
     * Remove what the app and the engine keep under the engine's home -
     * `projects`, `out`, `data` and `frames` - and nothing else; the home
     * itself and anything a person put in it stay. Answers what went and
     * what would not. Rejects when it may not run.
     */
    resetEngineData(): Promise<ResetOutcome>
  }
}

export const CHANNELS = {
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsDelete: 'projects:delete',
  projectsCompleteLayout: 'projects:complete-layout',
  projectsCompleteRebuild: 'projects:complete-rebuild',
  projectsSetInputs: 'projects:set-inputs',
  projectsCompleteColors: 'projects:complete-colors',
  projectsCompleteOrder: 'projects:complete-order',
  projectsSetTheme: 'projects:set-theme',
  viewerAttach: 'viewer:attach',
  viewerRelease: 'viewer:release',
  viewerCall: 'viewer:call',
  engineState: 'engine:state',
  engineRequest: 'engine:request',
  engineCancel: 'engine:cancel',
  engineStateChanged: 'engine:state-changed',
  engineSettled: 'engine:settled',
  engineProgress: 'engine:progress',
  engineLog: 'engine:log',
  exportRun: 'export:run',
  exportCancel: 'export:cancel',
  exportReveal: 'export:reveal',
  exportProgress: 'export:progress',
  exportSettled: 'export:settled',
  feedsPickZip: 'feeds:pick-zip',
  clipboardWrite: 'clipboard:write',
  settingsRead: 'settings:read',
  settingsSetTheme: 'settings:set-theme',
  settingsChooseEngineFolder: 'settings:choose-engine-folder',
  settingsChooseExportFolder: 'settings:choose-export-folder',
  settingsDefaultEngineFolder: 'settings:default-engine-folder',
  settingsDefaultExportFolder: 'settings:default-export-folder',
  settingsEngineSize: 'settings:engine-size',
  settingsOpenLogs: 'settings:open-logs',
  settingsResetEngineData: 'settings:reset-engine-data',
} as const
