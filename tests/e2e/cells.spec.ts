// What a cell's body looks like to the eye, measured (issue 281): every
// line of text inside a cell starts at one left edge, every field list's
// values start at one x, and a heading is the same distance from what
// surrounds it wherever it stands. The kit pads every `section`, which put
// nested panels 16px past a bare paragraph and another 16px past that, and
// each field list measured its own longest term, so the values did not line
// up. The notebook is drawn by `tests/support/a11y.ts`'s launch, against the
// stand-in engine, with a project laid out so every panel is on the screen.

import { expect, test, type Page } from '@playwright/test'
import { PYTHON, newProjectFromLibrary, openLaidOut, profile, withApp } from '../support/a11y'
import { CELL_LIST } from '../../src/renderer/src/runGraph'
import { openCell } from '../support/project'

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Reading {
  cell: string
  bodyLeft: number
  edges: { what: string; left: number }[]
  values: { what: string; left: number }[]
  headings: { what: string; gap: number | null; below: number }[]
}

/** Everything the three assertions need, read in one pass over one cell. */
async function read(page: Page, number: string): Promise<Reading> {
  return page.locator(`.cell[data-cell="${number}"]`).evaluate((cell, n) => {
    const body = cell.querySelector('.cell-body') as HTMLElement
    const inner = body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft)
    const shown = (el: Element): boolean => {
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      // The visually hidden status lines are one pixel and clipped; they
      // are for a reader that is not an eye.
      return (
        el.getClientRects().length > 0 &&
        box.width > 1 &&
        box.height > 1 &&
        style.display !== 'contents'
      )
    }
    const label = (el: Element): string =>
      `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`
    const edges = [
      ...cell.querySelectorAll('.cell-body > *, .cell-body section > *, .cell-footer > *'),
    ]
      .filter(shown)
      .map((el) => ({ what: label(el), left: el.getBoundingClientRect().left }))
    const values = [...cell.querySelectorAll('.fields dd')]
      .filter((el) => shown(el) && !el.closest('.counts'))
      .map((el) => ({
        what: `dd "${el.textContent?.slice(0, 20)}"`,
        left: el.getBoundingClientRect().left,
      }))
    const headings = [...cell.querySelectorAll('.cell-body h3')].filter(shown).map((el) => {
      const style = getComputedStyle(el)
      // What is above it, as a person sees it: the nearest thing before the
      // heading or before the section it opens, walking out of a section
      // that has nothing before the heading in it. The distance is between
      // the two boxes, so it is what margins collapse to and not what one
      // of them declares.
      let node: Element = el
      while (node.previousElementSibling === null && node.parentElement !== body)
        node = node.parentElement!
      const above = node.previousElementSibling
      return {
        what: `h3 "${el.textContent?.slice(0, 24)}"`,
        gap:
          above === null
            ? null
            : el.getBoundingClientRect().top - above.getBoundingClientRect().bottom,
        below: parseFloat(style.marginBottom),
      }
    })
    return { cell: n, bodyLeft: inner, edges, values, headings }
  }, number)
}

test('every line inside a cell starts at the body’s one left edge, in every cell', async () => {
  test.setTimeout(180_000)
  await withApp(profile(), async (page) => {
    await openLaidOut(page, 'Los Angeles')
    // Cell 06 starts closed; open it so its panels are on the screen.
    await openCell(page, 'export')

    for (const { number } of CELL_LIST) {
      const n = String(number).padStart(2, '0')
      const r = await read(page, n)
      expect(r.edges.length, `cell ${n} drew nothing to measure`).toBeGreaterThan(0)
      const off = r.edges.filter((e) => Math.abs(e.left - r.bodyLeft) > 1)
      expect(off, `cell ${n}: what does not start at ${r.bodyLeft}`).toEqual([])
    }
  })
})

test('within a cell every field value starts at one x, and every heading keeps one rhythm', async () => {
  test.setTimeout(180_000)
  await withApp(profile(), async (page) => {
    await openLaidOut(page, 'Los Angeles')
    for (const { number } of CELL_LIST) {
      const n = String(number).padStart(2, '0')
      const r = await read(page, n)
      if (r.values.length > 0) {
        const lefts = r.values.map((v) => Math.round(v.left))
        expect(new Set(lefts).size, `cell ${n}: ${JSON.stringify(r.values)}`).toBe(1)
      }
      for (const h of r.headings) {
        // `--space-4-6` from whatever is above, wherever the heading stands;
        // one that opens its cell has nothing above and is not measured.
        // `--space-4-3` below. (The tokens are 24px and 12px.)
        if (h.gap !== null)
          expect(Math.abs(h.gap - 24), `cell ${n} ${h.what}: ${h.gap}px above`).toBeLessThanOrEqual(
            1,
          )
        expect(h.below, `cell ${n} ${h.what} below`).toBe(12)
      }
    }
  })
})

test('cell 02 does not move when a run starts', async () => {
  test.setTimeout(180_000)
  // Slow enough that the run is still on the screen when it is measured.
  await withApp(profile({ progress_delay_ms: 400 }), async (page) => {
    await newProjectFromLibrary(page, 'Los Angeles')
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    const before = await read(page, '02')
    expect(before.edges.length).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Lay out', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Layout run' })).toBeVisible()
    const during = await read(page, '02')
    for (const r of [before, during]) {
      const off = r.edges.filter((e) => Math.abs(e.left - r.bodyLeft) > 1)
      expect(off, `cell 02 at ${r.bodyLeft}`).toEqual([])
    }
    expect(Math.abs(during.bodyLeft - before.bodyLeft)).toBeLessThanOrEqual(1)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  })
})
