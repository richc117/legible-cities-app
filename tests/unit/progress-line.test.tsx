// The progress line's stations per state, the quarter-circle bend it turns
// on, how far along the rail a run has got, its accessible name, and that no
// colour is written into it: colours are classes the stylesheet maps. Two of
// these read app.css, as tests/unit/tokens.test.ts reads a stylesheet: the
// drawing is half there, and what the document promises about it - a bend's
// proportions, and four states no two of which differ by colour alone -
// cannot be seen in either file alone.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgressLine, { type Stage } from '../../src/renderer/src/ProgressLine'

const css = readFileSync(resolve(__dirname, '../../src/renderer/src/styles/app.css'), 'utf8')

/** The declarations of one rule, as a map, or null when there is no such
 * rule; comments are taken out. */
function find(selector: string): Record<string, string> | null {
  const at = css.indexOf(`\n${selector} {`)
  if (at === -1) return null
  const body = css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
  const out: Record<string, string> = {}
  for (const part of body.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const [name, ...value] = part.split(':')
    if (value.length) out[name.trim()] = value.join(':').replace(/\s+/g, ' ').trim()
  }
  return out
}

/** The same, for a rule the drawing cannot do without. */
function rule(selector: string): Record<string, string> {
  const found = find(selector)
  expect(found, `${selector} is not in app.css`).not.toBeNull()
  return found ?? {}
}

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
    // In from the left below the line, up, then one arc.
    expect(html).toContain('d="M 0,24 V 19 A 3,3 0 0 1 3,16 H 304"')
    // Twice: the rail, and the length of it the run has covered.
    expect(html.match(/A 3,3 0 0 1/g)).toHaveLength(2)
    expect(html).not.toContain('<polyline')
    for (const label of ['gtfs2graph', 'topo', 'loom', 'octi'])
      expect(html).toContain(`>${label}</text>`)
    expect(html).not.toContain('progress-message')
  })

  it("draws the bend's inner radius a third of its outer, whatever the weight", () => {
    const html = renderToStaticMarkup(
      <ProgressLine stages={stages(['done', 'running', 'pending', 'pending'])} ariaLabel="x" />,
    )
    // Section 10's rule holds exactly when the bend's centreline radius is
    // the line's own weight, so the drawing sets both from one constant. A
    // weight drawn from somewhere else would break the ratio in silence, so
    // this reads the weight back off every stroke the component draws.
    const arc = / A (\d+(?:\.\d+)?),(\d+(?:\.\d+)?) /.exec(html)
    const radius = Number(arc?.[1])
    expect(radius).toBeGreaterThan(0)
    // A quarter-circle, so the two radii are one radius.
    expect(Number(arc?.[2])).toBe(radius)
    const weights = [...html.matchAll(/stroke-width="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]))
    expect(weights.length).toBeGreaterThan(0)
    for (const weight of weights) {
      expect(weight).toBe(radius)
      expect(radius + weight / 2).toBe(3 * (radius - weight / 2))
    }
    // And the stylesheet must not set a width of its own: a rule there beats
    // the attribute, and the ratio would go without this file being touched.
    expect(rule('.progress .line')['stroke-width']).toBeUndefined()
    expect(rule('.progress .mark')['stroke-width']).toBeUndefined()
  })

  it('tells its four states apart by shape, not by colour', () => {
    // A state's shape is whether the station carries a ring, how big the
    // station is drawn, and whether its core shows: three things none of
    // which is a colour. All four states differ in at least one of them, so
    // the line still reads where a colour does not (DESIGN.md section 8.2).
    const mark = rule('.progress .mark')
    const core = rule('.progress .core')
    // A ring arrives by transitioning from this, so it must be a colour:
    // `none` does not interpolate and the ring would pop into place.
    expect(mark.stroke).toBe('transparent')
    expect(core.transform).toBe('scale(0)')
    const shape = (state: string): string => {
      const own = rule(`.progress .mark-${state}`)
      return JSON.stringify({
        ringed: (own.stroke ?? mark.stroke) !== 'transparent',
        size: own.transform ?? mark.transform ?? 'scale(1)',
        core: find(`.progress .core-${state}`)?.transform ?? core.transform,
      })
    }
    const shapes = ['pending', 'done', 'running', 'failed'].map(shape)
    expect(new Set(shapes).size).toBe(4)
    expect(JSON.parse(shape('pending')).size).not.toBe('scale(1)')
    expect(JSON.parse(shape('done')).ringed).toBe(false)
    expect(JSON.parse(shape('running')).ringed).toBe(true)
    expect(JSON.parse(shape('running')).core).toBe('scale(0)')
    expect(JSON.parse(shape('failed')).ringed).toBe(true)
    expect(JSON.parse(shape('failed')).core).not.toBe('scale(0)')
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
    // The layout run has eight stages, the export three and a feed add two,
    // and each of them can run to the end, fail at the first stage or fail
    // at the last.
    const run = (n: number, at: number, how: Stage['state']): string => {
      const some: Stage[] = Array.from({ length: n }, (_, i) => ({
        id: `s${i}`,
        label: `s${i}`,
        state: i < at ? 'done' : i === at ? how : 'pending',
      }))
      return renderToStaticMarkup(<ProgressLine stages={some} ariaLabel={`${n} stages`} />)
    }
    for (let n = 1; n <= 8; n++) {
      const running = run(n, n - 1, 'running')
      const early = run(n, 0, 'failed')
      const late = run(n, n - 1, 'failed')
      for (const html of [running, early, late]) {
        expect(html.match(/<circle[^>]*class="mark /g)).toHaveLength(n)
        expect(html.match(/<circle[^>]*class="core /g)).toHaveLength(n)
        expect(html).toContain(`H ${16 + (n - 1) * 96}"`)
      }
      expect(early.match(/class="mark mark-failed"/g)).toHaveLength(1)
      expect(late.match(/class="mark mark-failed"/g)).toHaveLength(1)
      // The rail reaches the last station when the run got there, however it
      // ended, and stops at the first when that is where it failed.
      expect(offset(running)).toBe(0)
      expect(offset(late)).toBe(0)
      if (n === 1) {
        expect(offset(early)).toBe(0)
      } else {
        expect(offset(early)).toBeGreaterThan(0)
        expect(offset(early)).toBeLessThan(100)
      }
    }
  })
})
