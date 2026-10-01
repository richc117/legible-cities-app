// The rail (A5.5-21, ADR-045, docs/DESIGN.md 8.2, "The rail and its
// stepper" and "Outputs"): what only a running window shows.
//
// Four things, and the first is the one this issue exists for.
//
// **A step lands its cell clear of the header.** The header is the only
// thing pinned since ADR-046 put the map in the column's flow. From
// A5.5-20 until then a band half the window tall sat under the header and
// a step had to clear its foot, and a cell that landed behind it in CI by a
// fixed figure was issue 240. The assertion is against the header's
// *measured* foot, at two cells' geometry, and once at the header itself
// for a cell with room below it, so a clearance deeper than the header
// fails here.
//
// **The current step follows the scroll and takes no focus.** A person
// reading down the notebook has not asked to be moved anywhere, so the
// assertion is on both halves: the mark moves, and the focused element does
// not. It asserts the rule against the layout as it really is rather than
// naming a cell.
//
// **Outputs come from the files and not from the session.** Every row here
// is written into the export folder before the project is ever opened, so
// no export has run in this process at all - which is a stronger statement
// than the restart the acceptance criterion asks for, and needs no export.
//
// **The rail collapses below 900px, and is inert under the inspector.**
// The name and the state leave the eye and stay in the accessibility tree,
// and the whole main region - the rail with it - is inert while the
// inspector covers it, which is `App.tsx`'s own attribute rather than a
// second rule that could disagree with it.

import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { cellHandback, laidOutProject, openProject } from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

const PROJECT = 'Los Angeles'

interface Home {
  engineHome: string
  userData: string
  exportFolder: string
}

function home(): Home {
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-rail-'))
  const engineHome = join(dir, 'engine')
  mkdirSync(engineHome)
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 5 }),
  )
  // A profile and an export folder of this file's own, so nothing here
  // writes a person's own (`log-file.ts`, and the trap A4-03 met).
  return { engineHome, userData: join(dir, 'profile'), exportFolder: join(dir, 'exports') }
}

async function withApp(h: Home, run: (page: Page) => Promise<void>): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: h.engineHome,
      LEGIBLE_USER_DATA: h.userData,
      LEGIBLE_EXPORT_FOLDER: h.exportFolder,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
    } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    // No smooth scrolling under reduced motion, which is the design row's
    // own rule and is also what makes a measurement here a measurement
    // rather than a race against an animation. Emulated per page, never
    // through nativeTheme (rules/renderer.md).
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await run(page)
  } finally {
    await app.close()
    rmSync(h.engineHome, { recursive: true, force: true })
    rmSync(h.exportFolder, { recursive: true, force: true })
  }
}

/** A step in the rail, by the cell it names. */
const step = (page: Page, name: string | RegExp): ReturnType<Page['getByRole']> =>
  page.getByRole('navigation', { name: 'Steps' }).getByRole('button', { name })

/** Where the header ends, in the window's own coordinates: the only thing pinned. */
const headerFoot = (page: Page): Promise<number> =>
  page.locator('.app-header').evaluate((el) => el.getBoundingClientRect().bottom)

/** Where a cell's box begins, in the same coordinates. */
const cellTop = (page: Page, number: string): Promise<number> =>
  page.locator(`.cell[data-cell="${number}"]`).evaluate((el) => el.getBoundingClientRect().top)

/** One finished export as the engine leaves it: the file, and its sidecar. */
function wroteExport(h: Home, file: string, preset: string): void {
  const folder = join(h.exportFolder, PROJECT)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, file), 'a stand-in deliverable')
  writeFileSync(join(folder, `${file}.json`), JSON.stringify({ file, preset, alt: 'a map' }))
}

test('the six cells are a named stepper, and never a tablist', async () => {
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    const rail = page.getByRole('navigation', { name: 'Steps' })
    await expect(rail.getByRole('listitem')).toHaveCount(6)
    // Number, name and state as one name, which is what a screen reader
    // reads and what a person sees, in that order (WCAG 2.5.3).
    await expect(step(page, /^01 Data, /)).toBeVisible()
    await expect(step(page, /^06 Export, /)).toBeVisible()
    // The promise a tablist makes is that the other five panels are hidden.
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })
})

test('a step opens its cell, lands it clear of the header, and focuses its heading', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', PROJECT)

    // Two cells, one either side of where the map is now. Each lands with
    // its top at the header's foot, or below it where the document is too
    // short to scroll that far - and never behind it (issue 240's
    // criterion). The header is the only thing pinned since ADR-046.
    for (const { id, number, name } of [
      { id: 'frame', number: '03', name: /^03 Frame and service day, / },
      { id: 'lines', number: '05', name: /^05 Lines, / },
    ] as const) {
      await page.evaluate(() => window.scrollTo(0, 0))
      await step(page, name).click()
      // The cell is open and its heading has focus...
      await expect(cellHandback(page, id)).toBeFocused()
      // ...the page moved to it...
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      // ...and its top is at or below the header's foot, never behind it.
      // Re-read after the scroll has settled, with a pixel of slack because
      // a rounded layout is not integral.
      await expect
        .poll(async () => (await cellTop(page, number)) - (await headerFoot(page)), {
          timeout: 10_000,
        })
        .toBeGreaterThanOrEqual(-1)
    }

    // Cell 03 has a document below it, so it lands at the header itself and
    // not merely somewhere below it: a clearance deeper than the header (the
    // band it used to clear) would leave it lower than this.
    await page.evaluate(() => window.scrollTo(0, 0))
    await step(page, /^03 Frame and service day, /).click()
    await expect
      .poll(async () => Math.abs((await cellTop(page, '03')) - (await headerFoot(page))), {
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(2)
  })
})

test('the current step follows the scroll, and takes no focus doing it', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    await expect(step(page, /^01 Data, /)).toHaveAttribute('aria-current', 'step')

    // Focus somewhere a scroll must not take it from.
    const back = page.getByRole('button', { name: 'Back to Library' })
    await back.focus()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    // That the scroll moved at all, said separately: without this, a page
    // that could not scroll and a mark that did not follow fail the same
    // way, and the next person has to work out which.
    expect(await page.evaluate(() => window.scrollY), 'the page scrolled').toBeGreaterThan(0)

    // The mark moved off the first cell...
    await expect(step(page, /^01 Data, /)).not.toHaveAttribute('aria-current', 'step')
    // ...and what is asserted is the rule itself, against the layout as it
    // really is rather than a named cell: the step that carries the mark
    // names the first cell with any of itself below the header, which since
    // ADR-046 is the only thing a cell can be behind.
    const marked = await page.locator('.rail-step[aria-current="step"]').getAttribute('aria-label')
    expect(marked, 'some step carries the mark').not.toBeNull()
    const number = /^(\d\d) /.exec(marked as string)?.[1]
    expect(number, `"${marked}" begins with a cell number`).toBeDefined()
    const foot = await headerFoot(page)
    const feet = await page.evaluate(() =>
      [...document.querySelectorAll('.cell')].map((el) => ({
        cell: el.getAttribute('data-cell') ?? '',
        bottom: el.getBoundingClientRect().bottom,
      })),
    )
    for (const { cell, bottom } of feet) {
      if (cell < (number as string))
        expect(
          bottom,
          `cell ${cell} is behind the header, before the marked one`,
        ).toBeLessThanOrEqual(foot + 1)
      if (cell === number)
        expect(bottom, `the marked cell ${cell} shows below the header`).toBeGreaterThan(foot)
    }

    // And none of it moved focus.
    await expect(back).toBeFocused()
  })
})

test('Outputs lists what is on disk, from files this session never wrote', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    // Written before the project is opened, so nothing in this process has
    // ever seen an export: this is the restart, without the restart.
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    await expect(page.getByText('Nothing exported yet.')).toBeVisible()

    wroteExport(h, 'la-reel.mp4', 'instagram-reel')
    // Back to the Library and in again, which mounts the screen afresh.
    await page.getByRole('button', { name: 'Back to Library' }).click()
    await openProject(page, PROJECT)

    const outputs = page.getByRole('region', { name: 'Outputs' })
    await expect(outputs.getByText('instagram-reel')).toBeVisible()
    await expect(outputs.getByRole('button', { name: /^Reveal / })).toBeVisible()
    // No path, anywhere in the rail (constitution V).
    await expect(page.locator('.rail')).not.toContainText(h.exportFolder)
  })
})

test('a file moved or deleted since reads as gone, and offers nothing to press', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    wroteExport(h, 'la-reel.mp4', 'instagram-reel')
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    const outputs = page.getByRole('region', { name: 'Outputs' })
    const reveal = outputs.getByRole('button', { name: /^Reveal / })
    await expect(reveal).toBeVisible()

    // Taken away behind the app's back, as a person tidying a folder does.
    unlinkSync(join(h.exportFolder, PROJECT, 'la-reel.mp4'))
    // The press finds it gone, says so, and does not fail: the row stays,
    // because what was made is still worth saying.
    await reveal.click()
    await expect(outputs.getByText('the file has been moved or deleted')).toBeVisible()
    await expect(outputs.getByText('instagram-reel')).toBeVisible()
    await expect(reveal).toHaveCount(0)
    // An icon beside the sentence, never the hue by itself (principle 1).
    await expect(outputs.locator('.output-gone .icon')).toHaveCount(1)

    // And the button went under a person's finger, so focus went with it:
    // handed to this section's heading rather than dropped on the body,
    // which throws a keyboard user to the top of the screen with nothing
    // said (A6-07, `focusHandback.ts`).
    await expect(outputs.getByRole('heading', { name: 'Outputs' })).toBeFocused()
    expect(
      await page.evaluate(() => document.activeElement?.tagName.toLowerCase() ?? 'nothing'),
      'focus is not on the body',
    ).toBe('h2')
  })
})

test("the rail's headings, every step's number and Outputs start at one edge", async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    const heading = page.locator('.rail-heading')
    await expect(heading).toBeVisible()
    await expect(heading).toHaveText(/\S/)
    // The text's own left edge, not its box's: a Range over the contents.
    const lefts = await page.evaluate(() => {
      const edge = (el: Element): number => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getBoundingClientRect().left
      }
      return {
        heading: edge(document.querySelector('.rail-heading')!),
        numbers: [...document.querySelectorAll('.rail-number')].map(edge),
        outputs: edge(document.querySelector('#outputs-heading')!),
      }
    })
    // A step is one control's height, so the ground under the pointer and
    // the selected one are a button's and no taller, and its text is inside.
    const steps = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.rail-step')].map((el) => ({
        height: el.getBoundingClientRect().height,
        over: el.scrollHeight - el.clientHeight,
      })),
    )
    expect(steps).toHaveLength(6)
    for (const step of steps) {
      expect(step.height).toBeCloseTo(28, 0)
      expect(step.over).toBeLessThanOrEqual(0)
    }
    for (const left of [...lefts.numbers, lefts.outputs]) {
      expect(Math.abs(left - lefts.heading)).toBeLessThanOrEqual(1)
    }
  })
})

test('below 900px the rail collapses to its numbers and keeps its names', async () => {
  test.setTimeout(120_000)
  const h = home()
  await withApp(h, async (page) => {
    await laidOutProject(page, 'LA Metro Rail', PROJECT)
    await page.setViewportSize({ width: 800, height: 800 })

    // The number is what is drawn...
    await expect(page.locator('.rail-number').first()).toBeVisible()
    // ...and the name is clipped rather than removed, so the step still
    // says which cell it is to anything that is not an eye. `display: none`
    // would take it out of the accessibility tree with the picture.
    await expect
      .poll(() =>
        page
          .locator('.rail-name')
          .first()
          .evaluate((el) => (el as HTMLElement).offsetWidth),
      )
      .toBeLessThanOrEqual(1)
    await expect(step(page, /^01 Data, /)).toBeVisible()
    // The number is centred in its step: a left padding with no right one
    // would push it off by half of itself (issue 274).
    const offCentre = await page.evaluate(() => {
      const number = document.querySelector('.rail-number')!.getBoundingClientRect()
      const step = document.querySelector('.rail-step')!.getBoundingClientRect()
      return Math.abs(number.left + number.width / 2 - (step.left + step.width / 2))
    })
    expect(offCentre).toBeLessThanOrEqual(1)
    // The collapsed step is one control's height too.
    const collapsed = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.rail-step')].map((el) => ({
        height: el.getBoundingClientRect().height,
        over: el.scrollHeight - el.clientHeight,
      })),
    )
    expect(collapsed).toHaveLength(6)
    for (const step of collapsed) {
      expect(step.height).toBeCloseTo(28, 0)
      expect(step.over).toBeLessThanOrEqual(0)
    }
    // The project's name goes as Outputs goes; the nav's label still names it.
    await expect(page.locator('.rail-heading')).toBeHidden()

    // Inert under the inspector, which is the main region's own attribute:
    // Shift+Tab must not reach a control a person cannot see.
    await page.getByRole('button', { name: /^Jobs/ }).click()
    await expect(page.locator('.app-main')).toHaveAttribute('inert', '')
  })
})
