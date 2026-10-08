import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from 'react'
import type { EngineState } from '../../shared/engine'
import { withoutPaths } from '../../shared/engine'
import type { RenderStageResult, StageName } from '../../shared/protocol'
import { drawnDate, type ProjectRecord } from '../../shared/project'
import {
  DRAW_WIDTH,
  STAGES,
  STAGES_EXPLAINED,
  STAGE_SANDBOX,
  fit,
  frameDocument,
  keyed,
  pan,
  zoomAt,
  type View,
} from './engine/stages'
import Icon from './icons/Icon'
import Button from './kit/Button'
import Disclosure from './kit/Disclosure'
import {
  WORDS_GROUP,
  WORDS_SUMMARY,
  networkWords,
  paneName,
  readDescription,
  type NetworkWords,
} from './networkWords'

// Two stages of the layout, drawn where they run: as the feed draws its
// routes (gtfs2graph), and after LOOM has sorted the lines onto shared
// track (loom), before anything is straightened. The drawing is the
// engine's SVG in a frame with an empty sandbox: no script runs in it and
// it has no origin; pan and zoom are transforms on the frame from here
// (spec 016, ADR-028). The counts are the engine's, shown as sent.
//
// The drawing is hidden from assistive technology, so the pane's text
// alternative is the engine's `description` of the same stage graph, in two
// parts (issue 105, spec 031): the pane's name carries the stage and its
// counts, and a disclosure after the keys hint, "The network in words",
// holds the extent and one item per line. The words are `networkWords.ts`'s
// and are drawn here as text nodes; this file orders and computes nothing.

interface Props {
  project: ProjectRecord
  engine: EngineState | null
  read: (
    key: string,
    layout: string,
    made: string | null,
    stage: StageName,
    width: number,
    date: string | null,
  ) => Promise<RenderStageResult>
}

type State =
  | { status: 'waiting' }
  | { status: 'ready'; drawing: RenderStageResult }
  | { status: 'failed'; message: string }

/** A toggle's contents: the cell row's chevron, decorative, then the words that name it. */
const toggleSummary = (text: string): JSX.Element => (
  <>
    <Icon name="chevron" size={16} className="cell-chevron" />
    {text}
  </>
)

interface WordsProps {
  words: NetworkWords
  open: boolean
  onToggle: (open: boolean) => void
  /** The lines whose station lists are open, by label. */
  openLines: ReadonlySet<string>
  onToggleLine: (label: string, open: boolean) => void
}

/**
 * The long alternative (FR-003): one disclosure, closed, holding the extent
 * sentence and a list with one item per line, each with a disclosure of its
 * own for the stations in order (FR-005). Memoised: the pane re-renders on
 * every pointer move of a pan, and the words do not change with it. A
 * station list is mounted only while it is open, so a network of forty lines
 * puts forty buttons in the document and no stations.
 */
export const NetworkInWords = memo(function NetworkInWords({
  words,
  open,
  onToggle,
  openLines,
  onToggleLine,
}: WordsProps): JSX.Element {
  return (
    <div className="network-words">
      <Disclosure
        className="network-words-toggle"
        open={open}
        onToggle={onToggle}
        label={WORDS_GROUP}
        summary={toggleSummary(WORDS_SUMMARY)}
      >
        {words.extent !== null && <p className="prose network-extent">{words.extent}</p>}
        <ul className="network-lines">
          {words.lines.map((line) => {
            const lineOpen = openLines.has(line.label)
            return (
              <li key={line.label} className="network-line">
                <p className="prose">{line.sentence}</p>
                <Disclosure
                  className="network-words-toggle"
                  open={lineOpen}
                  onToggle={(next) => onToggleLine(line.label, next)}
                  label={line.group}
                  summary={toggleSummary(line.disclosure)}
                >
                  {lineOpen && (
                    <>
                      <ol className="network-stations">
                        {line.stations.map((name, i) => (
                          <li key={i}>{name}</li>
                        ))}
                      </ol>
                      {line.further.map((piece, i) => (
                        <div key={i}>
                          <p className="hint">{piece.heading}</p>
                          <ol className="network-stations">
                            {piece.stations.map((name, j) => (
                              <li key={j}>{name}</li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </>
                  )}
                </Disclosure>
              </li>
            )
          })}
        </ul>
      </Disclosure>
    </div>
  )
})

export default function StageView({ project, engine, read }: Props): JSX.Element {
  const ready = engine?.state === 'ready'
  const [stage, setStage] = useState<StageName>('gtfs2graph')
  const [state, setState] = useState<State>({ status: 'waiting' })
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 })
  // Whether "The network in words" is open, and which lines' station lists
  // are: the component's own, so a toggle between stages keeps them (the
  // words follow the stage shown, a person's place in them stays).
  const [wordsOpen, setWordsOpen] = useState(false)
  const [openLines, setOpenLines] = useState<ReadonlySet<string>>(() => new Set())
  const pane = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ x: number; y: number } | null>(null)
  // The set the view was fitted to: a toggle between stages keeps the pan
  // and zoom, so the two can be compared; a new set is fitted afresh.
  const fittedTo = useRef<string | null>(null)
  const layout = project.layout
  // The day the description's minutes are of: the day the map on screen was
  // drawn for, which is the day its sentence says ("On the day drawn"). A
  // day chosen and not yet drawn is not it (A5.5-15), and asking for each
  // day as it is chosen would have the engine read a timetable for a day
  // nothing shows. Null before a first layout: no day is sent, and the
  // engine answers an untimed description.
  const day = drawnDate(project)

  useEffect(() => {
    if (!ready || layout === null) {
      setState({ status: 'waiting' })
      setLoading(false)
      return
    }
    let left = false
    // The last drawing stays on screen while the next arrives, so a toggle
    // is a change of picture rather than a blank between two.
    setLoading(true)
    read(project.feed, layout, project.made, stage, DRAW_WIDTH, day).then(
      (drawing) => {
        if (left) return
        setLoading(false)
        setState({ status: 'ready', drawing })
        const set = `${layout}/${project.made ?? ''}`
        if (fittedTo.current !== set) {
          fittedTo.current = set
          const box = pane.current?.getBoundingClientRect()
          setView(
            fit(drawing, box ? { width: box.width, height: box.height } : { width: 0, height: 0 }),
          )
        }
      },
      (error: unknown) => {
        if (left) return
        setLoading(false)
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
  }, [ready, project.feed, layout, project.made, stage, day, read])

  const paneSize = (): { width: number; height: number } => {
    const box = pane.current?.getBoundingClientRect()
    return box ? { width: box.width, height: box.height } : { width: 0, height: 0 }
  }

  // The wheel zooms only while the pane has focus, or under a pinch (which
  // arrives with ctrlKey), so a person scrolling the screen with the
  // pointer over the pane is not stopped and zoomed instead; a horizontal
  // wheel is not a zoom at all.
  const onWheel = useCallback((event: WheelEvent): void => {
    const element = pane.current
    if (!element) return
    if (document.activeElement !== element && !event.ctrlKey) return
    event.preventDefault()
    if (event.deltaY === 0) return
    const box = element.getBoundingClientRect()
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
  // What the engine sent as the description, if it sent one: an older pin
  // sends none, and then there is no disclosure and the pane keeps the name
  // it had before the description existed (spec 031, edge cases).
  const described = useMemo(() => readDescription(drawing?.description), [drawing])
  const words = useMemo(() => (described === null ? null : networkWords(described)), [described])
  // The name follows the drawing on screen, which stays while the next
  // stage arrives, so the counts in it are those of the stage it names.
  const shown = STAGES.find((s) => s.stage === drawing?.stage) ?? current
  const name =
    counts !== null && words !== null
      ? paneName(shown, counts)
      : `The ${current.label} stage, ${current.gloss}`
  const toggleLine = useCallback((label: string, open: boolean): void => {
    setOpenLines((was) => {
      const next = new Set(was)
      if (open) next.add(label)
      else next.delete(label)
      return next
    })
  }, [])

  const idle = state.status === 'waiting' && !loading
  return (
    <section className="stage-view" aria-labelledby="stage-heading">
      {/* The second of cell 01's two sections, and the one whose contents a
          screen reader cannot read at all: the pane is a picture. The
          heading is how a person is told what the unreadable part is and
          where it starts, so it stays; it is a level below the cell's, as
          cell 05's two sections are (A5.5-18, issue 197). */}
      <h3 id="stage-heading">Where the routes run</h3>
      <p id="stage-explain" className="prose">
        {STAGES_EXPLAINED}
      </p>
      <div className="toolbar" role="group" aria-label="Stage" aria-describedby="stage-explain">
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
      {/* The sentences sit beside the pane, not in it: a group's children
          are read, a picture's are not. */}
      {(idle || loading) && (
        <p className="hint" role="status">
          {layout === null
            ? 'Lay the project out to see where its routes run.'
            : !ready
              ? 'The engine is not ready, so the stage cannot be drawn yet.'
              : 'Drawing the stage…'}
        </p>
      )}
      {state.status === 'failed' && (
        <p className="message error" role="alert">
          {state.message}
        </p>
      )}
      <div
        ref={pane}
        className="stage-pane"
        tabIndex={0}
        role="group"
        aria-label={name}
        aria-describedby="stage-keys"
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return
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
            srcDoc={frameDocument(drawing.svg)}
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
        {/* A pane of glass over the frame: every pointer and wheel event
            lands here and bubbles to the pane, so nothing inside the frame
            ever sees a pointer and the pane owns its input whatever the
            frame's process or style. */}
        <div className="stage-glass" aria-hidden="true" />
      </div>
      <p id="stage-keys" className="hint">
        Zoom with the wheel or plus and minus, pan by dragging or with the arrows, 0 to fit.
      </p>
      {words !== null && (
        <NetworkInWords
          words={words}
          open={wordsOpen}
          onToggle={setWordsOpen}
          openLines={openLines}
          onToggleLine={toggleLine}
        />
      )}
    </section>
  )
}
