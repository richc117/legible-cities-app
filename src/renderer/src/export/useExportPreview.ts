import { useEffect, useMemo, useRef, useState } from 'react'
import { withoutPaths } from '../../../shared/engine'
import type { ExportChoice, ExportPreview } from '../../../shared/export'
import { drawnDate } from '../../../shared/project/helpers'
import type { ProjectRecord } from '../../../shared/project/types'
import {
  PreviewPlanner,
  refusalWords,
  type ExportTables,
  type PreviewAddress,
} from '../exportChoice'

// Cell 06's preview, planned (ADR-046, spec 029 FR-004; issue 433, part
// b): `export.preview` asked for the choice once the changes stop, its
// address handed to the cell's own frame through `onPreview`, and its
// refusal or its notes kept for the form to say. Nothing is planned while
// the cell is closed, while a run rewrites the page or an export is under
// way, or before the engine's tables and the project's layout are there;
// an answer that comes after the cell has closed is dropped.

/**
 * A key for "this choice, for this page, in this theme", so a refusal is
 * tied to what was refused.
 *
 * The day is the one the page was drawn for and not the record's: a day
 * chosen and not yet drawn changes nothing about the page this preview is
 * of, and re-planning for it would draw the preview's beats and clock for a
 * picture that does not exist (A5.5-15).
 */
const keyOf = (choice: ExportChoice, project: ProjectRecord): string =>
  // Without the alt text, which is not on the plan and so changes nothing
  // the preview is of (issue 352).
  JSON.stringify([{ ...choice, alt: undefined }, project.theme, drawnDate(project), project.layout])

export interface PreviewPlanning {
  /** Whether the engine refused the choice as it is now; Export waits until it changes. */
  refused: boolean
  /** The last refusal, and the choice it was for. */
  refusal: { key: string; sentence: string } | null
  /** The engine's notes on the last plan it answered. */
  notes: string[]
}

export function useExportPreview({
  project,
  asked,
  active,
  ready,
  tables,
  layingOut,
  exporting,
  onPreview,
}: {
  project: ProjectRecord & { readOnly: boolean }
  /** The choice the preview and the export are planned from. */
  asked: ExportChoice
  /** Whether cell 06 is open. */
  active: boolean
  /** Whether the engine is up. */
  ready: boolean
  /** The engine's tables, or null while they are not read. */
  tables: ExportTables | null
  /** A run is rewriting the page. */
  layingOut: boolean
  /** An export is under way. */
  exporting: boolean
  /** The address cell 06's preview should show, when a plan answers. */
  onPreview: (address: PreviewAddress) => void
}): PreviewPlanning {
  const [refusal, setRefusal] = useState<{ key: string; sentence: string } | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const key = keyOf(asked, project)
  const refused = refusal !== null && refusal.key === key

  // The preview's planning: debounced, and a late answer dropped. The
  // callbacks are read through refs, so the planner is made once.
  const answerRef = useRef<(preview: ExportPreview, asked: ExportChoice) => void>(() => undefined)
  useEffect(() => {
    answerRef.current = (preview, asked) => {
      if (preview.ok) {
        // Not while the cell is closed. The planner is cancelled in an
        // effect, which flushes after the commit that closed it, so an
        // answer already on its way would otherwise leave an address for a
        // choice a person has left, to be shown the next time the cell
        // opens. `active` is current here because this callback is written
        // on every render.
        if (!active) return
        setRefusal(null)
        setNotes(preview.notes)
        // The preset's own size, from the engine's table, for the frame's
        // ratio and the caption; the plan's may be at another scale.
        const entry = tables?.presets.find((p) => p.name === asked.preset)
        onPreview({
          url: preview.url,
          width: entry?.width ?? preview.width,
          height: entry?.height ?? preview.height,
          safe: entry?.safe_zones ?? false,
        })
      } else {
        // The last good address stays in the frame; the sentence says why
        // this one is not there (FR-007).
        setNotes([])
        setRefusal({
          key: keyOf(asked, project),
          sentence: withoutPaths(refusalWords(preview)),
        })
      }
    }
  })
  const planner = useMemo(
    () =>
      new PreviewPlanner(
        (asked) => window.api.export.preview(project.id, asked),
        (preview, asked) => answerRef.current(preview, asked),
      ),
    [project.id],
  )
  useEffect(() => () => planner.cancel(), [planner])

  const canPlan =
    active &&
    !project.readOnly &&
    ready &&
    tables !== null &&
    project.layout !== null &&
    // A run rewrites the page in place; the frame is not reloaded under
    // it, and an export is planned from the record as it was.
    !layingOut &&
    !exporting
  // Planned again whenever what the address depends on changes: `key`
  // carries the choice, the theme, the day and the layout, and `made` a
  // layout laid out again under the same id. Read through a ref, so the
  // effect's dependencies are exactly those.
  const choiceRef = useRef(asked)
  useEffect(() => {
    choiceRef.current = asked
  })
  const made = project.made
  useEffect(() => {
    if (!canPlan) {
      planner.cancel()
      return
    }
    planner.schedule(choiceRef.current)
  }, [canPlan, key, made, planner])

  return { refused, refusal, notes }
}
