import { createContext, useContext } from 'react'
import type { ProjectState } from './useProjectState'

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
// There is one provider, in `ProjectView.tsx`, and it is never null in the
// tree: `useProject` throws rather than handing back a half-made state,
// because a cell rendered outside the notebook is a mistake at build time,
// not a case to draw an empty panel for.

const ProjectContext = createContext<ProjectState | null>(null)

export const ProjectProvider = ProjectContext.Provider

/** The project screen's state. Only inside the notebook; it throws outside one. */
export function useProject(): ProjectState {
  const state = useContext(ProjectContext)
  if (state === null) throw new Error('useProject was called outside a project screen’s provider')
  return state
}
