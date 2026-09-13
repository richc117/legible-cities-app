// The determinism test's fixture and its checks (A5-04): an engine home laid
// out from the committed BART feed and stored layout, a project whose page
// the real engine draws from that layout, and the check that two exports
// read the same stored layout and never laid the network out again.
//
// Pure Node, no Electron: the end-to-end test uses it around a launch of the
// app, and the unit tests use it on its own, the layout check against a
// swapped identifier and the fixture against the real engine.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { engineCommand, engineEnvironment } from '../../src/main/interpreter'
import { Sidecar } from '../../src/main/sidecar'
import type { EnginePin } from '../../src/shared/engine'
import { isLayoutId } from '../../src/shared/layout'
import {
  DEFAULT_COLOR,
  DEFAULT_MODE,
  DEFAULT_STYLE,
  DEFAULT_THEME,
  RECORD_VERSION,
  type ProjectRecord,
} from '../../src/shared/project'
import type { FeedsServiceResult, MapBuildResult } from '../../src/shared/protocol'

/** The committed fixture: `data/feeds/bart.zip` and one stored layout under `data/graphs/bart/`. */
export const FIXTURE = resolve(__dirname, '../fixtures/determinism/bart')
export const FEED = 'bart'
export const PROJECT_ID = 'determinism1'
export const PROJECT_NAME = 'BART'
/**
 * The day the service choice scans from. Fixed, so the project draws the
 * same day on every machine and in every month, and inside the feed's
 * calendar (10 August 2026 to 10 January 2027).
 */
export const ANCHOR = '2026-09-14'

/** The folder the test puts on PYTHONPATH, so the engine records each request's method. */
export const REQUESTS_SHIM = resolve(__dirname, 'engine-requests')
/** Where that record is written: beside the engine's home, never inside it. */
export const requestsLog = (engineHome: string): string =>
  join(resolve(engineHome, '..'), 'engine-requests.log')

export const PIN: EnginePin = (
  JSON.parse(readFileSync(resolve(__dirname, '../../vendor/pins.json'), 'utf8')) as {
    engine: EnginePin
  }
).engine

const graphs = (engineHome: string): string => join(engineHome, 'data', 'graphs', FEED)

/** The stored layouts under a feed's folder: the names that are layout ids. */
function layoutsIn(folder: string): string[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((name) => isLayoutId(name))
    .sort()
}

/** The fixture's one stored layout, by the id its folder is named with. */
export function fixtureLayoutId(): string {
  const found = layoutsIn(join(FIXTURE, 'data', 'graphs', FEED))
  if (found.length !== 1) throw new Error(`the fixture holds ${found.length} layouts, not one`)
  return found[0]
}

/** When a stored layout was made, from the meta the engine wrote beside it. */
function madeOf(engineHome: string, id: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(join(graphs(engineHome), id, '.meta.json'), 'utf8')) as {
      made?: unknown
    }
    return typeof meta.made === 'string' ? meta.made : null
  } catch {
    return null
  }
}

/** An engine home with the fixture's feed and layout in it, and nothing else. */
export function seedHome(engineHome: string): void {
  mkdirSync(engineHome, { recursive: true })
  cpSync(join(FIXTURE, 'data'), join(engineHome, 'data'), { recursive: true })
}

/** The pinned engine, started on a home and ready for requests. Stop it when done. */
export async function startEngine(
  interpreter: string,
  engineHome: string,
  options: { loomBin?: string | null; log?: string[] } = {},
): Promise<Sidecar> {
  const log = options.log ?? []
  const sidecar = new Sidecar({
    command: engineCommand(interpreter),
    env: engineEnvironment({
      config: {
        home: engineHome,
        loomBin: options.loomBin ?? null,
        loomCommit: null,
        ffmpeg: null,
      },
      base: process.env,
      development: true,
    }),
    pin: PIN,
    log: (m) => log.push(m),
    // A cold start imports pandas, which on a fresh Windows runner is slow.
    bounds: { handshakeMs: 120_000 },
  })
  sidecar.start()
  await new Promise<void>((ready, reject) => {
    // An engine that did not come up is stopped before the failure is
    // reported, or the supervisor would go on restarting it in the background.
    const fail = (error: Error): void => {
      void sidecar.stop().finally(() => reject(error))
    }
    const timer = setTimeout(() => fail(new Error(log.join('\n'))), 150_000)
    const check = (state: Sidecar['state']): void => {
      if (state.state === 'ready') {
        clearTimeout(timer)
        ready()
      } else if (state.state !== 'starting') {
        clearTimeout(timer)
        fail(new Error(`${state.state}: ${log.join('\n')}`))
      }
    }
    sidecar.onState(check)
    check(sidecar.state)
  })
  return sidecar
}

/**
 * A laid-out project on a seeded home, as a layout run would have left it:
 * the engine chooses the day from the fixed anchor, draws the project's page
 * from the fixture's stored layout with `map.build` - never `graph.build` -
 * and the record names that layout, its `made`, the day and the window. Its
 * export is the draft `instagram-reel-gif`. Answers the record.
 */
export async function prepareProject(
  interpreter: string,
  engineHome: string,
): Promise<ProjectRecord> {
  const layout = fixtureLayoutId()
  const made = madeOf(engineHome, layout)
  if (made === null) throw new Error('the seeded layout has no made in its meta')
  const sidecar = await startEngine(interpreter, engineHome)
  try {
    const service = (await sidecar.request('feeds.service', { key: FEED, anchor: ANCHOR })
      .result) as FeedsServiceResult
    const built = (await sidecar.request('map.build', {
      key: FEED,
      layout,
      date: service.busiest_weekday,
      out: PROJECT_ID,
      colors: {},
      default_color: DEFAULT_COLOR,
    }).result) as MapBuildResult
    if (built.layout !== layout)
      throw new Error(`map.build drew layout ${built.layout}, not the fixture's ${layout}`)
    const now = new Date().toISOString()
    const record: ProjectRecord = {
      version: RECORD_VERSION,
      id: PROJECT_ID,
      name: PROJECT_NAME,
      feed: FEED,
      mode: DEFAULT_MODE,
      agency: null,
      date: service.busiest_weekday,
      service: {
        start: service.start,
        end: service.end,
        busiest: service.busiest_weekday,
        anchor: service.anchor,
      },
      style: { ...DEFAULT_STYLE },
      colors: {},
      defaultColor: DEFAULT_COLOR,
      lineOrder: [],
      theme: DEFAULT_THEME,
      export: { preset: 'instagram-reel-gif', options: { quality: 'draft' } },
      layout,
      made,
      built: { mode: DEFAULT_MODE, agency: null },
      created: now,
      modified: now,
    }
    mkdirSync(join(engineHome, 'projects', PROJECT_ID), { recursive: true })
    writeFileSync(
      join(engineHome, 'projects', PROJECT_ID, 'project.json'),
      JSON.stringify(record, null, 2),
    )
    return record
  } finally {
    await sidecar.stop()
  }
}

/** The project's page as the engine wrote it for the project. */
export const pagePath = (engineHome: string): string =>
  join(engineHome, 'out', PROJECT_ID, `${FEED}.html`)

/** What says which layout a project draws from, at one moment. */
export interface LayoutSnapshot {
  /** The record's layout id. */
  layout: string | null
  /** The record's `made`. */
  made: string | null
  /** Every stored layout of the feed, by id, with the `made` its meta says. */
  stored: Record<string, string | null>
}

export function layoutSnapshot(engineHome: string, projectId = PROJECT_ID): LayoutSnapshot {
  const record = JSON.parse(
    readFileSync(join(engineHome, 'projects', projectId, 'project.json'), 'utf8'),
  ) as Partial<ProjectRecord>
  const stored: Record<string, string | null> = {}
  for (const id of layoutsIn(graphs(engineHome))) stored[id] = madeOf(engineHome, id)
  return { layout: record.layout ?? null, made: record.made ?? null, stored }
}

/**
 * Every way two snapshots say the layout moved, as sentences; empty when it
 * did not. A different id in the record is a different layout. A different
 * `made` under the same id, or a stored set that appeared or went, is the
 * layout stages run again, which a render or an export must never do
 * (ADR-023, ADR-033).
 */
export function layoutDrift(before: LayoutSnapshot, after: LayoutSnapshot): string[] {
  const drift: string[] = []
  if (before.layout !== after.layout)
    drift.push(`the record's layout moved from ${before.layout} to ${after.layout}`)
  if (before.made !== after.made)
    drift.push(`the record's made moved from ${before.made} to ${after.made}`)
  if (after.layout !== null && !(after.layout in after.stored))
    drift.push(`the record names ${after.layout}, which is not stored`)
  const ids = new Set([...Object.keys(before.stored), ...Object.keys(after.stored)])
  for (const id of [...ids].sort()) {
    if (!(id in after.stored)) drift.push(`stored layout ${id} went`)
    else if (!(id in before.stored)) drift.push(`stored layout ${id} appeared`)
    else if (before.stored[id] !== after.stored[id])
      drift.push(`stored layout ${id} was made again (${before.stored[id]} to ${after.stored[id]})`)
  }
  return drift
}

/** The methods the engine received since the log began, in order; empty when nothing was logged. */
export function requestsReceived(engineHome: string): string[] {
  const file = requestsLog(engineHome)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '')
}
