import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { RenderStageResult, StageName } from '../../shared/protocol'
import type { ProjectRecord } from '../../shared/project'
import { fit, keyed, pan, zoomAt, type View } from './engine/stages'
import Button from './kit/Button'

// Two stages of the layout, drawn where they run: as the feed draws its
// routes (gtfs2graph), and after LOOM has sorted the lines onto shared
// track (loom), before anything is straightened. The drawing is the
// engine's SVG in a frame with an empty sandbox: no script runs in it and
// it has no origin; pan and zoom are transforms on the frame from here
// (spec 016, ADR-028). The counts are the engine's, shown as sent.

export const STAGES: { stage: StageName; label: string; gloss: string }[] = [
  { stage: 'gtfs2graph', label: 'gtfs2graph', gloss: 'as the feed draws its routes' },
  { stage: 'loom', label: 'loom', gloss: 'lines sorted onto shared track' },
]

/** The pane's frame takes no permission at all: the whole of its sandbox. */
export const STAGE_SANDBOX = ''

/** The width the engine draws at: the pane's own, at most this, so a large network stays sharp. */
export const DRAW_WIDTH = 1600

interface Props {
  project: ProjectRecord
  engine: EngineState | null
  read: (
    key: string,
    layout: string,
    made: string | null,
    stage: StageName,
    width: number,
  ) => Promise<RenderStageResult>
}

type State =
  | { status: 'waiting' }
  | { status: 'ready'; drawing: RenderStageResult }
  | { status: 'failed'; message: string }

export default function StageView({ project, engine, read }: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const [stage, setStage] = useState<StageName>('gtfs2graph')
  const [state, setState] = useState<State>({ status: 'waiting' })
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  const pane = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ x: number; y: number } | null>(null)
  const layout = project.layout

  useEffect(() => {
    if (!ready || layout === null) {
      setState({ status: 'waiting' })
      return
    }
    let left = false
    setState({ status: 'waiting' })
    read(project.feed, layout, project.made, stage, DRAW_WIDTH).then(
      (drawing) => {
        if (left) return
        setState({ status: 'ready', drawing })
        const box = pane.current?.getBoundingClientRect()
        setView(
          fit(drawing, box ? { width: box.width, height: box.height } : { width: 0, height: 0 }),
        )
      },
      (error: unknown) => {
        if (left) return
        const reason = error as { data?: { hint?: string }; message?: string }
        setState({
          status: 'failed',
          message: withoutPaths(
            reason.data?.hint ?? reason.message ?? 'The stage could not be drawn.',
          ),
        })
      },
    )
    return () => {
      left = true
    }
  }, [ready, project.feed, layout, project.made, stage, read])

  const paneSize = (): { width: number; height: number } => {
    const box = pane.current?.getBoundingClientRect()
    return box ? { width: box.width, height: box.height } : { width: 0, height: 0 }
  }

  const onWheel = useCallback((event: WheelEvent): void => {
    event.preventDefault()
    const box = pane.current?.getBoundingClientRect()
    if (!box) return
    const at = { x: event.clientX - box.left, y: event.clientY - box.top }
    setView((v) => zoomAt(v, event.deltaY < 0 ? 1.1 : 1 / 1.1, at))
  }, [])

  // The wheel listener is attached by hand: React's is passive, and a
  // passive listener cannot keep the page from scrolling under the pane.
  useEffect(() => {
    const element = pane.current
    if (!element) return
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [onWheel])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === '0') {
      if (state.status === 'ready') setView(fit(state.drawing, paneSize()))
      event.preventDefault()
      return
    }
    const next = keyed(view, event.key, paneSize())
    if (next === null) return
    event.preventDefault()
    setView(next)
  }

  const drawing = state.status === 'ready' ? state.drawing : null
  const counts = drawing?.counts ?? null
  const current = STAGES.find((s) => s.stage === stage) ?? STAGES[0]

  return (
    <section className="stage-view" aria-labelledby="stage-heading">
      <h2 id="stage-heading">Where the routes run</h2>
      <div className="toolbar" role="group" aria-label="Stage">
        {STAGES.map((s) => (
          <Button
            key={s.stage}
            variant={s.stage === stage ? 'primary' : 'secondary'}
            aria-pressed={s.stage === stage}
            onClick={() => setStage(s.stage)}
          >
            {s.label}
          </Button>
        ))}
        <span className="hint">{current.gloss}</span>
      </div>
      {counts !== null && (
        <dl className="fields counts" aria-label="Counts">
          <dt>Nodes</dt>
          <dd>{counts.nodes.toLocaleString()}</dd>
          <dt>Stations</dt>
          <dd>{counts.stations.toLocaleString()}</dd>
          <dt>Junctions</dt>
          <dd>{counts.junctions.toLocaleString()}</dd>
          <dt>Edges</dt>
          <dd>{counts.edges.toLocaleString()}</dd>
          <dt>Lines</dt>
          <dd>{counts.lines.length.toLocaleString()}</dd>
        </dl>
      )}
      <div
        ref={pane}
        className="stage-pane"
        tabIndex={0}
        role="img"
        aria-label={`The ${current.label} stage, ${current.gloss}; zoom with plus and minus, pan with the arrows, 0 to fit`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = { x: event.clientX, y: event.clientY }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          const from = dragging.current
          if (from === null) return
          dragging.current = { x: event.clientX, y: event.clientY }
          setView((v) => pan(v, event.clientX - from.x, event.clientY - from.y))
        }}
        onPointerUp={() => {
          dragging.current = null
        }}
        onPointerCancel={() => {
          dragging.current = null
        }}
      >
        {drawing !== null && (
          <iframe
            className="stage-frame"
            sandbox={STAGE_SANDBOX}
            srcDoc={drawing.svg}
            title={`${current.label} stage of the layout`}
            tabIndex={-1}
            aria-hidden="true"
            style={{
              width: drawing.width,
              height: drawing.height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            }}
          />
        )}
        {state.status === 'waiting' && (
          <p className="hint" role="status">
            {layout === null
              ? 'Lay the project out to see where its routes run.'
              : ready
                ? 'Drawing the stage…'
                : 'The engine is not ready, so the stage cannot be drawn yet.'}
          </p>
        )}
        {state.status === 'failed' && (
          <p className="message error" role="alert">
            {state.message}
          </p>
        )}
      </div>
    </section>
  )
}
