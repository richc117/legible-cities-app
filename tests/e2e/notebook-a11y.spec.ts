// The accessibility pass over a project's screen: the notebook of six
// cells, its panels, the map's frame and the dialogs a project opens
// (A6-07, issue 40; ADR-045; constitution principle VI;
// docs/accessibility.md).
//
// Split out of `accessibility.spec.ts` by A5.5-08, the way the code was:
// the window, the Library, Settings and the dialogs that are not a
// project's stay there, and everything a person meets inside a project is
// here. Six of this milestone's open issues have checks to add to a cell,
// and they would otherwise all have edited the one spec. The machinery -
// the profile, the launch, the Tab walk, the named-controls check and the
// motion check - is `tests/support/a11y.ts`.
//
// The engine's page inside the viewer's frame is the engine's, and is not
// swept here; a Tab walk passes the "Skip past the map" control, then
// through its frame and out again (issue 106).

import { copyFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  PYTHON,
  controlsOf,
  fixture,
  heading,
  newProjectFromLibrary,
  openLaidOut,
  pressWithKeyboard,
  profile,
  sweep,
  withApp,
} from '../support/a11y'
import { cellHandback, cellHeading, closeCell, openCell } from '../support/project'

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

test('focus through a layout run and a confirmed re-layout, and left where a person put it', async () => {
  test.setTimeout(180_000)
  // Slow enough that a run is still going when focus is looked at.
  const p = profile({ progress_delay_ms: 150 })
  await withApp(p, async (page) => {
    await newProjectFromLibrary(page, 'Los Angeles')
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(heading(page)).toHaveText('Los Angeles')
    const run = page.getByRole('region', { name: 'Layout run' })
    const cancel = run.getByRole('button', { name: 'Cancel', exact: true })
    const again = page.getByRole('button', { name: 'Lay out again', exact: true })

    // From the keyboard: Lay out gives way to Cancel, Cancel to Lay out again.
    await pressWithKeyboard(page.getByRole('button', { name: 'Lay out', exact: true }))
    await expect(cancel).toBeFocused()
    await expect(again).toBeFocused({ timeout: 30_000 })

    // A re-layout confirmed from the keyboard: the warning closes onto a
    // Re-layout button the run has removed, and focus goes to the run's
    // Cancel, then to Lay out again.
    await pressWithKeyboard(page.getByRole('button', { name: 'Re-layout', exact: true }))
    const warning = page.getByRole('dialog', { name: 'Lay this project out from scratch?' })
    await pressWithKeyboard(warning.getByRole('button', { name: 'Re-layout', exact: true }))
    await expect(warning).toBeHidden()
    await expect(cancel).toBeFocused()
    await expect(again).toBeFocused({ timeout: 30_000 })

    // Focus moved elsewhere while the run goes stays there when it ends.
    await pressWithKeyboard(again)
    await expect(cancel).toBeFocused()
    // The cell's heading row is the service day's heading now (A5.5-08).
    const dayHeading = cellHeading(page, 'frame')
    await dayHeading.focus()
    await expect(again).toBeVisible({ timeout: 30_000 })
    await expect(dayHeading).toBeFocused()

    // A press on prose while the run goes leaves focus nowhere, and the
    // run's end does not pull it back.
    await again.click()
    await expect(cancel).toBeVisible()
    await run.locator('.layout-run-foot .progress-message').click()
    await expect(again).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'nothing'))
      .toBe('body')
  })
})

test('the notebook, Inspect, the geographic view, the inspector and its dialogs', async () => {
  // Seven walks of at most 20 s each, a layout run and a rebuild: a stuck
  // walk reports its own message well before the test's time runs out.
  test.setTimeout(420_000)
  const p = profile({ map_caveats: ['4 of 116 stops could not be placed on the map'] })
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    // The run's Lay out went with the press, its Cancel with the run's end:
    // focus is on what took their place.
    await expect(page.getByRole('button', { name: 'Lay out again', exact: true })).toBeFocused()

    await expect(page.getByRole('region', { name: 'Line colours' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'What the build had to fudge' })).toBeVisible()
    await expect(page.getByRole('group', { name: /^The gtfs2graph stage/ })).toBeVisible()

    // The heading outline (issue 197). A screen reader walks a long document
    // by heading, and the notebook is one: its six cells are the screen's
    // second-level headings and nothing inside a cell is their sibling. It
    // is asserted here, in the test that already has a laid-out project with
    // every panel drawn, rather than in a test of its own: a second launch
    // and a second layout run would cost minutes to see the same document.
    //
    // The inspector is still closed at this point, and its own "Jobs" is an
    // `h2` of the window rather than of the notebook (ADR-036). The check is
    // made before it is opened for that reason, and not by excluding it.
    //
    // A cell that is collapsed keeps its controls in the document, so this
    // sees cell 06's contents too though its row is shut.
    expect(await outline(page)).toEqual({
      second: [
        '01 Data',
        '02 Process',
        '03 Frame and service day',
        '04 Style',
        '05 Lines',
        '06 Export',
      ],
      perCell: ['01: 1', '02: 1', '03: 1', '04: 1', '05: 1', '06: 1'],
    })
    // And the panels that keep a name of their own carry it a level below,
    // which is what the region each one is named by still answers to: cell
    // 01's two sections, cell 02's report, and cell 05's two (A5.5-18).
    for (const name of [
      'In the feed',
      'Where the routes run',
      'What the build had to fudge',
      'Line colours',
      'Line order',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
    }

    await sweep(page, 'the project, its notebook')
    // A sortable column's header is a target of at least 24px, though its
    // label's line is 16.
    for (const sort of await page.locator('th button.sort').all())
      expect((await sort.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24)

    // A colour picker open: its two sliders, the hex field, and the ring.
    const colours = page.getByRole('region', { name: 'Line colours' })
    await colours.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = colours.getByRole('group', { name: 'Colour for line A' })
    await expect(picker.getByRole('slider', { name: 'Hue' })).toBeVisible()
    // Its Choose button controls the picker it opened, as a native button's
    // aria-controls would say (issue 121, F6).
    await expect
      .poll(() => controlsOf(page, 'Choose the colour of line A'))
      .toEqual(['Colour for line A'])
    await sweep(page, 'the project, a colour picker open')
    await picker.getByRole('slider', { name: 'Hue' }).focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(picker.getByRole('slider', { name: 'Hue' })).toBeFocused()
    expect(
      await picker
        .getByRole('slider', { name: 'Hue' })
        .evaluate((el) => getComputedStyle(el).outlineStyle),
      "the picker's slider shows the app's focus ring",
    ).not.toBe('none')
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    // Closed, it names nothing it no longer shows.
    await expect.poll(() => controlsOf(page, 'Choose the colour of line A')).toEqual([])

    // The default colour's Choose button, the other kind of row.
    const uncoloured = colours.getByRole('button', {
      name: 'Choose the colour of lines the feed leaves uncoloured',
    })
    await uncoloured.click()
    await expect(
      colours.getByRole('group', { name: 'Colour for lines the feed leaves uncoloured' }),
    ).toBeVisible()
    await expect
      .poll(() => controlsOf(page, 'Choose the colour of lines the feed leaves uncoloured'))
      .toEqual(['Colour for lines the feed leaves uncoloured'])
    await uncoloured.click()
    await expect(
      colours.getByRole('group', { name: 'Colour for lines the feed leaves uncoloured' }),
    ).toBeHidden()

    // An explanation shown on focus is sent away with Escape, and comes back
    // once focus has left its row and returned.
    const panel = page.getByRole('region', { name: 'What the build had to fudge' })
    const trigger = panel.getByRole('button', { name: /^What .* means$/ }).first()
    const tooltip = page.locator(`[id="${await trigger.getAttribute('aria-describedby')}"]`)
    await trigger.focus()
    await expect(tooltip).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(tooltip).toBeHidden()
    await expect(trigger).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(trigger).toBeFocused()
    await expect(tooltip).toBeVisible()

    // The rename form.
    await page.getByRole('button', { name: 'Rename' }).click()
    await expect(page.getByLabel('New name')).toBeVisible()
    await sweep(page, 'the project, renaming')
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // The re-layout warning and the delete confirmation.
    await page.getByRole('button', { name: 'Re-layout' }).click()
    const relayout = page.getByRole('dialog', { name: 'Lay this project out from scratch?' })
    await sweep(page, 'the re-layout warning', relayout)
    await relayout.getByRole('button', { name: 'Cancel' }).click()
    await expect(relayout).toBeHidden()
    await page.getByRole('button', { name: 'Delete project' }).click()
    const remove = page.getByRole('dialog', { name: 'Delete Los Angeles?' })
    await sweep(page, 'the delete confirmation', remove)
    await remove.getByRole('button', { name: 'Cancel' }).click()
    await expect(remove).toBeHidden()

    // The service day: the control and its button disable themselves for
    // the rebuild, and the section's heading holds focus.
    const day = page.getByRole('region', { name: 'Service day' })
    await day.getByLabel('Draw for another day').fill('2026-06-17')
    await pressWithKeyboard(day.getByRole('button', { name: 'Draw for this day' }))
    await expect(cellHandback(page, 'frame')).toBeFocused()
    await expect(page.getByText(/^Drawn for 2026-06-17 from the stored layout/)).toBeVisible({
      timeout: 30_000,
    })

    // Inspect: the feed's own entry, pressed, goes once the choice is the
    // entry's; focus lands on the mode it set.
    const inspect = page.getByRole('region', { name: 'In the feed' })
    await inspect.getByRole('combobox', { name: 'Mode' }).selectOption('tram')
    const useEntry = inspect.getByRole('button', { name: "Use the feed's entry" })
    await expect(useEntry).toBeVisible()
    await pressWithKeyboard(useEntry)
    await expect(useEntry).toHaveCount(0)
    await expect(inspect.getByRole('combobox', { name: 'Mode' })).toBeFocused()

    // The inspector, with the session's jobs: the layout run and the rebuild.
    // Collapsed, the toggle controls nothing yet: the inspector is not
    // rendered until it opens, and the relation follows it in and out.
    await expect.poll(() => controlsOf(page, /^Jobs, /)).toEqual([])
    await page.getByRole('button', { name: /^Jobs, / }).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByRole('listitem').first()).toBeVisible()
    await expect.poll(() => controlsOf(page, /^Jobs, /)).toEqual(['Inspector'])
    await sweep(page, 'the inspector')
    // Closed with its own button, since the walk leaves focus wherever it
    // ended and Escape is the inspector's only while focus is inside it.
    await inspector.getByRole('button', { name: 'Close the inspector' }).click()
    await expect(inspector).toHaveCount(0)
    await expect.poll(() => controlsOf(page, /^Jobs, /)).toEqual([])
  })
})

test('cell 06, and focus through an export', async () => {
  test.setTimeout(240_000)
  const p = profile({ encode_delay_ms: 30 })
  const exportFolder = join(p.userData, 'exports')
  await withApp(
    p,
    async (page) => {
      await openLaidOut(page, 'Los Angeles')
      const [id] = readdirSync(join(p.engineHome, 'projects'))
      copyFileSync(fixture, join(p.engineHome, 'out', id, 'la-metro-rail.html'))

      const tab = await openCell(page, 'export')
      await expect(tab.getByRole('combobox', { name: 'Preset' })).toBeVisible({ timeout: 20_000 })
      await sweep(page, 'the project, cell 06 open')

      // Export gives way to Cancel, and Cancel to Reveal: focus follows.
      await pressWithKeyboard(tab.getByRole('button', { name: 'Export', exact: true }))
      await expect(tab.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
      await expect(tab.getByRole('button', { name: 'Reveal' })).toBeFocused()
      await sweep(page, 'the project, an export finished')
    },
    { env: { LEGIBLE_EXPORT_FOLDER: exportFolder } },
  )
})

/**
 * The project screen's heading outline, as a screen reader's heading list
 * would read it (issue 197): every `h2` in the document, and how many each
 * cell holds.
 *
 * Read from the document rather than through roles because what is being
 * asserted is the outline itself - the levels and their order - and
 * `getByRole('heading')` would answer the same for an `h2` and an `h3`
 * given a level filter each time. A cell's row is named by its contents, so
 * it is read as the number and name it draws; anything else answers its own
 * text, which is how a panel heading that came back would be seen.
 *
 * The suite's own sweep cannot see this class of defect at all: `expectNamed`
 * looks at `CONTROL_ROLES` and asks only whether a name is present, never
 * whether an outline is sane. That is why this check is here and not in
 * `tests/support/a11y.ts`, which every screen goes through: Settings' six
 * `h2`s under its `h1` are correct, and a rule saying "six second-level
 * headings, the cells'" is the project screen's alone.
 */
async function outline(page: Page): Promise<{ second: string[]; perCell: string[] }> {
  return page.evaluate(() => ({
    second: [...document.querySelectorAll('h2')].map((h) => {
      const number = h.querySelector('.cell-number')?.textContent ?? ''
      const name = h.querySelector('.cell-name')?.textContent ?? ''
      return number === '' && name === '' ? (h.textContent ?? '').trim() : `${number} ${name}`
    }),
    perCell: [...document.querySelectorAll('section.cell')].map(
      (cell) => `${cell.getAttribute('data-cell')}: ${cell.querySelectorAll('h2').length}`,
    ),
  }))
}

/**
 * A page for the viewer's frame with many controls of its own, as the
 * engine's page has: the stand-in's page holds none, so a Tab walk through it
 * would be no longer than the skip. It says which address it was loaded at,
 * so a test can wait for the frame to hold the one it expects, and answers
 * the viewer's `state` so the screen does not report the map missing.
 */
function busyMapPage(controls: number): string {
  const buttons = Array.from(
    { length: controls },
    (_, i) => `<button type="button">Map control ${i + 1}</button>`,
  ).join('\n')
  return `<!doctype html>
<meta charset="utf-8" />
<title>a map with many controls</title>
<body>
${buttons}
<p id="where"></p>
<script>
  document.getElementById('where').textContent = location.search
  window.__present = { state: function () { return {} } }
</script>
</body>
`
}

test('the project screen: one press skips past the map to its toolbar, and the map stays reachable', async () => {
  // Issue 106, finding F3 in docs/accessibility.md.
  test.setTimeout(240_000)
  const p = profile()
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    const controls = 40
    const [id] = readdirSync(join(p.engineHome, 'projects'))
    const out = join(p.engineHome, 'out', id)
    for (const name of readdirSync(out).filter((n) => n.endsWith('.html')))
      writeFileSync(join(out, name), busyMapPage(controls))
    // Leave and come back, so the viewer loads the page again.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(heading(page)).toHaveText('Los Angeles')

    const skip = page.getByRole('button', { name: 'Skip past the map', exact: true })
    const rename = page.getByRole('button', { name: 'Rename', exact: true })
    const frame = page.frameLocator('iframe.viewer-frame')
    const width = (): Promise<number> => skip.evaluate((el) => el.getBoundingClientRect().width)
    const activeTag = (): Promise<string> =>
      page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'nothing')

    // The two things the one frame shows: the plain map while cell 06 is
    // closed, and the export's planned preview while it is open (A5-01).
    for (const [tab, address] of [
      ['the map', 'controls=1'],
      ["the export's preview", 'safe=1'],
    ] as const) {
      const previewing = address === 'safe=1'
      if (previewing) await openCell(page, 'export')
      else await closeCell(page, 'export')
      // The frame holds the busy page at this tab's address - the plain map
      // under Map, the export's planned preview under Export - and has
      // stopped moving. Everything below walks the Tab order through that
      // frame, and a frame that reloads mid-walk loses the focus the walk
      // just gave it, so both halves are waited for here.
      //
      // The two facts come out of one snapshot taken inside the frame.
      // Asked as two Playwright calls they are two round trips, and a load
      // landing between them answers the address from the document that is
      // going and the controls from the one arriving, which has parsed
      // nothing yet: `address: true, controls: 0`, however long the poll
      // runs (issue 147, item 3).
      //
      // Stillness is the other half, and the one the failures were really
      // about. Cell 06 does not plan its preview when the engine lists its
      // presets: the plan is asked for after them, debounced, and the write
      // that settles the choice in the record can ask for another. Measured
      // with the frame's address watched over time, the frame was still on
      // the map's own address when the presets were listed and moved to the
      // planned one afterwards - so waiting for the presets, which is what
      // this test used to do, waits for the wrong thing. The snapshot
      // carries the document's own birth time, which is new for every
      // document, and two readings a second apart agreeing on it is what
      // tells a settled frame from one between two loads.
      type Frame = { address: boolean; controls: number; born: number }
      const gone: Frame = { address: false, controls: 0, born: 0 }
      const look = async (): Promise<Frame> => {
        try {
          return await frame.locator('body').evaluate((body, last: string) => {
            const where = body.querySelector('#where')?.textContent ?? ''
            return {
              address: where.includes(last),
              controls: body.querySelectorAll('button').length,
              born: performance.timeOrigin,
            }
          }, address)
        } catch {
          // Mid-load the frame answers nothing at all; a retry, not a failure.
          return gone
        }
      }
      let before = gone
      const settled = async (): Promise<Frame & { still: boolean }> => {
        const now = await look()
        const still = now.born !== 0 && now.born === before.born
        before = now
        return { ...now, still }
      }
      await expect
        .poll(settled, {
          // One second between readings, so `still` means a second of quiet
          // rather than whatever gap the default escalation had reached.
          intervals: [1000],
          timeout: 60_000,
          message: `${tab}: the busy page at ${address}, and not about to reload`,
        })
        .toEqual({ address: true, controls, born: expect.any(Number), still: true })

      // Out of sight while it does not hold focus, and in the document.
      await expect.poll(width, { message: `${tab}: hidden at rest` }).toBeLessThanOrEqual(1)
      // Where the map sits, in the viewport.
      //
      // It was read from the top of the screen's own region until A5.5-20,
      // with a comment saying that made it independent of the scroll. The
      // map is pinned now: its top is held against the viewport while the
      // region scrolls under it, so that difference *is* the scroll offset,
      // and the measure reported the map moving four thousand pixels when
      // nothing had moved at all. There is no frame in which a pinned map
      // is stationary at every offset - it is still in the viewport while
      // pinned and still in the document while not - so the reading before
      // the skip appears and the reading after it are taken with nothing
      // between them that scrolls, and the viewport is then the plainer of
      // the two. Nothing about what is asserted changes: the skip is
      // absolutely placed and takes no space in the flow, so if it moves
      // the map it moves it wherever the page is.
      const mapAt = (): Promise<{ top: number; height: number }> =>
        page.locator('section.viewer').evaluate((el) => {
          const map = el.getBoundingClientRect()
          return { top: map.top, height: map.height }
        })
      const atRest = await mapAt()

      // It moves nothing: the map is where it was before the skip appeared.
      // Within half a pixel: a scroll can land on a fraction of one. The
      // walk to the project's header and back comes after this, because it
      // scrolls and the map is pinned; it used to sit in between.
      await skip.focus()
      await expect(skip).toBeFocused()
      const shown = await mapAt()
      expect(shown.top, `${tab}: the map does not move when the skip appears`).toBeCloseTo(
        atRest.top,
        0,
      )
      expect(shown.height, `${tab}: the map keeps its size`).toBeCloseTo(atRest.height, 0)

      // The map is the notebook column's first child (ADR-045), so the skip
      // is still the first stop in the column - but the stop before it is
      // no longer the project's header. A5.5-21 puts the rail between them,
      // and its focus order follows its visual position on the left rather
      // than the DOM order that would have kept this assertion: a
      // navigation rail last in the Tab order is worse than a moved
      // assertion (WCAG 2.4.3). So the stop before the skip is the rail's
      // last control.
      //
      // Named as that element and not as "somewhere in the rail", which the
      // rail preceding the column makes true of itself - the same reason
      // the original named a button rather than a region. `.last()` is DOM
      // order, and nothing in the rail reorders itself with `tabindex`, so
      // it is the last stop too: step 06 while the project has exported
      // nothing, the final Reveal once it has.
      const railControls = page.locator('.rail').getByRole('button')
      await page.keyboard.press('Shift+Tab')
      await expect(
        railControls.last(),
        `${tab}: the stop before the skip is the rail's last control`,
      ).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(skip).toBeFocused()

      // Seen once it holds focus: a target of at least 24px, unclipped, in
      // the viewport, with the focus ring.
      await expect(skip).toBeInViewport()
      const box = await skip.boundingBox()
      expect(box?.width ?? 0, `${tab}: shown when focused`).toBeGreaterThan(24)
      expect(box?.height ?? 0, `${tab}: a target when focused`).toBeGreaterThanOrEqual(24)
      expect(await skip.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none')
      expect(await skip.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

      // Not used, the next Tab goes into the map: its first control, whatever
      // else the page holds. Read from inside the frame, in one snapshot
      // again, so that a failure says what the frame was holding when the
      // press landed - the document's own controls - instead of only that a
      // button could not be found.
      await page.keyboard.press('Tab')
      const inside = async (): Promise<{ focused: string; controls: number }> => {
        try {
          return await frame.locator('body').evaluate((body) => ({
            focused: (body.ownerDocument.activeElement as HTMLElement | null)?.textContent ?? '',
            controls: body.querySelectorAll('button').length,
          }))
        } catch {
          return { focused: 'the frame answered nothing', controls: 0 }
        }
      }
      await expect
        .poll(inside, { message: `${tab}: one press past the skip is the map's first control` })
        .toEqual({ focused: 'Map control 1', controls })
      expect(await activeTag(), `${tab}: focus is in the frame`).toBe('iframe')
      await expect(rename).not.toBeFocused()
      await expect.poll(width, { message: `${tab}: hidden again` }).toBeLessThanOrEqual(1)

      // Back out of the map to the skip, and pressed: the project's own
      // toolbar, which is after the frame and after the six cells, however
      // many controls the map has (issue 106, DESIGN.md 8.2).
      await page.keyboard.press('Shift+Tab')
      await expect(skip).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(rename).toBeFocused()
      await expect.poll(width, { message: `${tab}: hidden after the skip` }).toBeLessThanOrEqual(1)
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Delete project', exact: true })).toBeFocused()
    }
  })
})
