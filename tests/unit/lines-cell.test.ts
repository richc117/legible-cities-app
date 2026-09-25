// The sentence cell 05 carries while it is collapsed (A5.5-18): how many
// lines carry a colour of their own, whether the default has moved, and
// whether the lines are drawn in an order a person chose.
//
// It is a pure function beside its cell, as cell 01's is, so a project with
// one override, with a default of its own and with an order that was moved
// and put back is a table here rather than three states of a running app.

import { describe, expect, it } from 'vitest'
import { linesSummary } from '../../src/renderer/src/notebook/cells/LinesCell'
import { DEFAULT_COLOR } from '../../src/shared/project'

type Lines = Parameters<typeof linesSummary>[0]

const project = (over: Partial<Lines> = {}): Lines => ({
  layout: 'la-metro-rail-4f2a',
  colors: {},
  defaultColor: DEFAULT_COLOR,
  lineOrder: [],
  ...over,
})

describe('what cell 05 says while it is collapsed', () => {
  it('says nothing at all before the project has been laid out', () => {
    // The cell itself says the lines arrive with the map; a count of
    // overrides on a project with no lines yet describes nothing.
    expect(linesSummary(project({ layout: null }))).toBeNull()
  })

  it('names no override and the engine’s own order', () => {
    expect(linesSummary(project())).toBe('no line recoloured, alphabetical order')
  })

  it('counts the lines that carry a colour of their own', () => {
    expect(linesSummary(project({ colors: { A: '#ff0000' } }))).toBe(
      '1 line recoloured, alphabetical order',
    )
    expect(linesSummary(project({ colors: { A: '#ff0000', B: '#00ff00' } }))).toBe(
      '2 lines recoloured, alphabetical order',
    )
  })

  it('says when the order has moved from the engine’s', () => {
    // A non-empty `lineOrder` is exactly an order a person chose: a move
    // undone stores nothing at all, because that is the engine's own order
    // (A4-02).
    expect(linesSummary(project({ lineOrder: ['B', 'A'] }))).toBe(
      'no line recoloured, an order you chose',
    )
    expect(linesSummary(project({ lineOrder: [] }))).toContain('alphabetical order')
  })

  it('says when the colour for the lines the feed leaves blank has moved', () => {
    // It is chosen in this cell too, so a summary that named only the
    // overrides would be silent about a change made in the cell it
    // describes.
    expect(linesSummary(project({ defaultColor: '#123456' }))).toBe(
      'no line recoloured, a default of your own, alphabetical order',
    )
    expect(linesSummary(project({ defaultColor: DEFAULT_COLOR }))).not.toContain('default')
  })

  it('names everything at once', () => {
    expect(
      linesSummary(
        project({ colors: { A: '#ff0000' }, defaultColor: '#123456', lineOrder: ['B', 'A'] }),
      ),
    ).toBe('1 line recoloured, a default of your own, an order you chose')
  })

  it('counts a line whose label is a property of every object', () => {
    // A feed's labels are not ours to choose, and `Object.keys` answers the
    // record's own keys rather than the prototype chain's, which is the
    // rule `hasOverride` keeps in `colours.ts`.
    expect(linesSummary(project({ colors: { toString: '#ff0000' } }))).toBe(
      '1 line recoloured, alphabetical order',
    )
  })
})
