// @vitest-environment jsdom
// The map's section says what the screen decided to do about the page it
// opened on, as `data-on-open` (issue 596): `never` or `redraw`, and no
// attribute at all before the decision. It is for an end-to-end test to wait
// on, so it is drawn as nothing: no class, style, text or ARIA. What decides
// it is held in `project-state-writes.test.tsx`; this holds that what the
// screen decided is what the section says, and that saying it costs the
// rest of the screen nothing (`cell-renders.test.tsx`).

import { afterEach, describe, expect, it } from 'vitest'
import { ProjectProviders } from '../../src/renderer/src/notebook/context'
import Preview from '../../src/renderer/src/notebook/Preview'
import { cleanup, defaultProjectState, renderPanel, type ApiStub } from '../support/render'
import { StandInRun } from '../support/stand-in-run'

afterEach(cleanup)

/** The bridge as far as the section reaches it: a frame that never loads. */
const API: ApiStub = {
  viewer: {
    attach: async () => true,
    release: async () => undefined,
    call: () => new Promise(() => undefined),
    seams: () => new Promise(() => undefined),
  },
}

/** The map's section, drawn under the screen's providers with this decision. */
function section(onOpen: 'redraw' | 'never' | null): Element {
  const { host } = renderPanel(
    <ProjectProviders state={{ ...defaultProjectState(new StandInRun()), onOpen }}>
      <Preview onLayOut={() => undefined} />
    </ProjectProviders>,
    { api: API },
  )
  const found = host.querySelector('section.viewer')
  if (found === null) throw new Error('the map’s section was not drawn')
  return found
}

describe('the map’s section and the decision about the page it opened on', () => {
  it('has no attribute before the decision', () => {
    // Mutation: `data-on-open` written as `openDecision ?? 'never'`.
    expect(section(null).hasAttribute('data-on-open')).toBe(false)
  })

  it('says never where the screen settled on leaving the page', () => {
    // Mutation: the attribute not written.
    expect(section('never').getAttribute('data-on-open')).toBe('never')
  })

  it('says redraw where the screen asked for it to be drawn again', () => {
    expect(section('redraw').getAttribute('data-on-open')).toBe('redraw')
  })

  it('is invisible: it adds nothing to the section but the attribute', () => {
    // The same section, decided and not, differs by that attribute alone.
    const before = section(null)
    const bare = before.cloneNode(true) as Element
    const after = section('never').cloneNode(true) as Element
    after.removeAttribute('data-on-open')
    expect(after.outerHTML).toBe(bare.outerHTML)
  })
})
