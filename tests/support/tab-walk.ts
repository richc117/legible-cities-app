// The Tab walk's own bookkeeping, apart from the page it walks (issue 271):
// the trace it keeps and the hand-over at a frame. Both are decisions over
// numbers and strings, so they live here, where a unit test can run them
// without a browser, and `expectTabWalk` in `a11y.ts` only supplies the page.
//
// Why a trace of the whole walk, and why the hand-over reads by identity:
// the sweep has failed now and then on a runner with one control, or the
// whole rest of the screen, "not reached", and a failure that names only
// what was missed cannot say what was asked for and what was reached. So a
// miss prints every press, with the time it was made and what the document
// said it had reached, and the hand-over at a frame prints its own line.

/** What the probe's `step()` reads from the document, in the page. */
export interface StepAnswer {
  state: 'none' | 'same' | 'stop' | 'repeat' | 'frame'
  /** Every control expected has been reached. */
  complete: boolean
  /** What holds focus, for the message when the walk does not end. */
  at: string
  /**
   * The control focus is on is the very element `past()` last put focus on,
   * by identity and not by its description (two buttons can be described
   * alike). Read from the document by `step()` as everything else is, never
   * set by the asking: a control that was only asked for has not been
   * reached.
   */
  onAimed: boolean
}

/** A reading as one line of the trace. */
export function readingLine({ state, complete, at }: StepAnswer): string {
  return `${state} ${at}${complete ? ' (all reached)' : ''}`
}

/**
 * Many more presses than any screen has controls: a screen with 80 stops
 * makes about 90 presses. A walk that runs past this is a runaway, and the
 * trace says how many of its first presses it let go of.
 */
export const TRACE_LIMIT = 400

/**
 * Every press of the walk, in order: its number, the time since the walk
 * began and what was read. Held whole rather than as the last few, because
 * the press that matters in a miss is the one before the control that was
 * skipped, which can be anywhere in the walk - at the frame, or at the
 * wrap from the end of the document to its start.
 *
 * **A hand-over's line is never let go.** Past the bound the oldest press is
 * dropped, and in a walk whose focus is stuck (hundreds of presses in its 20
 * seconds) a hand-over's line is among the oldest - and it is the one line
 * this trace exists to print. So the oldest press that is not a hand-over
 * goes first; the numbers skip where presses were let go. There are few
 * hand-overs, since each is a frame and takes up to six seconds, but if the
 * bound is reached with nothing else to drop the oldest of them goes.
 */
export class WalkTrace {
  private readonly entries: { text: string; handOver: boolean }[] = []
  private pressed = 0
  private readonly began: number
  private readonly now: () => number
  private readonly limit: number

  constructor(now: () => number, limit: number = TRACE_LIMIT) {
    this.now = now
    this.limit = limit
    this.began = now()
  }

  /** One press and what the document said of it. */
  press(reading: string): void {
    this.pressed += 1
    this.entries.push({
      text: `#${this.pressed} +${this.now() - this.began}ms ${reading}`,
      handOver: false,
    })
    if (this.entries.length > this.limit) {
      const oldest = this.entries.findIndex(
        (entry, i) => !entry.handOver && i < this.entries.length - 1,
      )
      this.entries.splice(oldest === -1 ? 0 : oldest, 1)
    }
  }

  /**
   * Said again, in more words, of the press made last: the hand-over's line
   * takes the place of the reading that found the frame, which is the
   * hand-over's own outcome. The press keeps its number and its time.
   */
  amend(reading: string): void {
    const last = this.entries[this.entries.length - 1]
    if (last === undefined) return
    const head = /^#\d+ \+\d+ms /.exec(last.text)?.[0] ?? ''
    last.text = `${head}${reading}`
    last.handOver = true
  }

  get presses(): number {
    return this.pressed
  }

  /** The walk, one press to a line, with a note when some of it was let go. */
  text(): string {
    const letGo = this.pressed - this.entries.length
    const note =
      letGo > 0
        ? [`(${letGo} earlier presses are not shown; the hand-over lines are always kept)`]
        : []
    return [...note, ...this.entries.map((entry) => entry.text)].join('\n')
  }
}

/**
 * The message of the assertion that every control was reached. Its first
 * line is the one the issue and the pickup notes quote, and is the same
 * whether or not anything was missed, because a step's title in a report
 * is this text on a run that passes as well; the walk comes after it only
 * when something was.
 */
export function missMessage(where: string, missed: readonly string[], trace: WalkTrace): string {
  const first = `${where}: controls the Tab walk did not reach`
  if (missed.length === 0) return first
  return `${first}\nthe walk, press by press (${trace.presses} presses):\n${trace.text()}`
}

/** The message of the assertion that the walk came back round, with the same rule about passing runs. */
export function endMessage(where: string, ended: boolean, trace: WalkTrace): string {
  const first = `${where}: the Tab walk came back round within the deadline`
  if (ended) return first
  return `${first}; the walk, press by press (${trace.presses} presses):\n${trace.text()}`
}

// ---------------------------------------------------------------------------
// The hand-over at a frame.

export interface HandOverIO {
  /**
   * Put focus on the first control the walk still wants after the frame,
   * and say which. `again` asks the same question of the same frame after
   * focus has moved on, which a first ask cannot be, since that one starts
   * from the frame holding focus. `null` is nothing to ask for: no control
   * the walk wants is left after the frame.
   */
  ask(again: boolean): Promise<string | null>
  /** The document's own reading of where focus is, recorded by the probe as a press would be. */
  read(): Promise<StepAnswer>
  now(): number
  pause(ms: number): Promise<void>
}

export interface HandOverLimits {
  /** Waited for the control by its identity this long at most. */
  deadlineMs: number
  /** Asked for again when it has not been reached this long after the ask. */
  reaskMs: number
  /** Between two readings. */
  pollMs: number
}

/**
 * Six seconds in all and an ask every two, which is what the walk gave a
 * frame before (three asks of two seconds each), so the walk's own deadline
 * is spent no faster than it was.
 */
export const HAND_OVER: HandOverLimits = { deadlineMs: 6_000, reaskMs: 2_000, pollMs: 20 }

export interface HandOver {
  /**
   * `nothing`: nothing after the frame that the walk still wants, so the
   * frame is the end of what it can step over. `landed`: the document read
   * focus on the control that was asked for. `moot`: the walk read, by
   * other means, every control that was left, so there was nothing more to
   * ask for. `lapsed`: the deadline came and the control was never read.
   */
  kind: 'nothing' | 'landed' | 'moot' | 'lapsed'
  /** The trace's line for the press that found the frame. */
  line: string
  waited: number
  asks: number
}

/** Runs of the same reading, counted: `frame iframe "" x40, none nothing`. */
export function tallyReadings(readings: readonly string[], most = 6): string {
  const runs: { reading: string; count: number }[] = []
  for (const reading of readings) {
    const last = runs[runs.length - 1]
    if (last?.reading === reading) last.count += 1
    else runs.push({ reading, count: 1 })
  }
  const shown = runs
    .slice(0, most)
    .map(({ reading, count }) => (count > 1 ? `${reading} x${count}` : reading))
  if (runs.length > most) shown.push(`and ${runs.length - most} more`)
  return shown.join(', ')
}

/**
 * Focus is put on the first control after a frame, and the walk goes no
 * further until the document says focus is **on that control**: the very
 * element, by identity. Leaving a frame crosses a process boundary and a
 * `focus()` there can be late, or dropped, or overtaken, so a reading taken
 * at once can be the frame still, or nothing, or some control that is not
 * the one asked for. All of those are readings to wait through, and the
 * last of them is what the walk used to take for arrival: it called any
 * reading that was neither the frame nor nothing "reached", pressed Tab
 * from wherever that was, and the control it had asked for was never
 * visited.
 *
 * Asked again every `reaskMs` while it has not been read, from the frame it
 * began at and from wherever focus has gone, which the walk's first version
 * of a second ask could not do once focus had left the frame. Never
 * returns having counted a control as reached for being asked for: the
 * only way `landed` comes out is a reading of the document.
 */
export async function handOver(
  io: HandOverIO,
  at: string,
  limits: HandOverLimits = HAND_OVER,
): Promise<HandOver> {
  const began = io.now()
  let aimed = await io.ask(false)
  if (aimed === null)
    return { kind: 'nothing', line: `frame ${at} -> nothing after it`, waited: 0, asks: 0 }
  let asks = 1
  let askedAt = began
  const heard: string[] = []
  const said = (): string => (heard.length === 0 ? '' : `; read ${tallyReadings(heard)}`)
  for (;;) {
    const answer = await io.read()
    const waited = io.now() - began
    if (answer.onAimed)
      return {
        kind: 'landed',
        line:
          `frame ${at} -> asked for ${aimed}, reached ${answer.at}, ` +
          `waited ${waited} ms in ${asks} ${asks === 1 ? 'ask' : 'asks'}${said()}`,
        waited,
        asks,
      }
    heard.push(readingLine(answer))
    if (waited >= limits.deadlineMs)
      return {
        kind: 'lapsed',
        line:
          `frame ${at} -> asked for ${aimed}, reached nothing, ` +
          `gave up after ${waited} ms in ${asks} ${asks === 1 ? 'ask' : 'asks'}${said()}`,
        waited,
        asks,
      }
    if (io.now() - askedAt >= limits.reaskMs) {
      const again = await io.ask(true)
      if (again === null)
        return {
          kind: 'moot',
          line:
            `frame ${at} -> asked for ${aimed}, reached nothing, and there was nothing left ` +
            `to ask for after the frame; waited ${io.now() - began} ms ` +
            `in ${asks} ${asks === 1 ? 'ask' : 'asks'}${said()}`,
          waited: io.now() - began,
          asks,
        }
      // Asked again, the question can have a different answer: the control
      // first asked for went away and the next one wanted after the frame is
      // the one focus was put on, and the one `onAimed` now follows. The
      // line names the one asked for last.
      aimed = again
      asks += 1
      askedAt = io.now()
    } else await io.pause(limits.pollMs)
  }
}
