// The export run's region is named for the run (issue 258): "Export run",
// as cell 02's is "Layout run".
//
// The rule is one sentence: a run's region is a noun naming the run, its
// controls are verbs, and no region shares its name with a control inside
// it. The region was named "Export" around a button named "Export", which a
// screen reader reads as one name for where a person is and what they can
// do there. The sweep's rule for a name said twice (`a11y-names.ts`, issue
// 208) found it, and `tests/e2e/notebook-a11y.spec.ts` shows that rule the
// live screen; what that cannot do is run without the application. This
// does, over what the component itself draws.
//
// Rendered to static markup, as the notebook's other component tests are,
// against a run that is a plain object in the state under test. The names
// read out of the markup are the region's `aria-label` and the text of each
// button inside it, which is how Playwright names a button that has no
// label of its own; they are handed to the sweep's own rule, with no pair
// excused, as the snapshot's text it reads.

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ExportRun from '../../src/renderer/src/ExportRun'
import { freshStages } from '../../src/renderer/src/engine/exportRun'
import type { RunState } from '../../src/shared/layout'
import { describePair, duplicatedNames } from '../support/a11y-names'

/** The export run in one state, drawn as the cell draws it. */
function draw(state: RunState): string {
  const run = {
    snapshot: {
      state,
      stages: freshStages(),
      message: null,
      error: null,
      file: 'la-metro-rail.mp4',
      left: false,
    },
    subscribe: () => () => undefined,
    start: () => undefined,
    cancel: () => undefined,
    reveal: () => undefined,
  }
  return renderToStaticMarkup(
    <ExportRun
      run={run as never}
      project={{} as never}
      engine={null}
      choice={{ preset: 'instagram-reel', options: {} }}
    />,
  )
}

/** The region's name, or null where the run draws no region. */
const regionOf = (html: string): string | null =>
  /<section class="export-run" aria-label="([^"]*)">/.exec(html)?.[1] ?? null

/** What each button says, in order: the text after its icon. */
const buttonsOf = (html: string): string[] =>
  [...html.matchAll(/<fig-button\b[^>]*>(.*?)<\/fig-button>/g)].map((match) =>
    match[1].replace(/<span class="icon"[\s\S]*?<\/span>/, ''),
  )

// What a state draws inside the region, which is what the region's name must
// not be: Cancel while it runs; and once it has ended Export again, with
// Reveal before it when a file was written.
const STATES: [RunState, string[]][] = [
  ['running', ['Cancel']],
  ['done', ['Reveal', 'Export']],
  ['failed', ['Export']],
  ['cancelled', ['Export']],
]

describe('the export run, named for the run', () => {
  it.each(STATES)('%s: a region named "Export run", holding %j', (state, buttons) => {
    const html = draw(state)
    expect(regionOf(html)).toBe('Export run')
    expect(buttonsOf(html)).toEqual(buttons)
  })

  it('before any export has run there is no region, only the button', () => {
    const html = draw('idle')
    expect(regionOf(html)).toBeNull()
    expect(buttonsOf(html)).toEqual(['Export'])
  })

  it.each(STATES)('%s: no control inside it is named as the region is', (state, buttons) => {
    const region = regionOf(draw(state))
    expect(region, 'the run draws a region').not.toBeNull()
    // The shape Playwright writes the tree in, one node a line, so that the
    // sweep's own rule is what judges the names.
    const snapshot = [
      `- region ${JSON.stringify(region)}:`,
      ...buttons.map((name) => `  - button ${JSON.stringify(name)}`),
    ].join('\n')
    const reading = duplicatedNames(snapshot, [])
    expect(reading.unread, 'every line of the snapshot is read').toEqual([])
    expect(reading.pairs.map(describePair)).toEqual([])
  })

  it('and the rule would have found the old name, so this is not a test of nothing', () => {
    const old = ['- region "Export":', '  - button "Reveal"', '  - button "Export"'].join('\n')
    expect(duplicatedNames(old, []).pairs.map(describePair)).toEqual([
      'region "Export" contains button "Export"',
    ])
  })
})
