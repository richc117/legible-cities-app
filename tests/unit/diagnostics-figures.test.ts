import { describe, expect, it } from 'vitest'
import { figuresToShow } from '../../src/renderer/src/Diagnostics'
import type { RunReport } from '../../src/renderer/src/engine/layoutRun'

const drawn = { date: 'a' } as unknown as RunReport
const fresh = { date: 'b' } as unknown as RunReport
const run = (
  state: 'idle' | 'running' | 'done' | 'cancelled' | 'failed',
  report: RunReport | null,
  kind: { recoloured?: boolean; reordered?: boolean } = {},
) => ({ state, report, recoloured: false, reordered: false, ...kind })

describe('which figures the diagnostics panel draws (issue 304)', () => {
  it('keeps the last figures through a redraw for colours or order', () => {
    expect(figuresToShow(drawn, run('running', null, { recoloured: true }))).toBe(drawn)
    expect(figuresToShow(drawn, run('running', null, { reordered: true }))).toBe(drawn)
  })
  it('takes the redraw’s own figures when they arrive', () => {
    expect(figuresToShow(drawn, run('done', fresh, { recoloured: true }))).toBe(fresh)
  })
  it('drops them when the redraw was cancelled or failed', () => {
    expect(figuresToShow(drawn, run('cancelled', null, { recoloured: true }))).toBeNull()
    expect(figuresToShow(drawn, run('failed', null, { reordered: true }))).toBeNull()
  })
  it('does not add a panel that was not there', () => {
    expect(figuresToShow(null, run('running', null, { recoloured: true }))).toBeNull()
    expect(figuresToShow(null, run('done', fresh, { recoloured: true }))).toBeNull()
  })
  it('clears at the start of any other run and draws that run’s own report', () => {
    expect(figuresToShow(drawn, run('running', null))).toBeNull()
    expect(figuresToShow(null, run('done', fresh))).toBe(fresh)
  })
})
