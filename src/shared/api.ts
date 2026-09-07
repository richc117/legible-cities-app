// The bridge's contract, imported by both the preload script and the
// renderer, so a change to the shape is a type error on whichever side did
// not follow. See specs/001-electron-skeleton/contracts/bridge.md.

export interface ProjectSummary {
  id: string
  name: string
}

export interface Api {
  library: {
    /** Always empty in the skeleton; A1-05 gives it content. */
    list(): Promise<ProjectSummary[]>
  }
}

export const CHANNELS = {
  libraryList: 'library:list',
} as const
