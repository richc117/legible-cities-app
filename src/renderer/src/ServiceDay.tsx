import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type JSX,
  type RefObject,
} from 'react'
import type { EngineState } from '../../shared/engine'
import { messageOf } from '../../shared/errors'
import { withinWindow } from '../../shared/project/helpers'
import { type ProjectRecord } from '../../shared/project/types'
import { validateServiceDate } from '../../shared/project/validate'
import { dayWords } from './dates'
import { debounce, type Debounced } from './debounce'
import type { LayoutRun as Run } from './engine/layoutRun'
import Icon from './icons/Icon'
import Button from './kit/Button'
import { useSnapshot } from './useSnapshot'

// The service day, cell 03's control: the day the map is drawn for, the
// days the feed covers, and a way to choose another (specs/012, A5.5-15).
//
// The day is the engine's choice at the first layout and a person's since.
// Drawing one rebuilds the map from the stored layout and never re-lays out
// (ADR-031, constitution III). The control is the platform's own date
// input, bounded by the window the engine answered, and the main process
// refuses a day outside it again: this form is the first gate, not the only
// one. Nothing here reads or shows a time of day; times past midnight are
// the page's own business.
//
// Choosing and drawing are two acts now (A5.5-15). A day is written to the
// record the moment it is chosen, as the mode and the operator are
// (`setInputs`, A2-02) and as the theme is (A4-03), and that write starts
// nothing. Until it existed the day reached the record only from a finished
// draw, in the same write that set `drawn.date`, so the two could never
// differ and the notebook's cells below this one could never be told that
// the map does not show the chosen day
// (specs/028-the-notebook/contracts/run-graph.md). "Draw for this day" is
// then the one press that closes that gap, and it is offered exactly while
// the gap is open.
//
// What the record holds and what the map shows are therefore two different
// days for as long as a person leaves them apart: `project.date` is the
// choice, `project.drawn.date` is the map. A cancelled or failed rebuild no
// longer puts the choice back, because the choice was never the rebuild's
// to undo.
//
// Revert (A5.5-12) is the other way to close it: back to the day the map
// already shows. It is a choice like any other - `onDate` with
// `drawn.date` - so it writes the record once and draws nothing, and the
// gap closes because the two days agree again, not because anything ran.
// It is offered only while the gap is open and the map has a day to go
// back to; a record from before `drawn` existed cannot say what the map was
// drawn for, and gets no Revert rather than one to nothing.
//
// It is the notebook's only Revert. The issue named cells 04 and 05 as
// well, and neither can use one: the colours and the order are written
// together with `drawn` only once the map carries them, so the two never
// differ, and the map always shows the record's theme, so going back to
// `drawn.theme` would be the theme switch's other button under another
// name (specs/028-the-notebook/contracts/run-graph.md, "Revert").

/**
 * The sentence a day outside the window gets on the form; the store's own
 * refusal (`serviceDayRefusal`) writes the window's days the same way.
 */
export function outsideWindow(start: string, end: string): string {
  return `The feed covers ${dayWords(start)} to ${dayWords(end)}.`
}

/** What "Draw for this day" says with no day in the control (issue 559). */
export const CHOOSE_A_DAY = 'Choose a day.'

/** What the section is called, as its name inside cell 03. */
const NAME = 'Service day'

/**
 * How long a chosen day waits before it is written, in milliseconds.
 *
 * The write is one small record and not a map build, so this is short: it
 * exists because a date control reports every whole value on the way to the
 * one a person means. Typing over a day segment passes through one other
 * day, and holding an arrow key passes through one per key repeat, each of
 * which would otherwise be a record rewritten and a modification time moved.
 *
 * A pending choice is never dropped: the form flushes it when it goes, a
 * layout run or a rebuild flushes it as it starts (`useDayChoice`), and "Draw
 * for this day" writes the day itself before it draws.
 */
const CHOICE_DELAY = 250

/**
 * The chosen day's write, held back by `CHOICE_DELAY` and never lost: sent at
 * once when the form goes, and when a layout run, a rebuild or Run all
 * starts (issue 407), whichever control started it. The second is the
 * run's own hook (`beforeStart`), told of the press before the run reads
 * its record, so a day picked a moment before "Lay out again" or Run all is
 * a write sent before that read, which the store answers with it (spec 037):
 * the run draws the day. Left to its timer it landed while the run went,
 * with the control already disabled, and the run drew the day before it.
 *
 * Flushed rather than cancelled, as the cheap edits flush theirs since
 * issue 490 (`notebook/useCheapEdit.ts`): this is a choice a person has
 * already seen the control take, and leaving the screen, or starting a run,
 * a fifth of a second after choosing a day must not lose the day. Unlike
 * theirs it is a write and draws nothing, so it is also flushed by a run's
 * press, where a cheap edit waits for the run to end. `write` is read
 * through a ref, so a waiting call is never the one from three renders ago.
 */
export function useDayChoice(
  run: Pick<Run, 'beforeStart'>,
  write: RefObject<(date: string) => void>,
): Debounced<[string]> {
  const schedule = useMemo(
    () => debounce((date: string) => write.current(date), CHOICE_DELAY),
    [write],
  )
  useEffect(() => () => schedule.flush(), [schedule])
  useEffect(() => run.beforeStart(() => schedule.flush()), [run, schedule])
  return schedule
}

/**
 * Has the day on the record not been drawn? `drawn` is what the map now on
 * disk was made from (A5.5-04); null is "we cannot prove this map is
 * current", which reads as drawn rather than as undrawn - an old project's
 * map is not wrong.
 */
export function dayUndrawn(record: Pick<ProjectRecord, 'date' | 'drawn'>): boolean {
  return record.drawn !== null && record.drawn.date !== record.date
}

/**
 * The day Revert goes back to (A5.5-12): the one the map shows, while the
 * record holds another. Null when there is no Revert to offer - the day is
 * drawn, or the record cannot say what the map was drawn for, which is
 * never a reason to revert to nothing.
 *
 * Null too when the drawn day is outside the window. A later layout keeps
 * the project's day and replaces the window without checking one against
 * the other (`completeLayout`), so a map can be drawn for a day the feed no
 * longer covers - and the store refuses that day to `setDate`, so a Revert
 * to it would be a button that fails on every press.
 */
export function revertDay(
  record: Pick<ProjectRecord, 'date' | 'drawn' | 'service'>,
): string | null {
  const day = dayUndrawn(record) ? (record.drawn?.date ?? null) : null
  if (day === null || record.service === null || !withinWindow(day, record.service)) return null
  return day
}

export default function ServiceDay({
  run,
  project,
  engine,
  onDate,
  disabled = false,
  handback,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /**
   * Write the chosen day to the record. It draws nothing; it rejects with
   * the store's own sentence when the day may not be stored, which is what
   * the control shows (A5.5-15).
   */
  onDate: (date: string) => Promise<void>
  /** True while something else, such as an export, is reading the project's page. */
  disabled?: boolean
  /**
   * Where focus goes when a control that held it is disabled or removed:
   * the heading of the cell the form is drawn in (A5.5-08). Required,
   * because the form draws no heading of its own - the cell's names it -
   * and a panel with nowhere to hand focus back to is the A6-07 defect
   * itself: Chromium blurs a disabled element and focus falls to the body.
   * Until the tab strip went (A5.5-23) it was optional, and its absence
   * drew an `h2`.
   */
  handback: RefObject<HTMLElement | null>
}): JSX.Element {
  const { state, rebuilt } = useSnapshot(run)
  const running = state === 'running'
  const [value, setValue] = useState(project.date ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const inputId = useId()
  const messageId = useId()
  const input = useRef<HTMLInputElement>(null)

  // The control follows the stored day, which is now the chosen one: a
  // choice lands on the record before the map is drawn for it, so this
  // confirms the control rather than correcting it. It still matters for
  // the project changing under the component and for a choice this screen
  // did not make. Keyed on the window's days, not the record object, which
  // a rename replaces without changing either; adjusted in the render that
  // sees the key move, and only then, so a day being typed is never put
  // back by a render of the screen.
  const service = project.service
  const windowKey = service === null ? '' : `${service.start}/${service.end}/${service.busiest}`
  const followKey = JSON.stringify([project.id, project.date, windowKey])
  const [followed, setFollowed] = useState(followKey)
  if (followed !== followKey) {
    setFollowed(followKey)
    setValue(project.date ?? '')
    setMessage(null)
  }
  // A rebuild that stopped drew nothing, so the day stays chosen and
  // undrawn, and the control keeps showing it: what this puts back is the
  // record's day, which the choice already is. On the run's edge into the
  // stop, in the render that sees it, and not for as long as it stays
  // stopped: a day typed after the stop is the person's (a day chosen
  // elsewhere meanwhile is the follow's, above). The edge is of the state
  // and of `rebuilt` both, as the effect this replaced was: a rebuild
  // refused at once after another run failed stays failed, and only
  // `rebuilt` moves.
  const [stopWas, setStopWas] = useState({ state, rebuilt })
  if (stopWas.state !== state || stopWas.rebuilt !== rebuilt) {
    setStopWas({ state, rebuilt })
    if (rebuilt && (state === 'cancelled' || state === 'failed')) setValue(project.date ?? '')
  }

  // The write waits: a date control reports every whole value on the way to
  // the one a person means (`useDayChoice`).
  const writeRef = useRef<(date: string) => void>(() => undefined)
  const schedule = useDayChoice(run, writeRef)

  if (service === null) {
    return (
      <section className="service-day" aria-label={NAME}>
        <p className="prose" role="status">
          {project.date === null ? 'Not yet chosen. ' : `Drawn for ${dayWords(project.date)}. `}
          Lay the project out again to learn which days the feed covers.
        </p>
      </section>
    )
  }

  const undrawn = dayUndrawn(project)
  // A refusal goes back to the control, as the rename form's does, so the
  // message it references is read out with it.
  const refuse = (sentence: string): void => {
    setMessage(sentence)
    input.current?.focus()
  }
  /** Write a chosen day to the record. True when it landed. */
  const choose = async (date: string): Promise<boolean> => {
    setMessage(null)
    try {
      await onDate(date)
      return true
    } catch (error) {
      refuse(messageOf(error))
      return false
    }
  }
  /**
   * A day the person settled on. A date input reports every edit, and a
   * half-typed date reaches here as an empty value, so only a whole day
   * inside the window is written; a whole day outside it gets the sentence
   * at once and is not written, and the submit that follows refuses it
   * again with the same words.
   */
  const pick = (next: string): void => {
    setValue(next)
    setMessage(null)
    // Whatever was waiting is a day the person has typed past. Dropped
    // before anything else is decided, so an earlier valid day cannot land
    // on the record while the control shows a later one it refused.
    schedule.cancel()
    if (next === '' || next === project.date || validateServiceDate(next) !== null) return
    if (!withinWindow(next, service)) {
      // Not `refuse`: focus is in the control already, and taking it again
      // would shut the platform's own calendar under the person's hand.
      setMessage(outsideWindow(service.start, service.end))
      return
    }
    schedule(next)
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    // An emptied control, or one half typed, reports no value: what the
    // person is missing is a day, not the record's way of writing one.
    const invalid = value === '' ? CHOOSE_A_DAY : validateServiceDate(value)
    if (invalid !== null) return refuse(invalid)
    if (!withinWindow(value, service)) return refuse(outsideWindow(service.start, service.end))
    if (value === project.date && !undrawn) return
    // A press is not a keystroke: whatever is waiting is this day, and it is
    // written here rather than a quarter of a second into the run.
    schedule.cancel()
    void (async () => {
      // Written first where the choice has not landed - a write that was
      // refused, waiting, or still in flight - so the record and the map
      // agree about the day the moment the rebuild ends.
      if (value !== project.date && !(await choose(value))) return
      // The rebuild disables the control and the button that asked for it,
      // and Chromium blurs a disabled element; the cell's heading keeps
      // focus in the cell, as the theme switch's does (A6-07).
      handback.current?.focus()
      run.rebuild(project, engine, value)
    })()
  }
  writeRef.current = (date: string): void => {
    void choose(date)
  }
  const shown = revertDay(project)
  const revert = (day: string): void => {
    setValue(day)
    setMessage(null)
    // The press takes this button away once the write lands, and Chromium
    // would put focus on the body; the control now holding the day is
    // where it belongs, as for "Use the busiest weekday", and it takes it
    // before the write that redraws this form.
    input.current?.focus()
    // A day waiting to be written is one the person is going back from.
    schedule.cancel()
    void (async () => {
      // Refused, the record still holds the chosen day, and so must the
      // control: otherwise it shows the day the status line says is not
      // chosen, and "Draw for this day" offers a write that fails again.
      if (!(await choose(day))) setValue(project.date ?? '')
    })()
  }
  // Every day here is in words (`dates.ts`, issue 559); the control below
  // keeps the record's form, which is its value and is drawn by the platform.
  const covers =
    service.start === service.end
      ? `The feed covers one day, ${dayWords(service.start)}`
      : `The feed covers ${dayWords(service.start)} to ${dayWords(service.end)}`
  // What the map shows, against what the record holds. The two differ only
  // between a choice and the draw that answers it.
  const said =
    project.date === null
      ? 'Not yet chosen.'
      : !undrawn
        ? `Drawn for ${dayWords(project.date)}.`
        : project.drawn?.date == null
          ? `${dayWords(project.date)} is chosen; no map has been drawn for it yet.`
          : `${dayWords(project.date)} is chosen; the map still shows ${dayWords(project.drawn.date)}.`

  return (
    <section className="service-day" aria-label={NAME}>
      <p className="prose" role="status">
        {said} {covers}; the busiest weekday, counted from {dayWords(service.anchor)}, is{' '}
        {dayWords(service.busiest)}.
      </p>
      <form className="inline-form" noValidate onSubmit={submit}>
        <div className="field">
          <label htmlFor={inputId}>Draw for another day</label>
          <input
            id={inputId}
            ref={input}
            type="date"
            value={value}
            min={service.start}
            max={service.end}
            disabled={disabled || running}
            onChange={(event) => pick(event.target.value)}
            aria-describedby={messageId}
            aria-invalid={message ? true : undefined}
          />
          {/* Spoken, not merely shown. Every other refusal in the app
              reaches a screen reader by taking focus back to the control
              that references it; this one does not, because `pick` refuses
              a day as it is typed and taking focus there would shut the
              platform's own calendar under the person's hand (A5.5-15). */}
          <p id={messageId} className="message error" role="alert">
            {message}
          </p>
        </div>
        <div className="actions">
          {shown !== null && (
            <Button disabled={disabled || running} onClick={() => revert(shown)}>
              Revert to {dayWords(shown)}
            </Button>
          )}
          <Button
            disabled={disabled || running || value === service.busiest}
            onClick={() => {
              setValue(service.busiest)
              setMessage(null)
              // The button disables itself once pressed, which drops focus;
              // the control now holding the day is where focus belongs, and
              // it takes it before the write that redraws this form.
              input.current?.focus()
              // A press, so at once and not on the debounce.
              schedule.cancel()
              if (service.busiest !== project.date) void choose(service.busiest)
            }}
          >
            Use the busiest weekday
          </Button>
          {/* Offered while the map does not show the control's day: a day
              chosen and not drawn, or one the store would not take, which
              is refused again rather than being unpressable and silent. */}
          <Button
            variant="primary"
            type="submit"
            disabled={disabled || running || value === '' || (value === project.date && !undrawn)}
          >
            <Icon name="map" />
            Draw for this day
          </Button>
        </div>
      </form>
    </section>
  )
}
