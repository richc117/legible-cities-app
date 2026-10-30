import { useCallback, useEffect, useState } from 'react'
import type { ExportOutput } from '../../../shared/export'
import type { RunState } from '../../../shared/layout'

// What a project has produced, read from its folder (A5.5-21; issue 563).
//
// The rail's Outputs list and cell 06's line about what an export would
// replace both ask the same question of the same folder, so they ask it
// through one hook. The folder is the answer and not anything this session
// remembers, which is what also covers two projects of one name sharing a
// folder: the file one wrote is the file the other would replace, and only
// a read of the folder knows.

/**
 * The project's outputs, newest first, or null before the first read; and
 * `read`, which asks again for the caller that learns the folder has
 * changed (a Reveal that finds its file gone).
 *
 * Read once when the project opens, and again whenever the export run
 * changes state: `done` is the one that adds a row, but a cancel and a
 * failure both leave the folder as it was and cost one cheap read.
 */
export function useOutputs(
  projectId: string | null,
  runState: RunState,
): { rows: ExportOutput[] | null; read: () => void } {
  const [rows, setRows] = useState<ExportOutput[] | null>(null)

  const read = useCallback((): void => {
    if (projectId === null) return
    window.api.export.outputs(projectId).then(
      (list) => setRows(list),
      // A folder that cannot be read is a list with nothing in it rather
      // than a sentence in the corner of a screen about a step a person did
      // not take. The main process has already logged the reason.
      () => setRows([]),
    )
  }, [projectId])

  useEffect(() => {
    read()
  }, [read, runState])

  return { rows, read }
}
