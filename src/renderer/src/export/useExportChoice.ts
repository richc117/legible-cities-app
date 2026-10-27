import { useMemo, useRef, useState } from 'react'
import type { ExportChoice } from '../../../shared/export'
import { sameChoice, usable, type ExportTables } from '../exportChoice'

// Cell 06's choice and its writes (issue 433, part b): the choice as the
// cell holds it, read against the engine's tables, and every change to it
// sent to the record. The one place in the cell that writes the choice;
// the form, the opening and the preview read it from here, through the
// composition (`ExportTab.tsx`).

export interface ExportChoiceState {
  /** The choice as it is offered: the one held, less what the tables no longer list. */
  choice: ExportChoice
  /** The preset or storyboard the record named that the engine no longer lists; null when none. */
  dropped: string | null
  /** A choice made: held at once, and written unless it is what was last sent. */
  change: (next: ExportChoice) => void
  /** The refusal of the last write, until a later one lands. */
  writeProblem: string | null
}

export function useExportChoice({
  record,
  tables,
  readOnly,
  onChoice,
}: {
  /** The record's choice, as the project was opened with it. */
  record: ExportChoice
  /** The engine's tables, or null while they are not read. */
  tables: ExportTables | null
  readOnly: boolean
  /** Write the choice to the record; the screen takes the record that comes back. */
  onChoice: (choice: ExportChoice) => Promise<void>
}): ExportChoiceState {
  const [saved, setSaved] = useState<ExportChoice>(record)
  const [writeProblem, setWriteProblem] = useState<string | null>(null)

  const { choice, dropped } = useMemo(
    () =>
      tables !== null ? usable(saved, tables) : { choice: saved, dropped: null as string | null },
    [saved, tables],
  )

  // Writing: each change is sent the moment it is made, and nothing here
  // orders the writes. The bridge hands main a frame's calls in the order
  // they were sent and the store writes them in that order, answering in it
  // too (spec 037, "The record session" in docs/ARCHITECTURE.md), so the
  // newest choice is the record's. What was last sent, not the record in
  // hand, decides whether a change needs writing: a change back to the
  // record's value while another write is out would otherwise be skipped,
  // and the record would keep the one in between.
  const sent = useRef<ExportChoice | null>(record)
  const latest = useRef<ExportChoice | null>(null)
  const write = async (next: ExportChoice): Promise<void> => {
    latest.current = next
    try {
      await onChoice(next)
      // The last answer is the newest choice's: it landed, and with it every
      // write before it, so nothing is left unsaved.
      if (latest.current === next) setWriteProblem(null)
    } catch (error) {
      // What is on disk is unknown now, so the next change is written
      // whatever it is.
      sent.current = null
      setWriteProblem(error instanceof Error ? error.message : String(error))
    }
  }
  const change = (next: ExportChoice): void => {
    setSaved(next)
    if (readOnly || (sent.current !== null && sameChoice(next, sent.current))) return
    sent.current = next
    void write(next)
  }

  return { choice, dropped, change, writeProblem }
}
