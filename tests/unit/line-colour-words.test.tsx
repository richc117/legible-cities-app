// @vitest-environment jsdom
// What each of cell 05's colour rows says (issue 560): the colour a line is
// drawn in and where it came from, and what the feed publishes only where
// that is another colour. A feed-coloured row used to print its hex twice,
// once as the feed's and once as the colour it is drawn in, which is one
// fact said twice on one line (DESIGN.md 8.2, issue 209).
//
// Drawn through `renderCell('lines')` with the kit real, from the support
// inspection: line A in its feed's colour, B and C with none, B given a
// colour of its own. Each test was watched failing under its mutation in
// `line-colour-words.mutations.json`.

import { afterEach, describe, expect, it } from 'vitest'
import { answered, BASE, byName, cleanup, renderCell } from '../support/render'

afterEach(cleanup)

/** The words of each colour row in the list named Lines, by line. */
async function rows(): Promise<Record<string, string>> {
  renderCell('lines', { project: { ...BASE, colors: { B: '#d6402a' }, readOnly: false } })
  await answered()
  const list = byName('list', 'Lines')
  const said: Record<string, string> = {}
  for (const row of list.querySelectorAll<HTMLElement>('.line-row')) {
    const name = row.querySelector('.line-name')?.textContent ?? ''
    said[name] = row.textContent ?? ''
  }
  return said
}

const times = (text: string, part: string): number => text.split(part).length - 1

describe('a colour row’s words', () => {
  it('holds a feed-coloured line’s hex once', async () => {
    const said = await rows()
    expect(said.A).toContain('the feed’s colour, #0072bc')
    expect(times(said.A, '#0072bc'), said.A).toBe(1)
  })

  it('says your colour and the feed’s where they differ, and the default where the feed has none', async () => {
    const said = await rows()
    expect(said.B).toContain('your colour, #d6402a; the feed has none')
    expect(said.C).toContain('the default, #888888; the feed has none')
    expect(times(said.C, '#888888'), said.C).toBe(1)
  })
})
