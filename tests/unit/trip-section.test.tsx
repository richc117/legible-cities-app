// Cell 03's Trip section, drawn (issue 272, spec 030 US1 scenario 1, FR-001,
// FR-002, FR-011): the third section of the cell, a region named by its `h3`
// "Trip" alone, holding a combobox "Start" and a combobox "End", with no
// pressed or disabled control; before a layout one sentence and no control;
// over a record that kept no stations, the pickers and a sentence.
//
// Rendered to static markup and drawn open, as `frame-cell.test.tsx` draws
// the cell. What the section does when a person uses it is the pure modules'
// (`trip-state.test.ts`, `trip-words.test.ts`) and the end-to-end suite's
// (`tests/e2e/trip.spec.ts`); the transport draws nothing here, because it
// waits for a page that has said what day it has.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { freshStages, type LayoutRun } from '../../src/renderer/src/engine/layoutRun'
import FrameCell from '../../src/renderer/src/notebook/cells/FrameCell'
import { ProjectProvider } from '../../src/renderer/src/notebook/context'
import type { ProjectState } from '../../src/renderer/src/notebook/useProjectState'
import { DRAW_AGAIN, NOT_LAID_OUT, TRIP_INTRO } from '../../src/renderer/src/tripWords'
import { CELL_LIST, type Cell } from '../../src/renderer/src/runGraph'
import { DEFAULT_STYLE, drawnFrom, type ProjectRecord } from '../../src/shared/project'
import type { Station } from '../../src/shared/trip'

const CELL = CELL_LIST.find((cell) => cell.id === 'frame') as Cell

const STATIONS: Station[] = [
  { id: '0x6000036f4a40', name: 'Alpha' },
  { id: '0x6000036f4c80', name: 'Bravo' },
  { id: '0x6000036f4010', name: 'Charlie' },
]

const base: ProjectRecord = {
  version: 2,
  id: 'kq7x2mzp4dna',
  name: 'Los Angeles',
  feed: 'la-metro-rail',
  mode: 'all',
  agency: null,
  date: '2026-09-12',
  service: { start: '2026-01-01', end: '2026-12-31', busiest: '2026-09-15', anchor: '2026-09-08' },
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

/** Laid out, its map drawn with the stand-in engine's three stations. */
const drawn: ProjectRecord = {
  ...base,
  drawn: { ...(drawnFrom(base) as NonNullable<ProjectRecord['drawn']>), stations: STATIONS },
}

/** Never laid out. */
const fresh: ProjectRecord = {
  ...base,
  date: null,
  service: null,
  layout: null,
  made: null,
  built: null,
}

const idle = {
  job: () => null,
  subscribe: () => () => undefined,
  snapshot: { state: 'idle', stages: freshStages(), message: null, error: null, report: null },
} as unknown as LayoutRun

function draw(project: ProjectRecord, { readOnly = false } = {}): string {
  const state = {
    project: { ...project, readOnly },
    engine: null,
    run: idle,
    runSnapshot: idle.snapshot,
    setDate: async () => {},
    exporting: false,
    layingOut: false,
    drawn: 0,
  } as unknown as ProjectState
  return renderToStaticMarkup(
    <ProjectProvider value={state}>
      <FrameCell cell={CELL} state="ready" open={true} onToggle={() => {}} />
    </ProjectProvider>,
  )
}

/** The Trip section's own markup, from its opening tag to its close. */
function section(html: string): string {
  const at = html.indexOf('<section class="trip"')
  expect(at, 'there is a Trip section').toBeGreaterThan(-1)
  const end = html.indexOf('</section>', at)
  // The section holds no section of its own, so its first close is its own.
  return html.slice(at, end + '</section>'.length)
}

describe("cell 03's Trip section", () => {
  it('is a region named by its h3 "Trip" alone, after the day and the frame’s sentence', () => {
    const html = draw(drawn)
    const trip = section(html)
    const open = /^<section[^>]*>/.exec(trip)?.[0] ?? ''
    const labelledBy = /aria-labelledby="([^"]+)"/.exec(open)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(trip).toContain(`<h3 id="${labelledBy}">Trip</h3>`)
    // Named by the heading and nothing else (FR-002): a label as well would
    // be said twice on the way in.
    expect(open).not.toContain('aria-label=')
    expect(open).not.toContain('role=')
    // The third section: after the service day and the frame's sentence.
    expect(html.indexOf('<section class="trip"')).toBeGreaterThan(
      html.indexOf('<section class="service-day"'),
    )
    const frameSentence = html.indexOf('never cropped or rotated')
    expect(frameSentence).toBeGreaterThan(-1)
    expect(html.indexOf('<section class="trip"')).toBeGreaterThan(frameSentence)
  })

  it('holds a combobox Start and a combobox End, and no pressed or disabled control', () => {
    const trip = section(draw(drawn))
    const fields = [...trip.matchAll(/<input[^>]*>/g)].map((m) => m[0])
    expect(fields).toHaveLength(2)
    for (const field of fields) expect(field).toContain('role="combobox"')
    const labels = [...trip.matchAll(/<label[^>]*>([^<]*)<\/label>/g)].map((m) => m[1])
    expect(labels).toEqual(['Start', 'End'])
    expect(trip).not.toMatch(/\sdisabled(=|\s|>)/)
    expect(trip).not.toContain('aria-pressed')
    expect(trip).not.toContain('aria-disabled')
    expect(trip).toContain(TRIP_INTRO)
    // No trip yet, so no steps, and no button to clear one.
    expect(trip).not.toContain('<ol')
    expect(trip).not.toContain('Show the whole network')
  })

  it('offers the trip to a project this version may not write, as it offers the transport', () => {
    const trip = section(draw(drawn, { readOnly: true }))
    expect([...trip.matchAll(/role="combobox"/g)]).toHaveLength(2)
  })

  it('says to lay the project out, and draws no control, before there is a layout', () => {
    const trip = section(draw(fresh))
    expect(trip).toContain(`<p class="prose">${NOT_LAID_OUT}</p>`)
    expect(trip).not.toContain('<input')
    expect(trip).not.toContain('fig-button')
  })

  it('says to draw the map again over a record that kept no stations, and disables nothing', () => {
    for (const project of [
      { ...base, drawn: drawnFrom(base) },
      { ...base, drawn: null },
    ]) {
      const trip = section(draw(project))
      expect(trip).toContain(`<p class="prose">${DRAW_AGAIN}</p>`)
      expect([...trip.matchAll(/role="combobox"/g)]).toHaveLength(2)
      expect(trip).not.toMatch(/\sdisabled(=|\s|>)/)
    }
    // With its stations, it does not.
    expect(section(draw(drawn))).not.toContain(DRAW_AGAIN)
  })
})
