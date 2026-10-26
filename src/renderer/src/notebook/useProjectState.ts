import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { DELETE_WHILE_DRAWING, DELETE_WHILE_EXPORTING } from '../../../shared/activity'
import type { DeleteResult, ProjectRecord } from '../../../shared/api'
import type { EngineState } from '../../../shared/engine'
import type { ExportChoice } from '../../../shared/export'
import { type ProjectInputs, type ProjectTuning, type Theme } from '../../../shared/project/types'
import { validateName } from '../../../shared/project/validate'
import type { Inspection, RenderStageResult, StageName } from '../../../shared/protocol'
import type { ExportRun, ExportSnapshot } from '../engine/exportRun'
import { feedRecordFor, inspectionFor } from '../engine/inspections'
import { afterRunDownload } from '../engine/downloadGate'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import {
  engineClient,
  exportRunFor,
  forgetProjectJobs,
  layoutRunFor,
  nameProject,
} from '../engine/runs'
import { stageFor } from '../engine/stages'
import { isOlderPage } from '../../../shared/viewer'
import { skipTarget } from '../SkipPastMap'
import { forgetTheme, rememberTheme } from '../themeMemory'
import { writeThenRestyle } from '../themeWrites'
import type { TextInputHandle } from '../kit/TextInput'
import { tunedProject } from '../tuningRules'
import { useEngineState } from '../useEngineState'
import { useSnapshot } from '../useSnapshot'
import { keepFocusInCell, redrawOnOpen, redrawPageOnOpen } from './olderPage'
import { useRefusedGone } from './useCheapEdit'

// Everything the project screen holds, in one hook (A5.5-08).
//
// It is `ProjectView.tsx`'s own body, moved: the record and the three ways
// it is written, the rename form, the delete, the two runs and whether
// either is going, the feed's registry entry, and the refs the skip link
// and the focus handbacks point at. Nothing here is new.
//
// It is a hook rather than a component's state because the notebook's six
// cells all read from it and three of them write to it, and threading
// twenty values through six adapters as props would mean every branch that
// adds a consumer edits the file above it. The context in `context.ts`
// carries what this returns; a cell reads what it needs and nothing else.

type Project = ProjectRecord & { readOnly: boolean }

type ViewState =
  | { status: 'loading' }
  | { status: 'ready'; project: Project }
  | { status: 'error'; message: string }

const FOLDER_WORDS: Record<DeleteResult['failed'][number]['folder'], string> = {
  project: "The project's folder",
  output: "The project's output folder",
}

// What a delete left behind, for the person: folders by role, never by
// path (the reasons come from the main side, which keeps paths out too).
export function describeFailures(failed: DeleteResult['failed']): string | undefined {
  if (failed.length === 0) return undefined
  return failed
    .map(({ folder, reason }) => `${FOLDER_WORDS[folder]} could not be removed: ${reason}`)
    .join(' ')
}

export interface ProjectState {
  /** The record, once it has been read; null while loading and after a failure. */
  project: Project | null
  /** The message a failed read left, for the screen to say. */
  error: string | null
  engine: EngineState | null
  /** The project's one layout run and its one export; both belong to the project, not to this screen. */
  run: LayoutRun
  exporter: ExportRun
  /** The two runs as they stand, read once here so nothing subscribes twice. */
  runSnapshot: RunSnapshot
  exportSnapshot: ExportSnapshot
  layingOut: boolean
  exporting: boolean
  /**
   * True from a run's `done` until the record it wrote has been read back
   * (A5.5-22). In that beat the run is over and the record is the old one,
   * so anything that decides what is left to run from the record would
   * decide it from before the run.
   */
  settling: boolean
  /**
   * The engine's sentence for a cheap edit that was flushed as its panel
   * went and refused at its start, while the run still stands where that
   * refusal left it (spec 037, User Story 3 scenario 5); null otherwise. The
   * header says it on the project's status line, since the control that
   * would have gone back is gone (`useCheapEdit.ts`).
   */
  refused: string | null
  /** How many runs have drawn the page while this screen is open; the viewer's address carries it. */
  drawn: number
  /**
   * How many times a theme was pressed on a page that has no `setTheme` (one
   * the engine wrote before v0.11.0) and so has to be loaded again to show
   * it; the viewer's address carries it, as it carries `drawn`.
   */
  themeReloads: number
  /**
   * Told what each page the map's frame loads has on its seam (`Viewer.tsx`'s
   * `onSeams`). The first answer decides whether the page the screen opened
   * on is redrawn, once, because an older engine drew it (issue 465).
   */
  pageSeams: (seams: string[] | null) => void
  /**
   * The job the redraw on open started on this screen, or null where it
   * started none (issue 517): cell 03 compares it with the run's latest job
   * to tell the opening's failure from a rebuild a person asked for
   * (`frameFailure`).
   */
  redrawAsked: string | null
  /**
   * The seam the first page the screen loaded answered, or null until it
   * has, or where it did not say: what cell 03 says still holds of a page
   * whose redraw failed is built from what it lacks (issue 517).
   */
  openedSeams: readonly string[] | null
  /** The feed's registry entry's mode and agency, when the Library listed it. */
  registry: { mode: string; agency: string | null } | null
  /** The feed as the engine reads it, cached by the inspection module. */
  inspect: (key: string) => Promise<Inspection>
  /**
   * One stage of the layout, drawn by the engine, with its description timed
   * for the day given (issue 105); null asks for none, and the engine times
   * nothing.
   */
  readStage: (
    key: string,
    layout: string,
    made: string | null,
    stage: StageName,
    width: number,
    date: string | null,
  ) => Promise<RenderStageResult>
  /**
   * The mode, the operator or both, written at once (A2-02); the store writes
   * them onto the record as the writes before them left it (issue 407, spec
   * 037).
   */
  setInputs: (inputs: Partial<ProjectInputs>) => Promise<void>
  /** The service day a person chose, written at once and drawing nothing (A5.5-15). */
  setDate: (date: string) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  /**
   * LOOM's settings for the layout (issue 385), written at once and laying
   * nothing out: the next layout run sends them. A rejection is the
   * caller's to show.
   */
  setTuning: (tuning: ProjectTuning) => Promise<void>
  setExport: (choice: ExportChoice) => Promise<void>
  /** The screen's own heading, focused once there is something to read. */
  headingRef: RefObject<HTMLHeadingElement | null>
  /** Past the map to cell 03's heading (issue 106, ADR-046). */
  skipPastMap: () => void
  onBack: (notice?: string) => void
  /** The rename form and the delete, which the footer draws. */
  rename: {
    open: boolean
    value: string
    setValue: (value: string) => void
    message: string | null
    saving: boolean
    buttonRef: RefObject<HTMLElement | null>
    inputRef: RefObject<TextInputHandle | null>
    begin: () => void
    close: () => void
    save: (event: FormEvent<HTMLFormElement>) => Promise<void>
  }
  remove: {
    confirming: boolean
    problem: string | null
    buttonRef: RefObject<HTMLElement | null>
    begin: () => void
    cancel: () => void
    confirm: () => Promise<void>
    setProblem: (problem: string | null) => void
  }
}

/**
 * What the front door says when a sample was cancelled while its feed
 * downloaded, and so was not kept (issue 178).
 */
export const sampleNotKept = (name: string): string =>
  `Opening ${name} was cancelled while its feed downloaded, so the project was not kept.`

export function useProjectState(
  id: string,
  onBack: (notice?: string) => void,
  layOut = false,
): ProjectState {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameMessage, setRenameMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // A delete refused after its confirmation was closed while it ran (A6-07).
  const [deleteProblem, setDeleteProblem] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  // How many runs have drawn the page while this view is open. The viewer
  // puts it on the page's address, so the frame is sent to the page a run
  // has just written instead of keeping the document it had: a run writes
  // the same file name again, so without it the address would not move.
  // It was the viewer's `key` until A5.5-20, which got the reload by
  // remounting the frame - and a remount loses the page's clock, its view
  // and its scrub position as surely as a reparent does (ADR-045).
  const [drawn, setDrawn] = useState(0)
  // How many times the map's page refused to be told a theme because it has
  // no `setTheme`, and has to be loaded again at an address carrying it.
  // Zero for every page the engine has written since v0.11.0.
  const [themeReloads, setThemeReloads] = useState(0)
  const engine = useEngineState()
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The runs belong to the project, not to this view: a person can start a
  // layout or an export, go back to the Library and come back to one still
  // running. Neither may start while the other runs: a layout rewrites the
  // page an export is reading, and an export reads a page a layout would
  // replace under it.
  const run = layoutRunFor(id)
  const exporter = exportRunFor(id)
  const runSnapshot = useSnapshot(run)
  // The run is past its feed: its first stage is done, or it ended with the
  // feed on disk. After cell 01's held inspection was refused because the
  // feed never arrived, the first run past it asks again (issue 178).
  const feedHere =
    runSnapshot.stages[0]?.state === 'done' ||
    (runSnapshot.state !== 'running' && runSnapshot.feedMissing === false)
  const inspectionRefused = useRef(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!feedHere || !inspectionRefused.current) return
    inspectionRefused.current = false
    setRetry((n) => n + 1)
  }, [feedHere])
  const exportSnapshot = useSnapshot(exporter)
  const refused = useRefusedGone(run, runSnapshot)
  const layingOut = runSnapshot.state === 'running'
  const exporting = exportSnapshot.state === 'running'

  // When a run finishes it has written the record; read it back so the
  // screen shows the layout and the day it just stored. `settling` covers
  // the read, and comes down however it ends: a read that failed leaves
  // the screen on the record it had, which is what it showed before.
  //
  // A run that is put back as it stood - Run all that found nothing left to
  // run in the record it read (issue 407) - goes back to
  // the very snapshot it had, which may be a `done` already seen here, and
  // nothing was drawn since: read back again, the page would load anew for
  // a map nobody drew.
  const [settling, setSettling] = useState(false)
  useEffect(() => {
    let previous = run.snapshot.state
    let settled = run.snapshot.state === 'done' ? run.snapshot : null
    return run.subscribe((snapshot) => {
      if (snapshot.state === 'done' && previous !== 'done' && snapshot !== settled) {
        setSettling(true)
        window.api.projects
          .get(id)
          .then(
            (project) => {
              setState({ status: 'ready', project })
              setDrawn((n) => n + 1)
            },
            () => undefined,
          )
          .finally(() => setSettling(false))
      }
      if (snapshot.state === 'done') settled = snapshot
      previous = snapshot.state
    })
  }, [id, run])
  const renameButtonRef = useRef<HTMLElement>(null)
  const deleteButtonRef = useRef<HTMLElement>(null)
  const newNameRef = useRef<TextInputHandle>(null)

  // Past the map to what comes after it (issue 106): cell 03's heading,
  // since ADR-046 put the map between cells 02 and 03. The heading and not
  // the cell's first control, because the heading is there whether the
  // cell is open or not; it takes focus by `tabIndex={-1}`, as every cell
  // heading does for the rail (`kit/Disclosure.tsx`). Until then the map
  // was pinned above every cell and the skip went to the footer's Rename.
  // The screen's own heading is the fallback, so a press never leaves focus
  // on a control that did nothing.
  const skipPastMap = (): void => {
    skipTarget<HTMLElement>(
      [document.querySelector<HTMLElement>(`.cell[data-cell="03"] .disclosure-heading`)],
      headingRef.current,
    )?.focus()
  }

  useEffect(() => {
    let cancelled = false
    window.api.projects.get(id).then(
      (project) => {
        if (cancelled) return
        setState({ status: 'ready', project })
        // Opened, for the front door's order (A5.6-04). Nothing waits on it
        // and nothing is said if it fails: an order one opening out of date
        // is not a thing to put in front of a person who is working. A
        // read-only project is not written at all.
        if (!project.readOnly) void window.api.projects.markOpened(id).catch(() => undefined)
      },
      (error: unknown) => {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
    return () => {
      cancelled = true
    }
  }, [id])

  // Focus the heading once there is something to read, so a screen reader
  // says which project opened.
  useEffect(() => {
    if (state.status !== 'loading') headingRef.current?.focus()
  }, [state.status])

  const project = state.status === 'ready' ? state.project : null

  // A project just made from a sample city starts its layout as its screen
  // opens (A5.6-03), once, and only while there is nothing laid out and
  // nothing running: a person who presses a city lands in a notebook
  // already at work, its stages in cell 02. (The preset's download is inside
  // that run; since engine v0.10.0 it reports stage download, which cell 01
  // draws, and a cancel stops it: E36, issue 178.)
  // It waits for an engine that is still starting, and gives up the moment
  // it has started or been made pointless - a read-only record, a layout
  // already there, a run already going.
  const layOutAsked = useRef(layOut)
  useEffect(() => {
    if (!layOutAsked.current || project === null) return
    if (project.readOnly || project.layout !== null || run.snapshot.state === 'running') {
      layOutAsked.current = false
      return
    }
    if (engine?.state !== 'ready') return
    layOutAsked.current = false
    run.start(project, engine)
    // The record and the engine becoming ready are what move this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, engine?.state])

  // A page an older engine drew is redrawn when the project opens (issue
  // 465; known by its seam, or since issue 494 by the engine version its
  // record names): a rebuild for the day the map already shows, from the stored
  // layout, with the record's own choices, as `olderPage.ts` decides, started
  // through Run all so the day is the record's once the writes on their way
  // have landed (issue 407). The
  // first page the frame reports on is the one judged; once that judgement
  // has been acted on - a redraw asked, or nothing to do - nothing here runs
  // again for this screen, so a redraw that fails, or one that leaves a page
  // no newer, is not asked for again. While the engine is away or the page is
  // held by a run or an export it waits; a run that draws meanwhile settles
  // it, since that page is the pinned engine's. The job a redraw started is
  // kept, so cell 03 can tell its failure from a rebuild a person asked for
  // and say it in words for a person who pressed nothing (issue 517).
  const [opened, setOpened] = useState<{
    older: boolean | null
    seams: readonly string[] | null
  } | null>(null)
  const seamsHeard = useRef(false)
  const pageSeams = useCallback((seams: string[] | null): void => {
    if (seamsHeard.current) return
    seamsHeard.current = true
    setOpened({ older: isOlderPage(seams), seams })
  }, [])
  const redrawSettled = useRef(false)
  const [redrawAsked, setRedrawAsked] = useState<string | null>(null)
  useEffect(() => {
    if (redrawSettled.current || opened === null || project === null) return
    // The engine's own version, which the record's `drawn.engine` is judged
    // against (issue 494): the engine a redraw would ask.
    const running = engine?.state === 'ready' ? engine.version : null
    const now = redrawOnOpen({
      older: opened.older,
      running,
      project,
      engineReady: engine?.state === 'ready',
      busy: layingOut || exporting || settling,
      drawnHere: drawn,
    })
    if (now.kind === 'wait') return
    redrawSettled.current = true
    if (now.kind === 'redraw') {
      // Out of the control a run is about to disable, before it does.
      keepFocusInCell(document.activeElement)
      setRedrawAsked(
        redrawPageOnOpen(run, project, engine, { older: opened.older, running, drawnHere: drawn }),
      )
    }
    // The record, the engine, the runs and the redraw count are what move this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, project, engine?.state, layingOut, exporting, settling, drawn])

  // A sample opened from its card and cancelled while its feed downloaded
  // leaves nothing behind: not the zip (the engine keeps none, v0.10.0), and
  // not the project, which names a feed that never arrived (issue 178). A
  // cancel once the download is done leaves the project with its feed, and
  // cell 02 ready to run, as a cancelled layout always has. Which of the two
  // it was is the registry's answer as the run ended (`feedMissing`), not
  // how far the bytes had come.
  const unkept = useRef(false)
  useEffect(() => {
    if (!layOut) return
    return run.subscribe((snapshot) => {
      const record = state.status === 'ready' ? state.project : null
      if (
        unkept.current ||
        record === null ||
        record.layout !== null ||
        snapshot.state !== 'cancelled' ||
        snapshot.feedMissing !== true
      )
        return
      unkept.current = true
      void window.api.projects.delete(id).then(
        () => {
          forgetProjectJobs(id)
          forgetTheme(id)
          if (mounted.current) onBack(sampleNotKept(record.name))
        },
        () => {
          // Not deleted: the project stays, naming a feed not on disk, which
          // its screen already says (A5.6-03's closed-mid-download case).
          unkept.current = false
        },
      )
    })
  }, [layOut, run, id, state, onBack])

  const openRename = (): void => {
    if (!project) return
    setNewName(project.name)
    setRenameMessage(null)
    setRenaming(true)
  }

  // The form's own controls disappear with it, so focus goes back to the
  // button that revealed it.
  const closeRename = (): void => {
    setRenaming(false)
    renameButtonRef.current?.focus()
  }

  const saveRename = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!project) return
    const trimmed = newName.trim()
    const invalid = validateName(trimmed)
    if (invalid) {
      setRenameMessage(invalid)
      newNameRef.current?.focus()
      return
    }
    if (trimmed === project.name) return closeRename()
    setSaving(true)
    try {
      const record = await window.api.projects.rename(id, trimmed)
      // The inspector's jobs say the new name from now on (A1-03).
      nameProject(id, record.name)
      setState({ status: 'ready', project: { ...project, ...record } })
      closeRename()
    } catch (error) {
      setRenameMessage(error instanceof Error ? error.message : String(error))
      newNameRef.current?.focus()
    } finally {
      setSaving(false)
    }
  }

  // The two inputs chosen with the feed in view: the record comes back
  // written, and the run reads it when it next starts.
  //
  // Every write here is sent the moment it is asked for, and a run reads its
  // record from the store, which answers the read only once every write sent
  // before it has landed (spec 037, "The record session" in
  // docs/ARCHITECTURE.md). So a field committed by leaving it for "Lay out"
  // is in what the run sends, and the answers come back in the order the
  // writes went, so the last one this screen takes is the last one written.
  //
  // The operator alone is sent without the mode (issue 407): the store
  // writes the fields a write names onto the record as the writes before it
  // left it, so a mode chosen a moment before and still on its way is not
  // put back by the mode this screen held.
  const setInputs = async (inputs: Partial<ProjectInputs>): Promise<void> => {
    const record = await window.api.projects.setInputs(id, inputs)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
        : current,
    )
  }
  // The service day is written the moment it is chosen, as the inputs are,
  // and draws nothing: the rebuild that draws it is a separate press. Until
  // A5.5-15 the day reached the record only from a finished draw, so
  // `drawn.date` could never differ from `date` and the notebook could
  // never say the map does not show the day a person picked. A rejection
  // is the caller's to show, as the rename's is.
  const setDate = async (date: string): Promise<void> => {
    const record = await window.api.projects.setDate(id, date)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
        : current,
    )
  }
  // The theme is written at once and nothing is rebuilt for it (A4-03). The
  // map's page is then told through its seam, which restyles it in place
  // and leaves the frame where it is; the record also reaches the next
  // document, on its address and as the first call of the restore (issue
  // 349). The theme is remembered here, **in the write's own callback, the
  // moment the record's answer arrives and before the page is told**,
  // because the restore of a document that is loading reads it from that
  // memory at the moment it sends and not from this screen's state, which
  // does not carry the theme until a render and its effects have run
  // (`themeMemory.ts`). A write that fails remembers nothing and sends
  // nothing. A page with no `setTheme` says so, and that one case loads the
  // page again with the theme on its address, as a press always did before
  // the seam had one.
  const setTheme = (theme: Theme): Promise<void> =>
    writeThenRestyle(
      theme,
      async (chosen) => {
        const record = await window.api.projects.setTheme(id, chosen)
        rememberTheme(id, record.theme)
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', project: { ...current.project, ...record } }
            : current,
        )
      },
      (chosen) => window.api.viewer.call('map', 'setTheme', chosen),
      () => setThemeReloads((count) => count + 1),
    )
  // LOOM's settings for the layout are written the moment they are
  // committed, as the export's options are, and nothing is laid out for
  // them: the next layout run reads the record and sends them, and until
  // then the run graph reports the layout as of another tuning (issue 385).
  // The record comes back whole and goes in whole (`tunedProject`): a reset
  // removes the key, which a merge would keep.
  const setTuning = async (tuning: ProjectTuning): Promise<void> => {
    const record = await window.api.projects.setTuning(id, tuning)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: tunedProject(current.project, record) }
        : current,
    )
  }
  // What to export is written the moment it is chosen, as the theme is;
  // nothing is built for it (A5-01).
  const setExport = async (choice: ExportChoice): Promise<void> => {
    const record = await window.api.projects.setExport(id, choice)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
        : current,
    )
  }
  const today = (): string => {
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }
  // A sample's feed not yet on disk downloads inside its layout run, and
  // cell 01's inspection waits for that download rather than racing it: the
  // bytes are then the run's to report, and a cancel of the run stops the
  // only download there is (issue 178, `downloadGate.ts`). Any other
  // project, and a sample once its run is past the download, inspects at
  // once.
  const inspect = useCallback(
    (key: string) => {
      if (!layOut) return inspectionFor(engineClient(), key, today())
      const cached = feedRecordFor(engineClient(), key).then(
        (record) => record?.cached === true,
        () => false,
      )
      return afterRunDownload(run, () => layOutAsked.current, cached).then(
        () => inspectionFor(engineClient(), key, today()),
        (error: unknown) => {
          inspectionRefused.current = true
          throw error
        },
      )
    },
    // `layOutAsked` and `inspectionRefused` are refs, read when asked.
    // `retry` moves only after an inspection was refused because the feed
    // never arrived, the first time a later run gets past the download -
    // whether or not it goes on to lay the project out - so cell 01 asks
    // again then, and only then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layOut, run, retry],
  )
  const readStage = useCallback(
    (
      key: string,
      layout: string,
      made: string | null,
      stage: StageName,
      width: number,
      date: string | null,
    ) => stageFor(engineClient(), key, layout, made, stage, width, date),
    [],
  )
  const [registry, setRegistry] = useState<{ mode: string; agency: string | null } | null>(null)
  const feedKey = project?.feed ?? null
  const ready = engine?.state === 'ready'
  useEffect(() => {
    if (feedKey === null || !ready) return
    let left = false
    feedRecordFor(engineClient(), feedKey).then(
      (record) => {
        if (!left)
          setRegistry(record === null ? null : { mode: record.mode, agency: record.agency })
      },
      () => undefined,
    )
    return () => {
      left = true
    }
  }, [feedKey, ready])

  // A rejection stays in the confirm dialog; a result goes back to the
  // Library, with a sentence if some folder remained.
  const remove = async (): Promise<void> => {
    // Re-read at the moment of confirming: the button was disabled when the
    // dialog opened, but a run can have started since, and `exporting` and
    // `layingOut` are the render's. Main refuses too (issue 491); this says
    // it without the round trip, in the same words.
    if (exporter.snapshot.state === 'running') throw new Error(DELETE_WHILE_EXPORTING)
    if (run.snapshot.state === 'running') throw new Error(DELETE_WHILE_DRAWING)
    const result = await window.api.projects.delete(id)
    // Deleted: its finished jobs leave the inspector. Only on this signal,
    // never because a list read happened to miss the record (A1-03).
    forgetProjectJobs(id)
    forgetTheme(id)
    // Back to the Library only from this screen: if a person has left it
    // while the delete ran, they are somewhere else now (A6-07).
    if (mounted.current) onBack(describeFailures(result.failed))
  }

  return {
    project,
    error: state.status === 'error' ? state.message : null,
    engine,
    run,
    exporter,
    runSnapshot,
    exportSnapshot,
    layingOut,
    settling,
    refused,
    exporting,
    drawn,
    themeReloads,
    pageSeams,
    redrawAsked,
    openedSeams: opened?.seams ?? null,
    registry,
    inspect,
    readStage,
    setInputs,
    setDate,
    setTheme,
    setTuning,
    setExport,
    headingRef,
    skipPastMap,
    onBack,
    rename: {
      open: renaming,
      value: newName,
      setValue: setNewName,
      message: renameMessage,
      saving,
      buttonRef: renameButtonRef,
      inputRef: newNameRef,
      begin: openRename,
      close: closeRename,
      save: saveRename,
    },
    remove: {
      confirming,
      problem: deleteProblem,
      buttonRef: deleteButtonRef,
      begin: () => {
        setDeleteProblem(null)
        setConfirming(true)
      },
      cancel: () => setConfirming(false),
      confirm: remove,
      setProblem: setDeleteProblem,
    },
  }
}
