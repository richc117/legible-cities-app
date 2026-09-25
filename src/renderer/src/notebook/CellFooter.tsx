import { Fragment, useEffect, useState, type JSX } from 'react'
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
// **What every row of a strip is.** A field of the record, or an answer the
// engine gave, shortened (`shortLayoutId`, `shortCommit`) or formatted (a
// moment in the person's own locale, a window as a range). **No row is a
// conclusion drawn from two of them.** That is not a style rule: whether a
// service day is the engine's own choice looks like a comparison of the
// record's day with the window's busiest weekday, and it is not one - every
// layout run asks `feeds.service` afresh with today as the anchor and
// writes the new window while deliberately keeping the day
// (`engine/layoutRun.ts`, `tests/unit/projects-store.test.ts` "replaces the
// window on a later run, keeping the day"), so a project laid out twice a
// week apart holds a day the engine chose beside a busiest weekday that has
// moved off it. A strip that inferred would credit the engine's own day to
// the person, in the cell built to be right about exactly that. So the
// strip lays the engine's answers beside the day and lets a person compare
// them.
//
// **No path is shown**, on any platform: a path is not for a screen
// (constitution V), and `bin/preflight` cannot see one the app prints at
// runtime. The two halves of a strip are defended differently, because
// `withoutPaths` rewrites its input into the words "a file":
//
//   - a **note** is a sentence, which is what `withoutPaths` is written for
//     (the engine's own "{reason}: {filename}"), so a note goes through it;
//   - a **value** is a field, and a field rewritten is a field falsified. A
//     record's `agency` is unvalidated beyond its length and comes from a
//     feed's `agency_id`, so an operator called `/LACMTA` would be drawn as
//     "a file" while `LayoutRun` prints the real name four lines above it.
//     A value that would show a path is **refused**: its row is not drawn.
//
// Nothing here reaches for a field that holds a path, so neither half fires
// today; both exist for the branch that reaches for `EngineInfo.home` or an
// export's destination without meaning to.

/** One row of the strip: what it is, and what it says. */
export interface Fact {
  term: string
  /**
   * A string, or a moment for the strip to render in the person's own
   * locale with the exact value kept on the element.
   *
   * Deliberately not `ReactNode`. The hatch was cut for `Time` and nothing
   * else, and a strip whose values could be elements is a strip whose
   * values could be anything - markup a builder composed, a value no path
   * check can see into, a second component drawn inside a definition list.
   * Two shapes, both of which this file renders itself.
   */
  value: string | { iso: string }
}

/** A value that would put a filesystem path on the screen; its row is refused. */
export function carriesPath(value: string): boolean {
  return /(^|[\s(])(?:[A-Za-z]:[\\/]|[\\/][^\s\\/])/.test(value)
}

/** The rows a strip may draw: every one whose value is not a path (see above). */
export function drawableFacts(facts: Fact[]): Fact[] {
  return facts.filter(({ value }) => typeof value !== 'string' || !carriesPath(value))
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
        {drawableFacts(facts).map(({ term, value }) => (
          <Fragment key={term}>
            <dt>{term}</dt>
            <dd>{typeof value === 'string' ? value : <Time iso={value.iso} />}</dd>
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
 * app is running.
 *
 * **The last two say "now" in the term itself**, and that word is the whole
 * point of them. They are read from `engine.info` as Settings reads it, so
 * they are this moment's, while the three above them are the stored
 * layout's; five bare terms in one strip read top to bottom would tell a
 * person the layout was made by engine 0.8.3, which is precisely what the
 * record cannot say - it does not keep the versions that made the layout,
 * and inventing them would be the app asserting something the engine did
 * not (constitution II). A comment cannot fix that, because a comment is
 * not on the screen; the term is.
 *
 * "Now" and not "running": the engine is a sidecar process and is running,
 * but LOOM is a binary the engine shells out to for a layout and nothing
 * named LOOM is running while a person reads this - beside a spinner,
 * "LOOM running" would read as a job in flight. Settings calls the same two
 * fields "LOOM backend" and "LOOM commit" for the same reason.
 *
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
  if (project.made !== null) facts.push({ term: 'Made', value: { iso: project.made } })
  // Null for a record from before the inputs were kept beside the layout
  // (A2-02); `describeInputs` says so in its own words, so it is asked
  // rather than guarded against here.
  if (project.built !== null)
    facts.push({ term: 'Built with', value: describeInputs(project.built) })
  if (info !== null) {
    facts.push({ term: 'Engine now', value: info.engine })
    facts.push({
      term: 'LOOM now',
      value:
        info.loom.commit === null
          ? `${info.loom.backend}, the host reported no commit`
          : `${info.loom.backend}, ${shortCommit(info.loom.commit)}`,
    })
  }
  return facts
}

/**
 * Cell 02's footer, with the engine's versions once it has answered.
 *
 * The record's inputs having moved since the layout was made (A2-02) is
 * **not** said here, though the strip is where provenance goes. A2-02's
 * sentence ends "so lay out to draw with ...", which is a prompt to act,
 * and it belongs beside the button that acts - where `LayoutRun` already
 * says it, inside this same cell. The strip carries the facts and the
 * panel carries the sentence; a strip that said it too would put the same
 * words on screen twice in one cell, which is duplication rather than
 * consistency. `Built with` is the fact under it, and it stays.
 */
function ProcessFooter({
  project,
}: {
  project: Pick<ProjectRecord, 'layout' | 'made' | 'built'>
}): JSX.Element {
  return processStrip(project, useEngineInfo())
}

/**
 * Cell 02's strip, composed once: the notebook draws it through
 * `ProcessFooter` and the sample page draws it directly, and neither
 * composes it itself.
 *
 * Cells 03 and 06 cannot drift from the page that shows them, because both
 * callers go through one builder. Cell 02 is the one that has to ask the
 * engine, so its builder takes the answer as an argument - which left the
 * composition in two places, and the prop that would have differed between
 * them is `note`, the one the comment above spends eleven lines on.
 */
export function processStrip(
  project: Pick<ProjectRecord, 'layout' | 'made' | 'built'>,
  info: EngineInfo | null,
): JSX.Element {
  return <CellFooter facts={processFacts(project, info)} />
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
  project: (Pick<ProjectRecord, 'layout' | 'made' | 'built'> | null) | undefined,
): JSX.Element | undefined {
  if (project == null || project.layout === null) return undefined
  return <ProcessFooter project={project} />
}

// ---------------------------------------------------------------- cell 03

/**
 * What cell 03's strip says: the day the project is set to, and the three
 * things the engine answered about the feed's calendar beside it.
 *
 * The window is the engine's answer at a layout run (ADR-031), so a project
 * that has never been laid out has none and gets no strip.
 *
 * **It does not say whose choice the day was, and must not.** That looks
 * like `service.busiest === date`, and it is the inference the file's
 * header refuses: every layout run asks `feeds.service` again with today as
 * the anchor and writes the fresh window while keeping the day, so a
 * project laid out a second time holds a day the engine chose beside a
 * busiest weekday that has moved. "Chosen: by you" for the engine's own day
 * is exactly the falsehood this cell exists to avoid. The engine's two
 * answers are drawn as themselves, unconditionally, and the day is above
 * them: a person who wants to know whether their day is the engine's can
 * read the two lines, which is the one form of the question nothing can get
 * wrong.
 *
 * The record's day and not `drawnDate`: this strip is about what the
 * project is set to, and the cell's own panel says in prose whether the map
 * on disk shows it yet (A5.5-15).
 *
 * `ServiceDay`'s status line states these same things as prose - "The feed
 * covers X to Y; the busiest weekday, counted from A, is B" - and the rule
 * cell 02 settled applies here: the strip carries the facts and the panel
 * carries the sentence. Terms the panel also names stay, because a term is
 * not the panel's sentence; the clause itself is never drawn here.
 *
 * The anchor is kept rather than left to the panel because the panel is not
 * always drawn - a read-only project has no `ServiceDay` at all - and the
 * anchor is what the engine's answer was counted from (ADR-031).
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
    { term: 'The engine’s busiest weekday', value: service.busiest },
    { term: 'Counted from', value: service.anchor },
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
