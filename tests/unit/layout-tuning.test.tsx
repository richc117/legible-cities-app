// Cell 02's Layout tuning (issue 385, spec 033): what a layout run sends
// `graph.build` for a tuning, and what the section draws and does with what
// is typed. The wire form and the commit rules are pure (`layoutTuning.ts`);
// the markup is rendered to static markup, as the other cells' tests are.
//
// Each test was watched failing under a mutation of the rule it holds; the
// mutation is named beside it.

import { describe, expect, it } from 'vitest'
import { askedWith, layoutTuning, tuningParams } from '../../src/renderer/src/layoutTuning'
import { DEFAULT_TUNING } from '../../src/shared/project'

describe('what graph.build is sent for a tuning', () => {
  it('is nothing at all for a project that never tuned, or tuned to LOOM’s own', () => {
    // Mutation: `layoutTuning` answers `{}` for none - an untuned request
    // then carries an empty `tuning`, which no untuned project ever sent.
    expect(tuningParams(undefined)).toEqual({})
    expect(tuningParams({})).toEqual({})
    expect(tuningParams({ ...DEFAULT_TUNING })).toEqual({})
    expect(layoutTuning({})).toBeNull()
  })

  it('is the fields the record holds, in the engine’s names, the penalties in their own object', () => {
    expect(
      layoutTuning({
        mergeDistance: 80,
        grid: 'hexalinear',
        gridSize: 50,
        deg45: 3,
        deg90: 1.5,
        deg180: 1,
        diagonal: 0,
      }),
    ).toEqual({
      merge_distance: 80,
      grid: 'hexalinear',
      grid_size: 50,
      // 90° at LOOM's own 1.5 is no choice and is not sent.
      penalties: { deg45: 3, deg180: 1, diagonal: 0 },
    })
  })

  it('sends no penalties object where no penalty is held', () => {
    expect(layoutTuning({ grid: 'orthoradial' })).toEqual({ grid: 'orthoradial' })
    expect(tuningParams({ gridSize: 200 })).toEqual({ tuning: { grid_size: 200 } })
  })

  it('tells the store what was sent, in the record’s names, and nothing for none', () => {
    expect(askedWith({ grid: 'ortholinear', deg45: 2 })).toEqual({
      tuning: { grid: 'ortholinear' },
    })
    expect(askedWith(undefined)).toEqual({})
    expect(askedWith({ ...DEFAULT_TUNING })).toEqual({})
  })
})
