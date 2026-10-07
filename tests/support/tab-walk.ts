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
//
// What that trace showed (seven failures on a runner, issue 271): the
// hand-over never ran. A press into a frame, or off the end of the document,
// is read as `none` while focus is still crossing a process boundary, and
// the walk took that for "between two controls" and pressed again, so the
// control focus had landed on was never read. `settleNone` takes the reading
// later instead.

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

  /**
   * One press and what the document said of it. `at` is the clock's time
   * when the key went down, for a press that is written down later than it
   * was made: one read as nothing is waited on for up to 2.5 seconds, and the
   * time it is dated by is the press's and not the reading's.
   */
  press(reading: string, at?: number): void {
    this.pressed += 1
    this.entries.push({
      text: `#${this.pressed} +${(at ?? this.now()) - this.began}ms ${reading}`,
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
   * `open`: only from `handOverAtLapse`, a reading that lapsed at a place
   * that is neither a frame nor the wrap, which is not handed over.
   */
  kind: 'nothing' | 'landed' | 'moot' | 'lapsed' | 'open'
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
  /** What the trace's line begins with: the press read as the frame, unless it is said otherwise. */
  lead: string = `frame ${at}`,
): Promise<HandOver> {
  const began = io.now()
  let aimed = await io.ask(false)
  if (aimed === null)
    return { kind: 'nothing', line: `${lead} -> nothing after it`, waited: 0, asks: 0 }
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
          `${lead} -> asked for ${aimed}, reached ${answer.at}, ` +
          `waited ${waited} ms in ${asks} ${asks === 1 ? 'ask' : 'asks'}${said()}`,
        waited,
        asks,
      }
    heard.push(readingLine(answer))
    if (waited >= limits.deadlineMs)
      return {
        kind: 'lapsed',
        line:
          `${lead} -> asked for ${aimed}, reached nothing, ` +
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
            `${lead} -> asked for ${aimed}, reached nothing, and there was nothing left ` +
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

// ---------------------------------------------------------------------------
// A press that is read as nothing.

export interface SettleIO {
  /** The document's own reading of where focus is, recorded by the probe as a press would be. */
  read(): Promise<StepAnswer>
  now(): number
  pause(ms: number): Promise<void>
}

export interface SettleLimits {
  /** A reading of nothing is waited through this long at most. */
  deadlineMs: number
  /** Between two readings. */
  pollMs: number
}

/**
 * The gaps seen on a runner were 5 to 20 ms, but a second was not enough at
 * cell 06's own preview frame, a full engine page that can still be loading
 * when focus arrives (a loop on Ubuntu, issue 271). It is paid once by a
 * walk that leaves the document and has to be pressed back in, and not at
 * all by a press that is read as a control.
 */
export const SETTLE: SettleLimits = { deadlineMs: 2_500, pollMs: 15 }

export interface Settled {
  /** The reading the press is judged by: the first one, or the one it settled to. */
  answer: StepAnswer
  /** How long it waited; none when the first reading was not nothing. */
  waited: number
  /** The press's trace line when it waited, else null: the reading speaks for itself. */
  note: string | null
}

/**
 * A press is read as `none` - focus on the body, or on nothing - and the
 * walk is not done: either focus is between two controls, or it is still
 * on its way to one. Leaving a frame and coming back round from the end of
 * the document both cross a process boundary, and for that moment the
 * parent's `activeElement` is the body. Pressing again at that point reads
 * the control after the one focus lands on, and the one it landed on is
 * never read.
 *
 * So a reading of nothing is read again until it is something else or the
 * deadline passes. **Nothing is decided here**: the settled reading is the
 * press's reading, recorded by the probe as it would have been, so a control
 * counts as reached only when the document reads focus on it, exactly as
 * before - this only takes the reading later. Still nothing at the deadline
 * is what it always meant: the walk presses on, and ends if it is complete.
 *
 * A complete walk's `none` is its end, and a reading that is anything but
 * `none` is not waited on, so neither costs a read.
 */
export async function settleNone(
  io: SettleIO,
  first: StepAnswer,
  limits: SettleLimits = SETTLE,
): Promise<Settled> {
  if (first.state !== 'none' || first.complete) return { answer: first, waited: 0, note: null }
  const began = io.now()
  let answer = first
  while (answer.state === 'none' && io.now() - began < limits.deadlineMs) {
    await io.pause(limits.pollMs)
    answer = await io.read()
  }
  const waited = io.now() - began
  const note =
    answer.state === 'none'
      ? `${readingLine(answer)}, still nothing after ${waited} ms`
      : `none -> ${readingLine(answer)} after ${waited} ms`
  return { answer, waited, note }
}

// ---------------------------------------------------------------------------
// A reading of nothing that did not settle.

/**
 * Where the probe finds a reading of nothing to have lapsed, from the last
 * control the walk read and the next one it wants. `frame`: an iframe lies
 * between them in the document, so the press went into it and the reading
 * is the process boundary's. `wrap`: nothing the walk wants follows the last
 * control, so the press left the end of the document. `open`: a control
 * follows and no frame lies between, which is nothing this walk can explain.
 */
export interface Crossing {
  kind: 'frame' | 'wrap' | 'open'
  /** The frame, as the trace names it, when `kind` is `frame`. */
  frame: string | null
}

/**
 * What the probe reads from the document where a reading of nothing lapsed,
 * and nothing it decides: which of the three places it is, is `crossingOf`'s,
 * where a unit test can reach it.
 */
export interface LapseFacts {
  /** The last control read has left the document, and where a press from it goes is not known. */
  detached: boolean
  /** A control the walk wants and has not read follows the last control read. */
  next: boolean
  /**
   * Of the iframes between the last control read and that next one, the
   * first a press of Tab can enter, as the trace names it; null where there
   * is none. A frame that takes no focus (`tabindex="-1"`, as the stage
   * view's is) is not one.
   */
  frame: string | null
  /**
   * The first of those frames that takes no focus, as the trace names it,
   * which the walk does not act on: it is how a reading shows the frame was
   * seen and let go, and not merely never seen.
   */
  skipped: string | null
  /**
   * The first control the walk wants in the document, which is where a press
   * off the end of it comes back to, has not been read.
   */
  topUnread: boolean
}

/**
 * Which place a lapsed reading is. **Where the walk's whole answer to a
 * lapse is to give focus to a control, the control must be one the walk
 * would have reached by pressing on**: at the wrap, Tab lands on the first
 * control of the document, and if that one is read already, handing over
 * from the top would focus the first control not yet read - one the walk
 * passed over - and the sweep would pass where it used to report the miss.
 * So that is `open`, and the walk presses on, and the miss prints.
 */
export function crossingOf(facts: LapseFacts): Crossing {
  if (facts.detached) return { kind: 'open', frame: null }
  if (facts.next)
    return facts.frame === null
      ? { kind: 'open', frame: null }
      : { kind: 'frame', frame: facts.frame }
  return facts.topUnread ? { kind: 'wrap', frame: null } : { kind: 'open', frame: null }
}

export interface LapseIO extends HandOverIO {
  /** Where the lapsed reading is, found from the document; it also records the origin the asks are made from. */
  crossing(): Promise<Crossing>
}

/**
 * **A reading of nothing that did not settle never has the walk press on
 * from a place the document could not read.** The press went into a frame
 * or off the end of the document and the reading is still the boundary's
 * after the settle's deadline, which on a runner happened at cell 06's own
 * preview frame: the walk pressed Tab from where it could not see, the press
 * landed on a control it had already read, and that read as the walk coming
 * back round with the rest of the screen unreached (issue 271).
 *
 * So the walk is handed over from the frame the press went into, or from the
 * top of the document for the wrap, by the same hand-over as at a frame: the
 * first control it still wants is given focus and the walk goes no further
 * until the document reads focus on it, by identity. Nothing is recorded by
 * the asking; a control counts as reached only when `step()` reads focus on
 * it. If the hand-over lapses too, the walk presses on and the miss prints
 * as it always did, with this line in its trace.
 *
 * `null` is not a lapse this decides: the reading settled, or the walk is
 * complete and nothing is its end. `open` is a lapse at a place that is
 * neither: it is left to the walk to press on, and said.
 */
export async function handOverAtLapse(
  io: LapseIO,
  settled: Settled,
  limits: HandOverLimits = HAND_OVER,
): Promise<HandOver | null> {
  const { answer, note } = settled
  if (note === null || answer.state !== 'none' || answer.complete) return null
  const crossing = await io.crossing()
  if (crossing.kind === 'open')
    return {
      kind: 'open',
      line: `${note}; a control follows and no frame lies before it, pressing on`,
      waited: 0,
      asks: 0,
    }
  const from =
    crossing.kind === 'frame'
      ? `handed over from ${crossing.frame ?? 'a frame'}`
      : 'handed over at the wrap past the end of the document'
  // Every ask is from the origin `crossing()` recorded: there is no frame
  // holding focus to ask from.
  return handOver({ ...io, ask: () => io.ask(true) }, answer.at, limits, `${note} -> ${from}`)
}
