// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (projects) and
// specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import type { EngineErrorShape, EngineState, JobLog, JobProgress } from './engine'
import type { LayoutDone, LayoutResult } from './layout'
import type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'

export type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'
export type { EngineState, JobLog, JobProgress } from './engine'
export type { LayoutDone, LayoutResult } from './layout'

/** A request in flight: the token the page uses for progress and cancel, and the answer. */
export interface EngineRequest {
  id: string
  result: Promise<unknown>
}

/** What `engine:request` answers at once: started, or refused before it started. */
export type EngineAccepted = { accepted: true } | { accepted: false; error: EngineErrorShape }

/**
 * How a request ends, sent on the same ordered channel as its progress and
 * log lines, so the page never sees the answer before the last notification
 * (an invoke reply is not ordered against events; see specs/004 research.md).
 */
export type EngineSettled =
  { id: string; ok: true; result: unknown } | { id: string; ok: false; error: EngineErrorShape }

export interface Api {
  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: string): Promise<ProjectRecord & { readOnly: boolean }>
    create(input: CreateProjectInput): Promise<ProjectRecord>
    rename(id: string, name: string): Promise<ProjectRecord>
    delete(id: string): Promise<DeleteResult>
    /**
     * A layout run finished: the day it was drawn for and the stage graphs
     * the engine named. The main process reads those files, derives the
     * layout's identifier and writes the record; the page never sees a path
     * of its own (specs/007-layout-run/contracts/bridge.md).
     */
    completeLayout(id: string, done: LayoutDone): Promise<LayoutResult>
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
}

export const CHANNELS = {
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsDelete: 'projects:delete',
  projectsCompleteLayout: 'projects:complete-layout',
  engineState: 'engine:state',
  engineRequest: 'engine:request',
  engineCancel: 'engine:cancel',
  engineStateChanged: 'engine:state-changed',
  engineSettled: 'engine:settled',
  engineProgress: 'engine:progress',
  engineLog: 'engine:log',
} as const
