import { useEffect, useState } from 'react'
import { runFailureSentence } from '../../../shared/jobs'
import { engineClient } from '../engine/runs'
import { exportTablesFor, forgetExportTables, type ExportTables } from '../exportChoice'

// Cell 06's first fact: the engine's two tables, its presets and its
// storyboards, which every list in the cell is read from (issue 433, part
// b). Asked once while the engine stays up; a restarted engine may be
// another version, so they are forgotten when it goes and asked again when
// it is back.

export type Tables =
  | { status: 'waiting' }
  | { status: 'ready'; tables: ExportTables }
  | { status: 'failed'; message: string }

export function useExportTables(ready: boolean): Tables {
  const [tables, setTables] = useState<Tables>({ status: 'waiting' })
  useEffect(() => {
    if (!ready) {
      forgetExportTables()
      setTables({ status: 'waiting' })
      return
    }
    let left = false
    exportTablesFor(engineClient()).then(
      (answer) => {
        if (!left) setTables({ status: 'ready', tables: answer })
      },
      (error: unknown) => {
        if (left) return
        setTables({
          status: 'failed',
          message: runFailureSentence(error, 'The engine did not list its presets.'),
        })
      },
    )
    return () => {
      left = true
    }
  }, [ready])
  return tables
}
