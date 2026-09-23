import type { JSX } from 'react'
import ProgressLine, { type Stage } from './ProgressLine'

// Sample data for the progress line, reached through ?progress-preview on
// the interface's URL in development and in the end-to-end test; nothing
// in the app navigates here; the layout run (LayoutRun.tsx) drives the
// real stages.
const STAGES = ['gtfs2graph', 'topo', 'loom', 'octi']

// The counts a run really has: the layout run's eight, the export's three
// and a feed add's two, with one at the short end.
const EIGHT = ['read', 'gtfs2graph', 'topo', 'loom', 'octi', 'render', 'schedule', 'animate']

function sample(states: Stage['state'][], message?: string): Stage[] {
  return STAGES.map((label, i) => ({
    id: label,
    label,
    state: states[i],
    message: states[i] === 'running' || states[i] === 'failed' ? message : undefined,
  }))
}

function counted(labels: string[], running: number): Stage[] {
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
      <ProgressLine stages={counted(['download'], 0)} ariaLabel="One stage, downloading" />
      <ProgressLine stages={counted(EIGHT, 4)} ariaLabel="Eight stages, octi running" />
    </main>
  )
}
