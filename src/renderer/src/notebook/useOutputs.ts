import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ExportOutput } from '../../../shared/export'
import type { RunState } from '../../../shared/layout'

// What a project has produced, read from its folder (A5.5-21; issue 563).
//
// The rail's Outputs list and cell 06's line about what an export would
// replace both ask the same question of the same folder, so the project
// screen asks it once, through this hook, and hands the answer to both
// (`ProjectState.outputs`): a Reveal that finds its file gone reads the
// folder again, and the line beside Export then sees what the rail sees. The
// folder is the answer and not anything this session remembers, which is
// what also covers two projects of one name sharing a folder: the file one
// wrote is the file the other would replace, and only a read of the folder
// knows.

/** The project's outputs, and the way to ask again. */
export interface OutputsState {
  /** Newest first (at most `OUTPUTS_MAX`), or null before the first read. */
  rows: ExportOutput[] | null
  /** Reads the folder again, for whoever learns it has changed. */
  read: () => void
}

/**
 * The project's outputs, read once when the project opens, and again
 * whenever the export run changes state - `done` is the one that adds a
 * row, but a cancel and a failure both leave the folder as it was and cost
 * one cheap read - or `folderKey` changes. The key is whatever names the
 * folder besides the project's id: its name, which is the folder's name
 * under the destination.
 */
export function useOutputs(
  projectId: string | null,
  runState: RunState,
  folderKey = '',
): OutputsState {
  const [rows, setRows] = useState<ExportOutput[] | null>(null)
  // The latest read's number. Reads overlap - a run ends as a folder is
  // chosen - and the folder is not read in the order it is asked, so an
  // answer is kept only if no read was asked after it: an older answer,
  // arriving last, would put the rows of the folder as it was.
  const latest = useRef(0)

  const read = useCallback((): void => {
    if (projectId === null) return
    const mine = ++latest.current
    window.api.export.outputs(projectId).then(
      (list) => {
        if (mine === latest.current) setRows(list)
      },
      // A folder that cannot be read is a list with nothing in it rather
      // than a sentence in the corner of a screen about a step a person did
      // not take. The main process has already logged the reason.
      () => {
        if (mine === latest.current) setRows([])
      },
    )
  }, [projectId])

  // `folderKey` is not read in the effect, only watched: a renamed project
  // exports to another folder, and the rows were of the old one.
  useEffect(() => {
    read()
  }, [read, runState, folderKey])

  return useMemo(() => ({ rows, read }), [rows, read])
}

/**
 * Reads the folder again when `key` moves after the first render: for the
 * piece of the folder's address that only one cell holds, the destination
 * cell 06 chose. The chooser has applied the folder by the time its answer
 * lands, so the read that follows is of the new one.
 */
export function useRereadOnChange(read: () => void, key: string): void {
  const seen = useRef(key)
  useEffect(() => {
    if (seen.current === key) return
    seen.current = key
    read()
  }, [read, key])
}
