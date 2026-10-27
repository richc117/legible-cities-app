import { useEffect, useMemo, useState } from 'react'
import type { ProjectRecord } from '../../../shared/project/types'
import type { Inspection } from '../../../shared/protocol'
import { linesOf } from '../colours'
import { keepableLines } from '../exportChoice'

// The lines cell 06 offers to keep (issue 399; issue 433, part b): the
// feed's lines under the layout's mode and agency, by the labels the line
// colours use, less any hidden in cell 05. Read once the engine is up,
// from the Inspect view's cache.

export function useExportLines(
  project: Pick<ProjectRecord, 'feed' | 'built' | 'mode' | 'agency' | 'lines'>,
  ready: boolean,
  inspect: (key: string) => Promise<Inspection>,
): { inspection: Inspection | null; lines: string[] } {
  const [inspection, setInspection] = useState<Inspection | null>(null)
  useEffect(() => {
    if (!ready) return
    let left = false
    inspect(project.feed).then(
      (answer) => {
        if (!left) setInspection(answer)
      },
      () => undefined,
    )
    return () => {
      left = true
    }
  }, [ready, project.feed, inspect])
  const mode = project.built === null ? project.mode : project.built.mode
  const agency = project.built === null ? project.agency : project.built.agency
  // A line hidden in cell 05 is not offered (issue 399): the page has no
  // such line to keep, and keeping only hidden lines would hide them all.
  const lines = useMemo(
    () =>
      inspection === null
        ? []
        : keepableLines(
            linesOf(inspection, { mode, agency }).map((l) => l.label),
            project.lines,
          ),
    [inspection, mode, agency, project.lines],
  )
  return { inspection, lines }
}
