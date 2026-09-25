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
import { MAX_LOG_LINES, type Job } from '../../src/shared/jobs'
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

  it('keeps nothing of its own: the lines are the buffer the run already bounds', () => {
    const lines = Array.from({ length: MAX_LOG_LINES }, (_, i) => `[info] line ${i}`)
    expect(logOf(job({ log: lines })).lines).toBe(lines)
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
    expect(droppedNote(0)).toBeNull()
    expect(droppedNote(-1)).toBeNull()
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
    expect(renderToStaticMarkup(<EngineLog run={runWith(null)} />)).toBe('')
  })

  it('is a closed disclosure holding the run’s lines and a copy', () => {
    const html = renderToStaticMarkup(
      <EngineLog run={runWith(job({ log: ['[info] parsed 3 stops', '[warning] two trips'] }))} />,
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

  it('makes the scrolling box focusable and names it', () => {
    const html = renderToStaticMarkup(<EngineLog run={runWith(job({ log: ['[info] one'] }))} />)
    expect(html).toMatch(
      /<pre class="engine-log-lines" tabindex="0" role="group" aria-label="The engine&#x27;s log for this run"/,
    )
  })

  it('says so rather than drawing an empty box before the first line', () => {
    const html = renderToStaticMarkup(<EngineLog run={runWith(job())} />)
    expect(html).toContain('no lines yet')
    expect(html).toContain('The engine has not said anything yet.')
    expect(html).not.toContain('engine-log-lines')
  })

  it('names the bound under the lines once the run has dropped any', () => {
    const html = renderToStaticMarkup(
      <EngineLog run={runWith(job({ log: ['[info] one'], dropped: 41 }))} />,
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
