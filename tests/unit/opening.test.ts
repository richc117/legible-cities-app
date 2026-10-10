// The list of beats an opening sends (issue 392, spec 035 FR-004): the
// opening's beats - the card, then the draw-in - at the page's own start
// clock, on the storyboard's first view where that is the map or the
// geographic one and on the map otherwise, then the storyboard's own beats
// as the engine writes them, its first keeping its own clock and given the
// tween of 0 it was always played with. With no
// opening the plan is asked for by the storyboard's name, exactly as
// before, and the engine's storyboards are not asked for at all.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CaptureOptions, CaptureResult } from '../../src/main/capture'
import { Exporter, type ExportEngine } from '../../src/main/export'
import type { CaptureJob } from '../../src/shared/capture'
import { ERROR_CODES } from '../../src/shared/engine'
import {
  OFFERED_PRESETS,
  OPENING_UNMADE,
  needsStoryboards,
  openingList,
  planOptions,
  type ExportChoice,
} from '../../src/shared/export'
import {
  firstClock,
  openingBeats,
  OPENINGS,
  openingView,
  PAGE_START,
} from '../../src/shared/opening'
import { DEFAULT_STYLE, type ProjectRecord } from '../../src/shared/project'
import type {
  CaptureJob as PlannedJob,
  Preset,
  Storyboard,
  StoryboardBeat,
} from '../../src/shared/protocol'

/** The engine's two tables, as the pinned fixture holds them. */
const TABLES = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/export-tables-v0.8.2.json'), 'utf8'),
) as { presets: Preset[]; storyboards: Storyboard[] }

const board = (name: string): Storyboard => {
  const found = TABLES.storyboards.find((b) => b.name === name)
  if (found === undefined) throw new Error(`no storyboard ${name}`)
  return found
}
const preset = (name: string): Preset => {
  const found = TABLES.presets.find((p) => p.name === name)
  if (found === undefined) throw new Error(`no preset ${name}`)
  return found
}

/** A beat as the engine writes it, every field present. */
const beat = (over: Partial<StoryboardBeat> & { secs: number }): StoryboardBeat => ({
  view: null,
  labels: null,
  at: null,
  speed: null,
  sweep: false,
  hours: null,
  span: null,
  tween: null,
  ...over,
})

/** A storyboard that opens on the rows, which none of the engine's does. */
const ROWS: Storyboard = {
  name: 'rows',
  views: 'linear -> map',
  seconds: 8,
  geographic: false,
  beats: [
    beat({ secs: 4, view: 'linear', at: '06:00', speed: 120, tween: 0 }),
    beat({ secs: 4, view: 'map' }),
  ],
}

describe('the opening’s beats', () => {
  it('are none for no opening, so the storyboard is asked for by its name', () => {
    for (const storyboard of TABLES.storyboards)
      expect(openingBeats(storyboard, 'none'), storyboard.name).toBeNull()
  })

  it('put the card first, on the map at the page’s own start, then the storyboard as the engine wrote it', () => {
    const tour = board('tour')
    const list = openingBeats(tour, 'card')
    expect(list).toEqual([
      beat({ secs: 2, view: 'map', at: '07:00', speed: 0, tween: 0, card: true }),
      { ...tour.beats[0], tween: 0 },
      ...tour.beats.slice(1),
    ])
  })

  it('put the draw-in after the card, each on the map at the page’s own start', () => {
    const morph = board('morph')
    const list = openingBeats(morph, 'card-then-draw-in', { card: 3, drawIn: 7.5 }) ?? []
    expect(list.map((b) => [b.secs, b.card === true, b.draw_in === true])).toEqual([
      [3, true, false],
      [7.5, false, true],
      [1.5, false, false],
      [2.5, false, false],
      [2.5, false, false],
      [2.5, false, false],
    ])
    for (const opener of list.slice(0, 2)) {
      expect(opener).toMatchObject({ view: 'map', at: '07:00', speed: 0, tween: 0, sweep: false })
    }
    // A flag is written only where it is true, as the engine writes it.
    expect(list[0]).not.toHaveProperty('draw_in')
    expect(list[1]).not.toHaveProperty('card')
    expect(openingBeats(morph, 'draw-in')?.[0]).toEqual(
      beat({ secs: 6, view: 'map', at: '07:00', speed: 0, tween: 0, draw_in: true }),
    )
  })

  it('send the storyboard’s first beat a tween of 0, which is what it was played with as the first', () => {
    for (const storyboard of TABLES.storyboards) {
      for (const opening of OPENINGS) {
        const list = openingBeats(storyboard, opening) ?? []
        const first = list.find((b) => b.card !== true && b.draw_in !== true)
        expect(first, `${storyboard.name}, ${opening}`).toEqual({
          ...storyboard.beats[0],
          tween: 0,
        })
        // Every later beat as the engine wrote it, a null tween kept null.
        expect(list.slice(list.length - storyboard.beats.length + 1)).toEqual(
          storyboard.beats.slice(1),
        )
      }
    }
  })

  it('carry every field the engine writes, nulls included', () => {
    const fields = ['at', 'hours', 'labels', 'secs', 'span', 'speed', 'sweep', 'tween', 'view']
    for (const b of openingBeats(board('transform'), 'card-then-draw-in') ?? []) {
      expect(
        Object.keys(b)
          .filter((key) => key !== 'card' && key !== 'draw_in')
          .sort(),
      ).toEqual(fields)
    }
  })

  it('open at the page’s own start, 07:00, before every storyboard, which then jumps to its own clock', () => {
    // Mutation: the storyboard's first clock restored for the opening - the
    // capture then looks for trains at 05:30 before tour, where without an
    // opening it looked at the page's own start.
    expect(PAGE_START).toBe('07:00')
    const clocks = Object.fromEntries(
      TABLES.storyboards.map((s) => {
        const list = openingBeats(s, 'card-then-draw-in') ?? []
        return [s.name, [list[0].at, list[1].at, list[2].at]]
      }),
    )
    expect(clocks).toEqual({
      transform: ['07:00', '07:00', '08:00'],
      'transform-loop': ['07:00', '07:00', '08:00'],
      'essay-loop': ['07:00', '07:00', '08:00'],
      tour: ['07:00', '07:00', '05:30'],
      reveal: ['07:00', '07:00', '05:30'],
      morph: ['07:00', '07:00', '08:00'],
      day: ['07:00', '07:00', '05:00'],
      run: ['07:00', '07:00', '07:30'],
    })
  })

  it('take a storyboard whose first beat sweeps a span, and name no speed where it names none', () => {
    const swept = {
      beats: [beat({ secs: 10, view: 'map', sweep: true, span: ['06:00', '09:00'] })],
    }
    expect(firstClock(swept)).toBe('06:00')
    // A span's end that is not text is no clock: the table came from another process.
    const odd = {
      beats: [beat({ secs: 10, view: 'map', sweep: true, span: [600 as never, '09:00'] })],
    }
    expect(firstClock(odd)).toBeNull()
    expect(openingBeats(swept, 'card')?.[0]).toMatchObject({ at: '07:00', speed: null })
    // The storyboard's first beat keeps its span, which it seeks along.
    expect(openingBeats(swept, 'card')?.[1]).toMatchObject({ span: ['06:00', '09:00'] })
    // A storyboard with no clock of its own has no opening: it would play from
    // the opening's clock and not its own.
    const lost = { beats: [beat({ secs: 10, view: 'map', sweep: true, hours: 2 })] }
    expect(firstClock(lost)).toBeNull()
    expect(openingBeats(lost, 'card')).toBeNull()
  })

  it('stand on the storyboard’s own first view where it is the map or the ground, else on the map', () => {
    // Mutation: every opening on the map again - the three storyboards that
    // open on the ground then draw in on the map and cut away from it.
    const TIME = { beats: [beat({ secs: 2, view: 'time', at: '07:00', speed: 60, tween: 0 })] }
    const cases: [string, { beats: StoryboardBeat[] }, string][] = [
      ['tour', board('tour'), 'map'],
      ['transform', board('transform'), 'geographic'],
      ['transform-loop', board('transform-loop'), 'geographic'],
      ['essay-loop', board('essay-loop'), 'geographic'],
      ['the rows', ROWS, 'map'],
      ['the time chart', TIME, 'map'],
    ]
    for (const [name, storyboard, view] of cases) {
      expect(openingView(storyboard), name).toBe(view)
      for (const opening of OPENINGS) {
        const list = openingBeats(storyboard, opening) ?? []
        const openers = opening === 'card-then-draw-in' ? 2 : 1
        expect(
          list.slice(0, openers).map((b) => b.view),
          `${name}, ${opening}`,
        ).toEqual(Array(openers).fill(view))
        // The storyboard's first beat follows on its own view, with a tween of 0.
        expect(list[openers], `${name}, ${opening}`).toEqual({
          ...storyboard.beats[0],
          tween: 0,
        })
      }
    }
  })

  it('never change the storyboard they are made from', () => {
    const tour = board('tour')
    const before = JSON.stringify(tour)
    openingBeats(tour, 'card-then-draw-in')
    expect(JSON.stringify(tour)).toBe(before)
  })
})

describe('a storyboard that opens on the rows', () => {
  it('takes every opening, as the engine does: the card, the draw-in and both, before its own beats', () => {
    // Mutation: the draw-in kept out on the rows again - the app refusing
    // what the engine takes (spec 035, as of 10 Oct 2026).
    const flags = (list: ReturnType<typeof openingBeats>): string[] =>
      (list ?? []).map((b) => (b.card === true ? 'card' : b.draw_in === true ? 'draw-in' : 'own'))
    expect(flags(openingBeats(ROWS, 'card'))).toEqual(['card', 'own', 'own'])
    expect(flags(openingBeats(ROWS, 'draw-in'))).toEqual(['draw-in', 'own', 'own'])
    expect(flags(openingBeats(ROWS, 'card-then-draw-in'))).toEqual([
      'card',
      'draw-in',
      'own',
      'own',
    ])
    // The storyboard's first beat keeps its view and is sent a tween of 0.
    expect(openingBeats(ROWS, 'draw-in')?.[1]).toEqual({ ...ROWS.beats[0], tween: 0 })
  })
})

describe('the plan’s options', () => {
  const video = { kind: 'video', format: 'mp4', storyboard: 'tour' } as const

  it('are exactly what they were for every choice without an opening, the tables given or not', () => {
    for (const name of OFFERED_PRESETS) {
      const entry = preset(name)
      for (const storyboard of [undefined, 'day', 'transform'] as const) {
        const choice: ExportChoice = {
          preset: name,
          ...(storyboard === undefined ? {} : { storyboard }),
          options: { clock: false, caption: 'Rush hour' },
        }
        expect(needsStoryboards(choice, entry), name).toBe(false)
        expect(planOptions(choice, entry, 'dark', false, TABLES.storyboards)).toEqual(
          planOptions(choice, entry, 'dark'),
        )
      }
    }
  })

  it('carry the list in place of the storyboard’s name, the preset’s own where none is named', () => {
    const choice: ExportChoice = { preset: 'instagram-reel', options: {}, opening: 'card' }
    expect(needsStoryboards(choice, video)).toBe(true)
    const options = planOptions(choice, video, 'light', true, TABLES.storyboards)
    expect(options.storyboard).toEqual(openingBeats(board('tour'), 'card'))
    expect(options).toMatchObject({ theme: 'light', safe: true })
    const day = planOptions({ ...choice, storyboard: 'day' }, video, 'dark', false, [
      ...TABLES.storyboards,
    ])
    expect(day.storyboard).toEqual(openingBeats(board('day'), 'card'))
    // The durations are the choice's.
    const timed = openingList({ ...choice, cardSecs: 5 }, video, TABLES.storyboards)
    expect(timed?.[0].secs).toBe(5)
  })

  it('throw, never send the name, for an opening whose list cannot be made, whoever calls them', () => {
    // Mutation: the fallback to the storyboard's name restored in planOptions
    // - a third caller would export without the opening the person chose.
    const choice: ExportChoice = {
      preset: 'instagram-reel',
      storyboard: 'day',
      options: {},
      opening: 'card',
    }
    const unmade = { code: ERROR_CODES.badCall, message: OPENING_UNMADE, data: { kind: 'params' } }
    const cases: [string, readonly { name: string; beats: StoryboardBeat[] }[] | undefined][] = [
      ['the storyboards not given', undefined],
      ['the storyboard not among them', TABLES.storyboards.filter((b) => b.name !== 'day')],
      [
        'no clock to open at',
        TABLES.storyboards.map((b) =>
          b.name === 'day'
            ? { ...b, beats: [{ ...b.beats[0], at: null }, ...b.beats.slice(1)] }
            : b,
        ),
      ],
    ]
    for (const [why, storyboards] of cases) {
      let thrown: unknown = null
      try {
        planOptions(choice, video, 'dark', false, storyboards)
      } catch (error) {
        thrown = error
      }
      expect(thrown, why).toMatchObject(unmade)
    }
    // Without an opening, the storyboards not given is the request it always was.
    expect(planOptions({ ...choice, opening: undefined }, video, 'dark')).toEqual({
      storyboard: 'day',
      theme: 'dark',
    })
  })

  it('send the name for a still or a storyboard not listed, and a list on the rows', () => {
    const still = { kind: 'still', format: 'png', storyboard: null } as const
    const card: ExportChoice = { preset: 'instagram-post', options: {}, opening: 'card' }
    expect(needsStoryboards(card, still)).toBe(false)
    expect(openingList(card, still, TABLES.storyboards)).toBeNull()
    const rows = { ...video, storyboard: 'rows' }
    expect(
      openingList({ preset: 'instagram-reel', options: {}, opening: 'draw-in' }, rows, [ROWS]),
    ).toEqual(openingBeats(ROWS, 'draw-in'))
    expect(
      openingList({ preset: 'instagram-reel', options: {}, opening: 'card' }, video, []),
    ).toBeNull()
  })
})

// ------------------------------------------------- the exporter's requests

interface Asked {
  method: string
  params: Record<string, unknown> | undefined
}

const PLAN: PlannedJob = {
  key: 'la-metro-rail',
  preset: 'instagram-reel',
  mode: 'video',
  url: 'app://local/projects/abcdefghijk1/la-metro-rail.html?present=1&view=map',
  width: 1080,
  height: 1920,
  scale: 2,
  fps: 30,
  format: 'mp4',
  settle: 1200,
  beats: [
    {
      secs: 1,
      view: 'map',
      labels: null,
      at: 8 * 3600,
      speed: 0,
      sweep: false,
      hours: null,
      lo: null,
      hi: null,
      tween: 0,
    },
  ],
  keep: false,
  crf: 20,
  fade: 0,
  stem: 'la-metro-rail-instagram-reel',
  theme: 'dark',
  view: 'map',
  storyboard: 'custom',
  at: null,
  notes: [],
  caption: null,
  clock_corner: 'top-right',
  filename: 'la-metro-rail-instagram-reel.mp4',
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** An exporter over an engine that answers everything at once, recording what it was asked. */
function exporter(choice: ExportChoice, storyboards: unknown[] = TABLES.storyboards) {
  const root = mkdtempSync(join(tmpdir(), 'legible-cities-opening-'))
  roots.push(root)
  const asked: Asked[] = []
  let id = 0
  const engine: ExportEngine = {
    request(method, params) {
      asked.push({ method, params })
      const answers: Record<string, unknown> = {
        'export.presets': { presets: TABLES.presets },
        'export.storyboards': { storyboards },
        'export.plan': PLAN,
        'export.encode': { files: [], sidecar: {} },
      }
      return { id: ++id, result: Promise.resolve(answers[method]) }
    },
    cancel: () => undefined,
    onNotification: () => () => undefined,
  }
  const jobs: CaptureJob[] = []
  const record: ProjectRecord & { readOnly: boolean } = {
    version: 2,
    id: 'abcdefghijk1',
    name: 'Los Angeles',
    feed: 'la-metro-rail',
    mode: 'all',
    agency: null,
    date: '2026-09-08',
    service: null,
    style: { ...DEFAULT_STYLE },
    colors: {},
    defaultColor: '#888888',
    lineOrder: [],
    theme: 'warm-dark',
    export: choice,
    destination: null,
    opened: null,
    layout: 'a'.repeat(64),
    made: null,
    drawn: null,
    built: null,
    created: '2026-09-10T00:00:00.000Z',
    modified: '2026-09-10T00:00:00.000Z',
    readOnly: false,
  }
  const run = new Exporter({
    engine,
    projects: { get: async () => record },
    capture: async (job: CaptureJob, options: CaptureOptions): Promise<CaptureResult> => {
      jobs.push(job)
      void options
      return { frames: 30, width: 2160, height: 3840, first: { now: 0, clock: '08:00', shown: 1 } }
    },
    framesRoot: join(root, 'frames'),
    exportFolder: () => join(root, 'exports'),
    log: () => undefined,
  })
  return { run, asked, jobs }
}

const methods = (asked: Asked[]): string[] => asked.map((a) => a.method)
const planned = (asked: Asked[]): Record<string, unknown> =>
  (asked.find((a) => a.method === 'export.plan')?.params?.options ?? {}) as Record<string, unknown>

describe('the exporter', () => {
  it('without an opening asks what it always asked, and never for the storyboards', async () => {
    const choice: ExportChoice = { preset: 'instagram-reel', storyboard: 'day', options: {} }
    const preview = exporter(choice)
    await preview.run.preview('abcdefghijk1', choice)
    expect(methods(preview.asked)).toEqual(['export.presets', 'export.plan'])
    expect(planned(preview.asked)).toEqual({ storyboard: 'day', theme: 'dark', safe: true })

    const made = exporter(choice)
    await made.run.start('t1', 'abcdefghijk1', choice).result
    expect(methods(made.asked)).toEqual(['export.presets', 'export.plan', 'export.encode'])
    expect(planned(made.asked)).toEqual({ storyboard: 'day', theme: 'dark' })
  })

  it('with an opening asks for the storyboards and sends the list, for the preview and the export alike', async () => {
    const choice: ExportChoice = {
      preset: 'instagram-reel',
      options: {},
      opening: 'card-then-draw-in',
      cardSecs: 4,
    }
    const list = openingBeats(board('tour'), 'card-then-draw-in', { card: 4 })
    const preview = exporter(choice)
    await preview.run.preview('abcdefghijk1', choice)
    expect(methods(preview.asked)).toEqual(['export.presets', 'export.storyboards', 'export.plan'])
    expect(planned(preview.asked)).toEqual({ storyboard: list, theme: 'dark', safe: true })

    const made = exporter(choice)
    await made.run.start('t1', 'abcdefghijk1', choice).result
    expect(methods(made.asked)).toEqual([
      'export.presets',
      'export.storyboards',
      'export.plan',
      'export.encode',
    ])
    expect(planned(made.asked)).toEqual({ storyboard: list, theme: 'dark' })
    // The capture takes the plan's beats as the engine answered them.
    expect(made.jobs[0].beats).toEqual(PLAN.beats)
  })
})

describe('an opening that cannot be made', () => {
  const choice: ExportChoice = {
    preset: 'instagram-reel',
    storyboard: 'day',
    options: {},
    opening: 'card-then-draw-in',
  }
  /** The day storyboard with its first beat's clock taken away. */
  const clockless = TABLES.storyboards.map((b) =>
    b.name === 'day' ? { ...b, beats: [{ ...b.beats[0], at: null }, ...b.beats.slice(1)] } : b,
  )
  const missing = TABLES.storyboards.filter((b) => b.name !== 'day')

  for (const [why, table] of [
    ['a storyboard the engine’s table does not list', missing],
    ['a storyboard whose first beat names no clock', clockless],
  ] as const) {
    it(`is refused, not planned by name, for ${why}`, async () => {
      // Mutation: the fallback to the storyboard's name restored - the
      // export runs without the opening cell 06 says plays.
      const preview = exporter(choice, [...table])
      const answer = await preview.run.preview('abcdefghijk1', choice)
      expect(answer).toMatchObject({
        ok: false,
        error: { code: ERROR_CODES.badCall, message: OPENING_UNMADE, data: { kind: 'params' } },
      })
      expect(methods(preview.asked)).toEqual(['export.presets', 'export.storyboards'])

      const made = exporter(choice, [...table])
      await expect(made.run.start('t1', 'abcdefghijk1', choice).result).rejects.toMatchObject({
        code: ERROR_CODES.badCall,
        message: OPENING_UNMADE,
        data: { kind: 'params' },
      })
      expect(methods(made.asked)).toEqual(['export.presets', 'export.storyboards'])
      expect(made.jobs, 'nothing was captured').toEqual([])
    })
  }

  it('says so in a sentence that tells the person what to do', () => {
    expect(OPENING_UNMADE).toBe(
      'The opening cannot be made from this storyboard; choose None or another storyboard.',
    )
  })
})
