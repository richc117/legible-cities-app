// The opening's list against the real engine (issue 392, spec 035 FR-004):
// what `openingBeats` makes from the engine's own storyboard table is what
// the engine's `export.plan` takes - a card alone, a draw-in alone, and the
// card then the draw-in - on a storyboard that opens on the map and on one
// that opens on the rows. Skips, saying so, without an engine checkout.
//
// The storyboard that opens on the rows is written here: none of the
// engine's eight does. The issue had decided the app would keep the draw-in
// out before one, believing the engine refused it; at the pin the engine
// takes all three, which this file showed, so the app sends all three (spec
// 035, as of 10 Oct 2026), and a pin that starts refusing one fails here
// first.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveConfig } from '../../src/main/config'
import { engineCommand, engineEnvironment, resolveInterpreter } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin } from '../../src/shared/engine'
import {
  CARD_SECONDS,
  DRAW_IN_SECONDS,
  firstClock,
  openingBeats,
  openingView,
  PAGE_START,
  type OpeningSeconds,
} from '../../src/shared/opening'
import type {
  CaptureJob,
  ExportStoryboards,
  Storyboard,
  StoryboardBeat,
} from '../../src/shared/protocol'

const repo = resolve(__dirname, '../..')
const pins = JSON.parse(readFileSync(join(repo, 'vendor/pins.json'), 'utf8')) as {
  engine: EnginePin
}

function localConfig() {
  let fileText: string | undefined
  try {
    fileText = readFileSync(join(repo, '.env.local'), 'utf8')
  } catch {
    fileText = undefined
  }
  return resolveConfig({
    fileText,
    env: process.env,
    userData: tmpdir(),
    desktop: tmpdir(),
    loomPin: '',
    baseDir: repo,
  })
}

const INTERPRETER = resolveInterpreter({
  config: { enginePython: null, engineCheckout: localConfig().engineCheckout },
  packaged: false,
  resourcesPath: '',
  platform: process.platform,
  exists: existsSync,
}).interpreter

const WHY = INTERPRETER === null ? ' (skipped: LEGIBLE_ENGINE_CHECKOUT names no engine)' : ''

const PAGE = 'app://local/projects/abcdefghijk1/la-metro-rail.html'

/** A storyboard that opens on the rows, every field as the engine writes one. */
const ROWS: Pick<Storyboard, 'beats'> = {
  beats: [
    {
      secs: 4,
      view: 'linear',
      labels: null,
      at: '06:00',
      speed: 120,
      sweep: false,
      hours: null,
      span: null,
      tween: 0,
    },
    {
      secs: 4,
      view: 'map',
      labels: null,
      at: null,
      speed: null,
      sweep: false,
      hours: null,
      span: null,
      tween: null,
    },
  ],
}

describe.skipIf(INTERPRETER === null)(`the opening against the real engine${WHY}`, () => {
  let home = ''
  let sidecar: Sidecar
  const log: string[] = []

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'lc-opening-real-'))
    sidecar = new Sidecar({
      command: engineCommand(INTERPRETER as string),
      // Nothing is written into the checkout: a plan reads, and so does this.
      env: {
        ...engineEnvironment({
          config: { home, loomBin: null, loomCommit: null, ffmpeg: null },
          base: process.env,
          development: true,
        }),
        PYTHONDONTWRITEBYTECODE: '1',
      },
      pin: pins.engine,
      log: (m) => log.push(m),
      bounds: { handshakeMs: 20_000 },
    })
    sidecar.start()
    await new Promise<void>((ready, reject) => {
      const timer = setTimeout(() => reject(new Error(log.join('\n'))), 25_000)
      sidecar.onState((s) => {
        if (s.state === 'ready') {
          clearTimeout(timer)
          ready()
        } else if (s.state !== 'starting') {
          clearTimeout(timer)
          reject(new Error(`${s.state}: ${log.join('\n')}`))
        }
      })
    })
  }, 30_000)

  afterAll(async () => {
    await sidecar?.stop()
    if (home !== '') rmSync(home, { recursive: true, force: true })
  })

  const plan = async (
    storyboard: StoryboardBeat[],
    extra: Record<string, unknown> = {},
  ): Promise<CaptureJob> =>
    (await sidecar.request('export.plan', {
      key: 'la-metro-rail',
      preset: 'linkedin-video',
      page: PAGE,
      date: '2026-06-16',
      options: { storyboard, theme: 'dark', ...extra },
    }).result) as CaptureJob

  const listed = async (name: string): Promise<Storyboard> => {
    const table = (await sidecar.request('export.storyboards').result) as ExportStoryboards
    const found = table.storyboards.find((board) => board.name === name)
    if (found === undefined) throw new Error(`the engine lists no ${name}`)
    return found
  }
  const tour = (): Promise<Storyboard> => listed('tour')

  /** A clock as the engine's plan writes one: seconds of the service day. */
  const secondsOf = (clock: string): number => {
    const [h, m, s] = clock.split(':').map(Number)
    return h * 3600 + m * 60 + (s ?? 0)
  }

  /**
   * Every opening before a storyboard, planned by the engine: the flags where
   * they belong, the opening on `view` at the page's own start for the seconds
   * asked, and the storyboard's first beat after it on its own view at its own
   * `clock` with a tween of 0; the address opens on `view` at the page's own
   * start, so the capture looks for trains where it always has. None is no
   * list: the name is sent.
   */
  const plansEveryOpening = async (
    storyboard: Pick<Storyboard, 'beats'>,
    view: string,
    clock: string,
    seconds: OpeningSeconds = {},
  ): Promise<void> => {
    expect(openingBeats(storyboard, 'none')).toBeNull()
    for (const opening of ['card', 'draw-in', 'card-then-draw-in'] as const) {
      const list = openingBeats(storyboard, opening, seconds)
      expect(list, opening).not.toBeNull()
      const job = await plan(list as StoryboardBeat[])
      expect(job.storyboard, opening).toBe('custom')
      const own = job.beats.length - storyboard.beats.length
      expect(own, opening).toBe(opening === 'card-then-draw-in' ? 2 : 1)
      expect(
        job.beats.slice(0, own).map((b) => b.secs),
        opening,
      ).toEqual([
        ...(opening === 'draw-in' ? [] : [seconds.card ?? CARD_SECONDS.fallback]),
        ...(opening === 'card' ? [] : [seconds.drawIn ?? DRAW_IN_SECONDS.fallback]),
      ])
      // The flags written only where true, the engine's way.
      expect(
        job.beats.slice(0, own).map((b) => (b.card === true ? 'card' : 'draw-in')),
        opening,
      ).toEqual(opening === 'card-then-draw-in' ? ['card', 'draw-in'] : [opening])
      expect(job.beats.slice(own).some((b) => b.card === true || b.draw_in === true)).toBe(false)
      for (const opener of job.beats.slice(0, own)) {
        expect(opener.view, opening).toBe(view)
        expect(opener.at, opening).toBe(secondsOf(PAGE_START))
      }
      expect(job.beats[own], opening).toMatchObject({
        view: storyboard.beats[0].view,
        at: secondsOf(clock),
        tween: 0,
      })
      const query = new URL(job.url).searchParams
      expect(query.get('view'), opening).toBe(view)
      expect(query.get('at'), opening).toBe(PAGE_START)
    }
  }

  it('plans every opening before a storyboard that opens on the map, on the map', async () => {
    const storyboard = await tour()
    await plansEveryOpening(storyboard, 'map', '05:30')
    // The storyboard's first beat as the engine plays it: its speed and clock.
    const job = await plan(openingBeats(storyboard, 'card') as StoryboardBeat[])
    expect(job.beats[1]).toMatchObject({ view: 'map', at: 5.5 * 3600, speed: 240, tween: 0 })
  })

  it('plans every opening before one that opens on the ground, on the ground', async () => {
    for (const name of ['transform', 'transform-loop', 'essay-loop'])
      await plansEveryOpening(await listed(name), 'geographic', '08:00')
  })

  it('plans every opening before each of the engine’s storyboards, at the defaults and at the longest durations', async () => {
    const table = (await sidecar.request('export.storyboards').result) as ExportStoryboards
    expect(table.storyboards.map((b) => b.name).sort()).toEqual([
      'day',
      'essay-loop',
      'morph',
      'reveal',
      'run',
      'tour',
      'transform',
      'transform-loop',
    ])
    for (const storyboard of table.storyboards) {
      const clock = firstClock(storyboard)
      expect(clock, storyboard.name).not.toBeNull()
      // At the defaults, and at a card of 10 and a draw-in of 20 seconds: the
      // longest storyboard and the longest opening together stay under the
      // engine's 90 seconds, so the engine plans them all.
      for (const seconds of [{}, { card: 10, drawIn: 20 }])
        await plansEveryOpening(storyboard, openingView(storyboard), clock as string, seconds)
    }
  })

  it('carries the card’s words on the address, and a note when they need longer than the card', async () => {
    const storyboard = await tour()
    const job = await plan(openingBeats(storyboard, 'card') as StoryboardBeat[], {
      title: false,
      caption: 'Rush hour on the Red Line',
    })
    expect(new URL(job.url).searchParams.get('city')).toBe('Los Angeles')
    expect(job.notes).toEqual([
      expect.stringMatching(
        /^the title card at storyboard\[0\] says \d+ words, about [\d.]+ seconds of reading at 0\.3 seconds a word, and lasts 2\. Lengthen the beat, or shorten the caption\.$/,
      ),
    ])
    const long = openingBeats(storyboard, 'card', { card: 10 }) as StoryboardBeat[]
    expect((await plan(long, { caption: 'Rush hour on the Red Line' })).notes).toEqual([])
  })

  it('plans every opening before a storyboard that opens on the rows, on the map', async () => {
    await plansEveryOpening(ROWS, 'map', '06:00')
  })
})
