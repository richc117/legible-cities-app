// The progress line's marks per state, its accessible name, and that no
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

describe('ProgressLine', () => {
  it('draws a tick, a filled tick, a hollow diamond and a failed diamond', () => {
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
    expect(html).toContain('role="img" aria-label="Four stages"')
    expect(html).toContain('topo: running')
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(html).not.toMatch(/\d+px/)
  })
  it('begins with the 45-degree lead-in and labels every stage', () => {
    const html = renderToStaticMarkup(
      <ProgressLine stages={stages(['pending', 'pending', 'pending', 'pending'])} ariaLabel="x" />,
    )
    expect(html).toMatch(/points="0,24 8,16 /)
    for (const label of ['gtfs2graph', 'topo', 'loom', 'octi'])
      expect(html).toContain(`>${label}</text>`)
    expect(html).not.toContain('progress-message')
  })
})
