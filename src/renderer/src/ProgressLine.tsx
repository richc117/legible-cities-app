import type { JSX } from 'react'

// The app's one signature component (docs/DESIGN.md, section 10 and section
// 8.2's progress row): a run's stages as round stations on a line, the line
// reaching as far as the run has got, a finished stage filled, the running
// one ringed in the accent, a failed one in the error colour. The line comes
// in from the left and turns onto the stations on a rounded quarter-circle
// bend, never a 45-degree join; the bend's radius is the rail's own weight,
// which is what makes a bend's inner radius a third of its outer.
//
// Lengths are grid units in the SVG's own space, not pixels. Every station
// is the same pair of circles and its state is a class: the stylesheet turns
// the class into a small dot, a filled station, a ring, or a ring with its
// centre filled, so a change of state transitions in place and no state is
// told apart by colour alone. Under reduced motion nothing transitions.

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
/** Where the first station sits. */
const FIRST = 2 * UNIT
/** A station's radius. */
const STATION = 5
/** How thick the line is drawn, rail and ring alike. */
const WEIGHT = 3
/**
 * The bend's centreline radius, which is the line's own weight: that is
 * exactly what makes a bend's inner radius (WEIGHT / 2) a third of its outer
 * (3 * WEIGHT / 2), as docs/DESIGN.md section 10 asks. Both come from this
 * one constant, rather than a number here and another in the stylesheet,
 * because a rail drawn thicker would otherwise change the ratio in silence.
 */
const BEND = WEIGHT
/** How far below the line the rail comes in from the left. */
const LEAD = UNIT
/** The stub and the quarter-circle, before the rail runs straight. */
const LEAD_LENGTH = LEAD - BEND + (Math.PI / 2) * BEND
/** The rail's own length units, so a dash can cut it short. */
const RAIL_LENGTH = 100

/** In from the left, onto the line on a quarter-circle bend, then straight
 * through every station. */
function rail(lastX: number): string {
  return `M 0,${LINE_Y + LEAD} V ${LINE_Y + BEND} A ${BEND},${BEND} 0 0 1 ${BEND},${LINE_Y} H ${lastX}`
}

/** How far along the rail the run has got, in its length units: the furthest
 * station that is no longer pending is where the line stops. */
function reached(stages: Stage[], lastX: number): number {
  let furthest = -1
  stages.forEach((stage, i) => {
    if (stage.state !== 'pending') furthest = i
  })
  if (furthest < 0) return 0
  const whole = LEAD_LENGTH + (lastX - BEND)
  const gone = LEAD_LENGTH + (FIRST + furthest * STEP - BEND)
  return Math.round((gone / whole) * RAIL_LENGTH * 10) / 10
}

/** A station: the circle the state shapes, and the core only a failed one
 * shows. Both are always drawn, so a state change is a transition. The ring
 * takes the line's weight and no vector effect: where the window is too
 * narrow for the drawing, all of it scales down together rather than the
 * stations keeping their weight over a line that has lost its. */
function station(x: number, state: StageState): JSX.Element {
  return (
    <>
      <circle
        className={`mark mark-${state}`}
        cx={x}
        cy={LINE_Y}
        r={STATION}
        strokeWidth={WEIGHT}
      />
      <circle className={`core core-${state}`} cx={x} cy={LINE_Y} r={STATION} />
    </>
  )
}

export default function ProgressLine({ stages, ariaLabel }: Props): JSX.Element {
  const last = FIRST + Math.max(0, stages.length - 1) * STEP
  const width = last + 2 * UNIT
  const path = rail(last)
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
        {/* The whole rail, then as much of it as the run has covered: the
            same path, dashed to the station the run has got to. */}
        <path className="line" d={path} strokeWidth={WEIGHT} />
        <path
          className="line line-reached"
          d={path}
          strokeWidth={WEIGHT}
          pathLength={RAIL_LENGTH}
          style={{
            strokeDasharray: RAIL_LENGTH,
            strokeDashoffset: RAIL_LENGTH - reached(stages, last),
          }}
        />
        {stages.map((stage, i) => {
          const x = FIRST + i * STEP
          return (
            <g key={stage.id}>
              {station(x, stage.state)}
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
