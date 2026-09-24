// The kit's disclosure (A5.5-05): a button carrying `aria-expanded` over a
// named group it points at. The wiring is what is worth pinning, because
// six cells and whatever follows them consume it: an `aria-controls` that
// names nothing, or a group with no name, is the kind of fault that reads
// as fine and is not (issue 121 was exactly that, one level down).

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Disclosure from '../../src/renderer/src/kit/Disclosure'

const draw = (props: Partial<Parameters<typeof Disclosure>[0]> = {}): string =>
  renderToStaticMarkup(
    <Disclosure
      summary={<span>the row</span>}
      open={false}
      onToggle={() => {}}
      label="01 Data"
      {...props}
    >
      <p>the controls</p>
    </Disclosure>,
  )

/** The id the button points at, and the id the group carries. */
const wiring = (html: string): { controls: string | null; group: string | null } => ({
  controls: /aria-controls="([^"]+)"/.exec(html)?.[1] ?? null,
  group: /<div id="([^"]+)"/.exec(html)?.[1] ?? null,
})

describe('the disclosure', () => {
  it('points at the group it discloses, by an id that is really there', () => {
    const { controls, group } = wiring(draw())
    expect(controls).not.toBeNull()
    expect(controls).toBe(group)
  })

  it('gives two disclosures on one page ids of their own', () => {
    // Two separate renders cannot collide by construction; what matters is
    // that the id is derived per instance rather than written as a constant.
    const first = wiring(
      renderToStaticMarkup(
        <>
          <Disclosure summary={<span>one</span>} open={false} onToggle={() => {}} label="01 Data">
            <p>one</p>
          </Disclosure>
          <Disclosure
            summary={<span>two</span>}
            open={false}
            onToggle={() => {}}
            label="02 Process"
          >
            <p>two</p>
          </Disclosure>
        </>,
      ),
    )
    const ids = [
      ...renderToStaticMarkup(
        <>
          <Disclosure summary={<span>one</span>} open={false} onToggle={() => {}} label="01 Data">
            <p>one</p>
          </Disclosure>
          <Disclosure
            summary={<span>two</span>}
            open={false}
            onToggle={() => {}}
            label="02 Process"
          >
            <p>two</p>
          </Disclosure>
        </>,
      ).matchAll(/aria-controls="([^"]+)"/g),
    ].map((m) => m[1])
    expect(first.controls).not.toBeNull()
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('names the group, and does not replace the button’s own contents', () => {
    const html = draw()
    expect(html).toContain('aria-label="01 Data"')
    expect(html).not.toMatch(/<button[^>]*aria-label/)
    expect(html).toContain('the row')
  })

  it('keeps the contents in the document, hidden, when it is closed', () => {
    expect(draw()).toContain('the controls')
    expect(draw()).toContain('hidden=""')
    expect(draw({ open: true })).not.toContain('hidden=""')
  })

  it('stands alone unless it is given a heading to sit in', () => {
    expect(draw()).not.toContain('disclosure-heading')
    expect(draw({ heading: 'h2' })).toMatch(/<h2[^>]*class="disclosure-heading"/)
  })
})
