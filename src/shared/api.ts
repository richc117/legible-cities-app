// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (projects) and
// specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import type { EngineErrorShape, EngineState, JobLog, JobProgress } from './engine'
import type { ExportProgress, ExportResult, OfferedPreset } from './export'
import type { LayoutDone, LayoutResult } from './layout'
import type { ViewerMethod } from './viewer'
import type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'

export type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'
export type { EngineState, JobLog, JobProgress } from './engine'
export type { ExportProgress, ExportResult, OfferedPreset } from './export'
export type { LayoutDone, LayoutResult } from './layout'

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
  export: {
    run(projectId: string, preset: OfferedPreset): ExportRequest
    cancel(id: string): Promise<void>
    /** Show a finished export's file in the platform's file browser. */
    reveal(id: string): Promise<void>
    onProgress(listener: (progress: ExportProgress) => void): () => void
  }
}

export const CHANNELS = {
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsDelete: 'projects:delete',
  projectsCompleteLayout: 'projects:complete-layout',
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
} as const
