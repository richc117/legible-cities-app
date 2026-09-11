// The Inspect view's own arithmetic: sorting what the engine sent,
// which types a mode keeps from the engine's mode per type, the modes
// offered, and the routes an agency keeps. No React.

import { describe, expect, it } from 'vitest'
import { keeps, modeOptions, routesOf, sortRoutes } from '../../src/renderer/src/Inspect'
import {
  feedRecordFor,
  forgetAllInspections,
  forgetFeedList,
  forgetInspection,
  inspectionFor,
} from '../../src/renderer/src/engine/inspections'
import type { FeedRecord } from '../../src/shared/protocol'
import type { Inspection, Route, RouteType } from '../../src/shared/protocol'

const route = (over: Partial<Route>): Route => ({
  route_id: 'r',
  agency_id: 'A',
  short_name: '',
  long_name: '',
  label: 'x',
  route_type: 0,
  color: null,
  text_color: null,
  trips: 0,
  ...over,
})
const TYPES: RouteType[] = [
  {
    route_type: 0,
    name: 'tram',
    mode: 'tram',
    modes: ['tram', 'streetcar'],
    routes: 4,
    trips: 830,
  },
  {
    route_type: 1,
    name: 'subway',
    mode: 'subway',
    modes: ['subway', 'metro'],
    routes: 2,
    trips: 330,
  },
  { route_type: 99, name: 'type 99', mode: null, modes: [], routes: 1, trips: 1 },
]

describe('sortRoutes', () => {
  const routes = [
    route({ route_id: 'a', label: '10', route_type: 1, trips: 5 }),
    route({ route_id: 'b', label: '2', route_type: 0, trips: 50 }),
    route({ route_id: 'c', label: 'A', route_type: 0, trips: 5 }),
  ]
  it('sorts labels as a person reads numbers, types by code, trips by count', () => {
    expect(sortRoutes(routes, 'label', false).map((r) => r.label)).toEqual(['2', '10', 'A'])
    expect(sortRoutes(routes, 'type', false).map((r) => r.route_id)).toEqual(['b', 'c', 'a'])
    expect(sortRoutes(routes, 'trips', true).map((r) => r.route_id)).toEqual(['b', 'a', 'c'])
  })
  it("keeps the engine's order on a tie and leaves the input alone", () => {
    const sorted = sortRoutes(routes, 'trips', false)
    expect(sorted.map((r) => r.route_id)).toEqual(['a', 'c', 'b'])
    expect(routes.map((r) => r.route_id)).toEqual(['a', 'b', 'c'])
  })
})

describe('keeps', () => {
  it("reads the engine's mode per type: all keeps every type, a name its own, a number its code", () => {
    expect(TYPES.map((t) => keeps('all', t))).toEqual([true, true, true])
    expect(TYPES.map((t) => keeps('tram', t))).toEqual([true, false, false])
    expect(TYPES.map((t) => keeps('tram,subway', t))).toEqual([true, true, false])
    // The engine's aliases keep too: gtfs2graph takes metro for subway.
    expect(TYPES.map((t) => keeps('metro', t))).toEqual([false, true, false])
    expect(TYPES.map((t) => keeps('streetcar,metro', t))).toEqual([true, true, false])
    expect(TYPES.map((t) => keeps('99', t))).toEqual([false, false, true])
    expect(TYPES.map((t) => keeps('rail', t))).toEqual([false, false, false])
  })
})

describe('modeOptions and routesOf', () => {
  it("offers all, the engine's modes once each, and the record's own if it is neither", () => {
    expect(modeOptions(TYPES, 'all')).toEqual(['all', 'tram', 'subway'])
    expect(modeOptions(TYPES, 'tram,subway')).toEqual(['all', 'tram', 'subway', 'tram,subway'])
    expect(modeOptions([], '3')).toEqual(['all', '3'])
  })
  it("keeps every route for no agency and one operator's otherwise", () => {
    const routes = [
      route({ route_id: 'a', agency_id: 'M' }),
      route({ route_id: 'b', agency_id: 'S' }),
    ]
    expect(routesOf(routes, null).map((r) => r.route_id)).toEqual(['a', 'b'])
    expect(routesOf(routes, 'S').map((r) => r.route_id)).toEqual(['b'])
  })
})

describe('the inspection cache', () => {
  const inspection = { key: 'la', name: 'LA' } as Inspection
  it('asks once per feed, forgets a refusal, and can be told to forget', async () => {
    forgetAllInspections()
    let asked = 0
    const client = {
      request: (_m: 'feeds.inspect', params: { key: string }) => {
        asked += 1
        return {
          result:
            params.key === 'bad'
              ? Promise.reject(new Error('no'))
              : Promise.resolve({ ...inspection, key: params.key }),
        }
      },
    }
    expect((await inspectionFor(client, 'la', '2026-09-11')).key).toBe('la')
    expect((await inspectionFor(client, 'la', '2026-09-11')).key).toBe('la')
    expect(asked).toBe(1)
    await expect(inspectionFor(client, 'bad', '2026-09-11')).rejects.toThrow('no')
    await new Promise((r) => setTimeout(r, 0))
    await expect(inspectionFor(client, 'bad', '2026-09-11')).rejects.toThrow('no')
    expect(asked).toBe(3)
    forgetAllInspections()
    await inspectionFor(client, 'la', '2026-09-11')
    expect(asked).toBe(4)
  })
})

describe('forgetting one feed, and the feed list', () => {
  it('forgets every day of one feed and no other', async () => {
    forgetAllInspections()
    let asked = 0
    const client = {
      request: (_m: 'feeds.inspect', params: { key: string }) => {
        asked += 1
        return { result: Promise.resolve({ key: params.key } as Inspection) }
      },
    }
    await inspectionFor(client, 'la', '2026-09-11')
    await inspectionFor(client, 'la', '2026-09-12')
    await inspectionFor(client, 'la-metro', '2026-09-11')
    expect(asked).toBe(3)
    forgetInspection('la')
    await inspectionFor(client, 'la-metro', '2026-09-11')
    expect(asked, 'the other feed is still held').toBe(3)
    await inspectionFor(client, 'la', '2026-09-11')
    await inspectionFor(client, 'la', '2026-09-12')
    expect(asked).toBe(5)
  })

  it('reads the feed list once, forgets it on demand, and does not keep a refusal', async () => {
    forgetAllInspections()
    let asked = 0
    let refuse = true
    const client = {
      request: () => {
        asked += 1
        return {
          result: refuse
            ? Promise.reject(new Error('away'))
            : Promise.resolve({ feeds: [{ key: 'la', mode: 'all' } as FeedRecord] }),
        }
      },
    }
    await expect(feedRecordFor(client, 'la')).rejects.toThrow('away')
    await new Promise((r) => setTimeout(r, 0))
    refuse = false
    expect((await feedRecordFor(client, 'la'))?.mode).toBe('all')
    expect(await feedRecordFor(client, 'nope')).toBeNull()
    expect(asked).toBe(2)
    forgetFeedList()
    await feedRecordFor(client, 'la')
    expect(asked).toBe(3)
  })
})
