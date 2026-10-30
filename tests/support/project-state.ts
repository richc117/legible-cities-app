// The project screen's state as a test starts from it: one default, so a
// test names only what it changes and builds no `ProjectState` by hand
// (ADR-059, issue 433).
//
// Data and nothing else - no kit, no DOM - so a test that runs in Node and
// draws to static markup takes it as a rendered test does; `render.tsx`
// re-exports it for the tests that draw into a document.

import { createRef } from 'react'
import type { EngineState } from '../../src/shared/engine'
import { DEFAULT_COLOR, type ProjectRecord } from '../../src/shared/project/types'
import type { Inspection } from '../../src/shared/protocol'
import { ExportRun } from '../../src/renderer/src/engine/exportRun'
import type { LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import type { ProjectState } from '../../src/renderer/src/notebook/context'
import { StandInRun } from './stand-in-run'

export const READY: EngineState = { state: 'ready', version: '0.19.0', protocol: 1 }

/** A laid-out project of the LA Metro Rail feed, with nothing of its own chosen yet. */
export const BASE: ProjectRecord = {
  version: 2,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-12', anchor: '2026-09-08' },
  style: {},
  colors: {},
  defaultColor: DEFAULT_COLOR,
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

/** Three lines, A, B and C, one route each, A in the colour its feed publishes. */
export const INSPECTION = {
  key: 'la-metro-rail',
  name: 'LA Metro Rail',
  routes: ['A', 'B', 'C'].map((label) => ({
    route_id: label,
    agency_id: 'M',
    short_name: label,
    long_name: '',
    label,
    route_type: 1,
    color: label === 'A' ? '0072BC' : null,
    text_color: null,
    trips: 1,
  })),
  route_types: [
    { route_type: 1, name: 'subway', mode: 'subway', modes: ['subway'], routes: 3, trips: 3 },
  ],
} as unknown as Inspection

const inspected = Promise.resolve(INSPECTION)

/** Never answers: a request or a stage that is still on its way. */
export const pending = <T>(): Promise<T> => new Promise<T>(() => undefined)

export const nothing = (): void => undefined
export const unsubscribed = (): (() => void) => nothing

/**
 * An export that has not started, on a bridge that starts nothing: what an
 * idle project's screen holds.
 */
const idleExporter = (): ExportRun =>
  new ExportRun({
    run: () => ({ id: 'export-1', result: pending() }),
    cancel: async () => undefined,
    reveal: async () => undefined,
    onProgress: unsubscribed,
  })

/**
 * The project screen's state for an open, laid-out project with nothing
 * going: `BASE` read and writable, the engine `READY`, `run` idle, an idle
 * export, the feed's inspection answering the three lines at once, nothing
 * being read back, and every writer resolving.
 */
export function defaultProjectState(run: StandInRun = new StandInRun()): ProjectState {
  const exporter = idleExporter()
  return {
    project: { ...BASE, readOnly: false },
    error: null,
    engine: READY,
    run: run as unknown as LayoutRun,
    exporter,
    runSnapshot: run.snapshot,
    exportSnapshot: exporter.snapshot,
    outputs: { rows: null, read: nothing },
    layingOut: run.snapshot.state === 'running',
    exporting: false,
    settling: false,
    refused: null,
    drawn: 0,
    themeReloads: 0,
    pageSeams: nothing,
    redrawAsked: null,
    onOpen: null,
    openedSeams: null,
    registry: null,
    inspect: () => inspected,
    readStage: () => pending(),
    setInputs: async () => undefined,
    setDate: async () => undefined,
    setTheme: async () => undefined,
    setTuning: async () => undefined,
    setExport: async () => undefined,
    setName: async () => undefined,
    deleteProject: async () => undefined,
    headingRef: createRef(),
    skipPastMap: nothing,
  }
}
