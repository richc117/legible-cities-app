import { useEffect, useId, useRef, useState, type JSX } from 'react'
import type { ProjectRecord } from '../../shared/project'
import { caveatsSentence, copyText, metrics } from './engine/diagnostics'
import type { LayoutRun as Run, RunReport } from './engine/layoutRun'
import Button from './kit/Button'
import Icon from './icons/Icon'
import { useSnapshot } from './useSnapshot'

// What the build had to fudge: the engine's caveat sentences word for
// word, its issue score, and the figures of its diagnostics block, each
// row saying what it means to anyone who asks (specs/017). Nothing here is
// computed from the engine's numbers; the panel formats them and stops.
//
// It is the run's, not the record's: a build the app did not watch has no
// report, so the panel is absent until a layout run or a rebuild has
// drawn a map, and goes again when the next run starts.

/** The panel, wired to a project's run. Nothing to show until a map has been drawn. */
export default function Diagnostics({
  run,
  project,
}: {
  run: Run
  project: ProjectRecord
}): JSX.Element | null {
  const { report } = useSnapshot(run)
  if (report === null) return null
  return <DiagnosticsReport name={project.name} report={report} />
}

/** What the panel says after a copy, either way. */
export const COPIED = 'The figures and the caveats are on the clipboard.'
export const NOT_COPIED = 'The figures could not be copied. Nothing was changed.'

/**
 * The copy, as a function that can be called without rendering: what is on
 * the screen goes to the clipboard, and the sentence that comes back is
 * what the panel says. A clipboard can refuse - it is the platform's, not
 * ours - and a refusal is a sentence, never a thrown error in a click
 * handler.
 */
export async function copyReport(
  write: (text: string) => Promise<void>,
  name: string,
  report: RunReport,
): Promise<string> {
  try {
    await write(copyText(name, report))
    return COPIED
  } catch {
    return NOT_COPIED
  }
}

/**
 * Which explanations a person asked for with a press, and which they sent
 * away with Escape. A shown explanation is content that appears on hover
 * and on focus, and WCAG 1.4.13 asks that it can be dismissed without
 * moving either: Escape hides every one showing, and each comes back once
 * the pointer and the focus have left its row, or on a press (A6-07).
 */
export interface Explained {
  asked: string | null
  dismissed: readonly string[]
}

/**
 * Escape: every explanation showing is sent away. One that is pointed at or
 * focused is dismissed until the pointer and the focus leave its row; one
 * that was only pressed open, with neither on its row any more, is simply
 * put away - nothing would ever clear a dismissal of it.
 */
export function explainedAfterEscape(now: Explained, showing: readonly string[]): Explained {
  return { asked: null, dismissed: [...new Set([...now.dismissed, ...showing])] }
}

/** A press on a row's control: its explanation is asked for, or put away, and never dismissed. */
export function explainedAfterPress(now: Explained, id: string): Explained {
  return {
    asked: now.asked === id ? null : id,
    dismissed: now.dismissed.filter((each) => each !== id),
  }
}

/** The pointer or the focus has left a row: Escape's dismissal of it is over. */
export function explainedAfterLeaving(now: Explained, id: string): Explained {
  return now.dismissed.includes(id)
    ? { asked: now.asked, dismissed: now.dismissed.filter((each) => each !== id) }
    : now
}

/**
 * The panel itself, given a report: a component with nothing behind it, so
 * a test can render it. `write` is the clipboard, injected for the same
 * reason; the bridge's method is the only way a page in this app can put
 * text on the clipboard, because every permission request is refused
 * (specs/017-diagnostics/contracts/bridge.md).
 */
export function DiagnosticsReport({
  name,
  report,
  write = (text: string) => window.api.clipboard.write(text),
}: {
  name: string
  report: RunReport
  write?: (text: string) => Promise<void>
}): JSX.Element {
  const [said, setSaid] = useState<string | null>(null)
  // The explanation a person asked for by pressing, which is the only way
  // a touch user can ask: hover and focus show one too, in the stylesheet.
  const [explained, setExplained] = useState<Explained>({ asked: null, dismissed: [] })
  const asked = explained.asked
  const base = useId()
  const rows = metrics(report.diagnostics)
  const table = useRef<HTMLTableElement>(null)
  const hovered = useRef<string | null>(null)

  // Escape from anywhere, since a pointer resting on a row leaves the focus
  // wherever it was.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // An Escape something else has taken - the inspector closing - is not
      // this panel's.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const showing: string[] = []
      if (hovered.current !== null) showing.push(hovered.current)
      const focused = document.activeElement?.closest('[data-metric]')
      const metric = focused?.getAttribute('data-metric')
      if (metric && table.current?.contains(focused ?? null)) showing.push(metric)
      setExplained((now) =>
        showing.length === 0 && now.asked === null ? now : explainedAfterEscape(now, showing),
      )
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const copy = async (): Promise<void> => setSaid(await copyReport(write, name, report))

  return (
    <section className="diagnostics" aria-labelledby="diagnostics-heading">
      <h2 id="diagnostics-heading">What the build had to fudge</h2>
      <p className="prose" role="status">
        {caveatsSentence(report)}
      </p>
      {report.caveats.length > 0 && (
        <ul className="caveats" aria-label="Caveats">
          {report.caveats.map((caveat) => (
            <li key={caveat} className="prose">
              {caveat}
            </li>
          ))}
        </ul>
      )}
      <table className="measures" ref={table}>
        <caption>What the engine measured drawing the map for {report.date}</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col">Figure</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((metric) => {
            const explainId = `${base}-${metric.id}`
            return (
              <tr key={metric.id}>
                <th scope="row">
                  <span
                    className="explain"
                    data-metric={metric.id}
                    data-open={asked === metric.id ? 'true' : undefined}
                    data-dismissed={explained.dismissed.includes(metric.id) ? 'true' : undefined}
                    onMouseEnter={() => {
                      hovered.current = metric.id
                    }}
                    onMouseLeave={(event) => {
                      hovered.current = null
                      if (!event.currentTarget.contains(document.activeElement))
                        setExplained((now) => explainedAfterLeaving(now, metric.id))
                    }}
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setExplained((now) => explainedAfterLeaving(now, metric.id))
                    }}
                  >
                    {metric.label}{' '}
                    <button
                      type="button"
                      className="explain-trigger"
                      aria-label={`What ${metric.label.toLowerCase()} means`}
                      aria-describedby={explainId}
                      aria-expanded={asked === metric.id}
                      onClick={() => setExplained((now) => explainedAfterPress(now, metric.id))}
                    >
                      <Icon name="info" />
                    </button>
                    <span role="tooltip" id={explainId} className="tooltip">
                      {metric.explain}
                    </span>
                  </span>
                </th>
                <td>{metric.value}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="toolbar">
        <Button onClick={copy}>Copy as text</Button>
      </div>
      <p className="message" role="status">
        {said}
      </p>
    </section>
  )
}
