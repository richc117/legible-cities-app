import type { JSX } from 'react'
import { ProjectProvider } from './notebook/context'
import Notebook from './notebook/Notebook'
import Preview from './notebook/Preview'
import ProjectFooter from './notebook/ProjectFooter'
import ProjectHeader from './notebook/ProjectHeader'
import Rail from './notebook/Rail'
import { useProjectState } from './notebook/useProjectState'

// A project's screen: the notebook of six cells (ADR-045, docs/DESIGN.md
// 9), replacing the tab strip and the column of panels it grew into.
//
// Composition only. Everything the screen holds is in `useProjectState`
// and reaches the cells through the context, so a branch that adds a
// control to a cell edits that cell's file under `notebook/cells/` and
// this one is not opened at all. That is deliberate: an audit of this
// milestone found fourteen of its nineteen open issues editing the file
// this used to be.
//
// The four regions of DESIGN.md section 9 are the rail, the notebook, the
// pinned preview and the inspector. Three are here; the inspector is the
// window's and is drawn by `App.tsx` beside all three screens (ADR-036).

interface Props {
  id: string
  /** Back to the Library, with an optional sentence for it to show. */
  onBack: (notice?: string) => void
}

export default function ProjectView({ id, onBack }: Props): JSX.Element {
  const state = useProjectState(id, onBack)
  return (
    <ProjectProvider value={state}>
      <main className="panel project" aria-labelledby="project-heading">
        <ProjectHeader />
        <Rail />
        <Notebook />
        <Preview />
        <ProjectFooter />
      </main>
    </ProjectProvider>
  )
}
