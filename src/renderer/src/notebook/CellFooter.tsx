import { Fragment, useEffect, useState, type JSX, type ReactNode } from 'react'
import { withoutPaths } from '../../../shared/engine'
import { shortLayoutId } from '../../../shared/layout'
import type { ProjectRecord } from '../../../shared/project'
import type { EngineInfo } from '../../../shared/protocol'
import type { ExportSnapshot } from '../engine/exportRun'
import { engineClient } from '../engine/runs'
import { describeInputs } from '../LayoutRun'
import { useProject } from './context'
import Time from './Time'

// The provenance footer (A5.5-11, ADR-045, DESIGN.md 8.2, "The cell"): the
// quiet strip under a cell's controls saying where what the cell holds came
// from.
//
// Three cells have provenance and get one: 02 the layout the map is drawn
// from, 03 the day against the window the feed covers, 06 the file the last
// export wrote and the record the engine put beside it. **Cells 01, 04 and
// 05 get none.** A footer under the line colours saying "changed just now"
// is chrome pretending to be information, and a cell with nothing true to
// report renders no footer at all rather than a row of blanks - which is
// why each builder below answers `undefined` and not an empty element:
// `Cell.tsx` draws the bordered strip whenever it is given anything, so the
// cell is the one that decides there is nothing to draw.
//
// Every value here is the record's or the engine's own. Nothing is
// computed, rounded or inferred, and **no path is shown**: a path is not
// for a screen (constitution V), so every string a footer draws goes
// through `withoutPaths` on its way out. That is a backstop and not the
// rule - no builder here reaches for a field that holds one - but the rule
// is one line away from being broken by a later branch reaching for
// `EngineInfo.home` or an export's destination, and `bin/preflight` cannot
// see a path the app prints at runtime.

/** One row of the strip: what it is, and what it says. */
export interface Fact {
  term: string
  /** A string, or an element where the value is one the page renders (a time). */
  value: ReactNode
}

/**
 * The strip itself: a definition list in the versions rows' style
 * (DESIGN.md 8.2), and one sentence below it where a cell has something to
 * say that is not a pair.
 */
export default function CellFooter({
  facts,
  note = null,
}: {
  facts: Fact[]
  note?: string | null
}): JSX.Element {
  return (
    <>
      <dl className="cell-provenance">
        {facts.map(({ term, value }) => (
          <Fragment key={term}>
            <dt>{term}</dt>
            <dd>{typeof value === 'string' ? withoutPaths(value) : value}</dd>
          </Fragment>
        ))}
      </dl>
      {note !== null && <p className="cell-provenance-note">{withoutPaths(note)}</p>}
    </>
  )
}

// ---------------------------------------------------------------- cell 02

/** A commit as git writes it short; the engine answers the whole hash. */
const shortCommit = (commit: string): string => commit.slice(0, 7)

/**
 * What cell 02's strip says: the stored layout's own eight characters, when
 * the engine made it, what it was made with, and the engine and LOOM this
 * app runs.
 *
 * The last two are the engine now running, read from `engine.info` as
 * Settings reads it, and they are not claimed to be the versions that made
 * the stored layout: the record does not keep those, and inventing them
 * would be the app saying something the engine did not (constitution II).
 * They belong here even so, because they are what a layout run in this
 * cell would use, and a person reporting a map that looks wrong is asked
 * for them first.
 *
 * A project with no layout has no provenance at all: the cell's own field
 * says "not laid out yet", and a strip of empty terms under it would say
 * less than nothing.
 */
export function processFacts(
  project: Pick<ProjectRecord, 'layout' | 'made' | 'built'>,
  info: EngineInfo | null,
): Fact[] {
  if (project.layout === null) return []
  const facts: Fact[] = [{ term: 'Layout', value: shortLayoutId(project.layout) }]
  // The moment in the person's own locale with the exact value on the
  // element, which is what `Time` is for and what the row above says too.
  if (project.made !== null) facts.push({ term: 'Made', value: <Time iso={project.made} /> })
  // Null for a record from before the inputs were kept beside the layout
  // (A2-02); `describeInputs` says so in its own words, so it is asked
  // rather than guarded against here.
  if (project.built !== null)
    facts.push({ term: 'Built with', value: describeInputs(project.built) })
  if (info !== null) {
    facts.push({ term: 'Engine', value: info.engine })
    facts.push({
      term: 'LOOM',
      value:
        info.loom.commit === null
          ? `${info.loom.backend}, the host reported no commit`
          : `${info.loom.backend}, ${shortCommit(info.loom.commit)}`,
    })
  }
  return facts
}

/** Have the record's inputs moved since the stored layout was made (A2-02)? */
export function inputsMoved(project: Pick<ProjectRecord, 'built' | 'mode' | 'agency'>): boolean {
  return (
    project.built !== null &&
    (project.built.mode !== project.mode || project.built.agency !== project.agency)
  )
}

/**
 * What the footer says when they have: **A2-02's own sentence**, as
 * `LayoutRun.tsx` says it for the same case. Quoted and not re-written -
 * one case is told to a person in one form of words, whichever part of the
 * cell says it - so a change to either must move both.
 */
export function movedSentence(project: Pick<ProjectRecord, 'built' | 'mode' | 'agency'>): string {
  return `This layout was made with ${describeInputs(project.built)}; the choice has changed since, so lay out to draw with ${describeInputs(project)}.`
}

/** Cell 02's footer, with the engine's versions once it has answered. */
function ProcessFooter({
  project,
}: {
  project: Pick<ProjectRecord, 'layout' | 'made' | 'built' | 'mode' | 'agency'>
}): JSX.Element {
  const info = useEngineInfo()
  return (
    <CellFooter
      facts={processFacts(project, info)}
      note={inputsMoved(project) ? movedSentence(project) : null}
    />
  )
}

/**
 * The engine's own versions, asked for once the engine is ready and again
 * if it restarts into another build. The same request Settings makes, and
 * the same handling of a refusal: the strip draws what the record knows and
 * says nothing about versions it could not get.
 */
function useEngineInfo(): EngineInfo | null {
  const { engine } = useProject()
  const ready = engine?.state === 'ready'
  const [info, setInfo] = useState<EngineInfo | null>(null)
  useEffect(() => {
    if (!ready) {
      setInfo(null)
      return
    }
    let left = false
    engineClient()
      .request('engine.info')
      .result.then(
        (answer) => {
          if (!left) setInfo(answer)
        },
        () => undefined,
      )
    return () => {
      left = true
    }
  }, [ready])
  return info
}

/** Cell 02's footer, or nothing at all before the project has a layout. */
export function processFooter(
  project:
    (Pick<ProjectRecord, 'layout' | 'made' | 'built' | 'mode' | 'agency'> | null) | undefined,
): JSX.Element | undefined {
  if (project == null || project.layout === null) return undefined
  return <ProcessFooter project={project} />
}

// ---------------------------------------------------------------- cell 03

/**
 * What cell 03's strip says: the day the project is set to, the days the
 * feed covers, and whose choice the day was.
 *
 * The window is the engine's answer at a layout run (ADR-031), so a project
 * that has never been laid out has none and gets no strip. Whose choice it
 * was is read from the window rather than recorded, exactly as the cell's
 * collapsed sentence reads it: the engine's own answer is the busiest
 * weekday, so a day that is not it is one a person picked.
 *
 * The record's day and not `drawnDate`: this strip is about what the
 * project is set to, and the cell's own panel says in prose whether the map
 * on disk shows it yet (A5.5-15).
 */
export function frameFacts(project: Pick<ProjectRecord, 'date' | 'service'>): Fact[] {
  const { service, date } = project
  if (service === null || date === null) return []
  return [
    { term: 'Service day', value: date },
    {
      term: 'The feed covers',
      value:
        service.start === service.end
          ? `one day, ${service.start}`
          : `${service.start} to ${service.end}`,
    },
    {
      term: 'Chosen',
      value:
        service.busiest === date
          ? `by the engine: the busiest weekday, counted from ${service.anchor}`
          : 'by you',
    },
  ]
}

/** Cell 03's footer, or nothing until a layout run has answered a window. */
export function frameFooter(
  project: (Pick<ProjectRecord, 'date' | 'service'> | null) | undefined,
): JSX.Element | undefined {
  if (project == null) return undefined
  const facts = frameFacts(project)
  return facts.length === 0 ? undefined : <CellFooter facts={facts} />
}

// ---------------------------------------------------------------- cell 06

/**
 * What cell 06's strip says: the file the last export of this session
 * wrote, and that the engine wrote a sidecar beside it.
 *
 * The name and never the path: the snapshot holds the engine's filename
 * alone, and where it went is the person's own folder, which the cell's own
 * choice names. A cancelled or failed export wrote nothing, so there is
 * nothing to be the provenance of and the strip is absent.
 *
 * The sidecar's own fields are not read back: the engine writes it beside
 * the file and the app never opens it, so the strip says that it is there
 * and what it holds rather than quoting fields it has not seen. The rail's
 * Outputs is what reads one (ADR-045).
 */
export function exportFacts(snapshot: Pick<ExportSnapshot, 'state' | 'file'>): Fact[] {
  if (snapshot.state !== 'done' || snapshot.file === null) return []
  return [{ term: 'Exported', value: snapshot.file }]
}

/** What the engine writes beside the file, in its own description of it. */
export const SIDECAR_NOTE =
  'The engine wrote a sidecar beside it: what the file is, the caveats of the network it shows, and its alt text.'

/** Cell 06's footer, or nothing until an export has written a file. */
export function exportFooter(
  snapshot: Pick<ExportSnapshot, 'state' | 'file'>,
): JSX.Element | undefined {
  const facts = exportFacts(snapshot)
  return facts.length === 0 ? undefined : <CellFooter facts={facts} note={SIDECAR_NOTE} />
}
