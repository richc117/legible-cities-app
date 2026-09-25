import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ExportOutput } from '../../../shared/export'
import Button from '../kit/Button'
import { useProject } from './context'
import Time from './Time'

// What this project has produced, under the stepper in the rail (A5.5-21,
// docs/DESIGN.md 8.2, "Outputs").
//
// The list is read from disk, from the sidecar the engine already writes
// beside every deliverable, and never from what this session remembers.
// That is the gap it fills: a finished export was findable only in the
// inspector, and only until the app was closed. It is read again whenever
// an export settles, so a file that has just been written appears without a
// restart, and again on a press that finds its file gone.
//
// No path is shown (constitution V). A row says the preset and when it was
// made; Reveal opens the folder, and the main process is the only side that
// ever knows which folder that is. A file moved or deleted since reads as
// gone rather than failing on a press, and offers nothing to press.

/** What a row says when its preset is missing from the sidecar. */
export const UNNAMED_PRESET = 'an export'

/** The sentence a project with nothing to show says. */
export const NOTHING_YET = 'Nothing exported yet.'

/** What a row says when its file is no longer beside its sidecar. */
export const GONE = 'the file has been moved or deleted'

export default function Outputs(): JSX.Element | null {
  const { project, exportSnapshot } = useProject()
  const id = project?.id ?? null
  const [rows, setRows] = useState<ExportOutput[] | null>(null)

  const read = useCallback((): void => {
    if (id === null) return
    window.api.export.outputs(id).then(
      (list) => setRows(list),
      // A folder that cannot be read is a list with nothing in it rather
      // than a sentence in the corner of a screen about a step a person did
      // not take. The main process has already logged the reason.
      () => setRows([]),
    )
  }, [id])

  // Once when the project opens, and again whenever the export run changes
  // state: `done` is the one that adds a row, but a cancel and a failure
  // both leave the folder as it was and cost one cheap read.
  const runState = exportSnapshot.state
  useEffect(() => {
    read()
  }, [read, runState])

  if (id === null) return null
  return (
    <section className="rail-outputs" aria-labelledby="outputs-heading">
      <h2 id="outputs-heading">Outputs</h2>
      {rows !== null && rows.length === 0 && <p className="rail-empty">{NOTHING_YET}</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="outputs">
          {rows.map((row) => (
            <li key={row.file} className="output">
              <span className="output-preset">{row.preset ?? UNNAMED_PRESET}</span>
              <span className="output-made">
                <Time iso={row.made} />
              </span>
              {row.present ? (
                <Button
                  aria-label={`Reveal ${row.preset ?? UNNAMED_PRESET}, ${row.file}`}
                  onClick={() => {
                    void window.api.export.revealOutput(id, row.file).then(
                      // False means the file went between the read and the
                      // press. Read the folder again, so the row says gone
                      // instead of pretending the press did something.
                      (shown) => {
                        if (!shown) read()
                      },
                      () => read(),
                    )
                  }}
                >
                  Reveal
                </Button>
              ) : (
                <span className="output-gone">{GONE}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
