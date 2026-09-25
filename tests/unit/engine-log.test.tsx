// Cell 02's engine log (A5.5-13): what it keeps, how many, whose lines
// they are, when it is open, and how the newest one is reached.
//
// Rendered to static markup, as the notebook's other cell tests are: what
// is asserted is what the adapter draws. `renderToStaticMarkup` runs no
// effects, so the panel's initial read - `run.job()` in the state's
// initialiser - is what these assertions see, and neither the bridge nor an
// animation frame is touched. What only a running app shows - a line
// arriving mid-run, the scroll that stays put under the sticky preview -
// is `tests/e2e/layout.spec.ts`.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import EngineLog, {
  atBottom,
  CLOSED,
  FOLLOWING,
  isFollowing,
  LINES_LABEL,
  named,
  PANEL_LABEL,
  readLog,
  saidFor,
  SAID_NOTHING,
  droppedNote,
  isOpen,
  lineCount,
  logOf,
  NO_LOG,
  sameLog,
  toNewest,
  type Box,
} from '../../src/renderer/src/notebook/EngineLog'
import ProcessCell from '../../src/renderer/src/notebook/cells/ProcessCell'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { freshStages, type LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { composeJobLog, MAX_LOG_LINES, type Job } from '../../src/shared/jobs'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1',
  kind: 'layout',
  projectId: 'p1',
  projectName: 'Los Angeles',
  label: 'Layout run',
  state: 'running',
  stages: [{ id: 'parse', label: 'parse', state: 'running' }],
  message: null,
  hint: null,
  detail: null,
  rawDetail: null,
  log: [],
  dropped: 0,
  started: Date.UTC(2026, 8, 25, 12, 0, 0),
  ended: null,
  ...over,
})

/**
 * A run that answers with one job and hears nothing. The panel reads only
 * `job()` and `subscribe`; the snapshot is here because cell 02 draws the
 * run's own panel beside this one and that panel reads it.
 */
const runWith = (answer: Job | null): LayoutRun =>
  ({
    job: () => answer,
    subscribe: () => () => undefined,
    snapshot: {
      state: answer === null ? 'idle' : 'running',
      stages: freshStages(),
      message: null,
      error: null,
      changed: false,
      relaid: false,
      forced: false,
      replaced: false,
      rebuilt: false,
      recoloured: false,
      reordered: false,
      day: null,
      report: null,
    },
  }) as unknown as LayoutRun

const box = (over: Partial<Box> = {}): Box => ({
  scrollTop: 0,
  scrollHeight: 400,
  clientHeight: 100,
  ...over,
})

describe('whose lines they are', () => {
  it('is the run’s own job, and nothing before a run', () => {
    expect(logOf(null)).toEqual(NO_LOG)
    const one = job({ log: ['[info] parsed 3 stops'], dropped: 2 })
    expect(logOf(one)).toEqual({ id: 'job-1', lines: ['[info] parsed 3 stops'], dropped: 2 })
  })

  // The property is that the panel adds no bound of its own and keeps no
  // second copy to go stale: whatever the run's buffer holds is what is
  // drawn, however full it is. Asserted as equality at the bound, not as
  // `toBe`, which pinned that `logOf` happens not to copy the array - true
  // today, not the thing the panel promises, and it would fail a later
  // `logOf` that copied defensively while behaving identically.
  it('keeps nothing of its own: the lines drawn are the buffer the run already bounds', () => {
    const lines = Array.from({ length: MAX_LOG_LINES }, (_, i) => `[info] line ${i}`)
    const view = logOf(job({ log: lines, dropped: 7 }))
    expect(view.lines).toEqual(lines)
    expect(view.lines).toHaveLength(MAX_LOG_LINES)
    expect(view.dropped).toBe(7)
    const html = renderToStaticMarkup(
      <EngineLog projectName="Los Angeles" run={runWith(job({ log: lines, dropped: 7 }))} />,
    )
    expect(html).toContain(lines[0])
    expect(html).toContain(lines[MAX_LOG_LINES - 1])
    expect(html).toContain(`${MAX_LOG_LINES} lines`)
  })
})

describe('the bound', () => {
  it('is stated, in figures, with where the rest of the lines went', () => {
    const note = droppedNote(41)
    expect(note).toContain(String(MAX_LOG_LINES))
    expect(note).toBe(
      'The last 200 lines are kept here; 41 earlier lines are in engine.log in the logs folder.',
    )
    expect(droppedNote(1)).toBe(
      'The last 200 lines are kept here; 1 earlier line is in engine.log in the logs folder.',
    )
  })

  it('says nothing while no line has been dropped', () => {
    // Zero is the whole of it: `dropped` is a counter that only goes up
    // (`LogBuffer`), so a negative count is not a case the panel can meet
    // and pinning one would be pinning a value nothing produces.
    expect(droppedNote(0)).toBeNull()
    expect(droppedNote(1)).not.toBeNull()
  })

  it('counts the lines in the row in words', () => {
    expect(lineCount(0)).toBe('no lines yet')
    expect(lineCount(1)).toBe('1 line')
    expect(lineCount(212)).toBe('212 lines')
  })
})

describe('a tick that brought nothing costs no render', () => {
  const view = { id: 'job-1', lines: ['a', 'b'], dropped: 0 }
  it('is the same read twice', () => {
    expect(sameLog(view, { id: 'job-1', lines: ['a', 'b'], dropped: 0 })).toBe(true)
  })
  it('is not a new line, a replaced last line, a drop, or another run', () => {
    expect(sameLog(view, { ...view, lines: ['a', 'b', 'c'] })).toBe(false)
    expect(sameLog(view, { ...view, lines: ['a', 'z'] })).toBe(false)
    expect(sameLog(view, { ...view, dropped: 1 })).toBe(false)
    expect(sameLog(view, { ...view, id: 'job-2' })).toBe(false)
  })
})

describe('where a person put it, for that run', () => {
  it('starts closed', () => {
    expect(isOpen(CLOSED, 'job-1')).toBe(false)
  })

  it('stays open for the run it was opened for', () => {
    expect(isOpen({ id: 'job-1', open: true }, 'job-1')).toBe(true)
  })

  it('starts closed again for the next run, without anything resetting it', () => {
    expect(isOpen({ id: 'job-1', open: true }, 'job-2')).toBe(false)
  })

  it('is closed when there is no run at all', () => {
    expect(isOpen({ id: null, open: true }, null)).toBe(false)
  })
})

// The panel's main correctness argument, which nothing asserted before:
// the bridge's `onLog` fires for every engine request in the renderer, so
// a feed add running beside this project's layout wakes this panel too.
// What it must never do is put its line here.
describe('whichever run woke it, the lines are this run’s', () => {
  it('reads the run and nothing else, however many times it is woken', () => {
    const mine = job({ id: 'job-A', log: ['[info] mine'] })
    const theirs = '[info] a feed add, which is another run entirely'
    const run = { job: () => mine }
    let view = readLog(run, NO_LOG)
    // Woken three more times, as a feed add's lines would wake it.
    for (let i = 0; i < 3; i++) view = readLog(run, view)
    expect(view.id).toBe('job-A')
    expect(view.lines).toEqual(['[info] mine'])
    expect(view.lines).not.toContain(theirs)
  })

  it('follows the run when the run’s own job changes, which is the only way content moves', () => {
    let current = job({ id: 'job-A', log: ['[info] first run'] })
    const run = { job: () => current }
    const first = readLog(run, NO_LOG)
    expect(first.lines).toEqual(['[info] first run'])
    current = job({ id: 'job-B', log: ['[info] second run'] })
    const second = readLog(run, first)
    expect(second.id).toBe('job-B')
    expect(second.lines).toEqual(['[info] second run'])
  })

  it('hands back the very same view when a tick brought nothing, so no render happens', () => {
    const run = { job: () => job({ id: 'job-A', log: ['[info] one'] }) }
    const once = readLog(run, NO_LOG)
    expect(readLog(run, once)).toBe(once)
  })
})

// Both of these were bugs: the component outlives the run it draws, so a
// ref or a sentence left from run 1 was still in force for run 2.
describe('nothing survives its own run', () => {
  it('follows the newest line again for a run nobody has scrolled in', () => {
    // Scrolled back through run 1, so run 1 no longer follows.
    const scrolled: typeof FOLLOWING = { id: 'job-A', at: false }
    expect(isFollowing(scrolled, 'job-A')).toBe(false)
    // Run 2 is a run this person has not scrolled in, so it follows again.
    expect(isFollowing(scrolled, 'job-B')).toBe(true)
    expect(isFollowing(FOLLOWING, 'job-A')).toBe(true)
    // And a run left resting at the end keeps following.
    expect(isFollowing({ id: 'job-A', at: true }, 'job-A')).toBe(true)
  })

  it('does not show one run’s copy sentence under the next run’s lines', () => {
    const copied: typeof SAID_NOTHING = { id: 'job-A', text: 'The log is on the clipboard.' }
    expect(saidFor(copied, 'job-A')).toBe('The log is on the clipboard.')
    expect(saidFor(copied, 'job-B')).toBeNull()
    expect(saidFor(SAID_NOTHING, 'job-A')).toBeNull()
  })
})

// `LayoutRun.job()` leaves `projectName` null on purpose, and the jobs
// inspector fills it from the registry. Cell 02 has the record in hand, so
// it fills it from there; without this the copied log's heading read "A
// project" and a bug report pasted from cell 02 did not say which.
describe('the copied log names the project', () => {
  it('puts the screen’s own name on the job the copy is composed from', () => {
    expect(named(job({ projectName: null }), 'Los Angeles').projectName).toBe('Los Angeles')
    expect(composeJobLog(named(job({ projectName: null }), 'Los Angeles'))).toContain(
      '# Layout run, Los Angeles',
    )
  })

  it('is what the run already said when it says anything', () => {
    const already = job({ projectName: 'Los Angeles' })
    expect(named(already, 'Los Angeles')).toBe(already)
  })
})

describe('the newest line', () => {
  it('is reached by moving the box’s own scroll and nothing else', () => {
    const b = box({ scrollTop: 10 })
    toNewest(b)
    expect(b).toEqual({ scrollTop: 400, scrollHeight: 400, clientHeight: 100 })
    expect(() => toNewest(null)).not.toThrow()
  })

  it('follows only while the box is resting at its end', () => {
    expect(atBottom(box({ scrollTop: 300 }))).toBe(true)
    // A fraction of a pixel off the end, which is what a scaled display gives.
    expect(atBottom(box({ scrollTop: 299 }))).toBe(true)
    expect(atBottom(box({ scrollTop: 120 }))).toBe(false)
  })

  // The acceptance criterion this file can prove without a browser: the
  // panel never asks the platform to bring a line into view, which is the
  // one call that would scroll the notebook's column under its pinned
  // preview. A `scrollIntoView` added here would pass every assertion
  // above.
  it('is never asked for with scrollIntoView, which scrolls every ancestor', () => {
    const source = readFileSync(
      resolve(__dirname, '../../src/renderer/src/notebook/EngineLog.tsx'),
      'utf8',
    )
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect(source).not.toMatch(/scrollIntoView/)
  })
})

describe('the panel', () => {
  it('draws nothing at all until a run has begun', () => {
    expect(renderToStaticMarkup(<EngineLog projectName="Los Angeles" run={runWith(null)} />)).toBe(
      '',
    )
  })

  it('is a closed disclosure holding the run’s lines and a copy', () => {
    const html = renderToStaticMarkup(
      <EngineLog
        projectName="Los Angeles"
        run={runWith(job({ log: ['[info] parsed 3 stops', '[warning] two trips'] }))}
      />,
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Engine log')
    expect(html).toContain('2 lines')
    // The disclosed part is in the document and hidden, as every disclosure
    // in this app keeps it, so nothing inside is unmounted by a toggle.
    expect(html).toMatch(
      /<div id="[^"]*" role="group" aria-label="The engine&#x27;s log for this run"/,
    )
    expect(html).toContain('hidden=""')
    expect(html).toContain('[info] parsed 3 stops\n[warning] two trips')
    expect(html).toContain('Copy log')
  })

  // The defect this file did not catch the first time, and the reason the
  // three end-to-end tests failed: the box of lines carried the disclosed
  // part's own name, so the same group name sat inside itself. A screen
  // reader user entering the disclosure heard it twice with nothing to tell
  // the inner one from the outer, and `getByRole` matched two elements.
  //
  // Asserted as a property of the whole panel rather than as two string
  // constants, so the next name added here is checked too.
  it('gives no two nested elements the same accessible name', () => {
    const html = renderToStaticMarkup(
      <EngineLog
        projectName="Los Angeles"
        run={runWith(job({ log: ['[info] one'], dropped: 41 }))}
      />,
    )
    const names = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])
    expect(names.length, 'the panel names something').toBeGreaterThan(1)
    expect(new Set(names).size, `two elements share a name: ${names.join(' | ')}`).toBe(
      names.length,
    )
  })

  it('names the disclosed part and the box of lines differently', () => {
    expect(PANEL_LABEL).not.toBe(LINES_LABEL)
    const html = renderToStaticMarkup(
      <EngineLog projectName="Los Angeles" run={runWith(job({ log: ['[info] one'] }))} />,
    )
    expect(html).toContain(`aria-label="Log lines"`)
    expect(html).toContain(`aria-label="The engine&#x27;s log for this run"`)
  })

  it('makes the scrolling box focusable and names it', () => {
    const html = renderToStaticMarkup(
      <EngineLog projectName="Los Angeles" run={runWith(job({ log: ['[info] one'] }))} />,
    )
    expect(html).toMatch(
      /<pre class="engine-log-lines" tabindex="0" role="group" aria-label="Log lines"/,
    )
  })

  it('says so rather than drawing an empty box before the first line', () => {
    const html = renderToStaticMarkup(<EngineLog projectName="Los Angeles" run={runWith(job())} />)
    expect(html).toContain('no lines yet')
    expect(html).toContain('The engine has not said anything yet.')
    expect(html).not.toContain('engine-log-lines')
  })

  it('names the bound under the lines once the run has dropped any', () => {
    const html = renderToStaticMarkup(
      <EngineLog
        projectName="Los Angeles"
        run={runWith(job({ log: ['[info] one'], dropped: 41 }))}
      />,
    )
    expect(html).toContain('41 earlier lines are in engine.log')
  })
})

const CELL = CELL_LIST.find((cell) => cell.id === 'process') as Cell

const record: ProjectRecord = {
  version: 1,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: { ...DEFAULT_STYLE },
  colors: {},
  defaultColor: '#888888',
  lineOrder: [],
  theme: 'warm-dark',
  export: { preset: 'instagram-reel', options: {} },
  destination: null,
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

describe('cell 02', () => {
  // The slot this replaced was a comment, and a comment renders as nothing:
  // the only way to say the log is wired into the cell is to draw the cell
  // and look for it.
  it('draws the engine log under the stages', () => {
    const state = {
      project: { ...record, readOnly: false },
      engine: null,
      run: runWith(job({ log: ['[info] parsed 3 stops'] })),
      exporting: false,
      layingOut: false,
    } as unknown as ProjectState
    const html = renderToStaticMarkup(
      <ProjectProvider value={state}>
        <ProcessCell cell={CELL} state="running" open={true} onToggle={() => {}} />
      </ProjectProvider>,
    )
    expect(html).toContain('engine-log')
    expect(html).toContain('[info] parsed 3 stops')
    // Under the run's own panel, and above the diagnostics, which is where
    // the stage doing the work is.
    expect(html.indexOf('engine-log')).toBeGreaterThan(html.indexOf('progress'))
  })
})
