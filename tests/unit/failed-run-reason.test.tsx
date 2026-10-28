// @vitest-environment jsdom
// A failed run's reason is a sentence for a screen, and a path is not one
// (issue 519; constitution V). The jobs inspector screened the engine's hint
// and cell 03 screened its own copy, but cell 02's status line, cell 06's
// run, cell 01's download line and the feed's add showed the run's `error`
// as the sentence was made, with whatever path the engine's I/O hint
// carried. The sentence is now made once, in `runFailureSentence`, so the
// snapshot's `error` is fit for any panel.
//
// What is held here is what a person is shown: each panel is rendered, to
// static markup as the notebook's other component tests are, from a real run
// that the stub engine has failed with a hint carrying a path, once for a
// POSIX path and once for a Windows one, and the markup is searched for the
// path. The control (one per path flavour) renders cell 02 over a snapshot
// whose `error` is the unscreened sentence and requires the same search to
// find the path, so a search that could not find one cannot pass.
//
// The app's own refusals are the exception: the main process gives them the
// code `badCall` and takes the known folders out of them, and they can quote
// a person's project name, which a guess at a path rewrites. They come
// through byte for byte.
//
// The paths are assembled rather than written out: bin/preflight refuses a
// path literal in a committed file.

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
import { inUseSentence } from '../../src/main/feeds-ipc'
import ProcessCell from '../../src/renderer/src/notebook/cells/ProcessCell'
import { ProjectProviders, type ProjectState } from '../../src/renderer/src/notebook/context'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { ERROR_CODES, withoutPaths, type EngineState } from '../../src/shared/engine'
import { composeJobLog, runFailureSentence, screenPaths, type Job } from '../../src/shared/jobs'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project/types'
import { defaultProjectState, pending } from '../support/project-state'
import { answered, cleanup, renderCell } from '../support/render'
import { StandInRun } from '../support/stand-in-run'
import { until } from '../support/until'

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
  await until('the layout run to fail', () => run.snapshot.state === 'failed')
  return run
}

/** Cell 02, open, over a run. */
function cellOver(run: LayoutRun): string {
  const state: ProjectState = {
    ...defaultProjectState(),
    project: { ...record, readOnly: false },
    engine: READY,
    run,
    runSnapshot: run.snapshot,
  }
  const cell = CELL_LIST.find((c) => c.id === 'process') as Cell
  return renderToStaticMarkup(
    <ProjectProviders state={state}>
      <ProcessCell cell={cell} state="error" open={true} onToggle={() => {}} />
    </ProjectProviders>,
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

  it('control: the same cell over the unscreened sentence does show the path', async () => {
    const run = await failedLayout(io(path))
    const raw = `Permission denied: ${path}`
    const unscreened = {
      job: () => null,
      subscribe: () => () => undefined,
      snapshot: { ...run.snapshot, error: raw },
    } as unknown as LayoutRun
    const html = cellOver(unscreened)
    expect(html).toContain('Permission denied')
    expect(leaks(html, path)).toBe(true)
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
    await until('the export to fail', () => run.snapshot.state === 'failed')
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
    await until('the feed add to fail', () => run.snapshot.state === 'failed')
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

/** The app's own refusal, as the main process shapes one: `badCall`, the sentence in all three fields. */
const refused = (sentence: string): unknown => ({
  code: ERROR_CODES.badCall,
  message: sentence,
  data: { kind: 'params', detail: sentence, hint: sentence },
})

describe("the app's own refusals", () => {
  // A project named for a line and a slash, inside curly quotes: the guess at
  // a path starts at the slash and takes the rest of the sentence.
  const NAMED = inUseSentence(['Lines /North'])

  it('are the sentence in use, with the slash in the name', () => {
    // The control for the tests below: the backstop does rewrite this name.
    expect(NAMED).toContain('“Lines /North”')
    expect(withoutPaths(NAMED)).not.toBe(NAMED)
  })

  it('come through byte for byte in each of the three runs', () => {
    for (const sentenceFor of [layoutSentence, exportSentence, addSentence]) {
      expect(sentenceFor(refused(NAMED))).toBe(NAMED)
      // The hint wins, as for any engine error; the message alone is the same.
      expect(sentenceFor({ code: ERROR_CODES.badCall, message: NAMED })).toBe(NAMED)
    }
  })

  it('come through byte for byte in a failed removal', () => {
    expect(removalOutcome('Los Angeles', { error: refused(NAMED) })).toEqual({
      kind: 'failed',
      sentence: NAMED,
    })
  })

  it('come through byte for byte in the jobs inspector’s hint and detail, for each run', async () => {
    // The inspector draws the detail behind a disclosure when it differs from
    // the hint, and the copied log adds a Detail section the same way: both
    // must equal the sentence, so neither shows a second, rewritten copy.
    const expectKept = (job: Job | null): void => {
      expect(job?.hint).toBe(NAMED)
      expect(job?.detail).toBe(NAMED)
      expect(job?.rawDetail).toBe(NAMED)
      const log = composeJobLog(job as Job)
      expect(log).toContain(`## Hint\n\n${NAMED}\n`)
      expect(log).not.toContain('## Detail')
      expect(log).not.toContain('a file uses')
    }

    const layout = await failedLayout(refused(NAMED))
    expectKept(layout.job())

    const exported = failedExport(refused(NAMED))
    await until('the export to fail', () => exported.snapshot.state === 'failed')
    expectKept(exported.job())

    const add = new FeedAdd({
      request: () =>
        ({
          result: Promise.reject(refused(NAMED)),
          onProgress: () => () => {},
          onLog: () => () => {},
          cancel: () => {},
        }) as never,
    })
    add.start({ url: 'https://agency.example/gtfs.zip' }, READY)
    await until('the feed add to fail', () => add.snapshot.state === 'failed')
    expectKept(add.job())
  })

  it('are the only engine error left alone: the engine’s own code is screened', () => {
    expect(layoutSentence({ code: -32602, message: NAMED })).toBe(withoutPaths(NAMED))
  })
})

describe('screening a sentence twice', () => {
  // Sentences with no path in them: screening must hand each back untouched,
  // whatever it is made from.
  const NO_PATH = [
    'Permission denied: a file',
    'The layout tool ran out of memory.',
    'matched 114/114 stops',
    'Lines A/C/E could not be placed.',
  ]
  const WITH_PATH = [
    `Permission denied: ${POSIX}`,
    `Permission denied: ${WINDOWS}`,
    `Could not open '${POSIX}' for writing.`,
    `Could not open "${WINDOWS}" for writing.`,
    `${POSIX} has no stops.txt`,
    'file:///a/file is not a feed',
  ]

  it.each(NO_PATH)('hands back a sentence with no path unchanged: %s', (sentence) => {
    expect(runFailureSentence(new Error(sentence), 'x')).toBe(sentence)
    const shape = (code: number): unknown => ({
      code,
      message: 'm',
      data: { kind: 'io', detail: 'd', hint: sentence },
    })
    expect(runFailureSentence(shape(-32000), 'x')).toBe(sentence)
    expect(runFailureSentence(shape(ERROR_CODES.exportFailed), 'x')).toBe(sentence)
    expect(runFailureSentence({ code: -32000, message: sentence }, 'x')).toBe(sentence)
  })

  it.each([...NO_PATH, ...WITH_PATH])('changes nothing the second time: %s', (sentence) => {
    const once = withoutPaths(sentence)
    expect(withoutPaths(once)).toBe(once)
    expect(screenPaths(once)).toBe(once)
    expect(runFailureSentence(new Error(once), 'x')).toBe(once)
  })

  it('takes the fallback when the failure is neither an error nor an engine shape', () => {
    expect(runFailureSentence('?', 'The run did not finish.')).toBe('The run did not finish.')
  })
})

// Issue 593: the four panels that read the engine without a run (cell 01's
// inspection and its stage drawing, cell 05's colours and its order) say a
// failure in the same rule as the runs, `runFailureSentence`, and not in a
// screen of their own that rewrote the app's refusals. Each is drawn, the
// kit real, over an engine that refuses the one question it asks, and the
// sentence it shows is read from the document. Each row was watched failing
// under its panel's old block put back (`failed-run-reason.mutations.json`).

describe('the panels that read the engine without a run', () => {
  afterEach(cleanup)

  const NAMED = inUseSentence(['Lines /North'])
  /** Cell 01 asks its run for the job it reveals; this one has none. */
  class IdleRun extends StandInRun {
    job(): null {
      return null
    }
  }
  const refuse = (reason: unknown) => (): Promise<never> => Promise.reject(reason)

  /** What a panel shows of a refusal: the text of the element that says it, or null. */
  const PANELS: readonly {
    name: string
    fallback: string
    shown: (reason: unknown) => Promise<string | null>
  }[] = [
    {
      name: 'cell 01’s inspection',
      fallback: 'The feed could not be read.',
      shown: async (reason) => {
        renderCell('data', { inspect: refuse(reason) }, { run: new IdleRun() })
        await answered()
        return document.querySelector('.inspect p.message.error[role="alert"]')?.textContent ?? null
      },
    },
    {
      name: 'cell 01’s stage drawing',
      fallback: 'The stage could not be drawn.',
      shown: async (reason) => {
        renderCell(
          'data',
          { inspect: () => pending(), readStage: refuse(reason) },
          { run: new IdleRun() },
        )
        await answered()
        return document.querySelector('.stage-view p.message.error')?.textContent ?? null
      },
    },
    {
      name: 'cell 05’s colours',
      fallback: 'The feed could not be read.',
      shown: async (reason) => {
        renderCell('lines', { inspect: refuse(reason) })
        await answered()
        return document.querySelector('.line-colours p.message.error')?.textContent ?? null
      },
    },
    {
      name: 'cell 05’s order',
      fallback: 'The feed could not be read.',
      shown: async (reason) => {
        renderCell('lines', { inspect: refuse(reason) })
        await answered()
        return document.querySelector('.line-order p.message.error')?.textContent ?? null
      },
    },
  ]

  describe.each(PANELS)('$name', ({ shown, fallback }) => {
    it('shows the app’s own refusal whole, with the slash in the project’s name', async () => {
      expect(withoutPaths(NAMED)).not.toBe(NAMED)
      expect(await shown(refused(NAMED))).toBe(NAMED)
    })

    it.each(PATHS)('shows an engine hint carrying %s with the path taken out', async (_n, path) => {
      const sentence = await shown(io(path))
      expect(sentence).toBe('Permission denied: a file')
    })

    it('says the panel’s own sentence where the failure is neither an error nor an engine shape', async () => {
      expect(await shown('?')).toBe(fallback)
    })
  })
})
