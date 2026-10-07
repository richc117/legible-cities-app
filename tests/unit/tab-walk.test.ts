// The Tab walk's trace and its hand-over at a frame (issue 271), without a
// browser: the decisions in `tests/support/tab-walk.ts` over a clock and
// readings written out here. What only the running app shows - what the
// document reads after a `focus()` that crosses out of a frame - is the
// sweep's, in `tests/e2e/notebook-a11y.spec.ts`, and is owed a run on a
// runner (the loop workflow's `load` input repeats it under strain).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HAND_OVER,
  SETTLE,
  TRACE_LIMIT,
  WalkTrace,
  crossingOf,
  endMessage,
  handOver,
  handOverAtLapse,
  missMessage,
  readingLine,
  settleNone,
  tallyReadings,
  type Crossing,
  type HandOverIO,
  type LapseFacts,
  type LapseIO,
  type Settled,
  type SettleIO,
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

  it('names the control a later ask put focus on when that is a different one', async () => {
    // The control first asked for went away (a cell closed, a panel
    // replaced) and the second ask found the next one wanted after the
    // frame: the document then reads focus on that one, and the line has to
    // say it was that one that was asked for.
    const OTHER = 'fig-button "04 Style"'
    // Focus lands on the new target only once the second ask has been made.
    const w: World = world(() => (w.asks.includes(true) ? read('stop', OTHER, true) : nowhere()), {
      reasked: OTHER,
    })
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('landed')
    expect(w.asks).toEqual([false, true])
    expect(result.line).toContain(`asked for ${OTHER}, reached ${OTHER}`)
    expect(result.line).not.toContain(ASKED)
  })

  it('names the control last asked for when it gives up', async () => {
    const OTHER = 'fig-button "04 Style"'
    const w = world(elsewhere, { reasked: OTHER })
    const result = await handOver(w.io, FRAME)
    expect(result.kind).toBe('lapsed')
    expect(result.line).toContain(`asked for ${OTHER}, reached nothing`)
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

describe('a press that is read as nothing', () => {
  const NEXT = 'button "03Frameandservicedayready"'
  const landedOn = (): StepAnswer => read('stop', NEXT)

  interface Boundary {
    io: SettleIO
    reads: () => number
    clock: () => number
  }

  /**
   * A page whose focus is still crossing a process boundary until
   * `crossesFor` milliseconds have passed, and then reads `after`. The
   * readings are drawn from a clock only the readings and the pauses move,
   * and a settle that never stops fails rather than hangs. A reading costs
   * `cost` milliseconds: a page that answers slowly, as one under load does.
   */
  function crossing(
    crossesFor: number,
    after: () => StepAnswer,
    cost: number = READ_COST,
  ): Boundary {
    let time = 0
    let reads = 0
    return {
      reads: () => reads,
      clock: () => time,
      io: {
        read: async () => {
          reads += 1
          time += cost
          if (reads > 10_000) throw new Error('the settle never stopped waiting')
          return time < crossesFor ? nowhere() : after()
        },
        now: () => time,
        pause: async (ms) => {
          time += ms
        },
      },
    }
  }

  it('is recorded as the control focus lands on when that comes within the deadline', async () => {
    // The walk used to press again here and read the control after this one.
    const c = crossing(85, landedOn)
    const settled = await settleNone(c.io, nowhere())
    expect(settled.answer).toMatchObject({ state: 'stop', at: NEXT })
    expect(settled.waited).toBeGreaterThanOrEqual(85)
    expect(settled.waited).toBeLessThan(SETTLE.deadlineMs)
    expect(settled.note).toMatch(
      new RegExp(`^none -> stop ${NEXT.replace(/[()]/g, '\\$&')} after \\d+ ms$`),
    )
  })

  it('goes to the hand-over when it settles to the frame', async () => {
    const c = crossing(40, frame)
    const settled = await settleNone(c.io, nowhere())
    expect(settled.answer.state).toBe('frame')
    expect(settled.note).toMatch(/^none -> frame iframe "map" after \d+ ms$/)
  })

  it('hands on whatever it settles to as it found it', async () => {
    for (const state of ['same', 'repeat'] as const) {
      const c = crossing(30, () => read(state, 'button "Rename"'))
      const settled = await settleNone(c.io, nowhere())
      expect(settled.answer).toMatchObject({ state, at: 'button "Rename"' })
    }
  })

  it('presses on after the deadline when nothing settles, and says so', async () => {
    const c = crossing(Number.POSITIVE_INFINITY, landedOn)
    const settled = await settleNone(c.io, nowhere())
    expect(settled.answer.state).toBe('none')
    expect(settled.waited).toBeGreaterThanOrEqual(SETTLE.deadlineMs)
    expect(settled.waited).toBeLessThan(SETTLE.deadlineMs + 100)
    expect(settled.note).toMatch(/^none nothing, still nothing after 25\d\d ms$/)
    // Paused between readings, and not read as fast as the page answers: a
    // reading every 15 ms plus its own cost, so about 125 in 2.5 seconds and
    // not 500.
    expect(c.reads()).toBeLessThanOrEqual(Math.ceil(SETTLE.deadlineMs / SETTLE.pollMs) + 1)
  })

  it('is bounded by the clock and not by a count of readings', async () => {
    // A page that takes 400 ms to answer: the deadline is passed after a few
    // readings, and the wait ends within one reading of it - a loop that
    // counted its turns would wait for all of them.
    const slow = 400
    const c = crossing(Number.POSITIVE_INFINITY, landedOn, slow)
    const settled = await settleNone(c.io, nowhere())
    expect(settled.answer.state).toBe('none')
    expect(settled.waited).toBeGreaterThanOrEqual(SETTLE.deadlineMs)
    expect(settled.waited).toBeLessThanOrEqual(SETTLE.deadlineMs + slow + SETTLE.pollMs)
    expect(c.reads()).toBeLessThanOrEqual(Math.ceil(SETTLE.deadlineMs / (slow + SETTLE.pollMs)) + 1)
  })

  it('costs nothing when the press was read as a control or as the frame', async () => {
    for (const first of [elsewhere(), frame(), read('same', 'button "x"'), read('repeat', 'b')]) {
      const c = crossing(0, landedOn)
      const settled = await settleNone(c.io, first)
      expect(settled).toEqual({ answer: first, waited: 0, note: null })
      expect(c.reads()).toBe(0)
      expect(c.clock()).toBe(0)
    }
  })

  it('costs nothing at the end of a walk that has reached everything', async () => {
    const c = crossing(0, landedOn)
    const done = { ...nowhere(), complete: true }
    const settled = await settleNone(c.io, done)
    expect(settled).toEqual({ answer: done, waited: 0, note: null })
    expect(c.reads()).toBe(0)
  })

  // -------------------------------------------------------------------------
  // A reading of nothing that did not settle.

  const PREVIEW = 'iframe "Los Angeles, as the export will frame it"'
  const LAPSED: Settled = {
    answer: nowhere(),
    waited: 2_512,
    note: 'none nothing, still nothing after 2512 ms',
  }

  /** The page of a lapsed reading: where the probe finds it to be, and what a hand-over from there reads. */
  function lapse(
    crossingIs: Crossing,
    script: (at: number) => StepAnswer,
    options: { answer?: string | null } = {},
  ): World & { crossings: () => number; lapse: LapseIO } {
    // Every ask of a lapse is a re-ask from the origin the crossing recorded.
    const answer = 'answer' in options ? (options.answer ?? null) : ASKED
    const w = world(script, { asked: answer, reasked: answer })
    let crossings = 0
    return {
      ...w,
      crossings: () => crossings,
      lapse: {
        ...w.io,
        crossing: async () => {
          crossings += 1
          return crossingIs
        },
      },
    }
  }

  it('hands over from the frame the press went into, and says which', async () => {
    const w = lapse({ kind: 'frame', frame: PREVIEW }, there)
    const result = await handOverAtLapse(w.lapse, LAPSED)
    expect(result?.kind).toBe('landed')
    // Every ask is from the origin the crossing recorded: no frame holds
    // focus to ask from.
    expect(w.asks).toEqual([true])
    expect(result?.line).toBe(
      `none nothing, still nothing after 2512 ms -> handed over from ${PREVIEW} -> ` +
        `asked for ${ASKED}, reached ${ASKED}, waited ${READ_COST} ms in 1 ask`,
    )
  })

  it('hands over at the wrap when nothing the walk wants follows the last control', async () => {
    const w = lapse({ kind: 'wrap', frame: null }, there)
    const result = await handOverAtLapse(w.lapse, LAPSED)
    expect(result?.kind).toBe('landed')
    expect(result?.line).toContain(
      '-> handed over at the wrap past the end of the document -> asked for',
    )
    expect(result?.line).not.toContain('iframe')
  })

  it('ends a complete walk as it did, and does not look for a place', async () => {
    const done: Settled = { answer: { ...nowhere(), complete: true }, waited: 0, note: null }
    const w = lapse({ kind: 'frame', frame: PREVIEW }, there)
    expect(await handOverAtLapse(w.lapse, done)).toBeNull()
    // Nor does a nothing that is the end of the walk after it was waited on.
    const waitedOn: Settled = { ...LAPSED, answer: { ...nowhere(), complete: true } }
    expect(await handOverAtLapse(w.lapse, waitedOn)).toBeNull()
    expect(w.crossings()).toBe(0)
    expect(w.asks).toEqual([])
  })

  it('leaves a reading that settled alone', async () => {
    const settled: Settled = { answer: landedOn(), waited: 85, note: 'none -> stop x after 85 ms' }
    const w = lapse({ kind: 'frame', frame: PREVIEW }, there)
    expect(await handOverAtLapse(w.lapse, settled)).toBeNull()
    expect(w.crossings()).toBe(0)
  })

  it('does not hand over before the settle has spent its deadline', async () => {
    // The two as the walk runs them: a crossing that takes 85 ms is settled
    // to the control it landed on, and is not a lapse.
    const c = crossing(85, landedOn)
    const settled = await settleNone(c.io, nowhere())
    const w = lapse({ kind: 'frame', frame: PREVIEW }, there)
    expect(await handOverAtLapse(w.lapse, settled)).toBeNull()
    expect(w.crossings()).toBe(0)
    // And a press the settle never looked at is not a lapse either.
    const unwaited: Settled = { answer: nowhere(), waited: 0, note: null }
    expect(await handOverAtLapse(w.lapse, unwaited)).toBeNull()
    expect(w.asks).toEqual([])
  })

  it('does not hand over where neither a frame nor the wrap explains the lapse', async () => {
    const w = lapse({ kind: 'open', frame: null }, there)
    const result = await handOverAtLapse(w.lapse, LAPSED)
    expect(result?.kind).toBe('open')
    expect(result?.line).toContain(
      'still nothing after 2512 ms; a control follows and no frame lies',
    )
    expect(w.asks).toEqual([])
    expect(w.reads()).toBe(0)
  })

  it('says nothing was left when there is nothing to ask for from there', async () => {
    const w = lapse({ kind: 'frame', frame: PREVIEW }, there, { answer: null })
    const result = await handOverAtLapse(w.lapse, LAPSED)
    expect(result?.kind).toBe('nothing')
    expect(result?.line).toBe(
      `none nothing, still nothing after 2512 ms -> handed over from ${PREVIEW} -> nothing after it`,
    )
  })

  it('is a miss, and says why, when the hand-over lapses after a lapsed settle', async () => {
    // The control asked for is never read: the walk presses on, and the
    // trace carries both lapses.
    const w = lapse({ kind: 'frame', frame: PREVIEW }, elsewhere)
    const result = await handOverAtLapse(w.lapse, LAPSED)
    expect(result?.kind).toBe('lapsed')
    expect(result?.waited).toBeGreaterThanOrEqual(HAND_OVER.deadlineMs)
    expect(result?.line).toMatch(
      new RegExp(
        `^none nothing, still nothing after 2512 ms -> handed over from ${PREVIEW} -> ` +
          `asked for ${ASKED}, reached nothing, gave up after \\d+ ms in 3 asks`,
      ),
    )
  })
})

describe('where a lapsed reading is', () => {
  const facts = (over: Partial<LapseFacts> = {}): LapseFacts => ({
    detached: false,
    next: true,
    frame: 'iframe "Los Angeles, as the export will frame it"',
    topUnread: true,
    ...over,
  })

  it('is in the frame between the last control read and the next one wanted', () => {
    expect(crossingOf(facts())).toEqual({
      kind: 'frame',
      frame: 'iframe "Los Angeles, as the export will frame it"',
    })
  })

  it('is the wrap when nothing wanted follows, and the document starts with a control not yet read', () => {
    expect(crossingOf(facts({ next: false, frame: null }))).toEqual({ kind: 'wrap', frame: null })
  })

  it('is not the wrap when the control a press off the end comes back to has been read', () => {
    // Handing over from the top would focus the first control not yet read,
    // which the walk passed over: the sweep would pass where it used to
    // report the miss. The walk presses on, and the miss prints.
    expect(crossingOf(facts({ next: false, frame: null, topUnread: false }))).toEqual({
      kind: 'open',
      frame: null,
    })
  })

  it('is open where a control follows and no frame that takes focus lies before it', () => {
    expect(crossingOf(facts({ frame: null }))).toEqual({ kind: 'open', frame: null })
  })

  it('is open where the last control read has left the document', () => {
    expect(crossingOf(facts({ detached: true }))).toEqual({ kind: 'open', frame: null })
    expect(crossingOf(facts({ detached: true, next: false, frame: null }))).toEqual({
      kind: 'open',
      frame: null,
    })
  })
})

describe('the walk', () => {
  // Read from the source, as far as can be asked of it without the app: the
  // sweeps are green whether or not the walk hands a lapse over (they do not
  // lapse on a machine that is not slow), so **this is the one thing that
  // notices the call being deleted.** It notices the text of it and no more.
  const source = readFileSync(resolve(__dirname, '../support/a11y.ts'), 'utf8')
  const body = new RegExp('^export async function expectTabWalk\\([\\s\\S]*?^}$', 'm').exec(
    source,
  )?.[0]

  it('reads the function it is looking at', () => {
    expect(body, 'expectTabWalk in tests/support/a11y.ts').toBeDefined()
    expect(body).toContain('while (Date.now() < deadline)')
  })

  it('settles a press read as nothing before it judges the press', () => {
    expect(body).toMatch(/^ +const settled = await settleNone\(io, await read\(\)\)$/m)
  })

  it('hands a lapse over, and puts what it did on the press that lapsed', () => {
    expect(body).toMatch(/^ +const lapse = await handOverAtLapse\($/m)
    expect(body).toContain('trace.amend(lapse.line)')
  })

  it('hands over at a frame by the same hand-over', () => {
    expect(body).toMatch(/^ +const result = await handOver\(io, at\)$/m)
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

  it('gives a press the time it was made when it is given one, and not the time it is written', () => {
    // A press read as nothing is settled for up to 2.5 seconds before it is
    // written down: it is dated by when the key went down.
    const trace = new WalkTrace(ticking())
    trace.press('none -> stop a after 850 ms', 1_040)
    trace.press('stop b')
    // The clock reads 1010 when the walk begins and 1020 for the second
    // press: the first never asked it, and was made at 1040.
    expect(trace.text()).toBe('#1 +30ms none -> stop a after 850 ms\n#2 +10ms stop b')
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
    expect(lines[0]).toBe('(3 earlier presses are not shown; the hand-over lines are always kept)')
    expect(lines).toHaveLength(6)
    expect(lines[1]).toMatch(/^#4 /)
    expect(lines[5]).toMatch(/^#8 /)
  })

  it('keeps the hand-over line however long the walk goes on after it', () => {
    // A walk whose focus is stuck makes hundreds of presses in its 20
    // seconds, and the oldest are let go; the hand-over's line is the one
    // thing the trace exists to print, and it is among the oldest.
    const trace = new WalkTrace(ticking())
    trace.press('stop a')
    trace.press(`frame ${FRAME}`)
    trace.amend(`frame ${FRAME} -> asked for ${ASKED}, reached nothing, gave up after 6012 ms`)
    for (let i = 0; i < TRACE_LIMIT + 50; i++) trace.press('same button "Rename"')
    const lines = trace.text().split('\n')
    expect(lines.filter((line) => line.includes('-> asked for'))).toEqual([
      expect.stringMatching(/^#2 \+\d+ms frame /),
    ])
    // Bounded all the same, and the newest press is the last line.
    expect(lines.length).toBeLessThanOrEqual(TRACE_LIMIT + 1)
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^#${TRACE_LIMIT + 52} `))
    expect(lines[0]).toMatch(/earlier presses are not shown; the hand-over lines are always kept/)
  })

  it('stays within its bound when nothing but hand-over lines is left to let go', () => {
    const trace = new WalkTrace(ticking(), 3)
    for (let i = 1; i <= 6; i++) {
      trace.press(`frame ${FRAME}`)
      trace.amend(`hand-over ${i}`)
    }
    const lines = trace.text().split('\n')
    // The oldest hand-over goes, never the newest press.
    expect(lines).toHaveLength(4)
    expect(lines[1]).toMatch(/hand-over 4$/)
    expect(lines[3]).toMatch(/^#6 .*hand-over 6$/)
  })

  it('keeps every hand-over line of a walk with several frames', () => {
    const trace = new WalkTrace(ticking(), 6)
    for (let frames = 0; frames < 3; frames++) {
      trace.press(`frame ${FRAME}`)
      trace.amend(`frame ${FRAME} -> asked for ${ASKED}, reached ${ASKED} (frame ${frames})`)
      for (let i = 0; i < 5; i++) trace.press('stop button')
    }
    const text = trace.text()
    for (const frames of [0, 1, 2]) expect(text).toContain(`(frame ${frames})`)
    expect(text.split('\n').filter((line) => !line.startsWith('('))).toHaveLength(6)
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
