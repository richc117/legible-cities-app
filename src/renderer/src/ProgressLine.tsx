import type { JSX } from 'react'

// The app's one signature component (docs/DESIGN.md, section 10): a run's
// stages as ticks on a line, the running stage a hollow diamond in the
// accent, a finished one a filled tick, a failed one in the error colour,
// the line beginning with a 45-degree lead-in. Lengths are grid units in
// the SVG's own space, not pixels. Every mark is the same square, and its
// state is a class: the stylesheet turns the class into a tick, a filled
// tick or a diamond with a transform and the tokens' colours, so a change
// of state transitions in place. Under reduced motion nothing transitions.

export type StageState = 'pending' | 'running' | 'done' | 'failed'

export interface Stage {
  id: string
  label: string
  state: StageState
  /** The engine's sentence for the stage, shown beside the line when current. */
  message?: string
}

interface Props {
  stages: Stage[]
  /** The sentence assistive technology reads for the whole line. */
  ariaLabel: string
}

const UNIT = 8
const STEP = 12 * UNIT
const LINE_Y = 2 * UNIT
const LABEL_Y = 5 * UNIT

function mark(x: number, state: StageState): JSX.Element {
  return (
    <rect
      className={`mark mark-${state}`}
      x={x - UNIT / 2}
      y={LINE_Y - UNIT / 2}
      width={UNIT}
      height={UNIT}
      rx={1}
      vectorEffect="non-scaling-stroke"
    />
  )
}

export default function ProgressLine({ stages, ariaLabel }: Props): JSX.Element {
  const first = 2 * UNIT
  const last = first + Math.max(0, stages.length - 1) * STEP
  const width = last + 2 * UNIT
  const current =
    stages.find((s) => s.state === 'running') ?? stages.find((s) => s.state === 'failed')
  return (
    <div className="progress">
      <svg
        width={width}
        height={LABEL_Y + UNIT}
        viewBox={`0 0 ${width} ${LABEL_Y + UNIT}`}
        role="img"
        aria-label={ariaLabel}
      >
        {/* The 45-degree lead-in, then the line through every stage. */}
        <polyline
          className="line"
          points={`0,${LINE_Y + UNIT} ${UNIT},${LINE_Y} ${last},${LINE_Y}`}
        />
        {stages.map((stage, i) => {
          const x = first + i * STEP
          return (
            <g key={stage.id}>
              {mark(x, stage.state)}
              <text
                className={stage === current ? 'label label-current' : 'label'}
                x={x}
                y={LABEL_Y}
                textAnchor="middle"
              >
                {stage.label}
              </text>
            </g>
          )
        })}
      </svg>
      {current?.message && <p className="progress-message">{current.message}</p>}
    </div>
  )
}
