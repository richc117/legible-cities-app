// The words cell 02 draws over the engine's eight stages (A5.5-10), and the
// sentence the cell carries while it is collapsed.
//
// The table is held to the engine's own list here rather than only by its
// type, because the type would be satisfied by a table built at run time
// and this is the test the issue asks for: a stage added to the pipeline
// fails here rather than vanishing from the screen.

import { describe, expect, it } from 'vitest'
import { waiting } from '../../src/renderer/src/LayoutRun'
import { processSummary } from '../../src/renderer/src/notebook/cells/ProcessCell'
import type { Stage } from '../../src/renderer/src/ProgressLine'
import { STAGE_WORDS, inWords, stageWord } from '../../src/renderer/src/stages'
import { LAYOUT_STAGES } from '../../src/shared/layout'

describe('the stage table', () => {
  it('has a word for every stage the engine reports, and for nothing else', () => {
    // Both directions: a stage the engine gained and nobody named would
    // leave the screen with a station it cannot label, and a word for a
    // stage the engine no longer runs would be a step that never happens.
    expect(Object.keys(STAGE_WORDS)).toEqual([...LAYOUT_STAGES])
  })

  it("is eight stages, the engine's own count", () => {
    expect(LAYOUT_STAGES).toHaveLength(8)
    expect(Object.keys(STAGE_WORDS)).toHaveLength(8)
  })

  it('says something, and something different, for each of them', () => {
    const words = Object.values(STAGE_WORDS)
    for (const word of words) expect(word.trim()).not.toBe('')
    expect(new Set(words).size, 'two stages sharing a word would read as one').toBe(words.length)
  })

  it("draws the wireframes' words where the engine reports the work", () => {
    // The words are a presentation choice, so they are written down once:
    // a change to any of them is a change to what a person reads and shows
    // up here rather than in a screenshot.
    expect(STAGE_WORDS).toEqual({
      gtfs2graph: 'parse',
      topo: 'collapse',
      loom: 'order',
      octi: 'octilinear',
      schedule: 'trips',
      render: 'draw',
      animate: 'animate',
      write: 'write',
    })
  })

  it('answers a name it has never heard rather than nothing', () => {
    // A backstop, not a behaviour a person can reach: `advance` drops a
    // report whose stage is not among the fresh eight, so an unknown stage
    // cannot get this far in the app as it stands. What is asserted is that
    // the lookup is total - it answers a string for any input - because the
    // alternative is a station drawn with no name at all.
    expect(stageWord('gtfs2graph')).toBe('parse')
    expect(stageWord('quantise')).toBe('quantise')
  })

  it('is not fooled by a name every object answers to', () => {
    // `'toString' in STAGE_WORDS` is true of every object, and a stage so
    // named would otherwise be drawn as a function.
    expect(stageWord('toString')).toBe('toString')
    expect(stageWord('constructor')).toBe('constructor')
  })
})

describe("a run's stages in those words", () => {
  const stages: Stage[] = [
    { id: 'gtfs2graph', label: 'gtfs2graph', state: 'done' },
    { id: 'topo', label: 'topo', state: 'running', message: 'topo: 111 nodes, 113 edges' },
    { id: 'loom', label: 'loom', state: 'pending' },
  ]

  it('renames the labels and moves nothing else', () => {
    expect(inWords(stages)).toEqual([
      { id: 'gtfs2graph', label: 'parse', state: 'done' },
      { id: 'topo', label: 'collapse', state: 'running', message: 'topo: 111 nodes, 113 edges' },
      { id: 'loom', label: 'order', state: 'pending' },
    ])
  })

  it("leaves the run's own stages alone", () => {
    // The snapshot is what the jobs inspector reports from and what the
    // record of a run is read beside; the words are put on at the screen.
    const before = JSON.stringify(stages)
    inWords(stages)
    expect(JSON.stringify(stages)).toBe(before)
  })

  it('names the resting line for a screen reader, which meets stations and no run', () => {
    // The other sentences of the run's panel are tested beside the run
    // itself (`tests/unit/layout-run.test.ts`); this one belongs to the
    // stages a cell draws while no run is going.
    expect(waiting(stages, false)).toBe("The layout run's 3 stages, none started.")
  })

  it('does not tell a project laid out last week that nothing has started', () => {
    // The stations are pending either way - a run is a session's - but the
    // sentence beside this line says which layout the map was drawn from,
    // and "none started" would contradict it.
    expect(waiting(stages, true)).toBe("The layout run's 3 stages.")
  })
})

describe('what cell 02 says while it is collapsed', () => {
  const project = (
    over: { layout?: string | null; made?: string | null } = {},
  ): { layout: string | null; made: string | null } => ({ layout: null, made: null, ...over })

  it('says nothing at all before the record has been read', () => {
    expect(processSummary(null)).toBeNull()
  })

  it('says a project has not been laid out, rather than nothing', () => {
    expect(processSummary(project())).toBe('not laid out yet')
  })

  it('names the layout by the eight characters a screen shows', () => {
    expect(processSummary(project({ layout: 'a'.repeat(64) }))).toBe('aaaaaaaa')
  })

  it("names when the engine made it, in the reader's own locale", () => {
    const made = '2026-09-12T10:03:00.000Z'
    expect(processSummary(project({ layout: 'b'.repeat(64), made }))).toBe(
      `bbbbbbbb, made ${new Date(made).toLocaleString()}`,
    )
  })

  it('shows a moment it cannot read as the record wrote it', () => {
    // `Time` does the same: a record whose value is not a date is shown
    // rather than shown as "Invalid Date".
    expect(processSummary(project({ layout: 'c'.repeat(64), made: 'the day before' }))).toBe(
      'cccccccc, made the day before',
    )
  })
})
