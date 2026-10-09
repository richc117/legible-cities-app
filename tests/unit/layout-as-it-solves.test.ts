// The layout as it solves (issue 382, specs/032): cell 01's stage view draws
// each stage of a layout run as the engine reports it. What can be held
// without React or Electron is here, a section per decision of the spec: the
// run's snapshot naming its layout, the cache's identity while a run is in
// flight, and the view's own pure parts.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import StageView from '../../src/renderer/src/StageView'
import {
  LayoutRun,
  freshStages,
  type RunClient,
  type RunSnapshot,
} from '../../src/renderer/src/engine/layoutRun'
import {
  LAYOUT_ORDER,
  LAYOUT_STAGE_WORDS,
  STAGES,
  clearedSentence,
  drawnAnnouncement,
  drawnAnnouncements,
  forgetAllStages,
  forgetStagesOf,
  notDrawnYet,
  revealOf,
  revealSentence,
  runSet,
  shownStage,
  stageFor,
  stageSet,
  toAsk,
  waitsOn,
  type Asked,
  type Reveal,
} from '../../src/renderer/src/engine/stages'
import { ERROR_CODES, type EngineState } from '../../src/shared/engine'
import type { ProjectRecord } from '../../src/shared/project'
import type { RenderStageParams, RenderStageResult, StageName } from '../../src/shared/protocol'

// ------------------------------------------------------------ the snapshot

type Report = { stage: string; message: string; fraction?: number; layout?: string }

interface Pending {
  method: string
  params: Record<string, unknown>
  report(p: Report): void
  resolve(value: unknown): void
  reject(error: unknown): void
}

type AnyHandle = ReturnType<RunClient['request']>

/** A client whose requests a test answers, and whose reports carry what the test hands them. */
function stubClient(): { client: RunClient; calls: Pending[] } {
  const calls: Pending[] = []
  const client: RunClient = {
    request(method, params: unknown) {
      const listeners: ((p: Report) => void)[] = []
      let settle!: (v: unknown) => void
      let fail!: (e: unknown) => void
      const result = new Promise<unknown>((res, rej) => {
        settle = res
        fail = rej
      })
      calls.push({
        method,
        params: params as Record<string, unknown>,
        report: (p) => listeners.forEach((l) => l(p)),
        resolve: settle,
        reject: fail,
      })
      return {
        result,
        onProgress: (listener: (p: Report) => void) => {
          listeners.push(listener)
          return () => {}
        },
        cancel: () => {},
      } as unknown as AnyHandle
    },
  }
  return { client, calls }
}

const LAYOUT = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)
const READY: EngineState = { state: 'ready', version: '0.14.0', protocol: 1 }
const BUILT = {
  layout: LAYOUT,
  paths: {},
  meta: { made: '2026-10-09T12:00:00+00:00', mode: 'all', agency: null },
  stages: { octi: { lines: ['A', 'B'] } },
}
const SERVICE = {
  start: '2026-01-01',
  end: '2026-12-31',
  busiest_weekday: '2026-09-15',
  anchor: '2026-09-08',
}

const record = (over: Partial<ProjectRecord> = {}): ProjectRecord =>
  ({
    version: 1,
    id: 'p1',
    name: 'LA',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: null,
    service: null,
    style: {},
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    theme: 'warm-dark',
    layout: null,
    made: null,
    drawn: null,
    built: null,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as ProjectRecord

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(): { run: LayoutRun; calls: Pending[] } {
  const { client, calls } = stubClient()
  const run = new LayoutRun({
    client,
    complete: vi.fn(async () => ({ changed: false, relaid: false })),
    completeRebuild: vi.fn(async () => ({})),
    completeColors: vi.fn(async () => ({})),
    completeOrder: vi.fn(async () => ({})),
    completeStyle: vi.fn(async () => ({})),
    today: () => '2026-09-08',
  })
  return { run, calls }
}

const stage = (name: string, layout?: string): Report =>
  layout === undefined
    ? { stage: name, message: `${name}: 3 nodes`, fraction: 0.25 }
    : { stage: name, message: `${name}: 3 nodes`, fraction: 0.25, layout }

describe('the run’s snapshot names its layout from the first report that does (FR-002)', () => {
  it('carries no layout until a stage reports one, and the reported one after', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    expect(run.snapshot.layout, 'nothing reported yet').toBeNull()
    // A download's reports come before the layout's id is known, and carry none.
    calls[0].report({ stage: 'download', message: 'downloaded 1 of 2 bytes', fraction: 0.5 })
    expect(run.snapshot.layout).toBeNull()
    calls[0].report(stage('gtfs2graph', LAYOUT))
    expect(run.snapshot.layout, 'named by the first stage').toBe(LAYOUT)
    expect(run.snapshot.stages[0].state, 'in the same change as the stage').toBe('done')
    for (const name of ['topo', 'loom', 'octi']) calls[0].report(stage(name, LAYOUT))
    expect(run.snapshot.layout).toBe(LAYOUT)
    calls[0].resolve(BUILT)
    await tick()
    calls[1].resolve(SERVICE)
    await tick()
    // The map call replays the four, naming the same layout, then its own four.
    for (const name of ['gtfs2graph', 'topo', 'loom', 'octi']) calls[2].report(stage(name, LAYOUT))
    for (const name of ['schedule', 'render', 'animate', 'write']) calls[2].report(stage(name))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('keeps the first layout named for the whole run', () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].report(stage('topo', OTHER))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('takes the layout from a report that names a stage the run has already seen', () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph'))
    expect(run.snapshot.layout, 'an engine from before v0.14.0 names none').toBeNull()
    calls[0].report(stage('gtfs2graph', LAYOUT))
    expect(run.snapshot.layout).toBe(LAYOUT)
  })

  it('forgets it at the next start, and a start that is refused carries none', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].reject({ code: ERROR_CODES.cancelled, message: 'Request Cancelled' })
    await tick()
    expect(run.snapshot.state).toBe('cancelled')
    expect(run.snapshot.layout, 'a cancelled run keeps what it reported').toBe(LAYOUT)
    run.start(record(), null)
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.layout, 'a refused start is not the last run').toBeNull()
    run.start(record(), READY)
    expect(run.snapshot.state).toBe('running')
    expect(run.snapshot.layout, 'a new run has reported nothing').toBeNull()
  })

  it('is cleared by a refused redraw too', async () => {
    const { run, calls } = setup()
    run.start(record(), READY)
    calls[0].report(stage('gtfs2graph', LAYOUT))
    calls[0].reject(new Error('x'))
    await tick()
    expect(run.snapshot.layout).toBe(LAYOUT)
    // No layout to draw from: the rebuild is refused before it asks anything.
    run.rebuild(record(), READY, '2026-09-15')
    expect(run.snapshot.state).toBe('failed')
    expect(run.snapshot.layout).toBeNull()
  })
})

// ------------------------------------------------- the cache while a run runs

describe('the stage cache keys a drawing by the run while one is in flight (FR-005)', () => {
  // Each answer is numbered, so a test can tell which request it came from:
  // a drawing answered from the wrong slot is a number it did not ask for.
  function numbered(): { client: Parameters<typeof stageFor>[0]; sent: RenderStageParams[] } {
    const sent: RenderStageParams[] = []
    const client = {
      request: (_method: 'render.stage', params: RenderStageParams) => {
        sent.push(params)
        return {
          result: Promise.resolve({
            layout: params.layout,
            stage: params.stage,
            svg: `answer ${sent.length}`,
          } as RenderStageResult),
        }
      },
    }
    return { client, sent }
  }
  const MADE = '2026-10-09T12:00:00+00:00'
  const LATER = '2026-10-09T12:05:00+00:00'
  const DAY = '2026-09-15'
  const svgOf = async (p: Promise<RenderStageResult>): Promise<string> => (await p).svg

  it('never answers a build’s drawing for the stored set, another build, or the reverse', async () => {
    forgetAllStages()
    const { client, sent } = numbered()
    const ask = (made: string | null, run: string | null, date: string | null = null) =>
      svgOf(stageFor(client, 'la', LAYOUT, stageSet(made, run), 'gtfs2graph', 1600, date))

    // The stored set, for the day drawn, as the view reads it today.
    expect(await ask(MADE, null, DAY)).toBe('answer 1')
    // A re-layout under the same id: `made` is still the stored set's.
    expect(await ask(MADE, 'job-1'), 'the build is asked, not the store').toBe('answer 2')
    expect(await ask(MADE, 'job-1'), 'and held for the run').toBe('answer 2')
    // That run was stopped, so `made` did not move; the next re-layout's
    // build is another build, and its first stage is not the first one's.
    expect(await ask(MADE, 'job-2'), 'a second run is never answered the first’s').toBe('answer 3')
    // The stored set, asked as the view asks it, without a day too.
    expect(await ask(MADE, null, DAY), 'the stored set is still the store’s').toBe('answer 1')
    expect(await ask(MADE, null), 'never a build’s, with no day either').toBe('answer 4')
    // The run finished: the store is read under the new `made`, as today.
    expect(await ask(LATER, null, DAY)).toBe('answer 5')
    expect(sent.map((p) => 'date' in p)).toEqual([true, false, false, false, true])
  })

  it('writes a run’s set so that no `made` can be it', () => {
    expect(stageSet(MADE, null)).toBe(MADE)
    expect(stageSet(null, null)).toBeNull()
    expect(stageSet(MADE, 'job-7')).toBe('run job-7')
    expect(stageSet(null, 'job-7')).toBe('run job-7')
    expect(stageSet(MADE, 'job-7')).not.toBe(stageSet(MADE, 'job-8'))
  })

  it('forgets one run’s drawings and nothing else', async () => {
    forgetAllStages()
    const { client, sent } = numbered()
    const ask = (run: string | null) =>
      stageFor(client, 'la', LAYOUT, stageSet(MADE, run), 'loom', 1600)
    await ask('job-1')
    await ask(null)
    forgetStagesOf(runSet('job-1'))
    await ask('job-1')
    await ask(null)
    expect(sent, 'the run’s asked again, the stored set’s not').toHaveLength(3)
  })

  it('keeps a slot asked again after it was forgotten, whatever the first ask did', async () => {
    forgetAllStages()
    let refuse!: (e: unknown) => void
    let asked = 0
    const client = {
      request: () => {
        asked += 1
        return {
          result:
            asked === 1
              ? new Promise<RenderStageResult>((_r, reject) => (refuse = reject))
              : Promise.resolve({ svg: 'second' } as RenderStageResult),
        }
      },
    }
    const set = runSet('job-3')
    const first = stageFor(client, 'la', LAYOUT, set, 'topo', 1600).catch(() => 'refused')
    forgetStagesOf(set)
    expect((await stageFor(client, 'la', LAYOUT, set, 'topo', 1600)).svg).toBe('second')
    refuse(new Error('not yet'))
    expect(await first).toBe('refused')
    expect((await stageFor(client, 'la', LAYOUT, set, 'topo', 1600)).svg).toBe('second')
    expect(asked, 'the late refusal did not take the second answer with it').toBe(2)
  })
})

// ------------------------------------------------------ which run reveals

describe('a layout run is a reveal from its first report naming its layout (FR-001, FR-006)', () => {
  const at = (states: string[]): RunSnapshot['stages'] =>
    freshStages().map((s, i) => ({ ...s, state: (states[i] ?? 'pending') as never }))
  const facts = (over: Partial<RunSnapshot> = {}) => ({
    state: 'running' as RunSnapshot['state'],
    stages: at(['done', 'running']),
    layout: LAYOUT as string | null,
    rebuilt: false,
    recoloured: false,
    reordered: false,
    restyled: false,
    ...over,
  })

  it('sees a layout run with its layout named, the stages it reported and the one it is at', () => {
    expect(revealOf(facts(), 'job-4', false)).toEqual({
      run: 'job-4',
      layout: LAYOUT,
      state: 'running',
      reported: ['gtfs2graph'],
      running: 'topo',
    })
    // Past the layout's four, the map is being drawn: no layout stage runs.
    const past = facts({ stages: at(['done', 'done', 'done', 'done', 'running']) })
    expect(revealOf(past, 'job-4', false)).toMatchObject({
      reported: ['gtfs2graph', 'topo', 'loom', 'octi'],
      running: null,
    })
  })

  it('sees nothing before the layout is named, without a job, while idle, or for a redraw', () => {
    expect(revealOf(facts({ layout: null }), 'job-4', false)).toBeNull()
    expect(revealOf(facts(), null, false)).toBeNull()
    expect(revealOf(facts({ state: 'idle' }), 'job-4', false)).toBeNull()
    for (const redraw of ['rebuilt', 'recoloured', 'reordered', 'restyled'] as const) {
      expect(revealOf(facts({ [redraw]: true }), 'job-4', false), redraw).toBeNull()
    }
  })

  it('keeps a finished run only until its record is read back, and a stopped one until the next', () => {
    const done = facts({ state: 'done', stages: at(['done', 'done', 'done', 'done']) })
    expect(revealOf(done, 'job-4', true)?.state).toBe('done')
    expect(revealOf(done, 'job-4', false), 'the store is read from then on').toBeNull()
    expect(revealOf(facts({ state: 'cancelled' }), 'job-4', false)?.state).toBe('cancelled')
    expect(revealOf(facts({ state: 'failed' }), 'job-4', false)?.state).toBe('failed')
  })
})

// ------------------------------------------------------- the not-yet retry

describe('a refusal as not yet waits on the stage its data names (FR-003)', () => {
  const refusal = (data: Record<string, unknown>) => ({ code: -32000, message: 'm', data })

  it('reads the stage waited on from a not-yet refusal, and nothing from any other', () => {
    expect(
      waitsOn(refusal({ kind: 'layout', building: true, stage: 'octi', layout: LAYOUT })),
    ).toBe('octi')
    // Not "not yet": no building, so it is shown as a refusal.
    expect(waitsOn(refusal({ kind: 'layout', hint: 'no stored layout' }))).toBeNull()
    expect(waitsOn(refusal({ kind: 'layout', stage: 'topo' }))).toBeNull()
    expect(waitsOn(refusal({ kind: 'layout', building: 'yes', stage: 'topo' }))).toBeNull()
    expect(waitsOn(refusal({ kind: 'layout', building: true, stage: 'sideways' }))).toBeNull()
    expect(waitsOn(refusal({ kind: 'layout', building: true }))).toBeNull()
    expect(waitsOn({ code: -32000, message: 'm' })).toBeNull()
    expect(waitsOn(new Error('x'))).toBeNull()
    expect(waitsOn(null)).toBeNull()
  })

  const waiting = (on: StageName, since: StageName[]): Asked => ({ state: 'waiting', on, since })

  it.each<[string, Partial<Record<StageName, Asked>>, StageName[], StageName[]]>([
    ['nothing reported, nothing asked', {}, [], []],
    ['each stage reported and not asked', {}, ['gtfs2graph', 'topo'], ['gtfs2graph', 'topo']],
    ['not a stage asked already', { gtfs2graph: { state: 'asking' } }, ['gtfs2graph'], []],
    ['not a stage drawn', { gtfs2graph: { state: 'drawn' } }, ['gtfs2graph', 'topo'], ['topo']],
    [
      'not a stage refused for good',
      { topo: { state: 'refused' } },
      ['gtfs2graph', 'topo'],
      ['gtfs2graph'],
    ],
    [
      'not one waiting on a stage not reported yet',
      { gtfs2graph: { state: 'drawn' }, topo: waiting('loom', ['gtfs2graph', 'topo']) },
      ['gtfs2graph', 'topo'],
      [],
    ],
    [
      'one waiting, at the report of the stage its data named, not its own',
      {
        gtfs2graph: { state: 'drawn' },
        topo: waiting('loom', ['gtfs2graph', 'topo']),
      },
      ['gtfs2graph', 'topo', 'loom'],
      ['topo', 'loom'],
    ],
    [
      'one waiting on octi, as a day makes it, only at octi',
      { loom: waiting('octi', ['gtfs2graph', 'topo', 'loom']) },
      ['gtfs2graph', 'topo', 'loom'],
      ['gtfs2graph', 'topo'],
    ],
    [
      'never one whose stage was already reported when it was asked',
      { topo: waiting('topo', ['gtfs2graph', 'topo']) },
      ['gtfs2graph', 'topo', 'loom'],
      ['gtfs2graph', 'loom'],
    ],
  ])('asks %s', (_what, asked, reported, expected) => {
    expect(toAsk(asked, reported)).toEqual(expected)
  })
})

// ------------------------------------------------------------- the words

describe('what the view says while a run reveals the layout (FR-007)', () => {
  it.each<[StageName[], StageName | null, string]>([
    [[], 'topo', 'Nothing drawn yet; topo running.'],
    [['gtfs2graph'], 'topo', 'gtfs2graph drawn; topo running.'],
    [['gtfs2graph', 'topo'], 'loom', 'topo drawn; loom running.'],
    // The latest in the engine's order, whatever order the drawings landed in.
    [['loom', 'gtfs2graph', 'topo'], 'octi', 'loom drawn; octi running.'],
    [['gtfs2graph', 'loom'], 'octi', 'loom drawn; octi running.'],
    [
      ['gtfs2graph', 'topo', 'loom', 'octi'],
      null,
      'octi drawn; the layout’s four stages are done.',
    ],
    [[], null, 'Nothing drawn yet; the layout’s four stages are done.'],
  ])('with %j drawn and %s running: "%s"', (drawn, running, sentence) => {
    expect(revealSentence(drawn, running)).toBe(sentence)
  })

  it('says each stage once as it is drawn, and a stage not drawn yet when it is pressed', () => {
    expect(drawnAnnouncement('topo')).toBe('topo drawn.')
    expect(drawnAnnouncements(['topo'])).toBe('topo drawn.')
    // A stage asked for again lands with the one it waited on: both are said.
    expect(drawnAnnouncements(['loom', 'octi'])).toBe('loom drawn. octi drawn.')
    expect(notDrawnYet('loom')).toBe('loom is not drawn yet.')
  })

  it('follows the run, and shows a pressed stage only until the next is drawn', () => {
    expect(shownStage([], null)).toBeNull()
    expect(shownStage(['gtfs2graph'], null)).toBe('gtfs2graph')
    expect(shownStage(['topo', 'gtfs2graph'], null)).toBe('topo')
    expect(shownStage(['gtfs2graph', 'topo'], { stage: 'gtfs2graph', drawn: 2 })).toBe('gtfs2graph')
    expect(
      shownStage(['gtfs2graph', 'topo', 'loom'], { stage: 'gtfs2graph', drawn: 2 }),
      'a stage drawn since the press is shown',
    ).toBe('loom')
    expect(shownStage(['gtfs2graph'], { stage: 'loom', drawn: 1 }), 'not drawn').toBe('gtfs2graph')
  })

  it('says in one sentence that a stopped run’s stages are gone, and that a stored layout is back', () => {
    expect(clearedSentence('cancelled', false)).toBe(
      'The layout run was cancelled, so its stages are no longer drawn.',
    )
    expect(clearedSentence('failed', false)).toBe(
      'The layout run failed, so its stages are no longer drawn.',
    )
    expect(clearedSentence('cancelled', true)).toBe(
      'The layout run was cancelled, so its stages are no longer drawn. The stored layout is shown as it was.',
    )
  })

  it('keeps the two buttons and their words, and has words for the four stages in order', () => {
    expect(STAGES.map((s) => s.stage)).toEqual(['gtfs2graph', 'loom'])
    expect(STAGES.map((s) => s.gloss)).toEqual([
      'as the feed draws its routes',
      'lines sorted onto shared track',
    ])
    expect(LAYOUT_ORDER).toEqual(['gtfs2graph', 'topo', 'loom', 'octi'])
    expect(LAYOUT_STAGE_WORDS.map((s) => s.label)).toEqual([...LAYOUT_ORDER])
  })
})

// ------------------------------------------------------------- the view

describe('the stage view while a run reveals the layout, as it is first drawn', () => {
  const stored = record({
    layout: 'a'.repeat(64),
    made: '2026-09-10T12:00:00+00:00',
    date: '2026-09-12',
  })
  const never = (): Promise<RenderStageResult> => new Promise(() => {})
  const view = (project: ProjectRecord, reveal: Reveal | null): string =>
    renderToStaticMarkup(createElement(StageView, { project, engine: READY, read: never, reveal }))
  const running: Reveal = {
    run: 'job-9',
    layout: LAYOUT,
    state: 'running',
    reported: ['gtfs2graph'],
    running: 'topo',
  }

  it('says what is drawn and running, presses neither button and disables neither', () => {
    const html = view(record(), running)
    expect(html).toContain('Nothing drawn yet; topo running.')
    expect(html, 'not the sentence of a project with nothing to draw').not.toContain(
      'Lay the project out to see where its routes run.',
    )
    // The kit mirrors `aria-pressed` onto its inner button at run time, so
    // the markup says pressed by the variant the view chose.
    expect(html.match(/variant="primary"/g), 'neither stage is pressed').toBeNull()
    expect(html.match(/variant="secondary"/g)).toHaveLength(2)
    expect(html).not.toMatch(/disabled/)
    // The live region is there before anything is drawn, empty, so the
    // first stage drawn is said.
    expect(html).toContain('<p class="visually-hidden" role="status"></p>')
    expect(html).not.toContain('role="alert"')
  })

  it('draws nothing of the stored set while a re-layout reveals the new one', () => {
    const html = view(stored, { ...running, layout: stored.layout as string })
    expect(html).not.toContain('Drawing the stage')
    expect(html).not.toContain('<iframe')
  })

  it('holds nothing once the run has finished, until its record has been read back', () => {
    const html = view(stored, {
      ...running,
      state: 'done',
      reported: ['gtfs2graph', 'topo', 'loom', 'octi'],
      running: null,
    })
    expect(html).toContain('Drawing the stage…')
    expect(html).not.toContain('<iframe')
    expect(html, 'no sentence of the run').not.toContain('drawn;')
    expect(html, 'nothing said aloud of the run').not.toContain('visually-hidden')
    expect(html.match(/variant="primary"/g), 'the stage chosen, as before the run').toHaveLength(1)
  })

  it('says a stopped run’s stages are gone, and that the stored layout is shown again', () => {
    expect(view(record(), { ...running, state: 'cancelled' })).toContain(
      'The layout run was cancelled, so its stages are no longer drawn.',
    )
    const back = view(stored, { ...running, state: 'failed' })
    expect(back).toContain(
      'The layout run failed, so its stages are no longer drawn. The stored layout is shown as it was.',
    )
    // Stopped, it is a stored layout's view again: its own sentence, no live region.
    expect(back).not.toContain('visually-hidden')
    expect(back.match(/variant="primary"/g)).toHaveLength(1)
  })

  it('is the view it always was without a run', () => {
    const html = view(stored, null)
    expect(html).not.toContain('drawn;')
    expect(html).not.toContain('no longer drawn')
    expect(html).not.toContain('visually-hidden')
    expect(html.match(/variant="primary"/g)).toHaveLength(1)
  })
})

// ---------------------------------------- nothing of the map, the record or the export

describe('the reveal reaches the engine through its stage reader alone (FR-008, FR-004)', () => {
  const source = (path: string): string =>
    readFileSync(resolve(__dirname, '../../src/renderer/src', path), 'utf8')

  it('asks only render.stage, through the reader the view is given, never the bridge', () => {
    const view = source('StageView.tsx')
    expect(view).not.toMatch(/window\.api/)
    expect(view).not.toMatch(/\bviewer\b|projects\.|export\./)
    const stages = source('engine/stages.ts')
    expect(stages).not.toMatch(/window\.api/)
    expect([...stages.matchAll(/request\(\s*'([a-z.]+)'/g)].map((m) => m[1])).toEqual([
      'render.stage',
    ])
  })

  it('asks for a run’s stage with no day, so a re-layout is never answered from the stored set', () => {
    expect(source('StageView.tsx')).toMatch(
      /read\(project\.feed, revealLayout, set, stage, DRAW_WIDTH, null\)/,
    )
  })
})
