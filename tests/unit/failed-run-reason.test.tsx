// A failed run's reason is a sentence for a screen, and a path is not one
// (issue 519; constitution V). The jobs inspector screened the engine's hint
// and cell 03 screened its own copy, but cell 02's status line, cell 06's
// run, cell 01's download line and the feed's add showed the run's `error`
// as the sentence was made, with whatever path the engine's I/O hint
// carried. The sentence is now made once, in `failureSentence`, so the
// snapshot's `error` is fit for any panel.
//
// What is held here is what a person is shown: each panel is rendered, to
// static markup as the notebook's other component tests are, from a real run
// that the stub engine has failed with a hint carrying a path, once for a
// POSIX path and once for a Windows one, and the markup is searched for the
// path. The control run in each case is the same markup with the path in
// the hint's words, so a search that could not find a path cannot pass.
//
// The paths are assembled rather than written out: bin/preflight refuses a
// path literal in a committed file.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import DownloadLine from '../../src/renderer/src/DownloadLine'
import ExportRunPanel from '../../src/renderer/src/ExportRun'
import { ExportRun, type ExportBridge } from '../../src/renderer/src/engine/exportRun'
import { FeedAdd, sentenceFor as addSentence } from '../../src/renderer/src/engine/feedAdd'
import {
  LayoutRun,
  sentenceFor as layoutSentence,
  type RunClient,
} from '../../src/renderer/src/engine/layoutRun'
import { sentenceFor as exportSentence } from '../../src/renderer/src/engine/exportRun'
import { removalOutcome } from '../../src/renderer/src/Library'
import ProcessCell from '../../src/renderer/src/notebook/cells/ProcessCell'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { withoutPaths } from '../../src/shared/engine'
import type { EngineState } from '../../src/shared/engine'
import { failureSentence, screenPaths } from '../../src/shared/jobs'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'

const POSIX = ['', 'Users', 'someone', 'Library', 'engine-home', 'feeds', 'la-metro.zip'].join('/')
const WINDOWS = ['C:', 'Users', 'someone', 'AppData', 'engine-home', 'feeds', 'la-metro.zip'].join(
  '\\',
)
const PATHS = [
  ['a POSIX path', POSIX],
  ['a Windows path', WINDOWS],
] as const

/** The engine's I/O refusal as it classifies one: "reason: path". */
const io = (path: string): unknown => ({
  code: -32000,
  message: 'io failed',
  data: { kind: 'io', detail: `raw detail ${path}`, hint: `Permission denied: ${path}` },
})

/** The pieces of a path that must not survive: the folders, not the words around them. */
const leaks = (html: string, path: string): boolean =>
  html.includes('someone') || html.includes(path) || html.includes('engine-home')

const READY: EngineState = { state: 'ready', version: '0.19.0', protocol: 1 }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

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
  opened: null,
  layout: 'a'.repeat(64),
  made: '2026-09-10T12:00:00+00:00',
  drawn: null,
  built: { mode: 'all', agency: null },
  created: '2026-09-07T20:00:00.000Z',
  modified: '2026-09-07T20:00:00.000Z',
}

/** A layout run whose first engine call is refused with `reason`, ended. */
async function failedLayout(
  reason: unknown,
  onDisk?: (key: string) => Promise<boolean>,
): Promise<LayoutRun> {
  const client = {
    request: () => ({
      result: Promise.reject(reason),
      onProgress: () => () => {},
      onLog: () => () => {},
      cancel: () => {},
    }),
  } as unknown as RunClient
  const run = new LayoutRun({
    client,
    read: async () => record,
    complete: vi.fn(async () => ({ changed: false, relaid: false })),
    completeRebuild: vi.fn(async () => ({})),
    completeColors: vi.fn(async () => ({})),
    completeOrder: vi.fn(async () => ({})),
    completeStyle: vi.fn(async () => ({})),
    completeLines: vi.fn(async () => ({})),
    today: () => '2026-09-08',
    ...(onDisk === undefined ? {} : { onDisk }),
  })
  run.start(record, READY)
  await tick()
  await tick()
  return run
}

/** Cell 02, open, over a run. */
function cellOver(run: LayoutRun): string {
  const state = {
    project: { ...record, readOnly: false },
    engine: READY,
    run,
    runSnapshot: run.snapshot,
    exporting: false,
    layingOut: false,
    redrawAsked: null,
    openedSeams: null,
  } as unknown as ProjectState
  const cell = CELL_LIST.find((c) => c.id === 'process') as Cell
  return renderToStaticMarkup(
    <ProjectProvider value={state}>
      <ProcessCell cell={cell} state="error" open={true} onToggle={() => {}} />
    </ProjectProvider>,
  )
}

describe.each(PATHS)('a failed layout run with %s in the engine hint', (_name, path) => {
  it("shows cell 02's status line no path, and still the words around it", async () => {
    const run = await failedLayout(io(path))
    expect(run.snapshot.state).toBe('failed')
    const html = cellOver(run)
    // The control: the sentence is on the screen, so a path would be found.
    expect(html).toContain('Permission denied: a file')
    expect(html).toContain('role="status"')
    expect(leaks(html, path), html).toBe(false)
  })

  it('keeps the path out of the snapshot, whose detail is the log copy’s own', async () => {
    const run = await failedLayout(io(path))
    expect(run.snapshot.error).toBe('Permission denied: a file')
    expect(run.job()?.hint).toBe('Permission denied: a file')
  })

  it("shows cell 01's download line no path when the feed is not on disk", async () => {
    const run = await failedLayout(io(path), async () => false)
    expect(run.snapshot.feedMissing).toBe(true)
    const html = renderToStaticMarkup(<DownloadLine run={run} />)
    expect(html).toContain('Permission denied: a file')
    expect(leaks(html, path), html).toBe(false)
  })
})

/** An export whose engine call is refused with `reason`. */
function failedExport(reason: unknown): ExportRun {
  const bridge: ExportBridge = {
    run: () => ({ id: 'tok-1', result: Promise.reject(reason) }),
    cancel: async () => {},
    reveal: async () => {},
    onProgress: () => () => {},
  }
  const run = new ExportRun(bridge)
  run.start(record, READY, { preset: 'instagram-reel', options: {} })
  return run
}

describe.each(PATHS)('a failed export with %s in the engine hint', (_name, path) => {
  it("shows cell 06's run no path", async () => {
    const run = failedExport(io(path))
    await tick()
    expect(run.snapshot.state).toBe('failed')
    const html = renderToStaticMarkup(
      <ExportRunPanel
        run={run}
        project={record}
        engine={READY}
        choice={{ preset: 'instagram-reel', options: {} }}
      />,
    )
    expect(html).toContain('Permission denied: a file')
    expect(leaks(html, path), html).toBe(false)
  })
})

describe.each(PATHS)('a failed feed add with %s in the failure', (_name, path) => {
  const failAdd = async (reason: unknown): Promise<FeedAdd> => {
    const run = new FeedAdd({
      request: () =>
        ({
          result: Promise.reject(reason),
          onProgress: () => () => {},
          onLog: () => () => {},
          cancel: () => {},
        }) as never,
    })
    run.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    await tick()
    return run
  }

  it("leaves the add's sentence, which the New project sheet shows, no path", async () => {
    const run = await failAdd(io(path))
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.error).toBe('Permission denied: a file')
  })

  it('screens a thrown error’s message too', async () => {
    const run = await failAdd(new Error(`Could not read ${path}`))
    expect(run.snapshot.error).toBe('Could not read a file')
  })

  it('screens a removal that failed, which the Library shows', () => {
    const outcome = removalOutcome('Los Angeles', { error: io(path) })
    expect(outcome).toEqual({ kind: 'failed', sentence: 'Permission denied: a file' })
  })
})

describe.each(PATHS)('the sentence of every run, for %s', (_name, path) => {
  it('is screened in all three runs, for an engine error and a thrown one', () => {
    for (const sentenceFor of [layoutSentence, exportSentence, addSentence]) {
      expect(sentenceFor(io(path))).toBe('Permission denied: a file')
      expect(sentenceFor({ code: -32000, message: `No such file: ${path}` })).toBe(
        'No such file: a file',
      )
      expect(sentenceFor(new Error(`Could not read ${path}`))).toBe('Could not read a file')
    }
  })
})

describe('screening a sentence twice', () => {
  const SENTENCES = [
    'Permission denied: a file',
    'The layout tool ran out of memory.',
    'matched 114/114 stops',
    'Lines A/C/E could not be placed.',
    `Permission denied: ${POSIX}`,
    `Permission denied: ${WINDOWS}`,
    `Could not open '${POSIX}' for writing.`,
    `Could not open "${WINDOWS}" for writing.`,
    `${POSIX} has no stops.txt`,
    'file:///a/file is not a feed',
  ]

  it.each(SENTENCES)('changes nothing the second time: %s', (sentence) => {
    const once = withoutPaths(sentence)
    expect(withoutPaths(once)).toBe(once)
    expect(screenPaths(once)).toBe(once)
    expect(failureSentence(new Error(once), 'x')).toBe(once)
  })

  it('does not take the words out of a sentence that has no path', () => {
    expect(failureSentence({ code: 1, message: 'm', data: { kind: 'io', hint: 'h' } }, 'x')).toBe(
      'h',
    )
    expect(failureSentence('?', 'The run did not finish.')).toBe('The run did not finish.')
  })
})
