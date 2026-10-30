import { createContext, useContext, useMemo, type Context, type JSX, type ReactNode } from 'react'
import type { ProjectState } from './useProjectState'

export type { ProjectState } from './useProjectState'

// The shared wiring of a project's screen, reaching the six cells without
// a prop list (A5.5-08): **nine contexts, split by who reads what** (issue
// 433) - the record, the runs, the export, the outputs, the actions, the map,
// the reload, the opening and the decision, each memoised over its own fields. The map's four fields
// are three contexts because their readers differ: cell 03's transport
// reads `drawn` beside the map's frame, so `themeReloads`, which the frame
// alone reads, cannot sit with it without rendering cell 03 on a reload;
// and `redrawAsked` and `openedSeams`, which cells 02 and 03 read, cannot
// sit with `drawn` without rendering the map for them and cell 02 for a
// redraw. `exporting` sits with the runs and not with the export's
// snapshot: five cells read whether an export goes and none reads its
// frames, so beside the snapshot they would render on every frame.
//
// The record, the runs, the writers and the refs the handbacks point at are
// read by cells that are built one branch each. Threaded as props they
// would be declared in `ProjectView.tsx`, passed through `Notebook` and
// destructured in every adapter, so a branch that adds one consumer would
// edit three files it does not own and meet every other branch in all
// three. Through a context it edits its own adapter and nothing else.
//
// **Split by who reads what** (issue 433, codebase review R4-02). It was one
// context, and its value a fresh object on every render of the screen -
// every run snapshot, every export frame, every keystroke in the rename
// field - so every cell rendered every time. Now each slice below is its
// own context, its value memoised over its own fields, so a render of the
// screen that changes none of a slice's fields hands its readers the very
// object they had, and they do not render. A field sits in a slice whose
// other fields its readers read too, or a reader renders for a change it
// does not read: `tests/unit/cell-renders.test.tsx` counts each part of the
// screen against each kind of change, and is what decided the slices.
//
// - The record: `project`, `error`, `engine`, `registry` - moved by a
//   write's answer, a run's read-back and the engine's state. Read by
//   everything on the screen.
// - The runs: the two runs (the objects, one each for the project's life),
//   the layout run's snapshot, and whether either runs, or the record is
//   being read back, or a flushed edit was refused. The six cells, the
//   header and the footer. `exporting` is here, not with the export's
//   snapshot: five cells read whether an export goes, and none of them its
//   frames.
// - The export: its snapshot alone, which moves every frame - the most
//   frequent change on the screen. Cell 06's strip, the header and the
//   notebook's run graph.
// - The outputs: what the folder holds and the way to read it again
//   (`useOutputs`, issue 563) - moved by a read, which follows a run's end,
//   a rename or a destination. The rail's list and cell 06's line about a
//   replacement, and neither of them the frames, nor the header the rows.
// - The actions: the writers, the two engine reads, the map's seam report,
//   the skip link and the heading's ref - stable for the
//   screen's life (`useProjectState` makes each once per project).
// - The map: `drawn`, how many runs have drawn the page on this screen,
//   which the map's frame carries on its address and cell 03's transport
//   polls the page again on.
// - The reload: `themeReloads`, the map's address and nothing else's.
// - The opening: `redrawAsked` and `openedSeams`, what cells 02 and 03 say
//   of the page the screen opened on (issue 517).
// - The decision: `onOpen`, what the screen settled on for that page, which
//   the map's section says as an attribute and nothing else reads (issue
//   596). Its own slice and not the opening's: the map would otherwise
//   render for `redrawAsked` and `openedSeams`, which it does not read.
//
// The providers are composed in one place, `ProjectProviders`, which both
// `ProjectView.tsx` and the unit tests' harness draw, so what a test renders
// a cell under is what the screen renders it under. The contexts are this
// module's own: nothing else can provide one, so nothing can draw a cell
// under a provider the screen does not use. None is null in the tree: each
// hook throws rather than handing back a half-made state, because a cell
// rendered outside the notebook is a mistake at build time, not a case to
// draw an empty panel for.

type RecordSlice = Pick<ProjectState, 'project' | 'error' | 'engine' | 'registry'>
type RunsSlice = Pick<
  ProjectState,
  'run' | 'exporter' | 'runSnapshot' | 'layingOut' | 'exporting' | 'settling' | 'refused'
>
type ExportSlice = Pick<ProjectState, 'exportSnapshot'>
type OutputsSlice = Pick<ProjectState, 'outputs'>
type ActionsSlice = Pick<
  ProjectState,
  | 'inspect'
  | 'readStage'
  | 'setInputs'
  | 'setDate'
  | 'setTheme'
  | 'setTuning'
  | 'setExport'
  | 'setName'
  | 'deleteProject'
  | 'pageSeams'
  | 'skipPastMap'
  | 'headingRef'
>
type MapSlice = Pick<ProjectState, 'drawn'>
type ReloadSlice = Pick<ProjectState, 'themeReloads'>
type OpeningSlice = Pick<ProjectState, 'redrawAsked' | 'openedSeams'>
type OnOpenSlice = Pick<ProjectState, 'onOpen'>

const RecordContext = createContext<RecordSlice | null>(null)
const RunsContext = createContext<RunsSlice | null>(null)
const ExportContext = createContext<ExportSlice | null>(null)
const OutputsContext = createContext<OutputsSlice | null>(null)
const ActionsContext = createContext<ActionsSlice | null>(null)
const MapContext = createContext<MapSlice | null>(null)
const ReloadContext = createContext<ReloadSlice | null>(null)
const OpeningContext = createContext<OpeningSlice | null>(null)
const OnOpenContext = createContext<OnOpenSlice | null>(null)

/**
 * The project screen's state, provided to everything under it as its
 * slices, each memoised over its own fields.
 */
export function ProjectProviders({
  state,
  children,
}: {
  state: ProjectState
  children: ReactNode
}): JSX.Element {
  const { project, error, engine, registry } = state
  const record = useMemo(
    () => ({ project, error, engine, registry }),
    [project, error, engine, registry],
  )
  const { run, exporter, runSnapshot, layingOut, exporting, settling, refused } = state
  const runs = useMemo(
    () => ({ run, exporter, runSnapshot, layingOut, exporting, settling, refused }),
    [run, exporter, runSnapshot, layingOut, exporting, settling, refused],
  )
  const { exportSnapshot, outputs } = state
  const exported = useMemo(() => ({ exportSnapshot }), [exportSnapshot])
  const produced = useMemo(() => ({ outputs }), [outputs])
  const { inspect, readStage, setInputs, setDate, setTheme, setTuning, setExport } = state
  const { setName, deleteProject, pageSeams, skipPastMap, headingRef } = state
  const actions = useMemo(
    () => ({
      inspect,
      readStage,
      setInputs,
      setDate,
      setTheme,
      setTuning,
      setExport,
      setName,
      deleteProject,
      pageSeams,
      skipPastMap,
      headingRef,
    }),
    [
      inspect,
      readStage,
      setInputs,
      setDate,
      setTheme,
      setTuning,
      setExport,
      setName,
      deleteProject,
      pageSeams,
      skipPastMap,
      headingRef,
    ],
  )
  const { drawn, themeReloads, redrawAsked, openedSeams, onOpen } = state
  const map = useMemo(() => ({ drawn }), [drawn])
  const reload = useMemo(() => ({ themeReloads }), [themeReloads])
  const opening = useMemo(() => ({ redrawAsked, openedSeams }), [redrawAsked, openedSeams])
  const decided = useMemo(() => ({ onOpen }), [onOpen])
  return (
    <RecordContext.Provider value={record}>
      <RunsContext.Provider value={runs}>
        <ExportContext.Provider value={exported}>
          <OutputsContext.Provider value={produced}>
            <ActionsContext.Provider value={actions}>
              <MapContext.Provider value={map}>
                <ReloadContext.Provider value={reload}>
                  <OpeningContext.Provider value={opening}>
                    <OnOpenContext.Provider value={decided}>{children}</OnOpenContext.Provider>
                  </OpeningContext.Provider>
                </ReloadContext.Provider>
              </MapContext.Provider>
            </ActionsContext.Provider>
          </OutputsContext.Provider>
        </ExportContext.Provider>
      </RunsContext.Provider>
    </RecordContext.Provider>
  )
}

/** A slice of the screen's state, or a throw outside the screen's providers. */
function useSlice<T>(context: Context<T | null>, hook: string): T {
  const slice = useContext(context)
  if (slice === null) throw new Error(`${hook} was called outside a project screen’s providers`)
  return slice
}

/** The record, the engine and the feed's registry entry. */
export const useProjectRecord = (): RecordSlice => useSlice(RecordContext, 'useProjectRecord')

/** The two runs and how they stand, but for the export's snapshot. */
export const useProjectRuns = (): RunsSlice => useSlice(RunsContext, 'useProjectRuns')

/** The export's snapshot, which moves every frame. */
export const useProjectExport = (): ExportSlice => useSlice(ExportContext, 'useProjectExport')

/** What the project has produced, read from its folder once for the screen (issue 563). */
export const useProjectOutputs = (): OutputsSlice => useSlice(OutputsContext, 'useProjectOutputs')

/** The writers, the engine's reads and the screen's callbacks and refs: stable. */
export const useProjectActions = (): ActionsSlice => useSlice(ActionsContext, 'useProjectActions')

/** How many runs have drawn the map's page on this screen. */
export const useProjectMap = (): MapSlice => useSlice(MapContext, 'useProjectMap')

/** How many times the map's page was loaded again to show a theme. */
export const useProjectReload = (): ReloadSlice => useSlice(ReloadContext, 'useProjectReload')

/** What the screen's opening asked of the page it opened on, and what that page has. */
export const useProjectOpening = (): OpeningSlice => useSlice(OpeningContext, 'useProjectOpening')

/** What the screen settled on for the page it opened on, once it has. */
export const useProjectOnOpen = (): OnOpenSlice => useSlice(OnOpenContext, 'useProjectOnOpen')
