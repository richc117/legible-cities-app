// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (projects) and
// specs/004-sidecar-supervisor/contracts/bridge.md (engine).

import type { EngineState, JobLog, JobProgress } from './engine'
import type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'

export type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'
export type { EngineState, JobLog, JobProgress } from './engine'

/** A request in flight: the token the page uses for progress and cancel, and the answer. */
export interface EngineRequest {
  id: string
  result: Promise<unknown>
}

export interface Api {
  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: string): Promise<ProjectRecord & { readOnly: boolean }>
    create(input: CreateProjectInput): Promise<ProjectRecord>
    rename(id: string, name: string): Promise<ProjectRecord>
    delete(id: string): Promise<DeleteResult>
  }
  // Untyped beyond "a method name and an object" on purpose: A1-02
  // generates the methods from the engine's schema and wraps this.
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
  engineState: 'engine:state',
  engineRequest: 'engine:request',
  engineCancel: 'engine:cancel',
  engineStateChanged: 'engine:state-changed',
  engineProgress: 'engine:progress',
  engineLog: 'engine:log',
} as const
