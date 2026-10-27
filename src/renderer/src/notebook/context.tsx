import { createContext, useContext, type JSX, type ReactNode } from 'react'
import type { ProjectState } from './useProjectState'

export type { ProjectState } from './useProjectState'

// The shared wiring of a project's screen, reaching the six cells without
// a prop list (A5.5-08).
//
// The record, the runs, the three writers and the refs the handbacks point
// at are read by cells that are built one branch each. Threaded as props
// they would be declared in `ProjectView.tsx`, passed through `Notebook`
// and destructured in every adapter, so a branch that adds one consumer
// would edit three files it does not own and meet every other branch in
// all three. Through a context it edits its own adapter and nothing else.
//
// The providers are composed in one place, `ProjectProviders`, which both
// `ProjectView.tsx` and the unit tests' harness draw, so what a test
// renders a cell under is what the screen renders it under (issue 433).
// It is never null in the tree: `useProject` throws rather than handing
// back a half-made state, because a cell rendered outside the notebook is
// a mistake at build time, not a case to draw an empty panel for.

const ProjectContext = createContext<ProjectState | null>(null)

export const ProjectProvider = ProjectContext.Provider

/** The project screen's state, provided to everything under it. */
export function ProjectProviders({
  state,
  children,
}: {
  state: ProjectState
  children: ReactNode
}): JSX.Element {
  return <ProjectContext.Provider value={state}>{children}</ProjectContext.Provider>
}

/** The project screen's state. Only inside the notebook; it throws outside one. */
export function useProject(): ProjectState {
  const state = useContext(ProjectContext)
  if (state === null) throw new Error('useProject was called outside a project screen’s provider')
  return state
}
