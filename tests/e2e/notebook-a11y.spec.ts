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
import { expect, test } from '@playwright/test'
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
import { cell, cellHandback, cellHeading, closeCell, openCell } from '../support/project'

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
      // Cell 06 plans its preview from the presets the engine answers, so
      // until they arrive the address it asks the frame for is not the one
      // it will settle on. The macOS failure in issue 147 was taken with
      // this combobox empty and the Storyboard's eight options already
      // listed: the frame was being re-pointed while the test read it. Wait
      // for the presets before looking at the frame at all.
      if (previewing)
        await expect(
          cell(page, 'export').getByRole('combobox', { name: 'Preset' }).locator('option').first(),
        ).toBeAttached({ timeout: 30_000 })
      // The frame holds the busy page at this tab's address: the plain map
      // under Map, the planned preview under Export. The frame loads the
      // page again whenever the address changes, and the Export tab plans
      // its preview after the tab is pressed, so the two facts are read
      // together and re-read as a pair: asked one after the other, a load
      // that lands between them fails the second for a frame that is
      // perfectly correct a moment later (issue 147, item 3 - it failed on
      // the macOS runner once in 125 runs and never here).
      const loaded = async (): Promise<{ address: boolean; lastControl: number }> => {
        try {
          const where = await frame.locator('#where').innerText({ timeout: 1_000 })
          const lastControl = await frame
            .getByRole('button', { name: `Map control ${controls}`, exact: true })
            .count()
          return { address: where.includes(address), lastControl }
        } catch {
          // Mid-load the frame answers nothing; that is a retry, not a failure.
          return { address: false, lastControl: 0 }
        }
      }
      await expect
        .poll(loaded, { timeout: 60_000, message: `${tab}: the busy page at ${address}` })
        .toEqual({ address: true, lastControl: 1 })

      // Out of sight while it does not hold focus, and in the document.
      await expect.poll(width, { message: `${tab}: hidden at rest` }).toBeLessThanOrEqual(1)
      // Where the map sits, from the top of the screen's own region rather
      // than the viewport, so a scroll that brings the focused skip into
      // view is not read as the map moving.
      const mapAt = (): Promise<{ top: number; height: number }> =>
        page.locator('section.viewer').evaluate((el) => {
          const map = el.getBoundingClientRect()
          const screen = (el.closest('main') as HTMLElement).getBoundingClientRect()
          return { top: map.top - screen.top, height: map.height }
        })
      const atRest = await mapAt()

      // The map is the notebook column's first child (ADR-045), so the skip
      // is the first stop in the column and the stop before it is the
      // project's own header: nothing focusable sits between the two.
      // Asserted as that button and not as "somewhere in the notebook",
      // which the skip being inside the column makes true of itself.
      await skip.focus()
      await page.keyboard.press('Shift+Tab')
      await expect(
        page.getByRole('button', { name: 'Back to Library' }),
        `${tab}: the stop before the skip is the project's header`,
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
      // And it moves nothing: the map is where it was before the skip appeared.
      // Within half a pixel: a scroll can land on a fraction of one.
      const shown = await mapAt()
      expect(shown.top, `${tab}: the map does not move when the skip appears`).toBeCloseTo(
        atRest.top,
        0,
      )
      expect(shown.height, `${tab}: the map keeps its size`).toBeCloseTo(atRest.height, 0)

      // Not used, the next Tab goes into the map: its first control, whatever
      // else the page holds.
      await page.keyboard.press('Tab')
      await expect(frame.getByRole('button', { name: 'Map control 1', exact: true })).toBeFocused()
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
