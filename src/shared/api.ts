// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/003-project/contracts/bridge.md (which replaced the
// skeleton's placeholder library.list()).

import type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'

export type { CreateProjectInput, DeleteResult, ProjectRecord, ProjectSummary } from './project'

export interface Api {
  projects: {
    list(): Promise<ProjectSummary[]>
    get(id: string): Promise<ProjectRecord & { readOnly: boolean }>
    create(input: CreateProjectInput): Promise<ProjectRecord>
    rename(id: string, name: string): Promise<ProjectRecord>
    delete(id: string): Promise<DeleteResult>
  }
}

export const CHANNELS = {
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsDelete: 'projects:delete',
} as const
