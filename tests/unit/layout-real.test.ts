// The one coupling this feature cannot avoid, checked against the engine
// that is actually installed: the app declares the eight stages it draws
// before anything has finished, and the engine has to report exactly those,
// in that order. A pipeline that changes shape fails here rather than
// drawing a wrong picture.
//
// It runs on the BART layout the determinism fixture commits, in a home
// seeded from it, wherever an interpreter with the engine is named; it skips,
// saying so, where none is, unless the determinism workflow opted in, where
// that fails. A layout the engine did not find there would fail at once
// rather than be made: the home names a LOOM folder that does not exist, and
// the fixture's is the one stored layout before and after.
//
// The same checks run on Los Angeles where an engine checkout has a cached
// layout for it, from a home seeded from the checkout's caches. A cold run
// needs Docker, a download and about thirteen seconds, so without the cache
// that block skips saying why - and is not registered at all where the
// determinism workflow opted in, which has no checkout and runs BART instead.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Sidecar } from '../../src/main/sidecar'
import { GRAPH_STAGES, LAYOUT_STAGES } from '../../src/shared/layout'
import { reportOf } from '../../src/renderer/src/engine/layoutRun'
import { copyText, metrics, score } from '../../src/renderer/src/engine/diagnostics'
import { fixtureLayoutId } from '../support/determinism'
import {
  BART,
  ENGINE_TEST_MS,
  NO_ENGINE,
  REQUIRED,
  bartHome,
  failIfRequired,
  localConfig,
  noLoom,
  realInterpreter,
  startRealEngine,
} from '../support/real-engine'

const LA = 'la-metro-rail'
const CONFIG = localConfig()
const CHECKOUT = CONFIG.engineCheckout
const INTERPRETER = realInterpreter(CONFIG)

// The engine's own home is its checkout, so that is where a developer's
// stored layouts are: one folder per layout id under the feed's, each with
// its four stage graphs and a .meta.json (engine v0.5.0). The feed's zip is
// required too: without it the engine would download it before finding the
// layout, which no run of this suite may do.
const CACHED =
  CHECKOUT !== null &&
  existsSync(join(CHECKOUT, 'data', 'feeds', `${LA}.zip`)) &&
  existsSync(join(CHECKOUT, 'data', 'graphs', LA)) &&
  readdirSync(join(CHECKOUT, 'data', 'graphs', LA)).some(
    (name) =>
      /^[0-9a-f]{64}$/.test(name) &&
      existsSync(join(CHECKOUT, 'data', 'graphs', LA, name, '03_octi.json')) &&
      existsSync(join(CHECKOUT, 'data', 'graphs', LA, name, '.meta.json')),
  )

const WHY = INTERPRETER === null ? NO_ENGINE : ''
const LA_WHY =
  INTERPRETER === null
    ? NO_ENGINE
    : CACHED
      ? ''
      : ` (skipped: no engine checkout with a cached layout for ${LA}; run the engine once)`

failIfRequired("the real engine's layout", INTERPRETER === null, 'no engine')

/** The first day inside [start, end] falling on the given weekday (0 Sunday), or null. */
function firstWeekdayInside(start: string, end: string, weekday: number): string | null {
  const day = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (day <= last) {
    if (day.getUTCDay() === weekday) return day.toISOString().slice(0, 10)
    day.setUTCDate(day.getUTCDate() + 1)
  }
  return null
}

/** A home seeded from the checkout's caches for Los Angeles, so nothing runs LOOM. */
function laHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'lc-layout-real-'))
  mkdirSync(join(home, 'data', 'graphs'), { recursive: true })
  mkdirSync(join(home, 'data', 'feeds'), { recursive: true })
  cpSync(join(CHECKOUT as string, 'data', 'graphs', LA), join(home, 'data', 'graphs', LA), {
    recursive: true,
  })
  // The feed's zip and its normalised copies; the id hashes the zip's bytes,
  // so the copy names the same layout the checkout stored.
  const feeds = join(CHECKOUT as string, 'data', 'feeds')
  for (const file of readdirSync(feeds).filter((f) => f.startsWith(LA))) {
    cpSync(join(feeds, file), join(home, 'data', 'feeds', file), { recursive: true })
  }
  return home
}

/** One feed's run of the checks, and what it needs to be asked for. */
interface Case {
  /** The registry key. */
  feed: string
  /** What graph.build is sent beside the key, which names the stored layout. */
  inputs: Record<string, unknown>
  /** The project's name, which the copied diagnostics begin with. */
  name: string
  /** The engine's home, where the drawn page is looked for. */
  home: string
}

/**
 * Lay a feed out on a home that already stores its layout, draw it, and hold
 * the engine's answers to what the app declares and reads. Answers the
 * layout graph.build named.
 */
async function layoutChecks(sidecar: Sidecar, { feed, inputs, name, home }: Case): Promise<string> {
  const reported: string[] = []
  sidecar.onNotification((n) => {
    if (n.method === 'job/progress') {
      reported.push((n.params as { stage: string }).stage)
    }
  })

  const built = (await sidecar.request('graph.build', { key: feed, ...inputs }).result) as {
    layout: string
    paths: Record<string, string>
    meta: { made: string }
    stages: { octi: { lines: string[] } }
  }
  expect(Number.isNaN(Date.parse(built.meta.made)), 'made is a time').toBe(false)
  expect(reported, 'the layout call reports the four layout stages').toEqual([...GRAPH_STAGES])
  expect(built.layout, "the engine's own id").toMatch(/^[0-9a-f]{64}$/)

  const map = (await sidecar.request('map.build', {
    key: feed,
    layout: built.layout,
    date: '2026-09-02',
    out: 'a-project',
  }).result) as { files: { html: string }; date: string; layout: string }

  // The map call repeats the four and adds its own four, which is the
  // whole sequence the app declares.
  expect(reported.slice(GRAPH_STAGES.length)).toEqual([...LAYOUT_STAGES])
  expect(map.date).toBe('2026-09-02')
  expect(map.layout, 'the map names the layout it was drawn from').toBe(built.layout)
  expect(existsSync(join(home, 'out', 'a-project', `${feed}.html`))).toBe(true)

  // What the diagnostics panel reads, against the engine that has it
  // (A3-03, engine v0.8.0). The block's own arithmetic is the engine's:
  // every matched stop is matched one way, and the ways add up to the
  // matched figure the panel shows above them. The app checks that
  // relation here rather than computing it on a screen.
  const report = reportOf(map as never, '2026-09-02')
  expect(report, 'v0.8.0 answers diagnostics beside the files').not.toBeNull()
  const diagnostics = report!.diagnostics
  const { matched, total, by } = diagnostics.stops
  expect(by.station_id + by.parent_station + by.name, 'one way each').toBe(matched)
  expect(matched).toBeLessThanOrEqual(total)
  expect(diagnostics.stops.unmatched.length, 'the first few, never the whole list').toBeLessThan(9)
  expect(diagnostics.octilinear).toBeGreaterThan(0)
  expect(diagnostics.octilinear).toBeLessThanOrEqual(1)
  expect(diagnostics.lines.length, 'the lines the layout drew').toBeGreaterThan(0)
  // The sentences are the engine's, and the app shows them as they
  // are: each is a sentence and none is a path (constitution V).
  for (const caveat of report!.caveats) {
    expect(caveat.length).toBeGreaterThan(10)
    expect(caveat, 'no path in a caveat').not.toMatch(/(^|[\s(])(?:[A-Za-z]:[\\/]|[\\/][^\s\\/])/)
  }
  expect(report!.issues).toBeGreaterThanOrEqual(0)
  // And the panel's own rendering of a real network: a figure in every
  // row, and a copied block that carries them all.
  const rows = metrics(diagnostics)
  for (const metric of rows) expect(metric.value, metric.id).not.toBe('')
  const text = copyText(name, report!)
  expect(text).toContain(`Issues score: ${score(report!.issues)}`)
  expect(text).toContain('the map drawn for 2026-09-02')

  // The same inputs name the same layout, and asking again runs nothing.
  const again = (await sidecar.request('graph.build', { key: feed, ...inputs }).result) as {
    layout: string
    meta: { made: string }
  }
  expect(again.layout, 'reproducible').toBe(built.layout)
  expect(again.meta.made, 'an unforced answer repeats when the set was made (A3-06)').toBe(
    built.meta.made,
  )

  // Which day to draw, as the app asks at the first layout: from a
  // fixed anchor and the lines the layout drew. The answer is a day
  // inside the window, and the same day when asked again (E21).
  const lines = built.stages.octi.lines
  const service = (await sidecar.request('feeds.service', {
    key: feed,
    anchor: '2026-09-08',
    lines,
  }).result) as { start: string; end: string; busiest_weekday: string; anchor: string }
  for (const day of [service.start, service.end, service.busiest_weekday]) {
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  }
  expect(service.anchor, 'the anchor is echoed').toBe('2026-09-08')
  expect(service.start <= service.busiest_weekday && service.busiest_weekday <= service.end).toBe(
    true,
  )
  const twice = (await sidecar.request('feeds.service', {
    key: feed,
    anchor: '2026-09-08',
    lines,
  }).result) as { busiest_weekday: string }
  expect(twice.busiest_weekday, 'the same feed and anchor give the same day').toBe(
    service.busiest_weekday,
  )

  // The two stages the geographic view draws, by the layout's id: the
  // engine's SVG and counts, each in under a second, equal to
  // graph.build's own for the stages. Between the two, topo merges
  // platforms into stations and adds junctions where lines cross, so
  // loom has no more stations and no fewer junctions; its node count
  // can go either way (Los Angeles gains four), and a literal count is
  // the wrong instrument anyway (ADR-023).
  const drawn: Record<string, { nodes: number; counts: { stations: number; junctions: number } }> =
    {}
  for (const stage of ['gtfs2graph', 'loom'] as const) {
    const t0 = performance.now()
    const result = (await sidecar.request('render.stage', {
      key: feed,
      layout: built.layout,
      stage,
      width: 1600,
    }).result) as {
      svg: string
      width: number
      height: number
      counts: { nodes: number; stations: number; junctions: number }
    }
    const took = performance.now() - t0
    // The criterion is a second; the assertion allows a cold machine.
    expect(took, `${stage} in a moment`).toBeLessThan(2500)
    expect(result.svg.trimStart().startsWith('<svg')).toBe(true)
    // The width sizes the network and the canvas grows for the margin,
    // so the drawing is at least as wide as asked.
    expect(result.width).toBeGreaterThanOrEqual(1600)
    expect(result.height).toBeGreaterThan(0)
    expect(result.counts).toEqual(
      (built as unknown as { stages: Record<string, unknown> }).stages[stage],
    )
    drawn[stage] = { nodes: result.counts.nodes, counts: result.counts }
  }
  expect(drawn.loom.counts.stations).toBeLessThanOrEqual(drawn.gtfs2graph.counts.stations)
  expect(drawn.loom.counts.junctions).toBeGreaterThanOrEqual(drawn.gtfs2graph.counts.junctions)

  // A chosen day: the first Saturday inside the window, drawn from the
  // same layout as the app's rebuild does. The schedule stage's
  // sentence names the day and its trips; the app shows that sentence
  // and never touches a time of day (SC-002).
  const saturday = firstWeekdayInside(service.start, service.end, 6)
  if (saturday !== null) {
    const sentences: string[] = []
    const off = sidecar.onNotification((n) => {
      if (n.method === 'job/progress') {
        const p = n.params as { stage: string; message: string }
        if (p.stage === 'schedule') sentences.push(p.message)
      }
    })
    const drawn = (await sidecar.request('map.build', {
      key: feed,
      layout: built.layout,
      date: saturday,
      out: 'a-project',
    }).result) as { date: string; diagnostics: { trips: { total: number } } }
    off()
    expect(drawn.date).toBe(saturday)
    expect(sentences).toHaveLength(1)
    expect(sentences[0]).toMatch(/^\d+ trips on Saturday /)
    expect(drawn.diagnostics.trips.total, 'a Saturday timetable has trips').toBeGreaterThan(0)
  }
  return built.layout
}

describe.skipIf(INTERPRETER === null)(`the real engine's layout, on the BART fixture${WHY}`, () => {
  it(
    'reports exactly the stages the app draws, in that order',
    async () => {
      const home = bartHome('lc-layout-real-')
      try {
        let sidecar: Sidecar | undefined
        try {
          sidecar = await startRealEngine(INTERPRETER as string, home, { loomBin: noLoom(home) })
          // What a layout run sends: the record's mode, and every operator.
          // Those are the inputs the fixture's layout is addressed with.
          const layout = await layoutChecks(sidecar, {
            feed: BART,
            inputs: { mode: 'all', agency: '' },
            name: 'BART',
            home,
          })
          expect(layout, "the fixture's layout, found").toBe(fixtureLayoutId())
        } finally {
          await sidecar?.stop()
        }
        // Found, never made: the one stored layout is the fixture's, so
        // nothing was laid out, and nothing was downloaded.
        expect(readdirSync(join(home, 'data', 'graphs', BART))).toEqual([fixtureLayoutId()])
        expect(readdirSync(join(home, 'data', 'graphs'))).toEqual([BART])
        // The feeds folder holds the fixture's zip and the copy the engine
        // normalised from it, and nothing of another feed's.
        expect(
          readdirSync(join(home, 'data', 'feeds')).filter((name) => !name.startsWith(`${BART}.`)),
          'no other feed is in the home',
        ).toEqual([])
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
    ENGINE_TEST_MS,
  )
})

// Where the determinism workflow opted in there is no checkout, and a block
// that could only skip is not registered: its run of the seven must have no
// skipped test in it.
if (CACHED || !REQUIRED) {
  describe.skipIf(INTERPRETER === null || !CACHED)(
    `the real engine's layout, on Los Angeles from the checkout${LA_WHY}`,
    () => {
      it(
        'reports exactly the stages the app draws, in that order',
        async () => {
          const home = laHome()
          let sidecar: Sidecar | undefined
          try {
            // A LOOM folder that does not exist, so a layout not found in the
            // copied store fails at once rather than starting Docker.
            sidecar = await startRealEngine(INTERPRETER as string, home, { loomBin: noLoom(home) })
            await layoutChecks(sidecar, { feed: LA, inputs: {}, name: 'Los Angeles', home })
          } finally {
            await sidecar?.stop()
            rmSync(home, { recursive: true, force: true })
          }
        },
        ENGINE_TEST_MS,
      )
    },
  )
}
