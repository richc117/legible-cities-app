import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import type { EngineState } from '../../shared/engine'
import { validateServiceDate, withinWindow, type ProjectRecord } from '../../shared/project'
import type { LayoutRun as Run } from './engine/layoutRun'
import Icon from './icons/Icon'
import Button from './kit/Button'
import { useSnapshot } from './useSnapshot'

// The service day on the project screen: the day the map is drawn for,
// the days the feed covers, and a way to choose another (specs/012).
//
// The day is the engine's choice at the first layout and a person's since.
// Choosing one rebuilds the map from the stored layout and never re-lays
// out (ADR-031, constitution III). The control is the platform's own date
// input, bounded by the window the engine answered, and the main process
// refuses a day outside it again: this form is the first gate, not the
// only one. Nothing here reads or shows a time of day; times past midnight
// are the page's own business.

/** The sentence a day outside the window gets, on the form and from the store alike. */
export function outsideWindow(start: string, end: string): string {
  return `The feed covers ${start} to ${end}.`
}

export default function ServiceDay({
  run,
  project,
  engine,
  disabled = false,
}: {
  run: Run
  project: ProjectRecord
  engine: EngineState | null
  /** True while something else, such as an export, is reading the project's page. */
  disabled?: boolean
}): JSX.Element {
  const { state, rebuilt } = useSnapshot(run)
  const running = state === 'running'
  const [value, setValue] = useState(project.date ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const inputId = useId()
  const messageId = useId()
  const input = useRef<HTMLInputElement>(null)

  // The control follows the stored day: the record is read again when a
  // run finishes, and a rebuild that stopped wrote nothing, so the day the
  // project kept is the one to show. Keyed on the window's days, not the
  // record object, which a rename replaces without changing either.
  const service = project.service
  const windowKey = service === null ? '' : `${service.start}/${service.end}/${service.busiest}`
  useEffect(() => {
    setValue(project.date ?? '')
    setMessage(null)
  }, [project.id, project.date, windowKey])
  useEffect(() => {
    if (rebuilt && (state === 'cancelled' || state === 'failed')) setValue(project.date ?? '')
  }, [state, rebuilt, project.date])

  if (service === null) {
    return (
      <section className="service-day" aria-labelledby="service-day-heading">
        <h2 id="service-day-heading">Service day</h2>
        <p className="prose" role="status">
          {project.date === null ? 'Not yet chosen. ' : `Drawn for ${project.date}. `}
          Lay the project out again to learn which days the feed covers.
        </p>
      </section>
    )
  }

  const unchanged = value === project.date
  // A refusal goes back to the control, as the rename form's does, so the
  // message it references is read out with it.
  const refuse = (sentence: string): void => {
    setMessage(sentence)
    input.current?.focus()
  }
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const invalid = validateServiceDate(value)
    if (invalid !== null) return refuse(invalid)
    if (!withinWindow(value, service)) return refuse(outsideWindow(service.start, service.end))
    if (unchanged) return
    setMessage(null)
    run.rebuild(project, engine, value)
  }
  const covers =
    service.start === service.end
      ? `The feed covers one day, ${service.start}`
      : `The feed covers ${service.start} to ${service.end}`

  return (
    <section className="service-day" aria-labelledby="service-day-heading">
      <h2 id="service-day-heading">Service day</h2>
      <p className="prose" role="status">
        {project.date === null ? 'Not yet chosen.' : `Drawn for ${project.date}.`} {covers}; the
        busiest weekday, counted from {service.anchor}, is {service.busiest}.
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
            onChange={(event) => {
              setValue(event.target.value)
              setMessage(null)
            }}
            aria-describedby={messageId}
            aria-invalid={message ? true : undefined}
          />
          <p id={messageId} className="message error">
            {message}
          </p>
        </div>
        <div className="actions">
          <Button
            disabled={disabled || running || value === service.busiest}
            onClick={() => {
              setValue(service.busiest)
              setMessage(null)
              // The button disables itself once pressed, which drops focus;
              // the control now holding the day is where focus belongs.
              input.current?.focus()
            }}
          >
            Use the busiest weekday
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={disabled || running || unchanged || value === ''}
          >
            <Icon name="map" />
            Draw for this day
          </Button>
        </div>
      </form>
    </section>
  )
}
