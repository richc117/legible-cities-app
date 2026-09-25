import type { JSX } from 'react'
import { LAYOUT_STAGES } from '../../shared/layout'
import ProgressLine, { type Stage } from './ProgressLine'
import { inWords } from './stages'

// Sample data for the progress line, reached through ?progress-preview on
// the interface's URL in development and in the end-to-end test; nothing
// in the app navigates here; the layout run (LayoutRun.tsx) drives the
// real stages.
const STAGES = ['gtfs2graph', 'topo', 'loom', 'octi']

function sample(states: Stage['state'][], message?: string): Stage[] {
  return STAGES.map((label, i) => ({
    id: label,
    label,
    state: states[i],
    message: states[i] === 'running' || states[i] === 'failed' ? message : undefined,
  }))
}

function counted(labels: readonly string[], running: number): Stage[] {
  return labels.map((label, i) => ({
    id: label,
    label,
    state: i < running ? 'done' : i === running ? 'running' : 'pending',
  }))
}

export default function ProgressPreview(): JSX.Element {
  return (
    <main className="panel" aria-labelledby="preview-heading">
      <h1 id="preview-heading">Progress line</h1>
      <ProgressLine
        stages={sample(['pending', 'pending', 'pending', 'pending'])}
        ariaLabel="Four stages, none started"
      />
      <ProgressLine
        stages={sample(['done', 'running', 'pending', 'pending'], 'topo: 111 nodes, 113 edges')}
        ariaLabel="Four stages, topo running"
      />
      <ProgressLine
        stages={sample(['done', 'done', 'done', 'done'])}
        ariaLabel="Four stages, all done"
      />
      <ProgressLine
        stages={sample(['done', 'done', 'failed', 'pending'], 'loom failed (137): out of memory')}
        ariaLabel="Four stages, loom failed"
      />
      {/* The counts a run really has, at both ends: a feed add's download
          alone, and the layout run's own eight stages - the last in the
          words the app draws them in (A5.5-10), so the design system's page
          does not show a vocabulary the app has stopped using. The four
          lines above keep the engine's names, because their sentences are
          the engine's and the two are read together. */}
      <ProgressLine stages={counted(['download'], 0)} ariaLabel="One stage, downloading" />
      <ProgressLine
        stages={inWords(counted(LAYOUT_STAGES, 4))}
        ariaLabel="The layout run's eight stages, trips running"
      />
    </main>
  )
}
