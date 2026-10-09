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
  expectNamed,
  expectNoDuplicatedNames,
  fixture,
  heading,
  installProbe,
  newProjectFromLibrary,
  openLaidOut,
  pressWithKeyboard,
  profile,
  sweep,
  withApp,
  type Probe,
} from '../support/a11y'
import { describePair, duplicatedNames } from '../support/a11y-names'
import { cell, cellHandback, cellHeading, closeCell, openCell } from '../support/project'
import { standInPage } from '../support/standInPage'
import { crossingOf, type StepAnswer } from '../support/tab-walk'

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
  // Eight sweeps, so sixteen walks (each sweep walks once in each theme)
  // of at most 20 s each, a layout run and a rebuild: a stuck
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
    // Its subject is the notebook and not the screen: the rail's "Outputs"
    // and the inspector's "Jobs" are second-level headings of the project
    // screen and of the window, both correct where they are, and `outline()`
    // is scoped to the column so that neither has to be listed here.
    //
    // Cell 06 is shut here, and a collapsed cell's contents are hidden, so
    // this does not see inside it: the same outline is read again in 'cell
    // 06, and focus through an export', where every cell is open.
    //
    // Polled, not read once. The panels above arrive at their own pace - the
    // diagnostics comes with the run's report and the geographic view with
    // the engine's drawing - and a single `evaluate` is a fixed budget
    // wherever it lands, which this suite has been bitten by before.
    await expect
      .poll(() => outline(page), { message: "the notebook's heading outline" })
      .toEqual({
        second: [
          '01 Data',
          '02 Process',
          '03 Frame and service day',
          '04 Style',
          '05 Lines',
          '06 Export',
        ],
        perCell: ['01: 1', '02: 1', '03: 1', '04: 1', '05: 1', '06: 1'],
        // Nothing inside a cell skips a level either: the rule is that a
        // panel's heading is one below the row, and a check that only
        // counted `h2`s would pass an `h4` that reads as a hole in the
        // outline to anyone walking it.
        deeper: [],
      })
    // And the panels that keep a name of their own carry it a level below,
    // which is what the region each one is named by still answers to: cell
    // 01's two sections, cell 02's report, and cell 05's two (A5.5-18).
    // Cell 03's Trip (issue 272) is one of them: drawn whatever the page
    // can do, a region named by its `h3` alone.
    for (const name of [
      'In the feed',
      'Where the routes run',
      'What the build had to fudge',
      'Trip',
      'Line colours',
      'Line order',
    ]) {
      await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name, exact: true })).toBeVisible()
    }

    // Cell 04's theme (A7-13): a group named for what it sets holding the
    // two radios, each named by its word and nothing else. The pictures
    // are `alt=""`, so they are not in the tree at all and add nothing to a
    // name, and the checked radio is announced as checked. The sweep below
    // walks it in both of the interface's themes: Tab enters the pair once
    // and the ring is drawn on the card.
    await openCell(page, 'style')
    const themeGroup = cell(page, 'style').getByRole('group', {
      name: 'The theme this map is drawn in',
    })
    await expect(themeGroup).toBeVisible()
    const themeNodes = (await themeGroup.ariaSnapshot())
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^- (radio|img|button)\b/.test(line))
    expect(themeNodes, "cell 04's theme, as the accessibility tree has it").toEqual([
      '- radio "Warm dark" [checked]',
      '- radio "Sepia"',
    ])

    await expect(page.getByRole('navigation', { name: 'Steps' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Outputs', exact: true })).toBeVisible()
    // The way back is in the window's header, not a breadcrumb (issue 275).
    await expect(
      page.locator('.app-header').getByRole('button', { name: 'Back to Library' }),
    ).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0)
    await sweep(page, 'the project, its notebook')

    // Issue 121, for the cells: a cell's row is a plain button over a
    // region in the same document, so its aria-controls resolves, where a
    // kit button's had to be set as an element reference. Measured in the
    // tree rather than assumed, for each of the six and for the engine log.
    // A closed cell's region is hidden, and a hidden element is not in the
    // tree: cell 06 starts closed and relates to nothing until it opens,
    // while its row's aria-expanded says which it is.
    const cellRow = (label: string): RegExp =>
      new RegExp(`^${label} (ready|running|not drawn yet|failed)`)
    for (const label of [
      '01 Data',
      '02 Process',
      '03 Frame and service day',
      '04 Style',
      '05 Lines',
    ])
      await expect.poll(() => controlsOf(page, cellRow(label))).toEqual([label])
    await expect.poll(() => controlsOf(page, cellRow('06 Export'))).toEqual([])
    await openCell(page, 'export')
    await expect.poll(() => controlsOf(page, cellRow('06 Export'))).toEqual(['06 Export'])
    await closeCell(page, 'export')
    const engineLog = page
      .locator('section.cell[data-cell="02"]')
      .getByRole('button', { name: /^Engine log\b/ })
    await expect.poll(() => controlsOf(page, /^Engine log\b/)).toEqual([])
    await engineLog.click()
    await expect(page.getByRole('group', { name: "The engine's log for this run" })).toBeVisible()
    await expect
      .poll(() => controlsOf(page, /^Engine log\b/))
      .toEqual(["The engine's log for this run"])
    await sweep(page, 'the project, the engine log open')
    await engineLog.click()

    // Every cell closed: six rows, each with its summary, and the rail.
    for (const id of ['data', 'process', 'frame', 'style', 'lines'] as const)
      await closeCell(page, id)
    await sweep(page, 'the project, every cell closed')
    for (const id of ['data', 'process', 'frame', 'style', 'lines'] as const)
      await openCell(page, id)
    // A sortable column's header is a target of at least 24px, though its
    // label's line is 16.
    for (const sort of await page.locator('th button.sort').all())
      expect((await sort.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24)

    // A colour picker open: its two sliders, the hex field, and the ring.
    const colours = page.getByRole('region', { name: 'Line colours' })
    await colours.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = colours.getByRole('group', { name: 'Colour for line A' })
    await expect(picker.getByRole('slider', { name: 'Hue' })).toBeVisible()
    // Its chip controls the picker it opened, as a native button's
    // aria-controls says (issue 121, F6; a native button since issue 284).
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

    // The default colour's chip, the other kind of row.
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
    // This warning is written inside cell 02, so while it is open the cell
    // does hold two `h2`s and the outline does say so. The heading walk
    // follows what is on screen, and a person in this dialog meets its
    // title; the outline check above is only true because the dialog is
    // shut, and this is what says the check can tell the two apart rather
    // than never counting a dialog at all.
    const warned = await outline(page)
    expect(warned.second).toContain('Lay this project out from scratch?')
    expect(warned.perCell).toContain('02: 2')
    await relayout.getByRole('button', { name: 'Cancel' }).click()
    await expect(relayout).toBeHidden()
    // And shut again, it is out of the outline once more.
    await expect
      .poll(async () => (await outline(page)).perCell, { message: 'the warning closed' })
      .toContain('02: 1')
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

test("a sample's download, drawn in cell 01 while its layout waits", async () => {
  // Issue 178: a sample whose feed is not on disk downloads it inside its
  // layout, and cell 01 draws the bytes. Ten reports two seconds apart hold
  // the download on screen through a sweep in both themes.
  test.setTimeout(180_000)
  const p = profile({ presets_cached: [], preset_download_delay_ms: 2000 })
  await withApp(p, async (page) => {
    await page
      .getByRole('list', { name: 'Presets' })
      .getByRole('listitem', { name: 'LA Metro Rail', exact: true })
      .getByRole('button')
      .click()
    const download = page
      .locator('section.cell[data-cell="01"]')
      .getByRole('region', { name: 'Download' })
    await expect(download.getByRole('status')).toHaveText(/^downloaded /, { timeout: 20_000 })
    await sweep(page, 'a sample, its download in cell 01')
    await expect(download, 'still downloading when the sweep ended').toBeVisible()
  })
})

test("cell 03's transport, on a page that answers what day it has", async () => {
  // The stand-in engine's own page answers nothing, so the transport never
  // draws over it and the notebook's sweep above cannot see it. Here the
  // page is one that carries the seam (A5.5-16), and the project is swept
  // with the scrub, Play day and Speed on screen (A5.6-09). A launch, a
  // layout run and two walks of the whole project screen: the budget
  // layout.spec.ts gives the same setup.
  test.setTimeout(180_000)
  const p = profile()
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    standInPage(p.engineHome)
    // Reopened so the frame loads the page just written: the viewer
    // navigates on a redraw and on nothing else.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    const transport = page.getByRole('region', { name: 'Transport', exact: true })
    await expect(transport).toBeVisible({ timeout: 20_000 })
    await expect(transport.getByRole('slider', { name: 'Time of day' })).toHaveAttribute(
      'aria-valuetext',
      /^\d{2}:\d{2}/,
    )
    // The controls sit in the container "Draw for another day" sits in, and
    // Play and Speed stand on one line (the maintainer's note of 30 Sep
    // 2026): the button and the select have the same foot and the same
    // height, though the select has its label above it.
    const play = transport.locator('fig-button').first()
    const speed = transport.locator('fig-dropdown select')
    const [b, c] = [(await play.boundingBox())!, (await speed.boundingBox())!]
    expect(
      Math.abs(b.y + b.height - (c.y + c.height)),
      `Play ${JSON.stringify(b)} against Speed ${JSON.stringify(c)}`,
    ).toBeLessThanOrEqual(1)
    expect(Math.abs(b.height - c.height), 'one height').toBeLessThanOrEqual(1)
    const ground = (selector: string): Promise<string> =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => {
          const s = getComputedStyle(el)
          return `${s.backgroundColor} ${s.borderTopWidth} ${s.borderRadius} ${s.padding}`
        })
    expect(await ground('.transport .inline-form')).toBe(await ground('.service-day .inline-form'))
    await sweep(page, 'the project, the transport drawn')
  })
})

test("cell 03's trip: a picker is one Tab stop, its options are reached by arrows, and its popup is swept open", async () => {
  // The kit's combobox (issue 272, spec 030 FR-003, SC-004): the first
  // control here with a popup and `aria-activedescendant`. The pickers'
  // stations are the record's, which the stand-in's `map.build` answered,
  // so no page with a seam is needed to walk them. A launch, a layout run,
  // the popup read in both themes and a walk of the whole project screen.
  test.setTimeout(180_000)
  const p = profile()
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    await openCell(page, 'frame')
    const trip = page.getByRole('region', { name: 'Trip', exact: true })
    await expect(trip.getByRole('heading', { level: 3, name: 'Trip', exact: true })).toBeVisible()
    const start = trip.getByRole('combobox', { name: 'Start', exact: true })
    const end = trip.getByRole('combobox', { name: 'End', exact: true })
    const options = page.getByRole('listbox', { name: 'Start' }).getByRole('option')

    // One Tab stop a picker: with its popup open, Tab leaves Start for End
    // and never enters the popup, which shuts behind it.
    await start.focus()
    await start.pressSequentially('a')
    await expect(options).toHaveCount(3)
    await page.keyboard.press('Tab')
    await expect(end).toBeFocused()
    await expect(start).toHaveAttribute('aria-expanded', 'false')
    // The ring is on the field itself, from the keyboard.
    expect(await end.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')

    // The options by the arrows, each its own name, each by its own id,
    // while DOM focus stays in the field.
    await start.focus()
    const reached: string[] = []
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      await start.press('ArrowDown')
      const id = (await start.getAttribute('aria-activedescendant')) ?? ''
      ids.push(id)
      reached.push((await page.locator(`[id="${id}"]`).textContent()) ?? '')
      await expect(start).toBeFocused()
    }
    expect(reached).toEqual(['Alpha', 'Bravo', 'Charlie'])
    expect(new Set(ids).size, 'one option a station').toBe(3)
    const names = await options.allTextContents()
    expect(new Set(names).size, 'no two options share a name').toBe(names.length)

    // The popup open, read in both of the interface's themes: every control
    // named, and no name said twice on the way in.
    for (const [scheme, attribute, name] of [
      ['dark', null, 'Night'],
      ['light', 'sepia', 'Parchment'],
    ] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(attribute)
      await start.focus()
      if ((await start.getAttribute('aria-expanded')) !== 'true') await start.press('ArrowDown')
      await expect(start).toHaveAttribute('aria-expanded', 'true')
      const snapshot = await page.locator('body').ariaSnapshot()
      expect(snapshot, 'the popup is in the tree while it is open').toContain('- listbox "Start"')
      await expectNamed(snapshot, `the project, a trip's popup open (${name})`)
      await expectNoDuplicatedNames(snapshot, `the project, a trip's popup open (${name})`)
    }
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await start.press('Escape')
    await expect(start).toHaveAttribute('aria-expanded', 'false')

    // And the whole screen walked with the Trip section on it, in both
    // themes: the two fields reached by Tab, each with its ring.
    await sweep(page, 'the project, the trip’s pickers used')
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

      // The heading outline with every cell open (issue 197). The other
      // reading of it is taken with cell 06 shut, and a collapsed cell's
      // contents are hidden from a screen reader and from the check alike,
      // so this is the one that sees inside cell 06: its export panel is
      // drawn headless under the row (#171), and the row is the only `h2`.
      await expect
        .poll(() => outline(page), { message: 'the heading outline, every cell open' })
        .toEqual({
          second: [
            '01 Data',
            '02 Process',
            '03 Frame and service day',
            '04 Style',
            '05 Lines',
            '06 Export',
          ],
          perCell: ['01: 1', '02: 1', '03: 1', '04: 1', '05: 1', '06: 1'],
          deeper: [],
        })

      await sweep(page, 'the project, cell 06 open')

      // Export gives way to Cancel, and Cancel to Reveal: focus follows.
      await pressWithKeyboard(tab.getByRole('button', { name: 'Export', exact: true }))
      await expect(tab.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
      await expect(tab.getByRole('button', { name: 'Reveal' })).toBeFocused()
      await sweep(page, 'the project, an export finished')

      // The run's region is named for the run (issue 258): "Export run", as
      // cell 02's is "Layout run", and not "Export", which is the name of
      // the button inside it that starts the next one. The sweep above says
      // so as well, but only by finding no pair; this is the name itself.
      const run = tab.getByRole('region', { name: 'Export run', exact: true })
      await expect(run).toBeVisible()
      await expect(run.getByRole('button', { name: 'Export', exact: true })).toBeVisible()

      // The rule, seen to see (issue 208). There is no known pair now, so
      // the sweep is the rule with nothing excused, and a sweep is green
      // just the same when the rule has stopped reading the tree - a later
      // Playwright writing a name where the rule takes it for text would
      // pass every sweep there is. So the rule is shown a pair it has to
      // find: the one this screen held until issue 258, put back on the live
      // tree by naming the region "Export" again, and asked alone, with
      // every line read. It has to answer that pair and only that pair.
      //
      // What it does not notice is the call inside `sweep()` being
      // deleted, since it asks the rule and not the sweep. A unit test
      // reads the sweep's source for that call ("the sweep", in
      // `tests/unit/a11y-names.test.ts`), and nothing that runs the
      // application does.
      const region = await run.elementHandle()
      if (region === null) throw new Error('the export run has no region to rename')
      await region.evaluate((el) => el.setAttribute('aria-label', 'Export'))
      try {
        const alone = duplicatedNames(await page.locator('body').ariaSnapshot(), [])
        expect(alone.unread, 'every line of the snapshot is read').toEqual([])
        expect(
          alone.pairs.map(describePair),
          'the rule alone, over the project once an export has finished, with the region named as the button is',
        ).toEqual(['region "Export" contains button "Export"'])
      } finally {
        await region.evaluate((el) => el.setAttribute('aria-label', 'Export run'))
      }
    },
    { env: { LEGIBLE_EXPORT_FOLDER: exportFolder } },
  )
})

/**
 * The notebook's heading outline, as a screen reader's heading list would
 * read it (issue 197): every `h2` in the column that is not hidden, and how
 * many each cell holds. What "not hidden" and "in the column" mean exactly
 * is in `met` and `column` below; the scope is the point rather than an
 * implementation detail, because the project screen carries second-level
 * headings that are not the notebook's and are right where they are.
 *
 * Read from the document rather than through roles because what is being
 * asserted is the outline itself - the levels and their order - and
 * `getByRole('heading')` would answer the same for an `h2` and an `h3`
 * given a level filter each time. A cell's row is named by its contents, so
 * it is read as the number and name it draws; anything else answers its own
 * text, which is how a panel heading that came back would be seen.
 *
 * The suite's own sweep cannot see this class of defect at all: it asks
 * whether a control has a name (`expectNamed`) and whether a name is said
 * again inside the element it names (`expectNoDuplicatedNames`), never
 * whether an outline is sane. That is why this check is here and not in
 * `tests/support/a11y.ts`, which every screen goes through: Settings' six
 * `h2`s under its `h1` are correct, and a rule saying "six second-level
 * headings, the cells'" is the notebook's alone.
 */
async function outline(
  page: Page,
): Promise<{ second: string[]; perCell: string[]; deeper: string[] }> {
  return page.evaluate(() => {
    // The headings that are not inside a `display: none` subtree, which is
    // what `checkVisibility()` answers and is narrower than "the headings a
    // person would meet" - a heading hidden by `visibility`, by `opacity` or
    // off the side of the screen still counts here. That is the safe
    // direction: this check can only over-count, and over-counting fails
    // rather than passes. A visually hidden heading counts too, and should,
    // because a screen reader meets it.
    //
    // It matters because the project screen keeps two `ConfirmDialog`s in
    // the document at all times, each with a real `<h2>` for its title:
    // the re-layout warning, which `LayoutRun` renders inside cell 02, and
    // the delete confirmation under the notebook. Both are shut.
    //
    // Their `h2`s are right and are not to be demoted. A dialog's title
    // names the dialog rather than a section of the cell it happens to be
    // written in, and while one is open it should be a top-level heading of
    // what is then on screen. They are simply not part of this outline
    // while they are closed, and a check that counted them would be
    // asserting markup while claiming to describe a heading walk.
    //
    // `checkVisibility()` and not a list of `dialog` and `[role="dialog"]`
    // subtrees to exclude: a list has to be kept current, and the next
    // hidden thing to land inside a cell would come back as this same
    // failure. It is also the general answer - a `display: none` subtree is
    // out of the accessibility tree whatever put it there - and it makes a
    // collapsed cell's contents absent too, which is again what a person
    // meets. That last part is why the outline is read a second time in
    // 'cell 06, and focus through an export', where all six are open.
    const met = (h: Element): boolean => h.checkVisibility()

    // `second` is the notebook's own outline and not the whole screen's.
    // The column is `.notebook`, whose children are the map and the six
    // cells (`Notebook.tsx`, `notebook.css`); the rail sits outside it, as
    // do the header, the footer and the inspector.
    //
    // Scoped rather than given a list of what else to expect, because the
    // screen's furniture is not this check's subject. The rail's "Outputs"
    // (A5.5-21) is a real second-level heading of the project screen and
    // belongs exactly where it is, as the inspector's "Jobs" does
    // (ADR-036). Neither is part of the notebook's outline, and a check
    // that named them would be rewritten by every branch that puts another
    // region beside the column.
    //
    // What that gives up, plainly: an `h2` outside a cell but inside the
    // column is still caught - the map's own part of it included - and one
    // anywhere else on the project screen is no longer this check's
    // business. The inspector used to be kept out by reading the outline
    // before it was opened; the scope is what keeps it out now, which is
    // the better of the two, since an ordering that has to be remembered
    // is an exclusion that rots.
    //
    // A missing column answers nothing and fails against six expected
    // rows, rather than passing empty.
    const column = document.querySelector('.notebook')
    // `cells` is deliberately not scoped the same way: a cell is a cell
    // wherever it is drawn, and the two fields below should follow one that
    // ever appears outside the column rather than stop seeing it. Every
    // `section.cell` on this screen is inside it today (`Notebook.tsx`), so
    // a panel `h2` returning inside a cell is caught twice over - once here
    // and once in `second`.
    const cells = [...document.querySelectorAll('section.cell')]
    return {
      second: [...(column?.querySelectorAll('h2') ?? [])].filter(met).map((h) => {
        const number = h.querySelector('.cell-number')?.textContent ?? ''
        const name = h.querySelector('.cell-name')?.textContent ?? ''
        return number === '' && name === '' ? (h.textContent ?? '').trim() : `${number} ${name}`
      }),
      perCell: cells.map(
        (cell) =>
          `${cell.getAttribute('data-cell')}: ${[...cell.querySelectorAll('h2')].filter(met).length}`,
      ),
      // Every heading inside a cell that is neither the row nor a panel's
      // own level: an `h1`, or an `h4` and below, which skips one and reads
      // as a hole in the outline.
      deeper: cells.flatMap((cell) =>
        [...cell.querySelectorAll('h1, h4, h5, h6')]
          .filter(met)
          .map(
            (h) =>
              `${cell.getAttribute('data-cell')}: ${h.tagName.toLowerCase()} ${(h.textContent ?? '').trim()}`,
          ),
      ),
    }
  })
}

/**
 * A page for the viewer's frames with many controls of its own, as the
 * engine's page has: the stand-in's page holds none, so a Tab walk through it
 * would be no longer than the skip. It says which address it was loaded at,
 * so a test can wait for a frame to hold the one it expects, and answers the
 * viewer's `state` so the screen does not report the map missing.
 *
 * Its controls are drawn only at an address carrying `controls=1`, which is
 * the map's (`Viewer.tsx`), as the engine's page draws its header only
 * there: the address cell 06's preview is given never carries it. Measured
 * against a page the pinned engine (v0.10.1) generated, the preview's frame
 * took no Tab stop at all and had nothing in it that could take focus; that
 * is what this page reproduces, so the walk below asserts the app's half -
 * a titled frame that is never a trap - against a page that behaves as the
 * engine's does.
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
<div id="controls">
${buttons}
</div>
<p id="where"></p>
<script>
  document.getElementById('where').textContent = location.search
  if (!/[?&]controls=1(&|$)/.test(location.search)) document.getElementById('controls').remove()
  window.__present = { state: function () { return {} } }
</script>
</body>
`
}

test('a cell row shows a chevron that turns, and its ground is balanced about its text', async () => {
  // Issue 279. The row is the toggle and nothing on it said so; and the
  // kit's heading margin and baseline alignment had the hover ground sit
  // high on the text and stop short of the cell's border.
  test.setTimeout(180_000)
  await withApp(profile(), async (page) => {
    await openLaidOut(page, 'Los Angeles')
    for (const id of ['data', 'lines'] as const) {
      const row = page.locator(`.cell[data-cell="${id === 'data' ? '01' : '05'}"] .cell-head`)
      const chevron = row.locator('.cell-chevron')
      const turn = (): Promise<string> => chevron.evaluate((el) => getComputedStyle(el).transform)
      await openCell(page, id)
      // A quarter turn is the matrix (0, 1, -1, 0) up to rounding; the
      // transition runs where motion is allowed, so it is polled for.
      await expect.poll(turn).toMatch(/^matrix\(0, 1, -1, 0|^matrix\(6\.\d+e-17, 1, -1, 6\.\d+e-17/)
      await closeCell(page, id)
      await expect.poll(turn).toBe('none')
      // Under reduced motion the turn has no transition (issue 279).
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await expect
        .poll(() => chevron.evaluate((el) => getComputedStyle(el).transitionDuration))
        .toBe('0s')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await expect
        .poll(() => chevron.evaluate((el) => getComputedStyle(el).transitionDuration))
        .not.toBe('0s')

      // The ground is as deep above the text as below it, and reaches the
      // cell's own border at both ends.
      const box = await row.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const name = el.querySelector('.cell-name')!.getBoundingClientRect()
        const cell = el.closest('.cell')!.getBoundingClientRect()
        return { above: name.top - r.top, below: r.bottom - name.bottom, edge: r.top - cell.top }
      })
      expect(Math.abs(box.above - box.below), `${id}: ${JSON.stringify(box)}`).toBeLessThanOrEqual(
        1,
      )
      // The cell's border is one pixel; nothing else stands between.
      expect(box.edge, `${id} row starts at the cell's border`).toBeLessThanOrEqual(1)
      await openCell(page, id)
    }
  })
})

test('the project screen: one press skips past the map to cell 03, the map stays reachable, and the preview is no trap', async () => {
  // Issue 106, finding F3 in docs/accessibility.md; the skip's target and
  // the walk over two frames are ADR-046's (specs/029 FR-011, FR-012).
  test.setTimeout(240_000)
  const p = profile()
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    const controls = 40
    const [id] = readdirSync(join(p.engineHome, 'projects'))
    const out = join(p.engineHome, 'out', id)
    for (const name of readdirSync(out).filter((n) => n.endsWith('.html')))
      writeFileSync(join(out, name), busyMapPage(controls))
    // Leave and come back, so the viewer loads the page again. A laid-out
    // project opens with cells 01 and 02 collapsed (FR-010), so the map is
    // the first tall thing on screen.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await page.getByRole('button', { name: 'Open Los Angeles' }).click()
    await expect(heading(page)).toHaveText('Los Angeles')

    const skip = page.getByRole('button', { name: 'Skip past the map', exact: true })
    const frame = page.frameLocator('iframe.viewer-frame')
    const width = (): Promise<number> => skip.evaluate((el) => el.getBoundingClientRect().width)
    const activeTag = (): Promise<string> =>
      page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'nothing')

    // The frame holds the busy page and has stopped moving: everything
    // below walks the Tab order through it, and a frame that reloads
    // mid-walk loses the focus the walk just gave it. The two facts come
    // out of one snapshot taken inside the frame (issue 147, item 3), and
    // two readings a second apart agreeing on the document's birth time is
    // what tells a settled frame from one between two loads.
    type Frame = { address: boolean; controls: number; born: number }
    const gone: Frame = { address: false, controls: 0, born: 0 }
    const look = async (): Promise<Frame> => {
      try {
        return await frame.locator('body').evaluate((body) => {
          const where = body.querySelector('#where')?.textContent ?? ''
          return {
            address: where.includes('controls=1'),
            controls: body.querySelectorAll('button').length,
            born: performance.timeOrigin,
          }
        })
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
        intervals: [1000],
        timeout: 60_000,
        message: 'the busy page in the map, and not about to reload',
      })
      .toEqual({ address: true, controls, born: expect.any(Number), still: true })

    // Out of sight while it does not hold focus, and in the document.
    await expect.poll(width, { message: 'hidden at rest' }).toBeLessThanOrEqual(1)
    // It moves nothing: the map is where it was before the skip appeared.
    // Read with nothing between the two readings that scrolls, within half
    // a pixel, because a scroll can land on a fraction of one.
    const mapAt = (): Promise<{ top: number; height: number }> =>
      page.locator('section.viewer').evaluate((el) => {
        const map = el.getBoundingClientRect()
        return { top: map.top, height: map.height }
      })
    const atRest = await mapAt()
    await skip.focus()
    await expect(skip).toBeFocused()
    const shown = await mapAt()
    expect(shown.top, 'the map does not move when the skip appears').toBeCloseTo(atRest.top, 0)
    expect(shown.height, 'the map keeps its size').toBeCloseTo(atRest.height, 0)

    // The map is in the column after cell 02 (ADR-046), so the stop before
    // the skip is cell 02's row, which is collapsed on a laid-out project.
    await page.keyboard.press('Shift+Tab')
    await expect(cellHeading(page, 'process'), 'the stop before the skip is cell 02').toBeFocused()
    await page.keyboard.press('Tab')
    await expect(skip).toBeFocused()

    // Seen once it holds focus: a target of at least 24px, unclipped, in
    // the viewport, with the focus ring.
    await expect(skip).toBeInViewport()
    const box = await skip.boundingBox()
    expect(box?.width ?? 0, 'shown when focused').toBeGreaterThan(24)
    expect(box?.height ?? 0, 'a target when focused').toBeGreaterThanOrEqual(24)
    expect(await skip.evaluate((el) => getComputedStyle(el).clipPath)).toBe('none')
    expect(await skip.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid')

    // Not used, the next Tab goes into the map: its first control.
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
      .poll(inside, { message: "one press past the skip is the map's first control" })
      .toEqual({ focused: 'Map control 1', controls })
    expect(await activeTag(), 'focus is in the frame').toBe('iframe')
    await expect.poll(width, { message: 'hidden again' }).toBeLessThanOrEqual(1)

    // Back out of the map to the skip, and pressed: cell 03's heading, the
    // first thing after the map, however many controls the map has. The
    // heading and not the toggle inside it, so a reflexive Space after the
    // press does not collapse the cell (FR-011).
    await page.keyboard.press('Shift+Tab')
    await expect(skip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(cellHandback(page, 'frame'), "the skip lands on cell 03's heading").toBeFocused()
    await expect.poll(width, { message: 'hidden after the skip' }).toBeLessThanOrEqual(1)
    await page.keyboard.press('Tab')
    await expect(cellHeading(page, 'frame')).toBeFocused()

    // The walk over the second frame (FR-012). Cell 06 opens with a frame
    // of its own, and the walk from its heading counts the stops inside
    // that frame on the way to the cell's first choice. The number is
    // recorded; fewer than five needs no skip of its own, provided the
    // frame has a title and focus comes out of it.
    await openCell(page, 'export')
    const preview = page.locator('iframe.export-frame')
    await expect(preview).toHaveCount(1, { timeout: 60_000 })
    await expect(preview).toHaveAttribute('title', 'Los Angeles, as the export will frame it')
    await expect
      .poll(
        () =>
          page
            .frameLocator('iframe.export-frame')
            .locator('#where')
            .textContent()
            .catch(() => ''),
        { timeout: 30_000 },
      )
      .toMatch(/[?&]frame=/)
    await cellHeading(page, 'export').focus()
    let stops = 0
    let leftTo = ''
    for (let i = 0; i < 60 && leftTo === ''; i += 1) {
      await page.keyboard.press('Tab')
      const where = await page.evaluate(() => {
        const a = document.activeElement
        return a === null ? 'nothing' : `${a.tagName.toLowerCase()}.${a.className}`
      })
      if (where.startsWith('iframe.export-frame')) stops += 1
      else leftTo = where
    }
    test.info().annotations.push({
      type: 'Tab stops in the export frame',
      description: String(stops),
    })
    // The stand-in's planned page has no controls without `controls=1`, so
    // this count cannot fail on its own; the real planned page measured 0 by
    // hand (and the map's own page 4), recorded in ADR-046. It holds the walk,
    // not the number.
    expect(stops, 'the preview takes fewer than five Tab stops (FR-012)').toBeLessThan(5)
    expect(leftTo, 'focus came out of the preview: it is no trap').not.toBe('')
    await expect(
      cell(page, 'export').getByRole('combobox', { name: 'Preset' }),
      'the walk reaches the cell’s first choice',
    ).toBeFocused()
  })
})

test('the Tab walk hands over at the map frame by identity, and asks again from the frame it began at', async () => {
  // Issue 271: the sweep's in-page half, driven by hand. The sweep reaches
  // the hand-over only when a press of Tab leaves the document reading the
  // map's frame as focused, which a fast machine never shows (the frame's
  // page has nothing focusable in present mode, so the press passes through
  // it) and a slow runner now and then does. So the frame is focused here
  // from the document, which is deterministic, and the probe's three
  // answers are read: that the frame is told apart, that the control asked
  // for is read by identity and not by description, and that a second ask
  // is made from the remembered frame once focus has left it.
  test.setTimeout(120_000)
  const p = profile()
  await withApp(p, async (page) => {
    await openLaidOut(page, 'Los Angeles')
    await expect(heading(page)).toHaveText('Los Angeles')
    const frame = page.locator('iframe.viewer-frame')
    await expect(frame, 'the map is drawn').toBeVisible({ timeout: 60_000 })

    const probe = {
      begin: () => page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.begin()),
      step: () => page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.step()),
      past: (again: boolean) =>
        page.evaluate(
          (again) => (window as unknown as { __a11y: Probe }).__a11y.past(again),
          again,
        ),
      lapsed: () => page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.lapsed()),
    }
    /** Read until the document says focus is on the control `past()` put it on: a deadline, not a count of readings. */
    const arrival = async (): Promise<StepAnswer> => {
      const deadline = Date.now() + 10_000
      let reading = await probe.step()
      while (!reading.onAimed && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25))
        reading = await probe.step()
      }
      return reading
    }

    await page.evaluate(installProbe)
    expect(await probe.begin(), 'there are controls to reach').toBeGreaterThan(0)

    // The frame holds focus, and the document says so.
    await frame.evaluate((el) => (el as HTMLElement).focus())
    await expect
      .poll(async () => (await probe.step()).state, { message: 'the map frame holds focus' })
      .toBe('frame')

    // Asked from the frame: the first control wanted after it, which is
    // cell 03's heading row (ADR-046), named as the probe names it.
    const first = await probe.past(false)
    expect(first, "the first control after the map is cell 03's heading row").toMatch(/^button "03/)
    // Read by identity: the very element asked for. A reading of the
    // frame, of nothing or of some other control is not it.
    const landed = await arrival()
    expect(landed, 'the document reads focus on the control that was asked for').toMatchObject({
      state: 'stop',
      onAimed: true,
    })
    expect(landed.at).toMatch(/^button "03/)
    await expect(cellHeading(page, 'frame'), 'and it is the one a person sees').toBeFocused()

    // Asked again, now that focus has left the frame: the same question of
    // the frame the first ask began at. Cell 03's row has been read, so the
    // answer is the next control wanted, and the document reads that one.
    const second = await probe.past(true)
    expect(second, 'a re-ask from the remembered frame answers').not.toBeNull()
    expect(second, 'and names the next control, not the one already read').not.toBe(first)
    expect((await arrival()).onAimed, 'the document reads focus on the second control').toBe(true)

    // Asked from the frame again with focus in no frame: nothing to ask,
    // and the remembered frame is not lost for it.
    expect(await probe.past(false), 'a first ask with focus in no frame answers null').toBeNull()
    expect(await probe.past(true), 'the remembered frame still answers').not.toBeNull()

    // A reading of nothing that does not settle is handed over from the
    // frame the press went into, and cell 06 has a frame of its own, mounted
    // while it is open (ADR-046): the map's frame is earlier in the document
    // and is not the one to ask from. It is cell 06's preview frame, a full
    // page that may still be loading when focus arrives, where a runner read
    // nothing for more than a second.
    await openCell(page, 'export')
    const preview = page.locator('iframe.export-frame')
    await expect(preview, "cell 06's preview frame is mounted").toBeVisible({ timeout: 60_000 })
    const preset = cell(page, 'export').getByRole('combobox', { name: 'Preset' })
    await expect(preset).toBeVisible()

    // Asked from that frame by name, with focus nowhere near it: the first
    // control after it, by identity. Not the first control after the map,
    // which is cell 03's row and which this walk has not read.
    expect(await probe.begin(), 'there are controls to reach').toBeGreaterThan(0)
    expect(
      await preview.evaluate((el) =>
        (window as unknown as { __a11y: Probe }).__a11y.past(false, el),
      ),
      'asked from the preview frame, there is a control after it',
    ).not.toBeNull()
    expect((await arrival()).onAimed, 'the document reads focus on it').toBe(true)
    await expect(preset, 'the first control after the preview frame').toBeFocused()

    // Found by the probe, as a lapse finds it: the last control read is
    // cell 06's row, the next wanted is past the preview frame, and the
    // frame between them is the preview and not the map. The asking is then
    // from the origin the probe recorded.
    expect(await probe.begin()).toBeGreaterThan(0)
    await cellHeading(page, 'export').focus()
    expect((await probe.step()).state, "cell 06's row is read as a stop").toBe('stop')
    expect(
      crossingOf(await probe.lapsed()),
      'a lapse after cell 06 is in the preview frame',
    ).toEqual({
      kind: 'frame',
      frame: expect.stringContaining('as the export will frame it'),
    })
    expect(await probe.past(true), 'asked from the recorded origin').not.toBeNull()
    expect((await arrival()).onAimed, 'the document reads focus on it').toBe(true)
    await expect(preset, 'the first control after the preview frame, by the lapse').toBeFocused()

    // And past the end of the document: the footer's last control is read,
    // nothing wanted follows it, and the asking is from the top, which is
    // the header's first control.
    expect(await probe.begin()).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Delete project', exact: true }).focus()
    expect((await probe.step()).state, 'the last control is read as a stop').toBe('stop')
    expect(crossingOf(await probe.lapsed()), 'a lapse after the last control is the wrap').toEqual({
      kind: 'wrap',
      frame: null,
    })
    expect(await probe.past(true), 'asked from the top').not.toBeNull()
    expect((await arrival()).onAimed, 'the document reads focus on it').toBe(true)
    await expect(
      page.getByRole('button', { name: 'Back to Library', exact: true }),
      "the header's first control",
    ).toBeFocused()

    // But not when the control a press off the end comes back to has been
    // read: handing over from the top would focus the first control not yet
    // read, which the walk passed over, and the sweep would pass where it
    // reports the miss. The walk presses on instead.
    expect(await probe.begin()).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Back to Library', exact: true }).focus()
    expect((await probe.step()).state, "the header's first control is read").toBe('stop')
    await page.getByRole('button', { name: 'Delete project', exact: true }).focus()
    expect((await probe.step()).state, 'and then the last').toBe('stop')
    expect(
      crossingOf(await probe.lapsed()),
      'a lapse at the wrap, with the first control already read, is not handed over',
    ).toEqual({ kind: 'open', frame: null })

    // Nor is a lapse beside a frame Tab cannot enter. Cell 01's stage view
    // draws the layout in a frame with `tabindex="-1"` and `aria-hidden`
    // inside its pane, and the pane is a stop of its own, the last before
    // the frame: a reading that lapses after the pane is not in that frame.
    // Every step of it is asserted, because a pane that did not take focus
    // would leave the probe reading the heading `begin()` focused, which is
    // a stop too, and the frame would be missed for the wrong reason.
    await openCell(page, 'data')
    await expect(page.locator('iframe.stage-frame'), 'the stage view is drawn').toHaveCount(1, {
      timeout: 30_000,
    })
    const pane = page.getByRole('group', { name: /^The gtfs2graph stage/ })
    await expect(pane, "the stage view's pane is on screen").toBeVisible()
    expect(await probe.begin()).toBeGreaterThan(0)
    await pane.focus()
    await expect(pane, 'and takes focus').toBeFocused()
    const paneRead = await probe.step()
    expect(paneRead.state, "the stage view's pane is read as a stop").toBe('stop')
    expect(paneRead.at, 'and what was read is the pane, not the heading').toContain(
      'The gtfs2graph stage',
    )
    const beside = await probe.lapsed()
    expect(beside, 'a control follows the pane').toMatchObject({ next: true, detached: false })
    expect(beside.skipped, 'the frame was seen between them and let go').toBe(
      'iframe "gtfs2graph stage of the layout"',
    )
    expect(beside.frame, 'the frame that takes no focus is not one a press enters').toBeNull()
    expect(crossingOf(beside)).toEqual({ kind: 'open', frame: null })
  })
})
