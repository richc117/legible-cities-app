// The progress line's stations per state, the quarter-circle bend it turns
// on, how far along the rail a run has got, its accessible name, and that no
// colour is written into it: colours are classes the stylesheet maps.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgressLine, { type Stage } from '../../src/renderer/src/ProgressLine'

const stages = (states: Stage['state'][]): Stage[] =>
  ['gtfs2graph', 'topo', 'loom', 'octi'].map((label, i) => ({
    id: label,
    label,
    state: states[i],
    message:
      states[i] === 'running'
        ? `${label}: running`
        : states[i] === 'failed'
          ? `${label} failed`
          : undefined,
  }))

/** The dash the rail is cut with: how much of it the run has not covered. */
const offset = (html: string): number => Number(/stroke-dashoffset:([\d.]+)/.exec(html)?.[1] ?? NaN)

describe('ProgressLine', () => {
  it('draws a station per stage, shaped by its state', () => {
    const html = renderToStaticMarkup(
      <ProgressLine
        stages={stages(['done', 'running', 'failed', 'pending'])}
        ariaLabel="Four stages"
      />,
    )
    expect(html).toContain('class="mark mark-done"')
    expect(html).toContain('class="mark mark-running"')
    expect(html).toContain('class="mark mark-failed"')
    expect(html).toContain('class="mark mark-pending"')
    // The core only a failed station shows: every station carries one, so a
    // change of state transitions rather than an element appearing.
    expect(html.match(/class="core core-\w+"/g)).toHaveLength(4)
    expect(html).toContain('class="core core-failed"')
    expect(html).toContain('role="img" aria-label="Four stages"')
    expect(html).toContain('topo: running')
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(html).not.toMatch(/\d+px/)
  })

  it('draws round stations, and no square tick or turned diamond', () => {
    const html = renderToStaticMarkup(
      <ProgressLine stages={stages(['done', 'running', 'pending', 'pending'])} ariaLabel="x" />,
    )
    expect(html).not.toContain('<rect')
    expect(html).not.toContain('rotate(')
    expect(html.match(/<circle[^>]*class="mark /g)).toHaveLength(4)
    // Every station is the same circle; only its class differs.
    for (const cx of [16, 112, 208, 304]) expect(html).toContain(`cx="${cx}" cy="16" r="5"`)
  })

  it('turns onto the line on a quarter-circle bend, not a 45-degree join', () => {
    const html = renderToStaticMarkup(
      <ProgressLine stages={stages(['pending', 'pending', 'pending', 'pending'])} ariaLabel="x" />,
    )
    // In from the left below the line, up, then one arc of radius 3, which
    // is the rail's own weight in app.css: that is what makes the bend's
    // inner radius a third of its outer.
    expect(html).toContain('d="M 0,24 V 19 A 3,3 0 0 1 3,16 H 304"')
    // Twice: the rail, and the length of it the run has covered.
    expect(html.match(/A 3,3 0 0 1/g)).toHaveLength(2)
    expect(html).not.toContain('<polyline')
    for (const label of ['gtfs2graph', 'topo', 'loom', 'octi'])
      expect(html).toContain(`>${label}</text>`)
    expect(html).not.toContain('progress-message')
  })

  it('reaches as far as the run has got', () => {
    const none = renderToStaticMarkup(
      <ProgressLine stages={stages(['pending', 'pending', 'pending', 'pending'])} ariaLabel="x" />,
    )
    const middle = renderToStaticMarkup(
      <ProgressLine stages={stages(['done', 'running', 'pending', 'pending'])} ariaLabel="x" />,
    )
    const failed = renderToStaticMarkup(
      <ProgressLine stages={stages(['done', 'done', 'failed', 'pending'])} ariaLabel="x" />,
    )
    const all = renderToStaticMarkup(
      <ProgressLine stages={stages(['done', 'done', 'done', 'done'])} ariaLabel="x" />,
    )
    // Nothing started leaves the whole rail uncovered; every stage finished
    // covers it; a run part way covers part of it, and a failed stage is as
    // far as its run got.
    expect(offset(none)).toBe(100)
    expect(offset(all)).toBe(0)
    expect(offset(middle)).toBeLessThan(100)
    expect(offset(middle)).toBeGreaterThan(offset(failed))
    expect(offset(failed)).toBeGreaterThan(0)
    expect(none).toContain('pathLength="100"')
  })

  it('draws every stage count a run has, from one to eight', () => {
    // The layout run has eight stages, the export three and a feed add two.
    for (let n = 1; n <= 8; n++) {
      const some: Stage[] = Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        label: `s${i}`,
        state: i === n - 1 ? 'running' : 'done',
      }))
      const html = renderToStaticMarkup(<ProgressLine stages={some} ariaLabel={`${n} stages`} />)
      expect(html.match(/<circle[^>]*class="mark /g)).toHaveLength(n)
      expect(html).toContain(`H ${16 + (n - 1) * 96}"`)
      // The rail always reaches the last station, which is the running one.
      expect(offset(html)).toBe(0)
    }
  })
})
