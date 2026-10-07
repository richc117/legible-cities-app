// The Tab walk's trace and its hand-over at a frame (issue 271), without a
// browser: the decisions in `tests/support/tab-walk.ts` over a clock and
// readings written out here. What only the running app shows - what the
// document reads after a `focus()` that crosses out of a frame - is the
// sweep's, in `tests/e2e/notebook-a11y.spec.ts`, and is owed a run on a
// runner (the loop workflow's `load` input repeats it under strain).

import { describe, expect, it } from 'vitest'
import {
  HAND_OVER,
  WalkTrace,
  endMessage,
  handOver,
  missMessage,
  readingLine,
  tallyReadings,
  type HandOverIO,
  type StepAnswer,
} from '../support/tab-walk'

const FRAME = 'iframe "map"'
const ASKED = 'fig-button "03 Frame and service day"'

const read = (state: StepAnswer['state'], at: string, onAimed = false): StepAnswer => ({
  state,
  complete: false,
  at,
  onAimed,
})
const frame = (): StepAnswer => read('frame', FRAME)
const nowhere = (): StepAnswer => read('none', 'nothing')
const elsewhere = (): StepAnswer => read('stop', 'button "Rename"')
const there = (): StepAnswer => read('stop', ASKED, true)

/** The cost of one reading and the pause between two, in the clock's own milliseconds. */
const READ_COST = 5

interface World {
  io: HandOverIO
  asks: boolean[]
  reads: () => number
  clock: () => number
}

/**
 * A page that answers each reading from a script of the time, on a clock
 * only the readings and the pauses move. `asked` is what the first ask
 * answers; `reasked` what each later one does.
 */
function world(
  script: (at: number) => StepAnswer,
  { asked = ASKED as string | null, reasked = ASKED as string | null } = {},
): World {
  let time = 0
  let reads = 0
  const asks: boolean[] = []
  return {
    asks,
    reads: () => reads,
    clock: () => time,
    io: {
      ask: async (again) => {
        asks.push(again)
        return again ? reasked : asked
      },
      read: async () => {
        reads += 1
        time += READ_COST
        return script(time)
      },
      now: () => time,
      pause: async (ms) => {
        time += ms
      },
    },
  }
}

describe('the hand-over at a frame', () => {
  it('has nothing to wait for where nothing is wanted after the frame', async () => {
    const w = world(frame, { asked: null })
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('nothing')
    expect(result.line).toBe(`frame ${FRAME} -> nothing after it`)
    expect(w.reads()).toBe(0)
  })

  it('names what it asked for and what it reached, and how long it waited', async () => {
    const w = world(there)
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
    expect(result.asks).toBe(1)
    expect(result.line).toBe(
      `frame ${FRAME} -> asked for ${ASKED}, reached ${ASKED}, waited ${READ_COST} ms in 1 ask`,
    )
  })

  it('waits through the frame and through nothing for the control it asked for', async () => {
    const script = [frame(), frame(), nowhere(), there()]
    let i = 0
    const w = world(() => script[Math.min(i++, script.length - 1)])
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
    expect(w.reads()).toBe(4)
    expect(w.asks).toEqual([false])
    expect(result.line).toContain(`reached ${ASKED}`)
    expect(result.line).toContain(
      `read ${tallyReadings([readingLine(frame()), readingLine(frame()), readingLine(nowhere())])}`,
    )
  })

  it('does not take some other control for the one it asked for', async () => {
    // The walk used to call any reading that was neither the frame nor
    // nothing "reached": it pressed Tab on from here, and the control asked
    // for was never visited.
    const script = [elsewhere(), elsewhere(), there()]
    let i = 0
    const w = world(() => script[Math.min(i++, script.length - 1)])
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
    expect(w.reads()).toBe(3)
    expect(result.line).toContain(`reached ${ASKED}`)
    expect(result.line).toContain('button "Rename" x2')
  })

  it('asks again, from where focus has gone, when two seconds pass without it', async () => {
    const w = world((at) => (at < 4_500 ? nowhere() : there()))
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
    // The first ask is from the frame; the others are the same question
    // after focus has left it.
    expect(w.asks).toEqual([false, true, true])
    expect(result.asks).toBe(3)
    expect(result.waited).toBeGreaterThanOrEqual(4_500)
    expect(result.waited).toBeLessThan(HAND_OVER.deadlineMs)
  })

  it('gives up at its deadline and says it never reached the control', async () => {
    const w = world(elsewhere)
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('lapsed')
    expect(result.waited).toBeGreaterThanOrEqual(HAND_OVER.deadlineMs)
    expect(result.waited).toBeLessThan(HAND_OVER.deadlineMs + 100)
    expect(w.asks).toEqual([false, true, true])
    expect(result.line).toMatch(
      new RegExp(
        `^frame ${FRAME} -> asked for ${ASKED}, reached nothing, gave up after \\d+ ms in 3 asks; read stop button "Rename" x\\d+$`,
      ),
    )
  })

  it('counts a reading taken at the deadline that is the control as reaching it', async () => {
    const w = world((at) => (at < HAND_OVER.deadlineMs ? frame() : there()))
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
  })

  it('stops waiting when there is nothing left to ask for', async () => {
    // Every control wanted after the frame was read by other means while it
    // waited: the second ask has no question.
    const w = world(frame, { reasked: null })
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('moot')
    expect(result.waited).toBeLessThan(HAND_OVER.deadlineMs)
    expect(result.line).toContain('nothing left to ask for')
    expect(w.asks).toEqual([false, true])
  })
})

describe('the trace of the walk', () => {
  /** A clock that moves 10 ms every time it is read. */
  const ticking = (): (() => number) => {
    let t = 1_000
    return () => (t += 10)
  }

  it('holds the whole walk and not the last twelve presses', () => {
    const trace = new WalkTrace(ticking())
    for (let i = 0; i < 60; i++) trace.press(`stop button "${i}"`)
    const lines = trace.text().split('\n')
    expect(lines).toHaveLength(60)
    expect(lines[0]).toMatch(/^#1 \+\d+ms stop button "0"$/)
    expect(lines[59]).toMatch(/^#60 \+\d+ms stop button "59"$/)
  })

  it('gives each press its number and the time since the walk began', () => {
    const trace = new WalkTrace(ticking())
    trace.press('stop a')
    trace.press('stop b')
    // The clock is read once at the start (1010) and once per press.
    expect(trace.text()).toBe('#1 +10ms stop a\n#2 +20ms stop b')
  })

  it('puts the hand-over in the place of the press that found the frame', () => {
    const trace = new WalkTrace(ticking())
    trace.press('stop a')
    trace.press(`frame ${FRAME}`)
    trace.amend(`frame ${FRAME} -> asked for ${ASKED}, reached ${ASKED}`)
    trace.press('stop b')
    expect(trace.text().split('\n')).toEqual([
      '#1 +10ms stop a',
      `#2 +20ms frame ${FRAME} -> asked for ${ASKED}, reached ${ASKED}`,
      '#3 +30ms stop b',
    ])
  })

  it('has a bound, and says how many presses it let go of', () => {
    const trace = new WalkTrace(ticking(), 5)
    for (let i = 1; i <= 8; i++) trace.press(`stop ${i}`)
    const lines = trace.text().split('\n')
    expect(lines[0]).toBe('(the first 3 presses are not shown)')
    expect(lines).toHaveLength(6)
    expect(lines[1]).toMatch(/^#4 /)
    expect(lines[5]).toMatch(/^#8 /)
  })
})

describe('what the assertions print', () => {
  const trace = (): WalkTrace => {
    const t = new WalkTrace(() => 0)
    t.press('stop button "Rename"')
    t.press(`frame ${FRAME}`)
    t.amend(
      `frame ${FRAME} -> asked for ${ASKED}, reached nothing, gave up after 6010 ms in 3 asks`,
    )
    t.press('repeat button "Rename"')
    return t
  }

  it('prints the walk with a miss, under the first line the issue quotes', () => {
    const message = missMessage(
      'the project, cell 06 open (Night)',
      ['fig-button "Back to Library"'],
      trace(),
    )
    const lines = message.split('\n')
    expect(lines[0]).toBe('the project, cell 06 open (Night): controls the Tab walk did not reach')
    expect(message).toContain(`frame ${FRAME} -> asked for ${ASKED}, reached nothing`)
    expect(message).toContain('#3 +0ms repeat button "Rename"')
  })

  it('keeps the first line and leaves the walk out when nothing was missed', () => {
    expect(missMessage('here', [], trace())).toBe('here: controls the Tab walk did not reach')
  })

  it('prints the walk when it never came back round, and only then', () => {
    expect(endMessage('here', true, trace())).toBe(
      'here: the Tab walk came back round within the deadline',
    )
    const message = endMessage('here', false, trace())
    expect(message.split('\n')[0]).toContain('the Tab walk came back round within the deadline')
    expect(message).toContain('#1 +0ms stop button "Rename"')
  })
})

describe('reading a tally', () => {
  it('counts runs of the same reading in order', () => {
    expect(tallyReadings(['a', 'a', 'a', 'b', 'a'])).toBe('a x3, b, a')
  })

  it('stops after a few runs and says how many it left out', () => {
    expect(tallyReadings(['a', 'b', 'c', 'd'], 2)).toBe('a, b, and 2 more')
  })

  it('marks the reading at which every control had been reached', () => {
    expect(readingLine({ ...there(), complete: true })).toBe(`stop ${ASKED} (all reached)`)
    expect(readingLine(nowhere())).toBe('none nothing')
  })
})
