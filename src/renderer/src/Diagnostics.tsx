import { useId, useState, type JSX } from 'react'
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
  const base = useId()
  const rows = metrics(report.diagnostics)

  const copy = async (): Promise<void> => {
    try {
      await write(copyText(name, report))
      setSaid('The figures and the caveats are on the clipboard.')
    } catch {
      setSaid('The figures could not be copied.')
    }
  }

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
      <table className="measures">
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
                  <span className="explain">
                    {metric.label}{' '}
                    <button
                      type="button"
                      className="explain-trigger"
                      aria-label={`What ${metric.label.toLowerCase()} means`}
                      aria-describedby={explainId}
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
