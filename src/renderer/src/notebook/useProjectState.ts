import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import type { DeleteResult, ProjectRecord } from '../../../shared/api'
import type { EngineState } from '../../../shared/engine'
import type { ExportChoice } from '../../../shared/export'
import { validateName, type Theme } from '../../../shared/project'
import type { Inspection, RenderStageResult, StageName } from '../../../shared/protocol'
import type { ExportRun, ExportSnapshot } from '../engine/exportRun'
import { feedRecordFor, inspectionFor } from '../engine/inspections'
import type { LayoutRun, RunSnapshot } from '../engine/layoutRun'
import {
  engineClient,
  exportRunFor,
  forgetProjectJobs,
  layoutRunFor,
  nameProject,
} from '../engine/runs'
import { stageFor } from '../engine/stages'
import type { PreviewAddress } from '../exportChoice'
import { skipTarget } from '../SkipPastMap'
import type { TextInputHandle } from '../kit/TextInput'
import { useEngineState } from '../useEngineState'
import { useSnapshot } from '../useSnapshot'

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
  /** How many runs have drawn the page while this screen is open; the viewer is keyed by it. */
  drawn: number
  /** The address the export planned for the map's frame, while cell 06 is open. */
  preview: PreviewAddress | null
  setPreview: (address: PreviewAddress | null) => void
  /** The feed's registry entry's mode and agency, when the Library listed it. */
  registry: { mode: string; agency: string | null } | null
  /** The feed as the engine reads it, cached by the inspection module. */
  inspect: (key: string) => Promise<Inspection>
  /** One stage of the layout, drawn by the engine. */
  readStage: (
    key: string,
    layout: string,
    made: string | null,
    stage: StageName,
    width: number,
  ) => Promise<RenderStageResult>
  setInputs: (inputs: { mode: string; agency: string | null }) => Promise<void>
  /** The service day a person chose, written at once and drawing nothing (A5.5-15). */
  setDate: (date: string) => Promise<void>
  setTheme: (theme: Theme) => Promise<void>
  setExport: (choice: ExportChoice) => Promise<void>
  /** The screen's own heading, focused once there is something to read. */
  headingRef: RefObject<HTMLHeadingElement | null>
  /** Past the map to the project's own toolbar (issue 106). */
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

export function useProjectState(id: string, onBack: (notice?: string) => void): ProjectState {
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
  // is keyed by it, so the frame loads the page a run just wrote instead of
  // keeping the one it had: its address does not change between the two.
  const [drawn, setDrawn] = useState(0)
  // The address the export last planned for the map's frame. Not stored: it
  // is planned again whenever cell 06 opens.
  const [preview, setPreview] = useState<PreviewAddress | null>(null)
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
  const exportSnapshot = useSnapshot(exporter)
  const layingOut = runSnapshot.state === 'running'
  const exporting = exportSnapshot.state === 'running'

  // When a run finishes it has written the record; read it back so the
  // screen shows the layout and the day it just stored.
  useEffect(() => {
    let previous = run.snapshot.state
    return run.subscribe((snapshot) => {
      if (snapshot.state === 'done' && previous !== 'done') {
        window.api.projects.get(id).then(
          (project) => {
            setState({ status: 'ready', project })
            setDrawn((n) => n + 1)
          },
          () => undefined,
        )
      }
      previous = snapshot.state
    })
  }, [id, run])
  const renameButtonRef = useRef<HTMLElement>(null)
  const deleteButtonRef = useRef<HTMLElement>(null)
  const newNameRef = useRef<TextInputHandle>(null)

  // Past the map to the project's own toolbar (issue 106): its first button
  // that can take focus, or the screen's heading when neither can.
  const skipPastMap = (): void => {
    skipTarget<HTMLElement>(
      [renameButtonRef.current, deleteButtonRef.current],
      headingRef.current,
    )?.focus()
  }

  useEffect(() => {
    let cancelled = false
    window.api.projects.get(id).then(
      (project) => {
        if (!cancelled) setState({ status: 'ready', project })
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
  const setInputs = async (inputs: { mode: string; agency: string | null }): Promise<void> => {
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
  // The theme is written at once and nothing is rebuilt for it: the page
  // takes it on its address and restyles itself, so the record coming back
  // is all the viewer needs to reload in it (A4-03).
  const setTheme = async (theme: Theme): Promise<void> => {
    const record = await window.api.projects.setTheme(id, theme)
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', project: { ...current.project, ...record } }
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
  const inspect = useCallback((key: string) => inspectionFor(engineClient(), key, today()), [])
  const readStage = useCallback(
    (key: string, layout: string, made: string | null, stage: StageName, width: number) =>
      stageFor(engineClient(), key, layout, made, stage, width),
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
    const result = await window.api.projects.delete(id)
    // Deleted: its finished jobs leave the inspector. Only on this signal,
    // never because a list read happened to miss the record (A1-03).
    forgetProjectJobs(id)
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
    exporting,
    drawn,
    preview,
    setPreview,
    registry,
    inspect,
    readStage,
    setInputs,
    setDate,
    setTheme,
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
