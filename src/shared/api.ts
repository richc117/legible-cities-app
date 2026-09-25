// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (projects) and
// specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import type { EngineErrorShape, EngineState, JobLog, JobProgress } from './engine'
import type {
  ExportChoice,
  ExportOutput,
  ExportPreview,
  ExportProgress,
  ExportResult,
} from './export'
import type { FirstRunResult } from './first-run'
import type { LayoutDone, LayoutResult } from './layout'
import type { LicencesView } from './licences'
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
export type {
  ExportChoice,
  ExportOutput,
  ExportPreview,
  ExportProgress,
  ExportResult,
  OfferedPreset,
} from './export'
export type { FirstRunResult, ToolCheck } from './first-run'
export type { LayoutDone, LayoutResult } from './layout'
export type { LicenceFileState, LicencesView } from './licences'
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
     * The service day a person chose (A5.5-15), written the moment it is
     * chosen rather than after the rebuild that draws it, as the inputs and
     * the theme are. That gap - a day on the record that `drawn.date` does
     * not match - is what lets the notebook's cell 03 say the map does not
     * show it, and nothing is started by the write. The main process refuses
     * a day outside the stored window, and a project that has no window to
     * be inside (specs/028-the-notebook/contracts/run-graph.md).
     */
    setDate(id: string, date: string): Promise<ProjectRecord>
    /**
     * The theme a person chose for this project's map (A4-03), written the
     * moment it is pressed: a theme is neither a layout nor a render, so
     * there is nothing to finish first. The page restyles itself from its
     * own address (specs/021-theme/contracts/bridge.md).
     */
    setTheme(id: string, theme: Theme): Promise<ProjectRecord>
    /**
     * What a person set the project to export (A5-01): the preset, the
     * storyboard and the options, written the moment they are chosen, as
     * the theme is. The main process checks every field against the
     * engine's own rules before the store sees it
     * (specs/010-export/contracts/bridge.md, specs/022-export-tab).
     */
    setExport(id: string, choice: ExportChoice): Promise<ProjectRecord>
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
   * The one thing a page cannot do for a feed: choose a file. The main
   * process opens the platform's chooser, remembers the answer, and refuses
   * a feeds.add that names any other path (specs/014-feeds/contracts/bridge.md).
   */
  feeds: {
    /** Null when the person cancelled the chooser. */
    pickZip(): Promise<PickedZip | null>
  }
  /**
   * An export of one preset, run in the main process because the capture
   * lives there (ADR-024): the engine plans it, the app takes the frames,
   * the engine encodes them. The page names a project and what to export,
   * and gets back a file's name; the folder is the project's own
   * destination, or the export folder from the configuration where it has
   * none, and `reveal` opens it (specs/010-export/contracts/bridge.md).
   */
  export: {
    run(projectId: string, choice: ExportChoice): ExportRequest
    /**
     * The address the map's frame shows while the export tab is open: the
     * engine's plan for this choice with the platform's safe zones drawn
     * where the preset has them. Planned, never captured; nothing is
     * written (specs/022-export-tab).
     */
    preview(projectId: string, choice: ExportChoice): Promise<ExportPreview>
    cancel(id: string): Promise<void>
    /** Show a finished export's file in the platform's file browser. */
    reveal(id: string): Promise<void>
    /**
     * What this project has produced, newest first (A5.5-21): one row per
     * sidecar in the project's own export folder, read from disk rather
     * than from this session, so it survives a restart. The page names a
     * project and nothing else; the folder is the main process's to work
     * out, and no path comes back.
     */
    outputs(projectId: string): Promise<ExportOutput[]>
    /**
     * Show one of those in the platform's file browser, by the file's own
     * bare name. False when it is no longer there, which is a row that has
     * gone stale rather than a failure: the page re-reads the list and the
     * row says so. The name is checked against the folder's own contents on
     * the main side, so it can never become a path the page chose.
     */
    revealOutput(projectId: string, file: string): Promise<boolean>
    /**
     * Open the platform's folder chooser and store its answer as this
     * project's own export destination (A5.5-19). Takes no path: the main
     * process opens the dialog and applies the answer itself, exactly as
     * Settings does for its two folders, so there is no path here for a
     * page to invent. Answers the record, unchanged when the chooser was
     * cancelled.
     */
    chooseDestination(projectId: string): Promise<ProjectRecord>
    /** Forget this project's own folder; its exports go to the app's again. */
    useAppFolder(projectId: string): Promise<ProjectRecord>
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
   * The jobs the inspector lists (A1-03). Only the copy crosses the bridge:
   * the jobs themselves are the runs the page already keeps. The page sends
   * a job's text, at most 256 KB; the main process takes the secrets out of
   * its web addresses, writes the home folder as `~` and puts it on the
   * clipboard, or refuses (specs/024-jobs, FR-007).
   */
  jobs: {
    copyLog(text: string): Promise<void>
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
    /**
     * Put what a bug report needs on the clipboard: the app's and the
     * engine's versions, the operating system, the last lines of both logs
     * and the reports given here - each project's diagnostics as its own
     * panel copies them, at most twenty of at most 64 KB. The main process
     * composes the text and writes the home folder as `~`; nothing is sent
     * anywhere (specs/023-logs-and-diagnostics).
     */
    copyDiagnostics(reports: string[]): Promise<void>
  }
  /**
   * The first-run check of the bundled LOOM and ffmpeg (A6-02): run once per
   * start by the main process, which spawns the tools itself. The page reads
   * the result and hears each change; nothing it sends reaches a spawn
   * (specs/026-first-run-check).
   */
  firstRun: {
    get(): Promise<FirstRunResult>
    onChanged(listener: (result: FirstRunResult) => void): () => void
    /** Open the install document in the platform's browser. Takes no address: the main process holds it. */
    openInstallGuide(): Promise<void>
  }
  /**
   * The Licences section of Settings (issue 108): whether the notices file,
   * the folder of licence texts and Chromium's licences are there to open,
   * and the three openings. None takes an argument: all three are fixed
   * paths in the app - under its resources, and Chromium's licences beside
   * the executable on Windows - held by the main process
   * (specs/027-licences, FR-004).
   */
  licences: {
    read(): Promise<LicencesView>
    /** `THIRD_PARTY_NOTICES.md` in the platform's default viewer, or shown in its file browser. */
    openNotices(): Promise<void>
    /** The runtime's folder of licence texts in the platform's file browser. */
    showTexts(): Promise<void>
    /** Chromium's licences, as Electron ships them, in the platform's browser. */
    openChromium(): Promise<void>
  }
}

/**
 * What `settings.copyDiagnostics` accepts from the page: at most this many
 * reports, each at most this many bytes of UTF-8. The main side checks it;
 * the page keeps to it so a long session is not refused outright.
 */
export const DIAGNOSTICS_REPORTS = { count: 20, bytes: 64 * 1024 } as const

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
  projectsSetDate: 'projects:set-date',
  projectsSetTheme: 'projects:set-theme',
  projectsSetExport: 'projects:set-export',
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
  exportOutputs: 'export:outputs',
  exportRevealOutput: 'export:reveal-output',
  exportPreview: 'export:preview',
  exportChooseDestination: 'export:choose-destination',
  exportUseAppFolder: 'export:use-app-folder',
  exportProgress: 'export:progress',
  exportSettled: 'export:settled',
  feedsPickZip: 'feeds:pick-zip',
  clipboardWrite: 'clipboard:write',
  jobsCopyLog: 'jobs:copy-log',
  settingsRead: 'settings:read',
  settingsSetTheme: 'settings:set-theme',
  settingsChooseEngineFolder: 'settings:choose-engine-folder',
  settingsChooseExportFolder: 'settings:choose-export-folder',
  settingsDefaultEngineFolder: 'settings:default-engine-folder',
  settingsDefaultExportFolder: 'settings:default-export-folder',
  settingsEngineSize: 'settings:engine-size',
  settingsOpenLogs: 'settings:open-logs',
  settingsResetEngineData: 'settings:reset-engine-data',
  settingsCopyDiagnostics: 'settings:copy-diagnostics',
  firstRunGet: 'first-run:get',
  firstRunChanged: 'first-run:changed',
  firstRunOpenInstallGuide: 'first-run:open-install-guide',
  licencesRead: 'licences:read',
  licencesOpenNotices: 'licences:open-notices',
  licencesShowTexts: 'licences:show-texts',
  licencesOpenChromium: 'licences:open-chromium',
} as const
