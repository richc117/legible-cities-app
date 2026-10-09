// Where a project's controls live, in one file (A5.5-06, issue 158).
//
// The end-to-end suite is 7,780 lines across 22 files, and nearly every
// assertion about a project reaches its control by walking the screen's
// current shape. The notebook (ADR-045) moved all of it into six cells.
// Done a spec at a time, every branch of that refactor would edit twenty
// files and a reviewer could not tell a regression from churn.
//
// So the knowledge of *where* a control lives is here, and the specs say
// *what* they expect. A5.5-08 moved the screen and this file moved with
// it: `openCell` presses a cell's disclosure where it pressed a tab, and
// the specs that go through it did not change at all.
//
// Two things deliberately do not belong here. A spec asserting the tab
// strip's own behaviour reached for tabs directly, because that assertion
// was about the tabs and went when they did (issue 175). And the stand-in
// engine's own helpers stay in `python.ts`: this file knows about screens,
// not about processes.
//
// It lives beside the suite's other helpers in `tests/support/` rather than
// in `tests/e2e/support/`, which issue 158 named, because that is where
// `python.ts`, `store-lines.ts` and `frames.ts` already are.

import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The six cells of the notebook, by the number and name ADR-045 fixes, and
 * where each one's controls live inside it.
 *
 * `panel` is the region a cell's controls sit in, where the panel that
 * moved into the cell kept the name its own heading gave it; null where the
 * cell's own disclosed group is what holds them, which is cell 06's export.
 *
 * **Cell 05 keeps two named sections**, Line colours and Line order, and
 * A5.5-18 decided it should: one cell called Lines cannot say where the
 * colours end and the order begins, and both names are quoted in the
 * release documents. So `panel` is null for it, and `cell('lines')` answers
 * the cell's own group - the whole cell, both sections. Before A5.5-18 it
 * answered the colours alone, so a spec that reached for "cell 05" quietly
 * got half of it; `panel(page, 'Line colours')` and `panel(page, 'Line
 * order')` are how a spec names one section on purpose.
 */
const CELLS = {
  data: { number: 1, name: 'Data', panel: 'In the feed' },
  process: { number: 2, name: 'Process', panel: 'Layout run' },
  frame: { number: 3, name: 'Frame and service day', panel: 'Service day' },
  style: { number: 4, name: 'Style', panel: 'Theme' },
  lines: { number: 5, name: 'Lines', panel: null },
  export: { number: 6, name: 'Export', panel: null },
} as const

export type CellId = keyof typeof CELLS

/** `01 Data` to `06 Export`: the cell's own name, in the rail and on its heading row. */
export const cellLabel = (id: CellId): string =>
  `${String(CELLS[id].number).padStart(2, '0')} ${CELLS[id].name}`

/** The project screen's own heading, which carries the project's name. */
export const projectHeading = (page: Page): Locator => page.getByRole('heading', { level: 1 })

/** A panel by the name its region carries. */
export const panel = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true })

/**
 * A named button inside a panel, a dialog or the screen. `exact` is passed
 * through because several names are prefixes of others ("Reset line A" and
 * "Reset every line"), and a spec that meant one must not reach two.
 */
export const control = (
  scope: Page | Locator,
  name: string | RegExp,
  { exact = false }: { exact?: boolean } = {},
): Locator => scope.getByRole('button', { name, exact })

/**
 * A cell's heading row, which is its toggle: a button whose accessible name
 * is the row's own contents, so it begins with the cell's label and goes on
 * with its state.
 *
 * Narrowed to `button.cell-head` by A5.5-21: the rail's own step for the
 * same cell is named "01 Data, ready", which the label's prefix also
 * matches, and an unnarrowed locator would answer two elements on every
 * project screen.
 */
export const cellHeading = (page: Page, id: CellId): Locator =>
  page
    .getByRole('button', { name: new RegExp(`^${cellLabel(id)}\\b`) })
    .and(page.locator('button.cell-head'))

/**
 * Where a cell's controls hand focus back when one of them disables itself
 * under a person's hands: the heading the row sits in, which takes focus
 * and does nothing with it. Not the row's button - a reflexive Space or
 * Enter there would collapse the cell the person is working in.
 */
export const cellHandback = (page: Page, id: CellId): Locator =>
  page
    .locator('h2.disclosure-heading')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${cellLabel(id)}\\b`) }) })

/**
 * A cell's panel, without pressing anything: the caller has already made it
 * visible, or is asserting that it is not.
 */
export const cell = (page: Page, id: CellId): Locator => {
  const { panel: name } = CELLS[id]
  return name === null
    ? page.getByRole('group', { name: cellLabel(id), exact: true })
    : panel(page, name)
}

/**
 * How long a press on a cell's heading is given to show in the heading's
 * `aria-expanded` before it is taken for lost. The attribute follows a
 * press that landed within a frame or two; this is generous for a runner
 * that is starved, and short beside the ten seconds a lost press used to
 * cost, which were spent waiting on a group that was never going to appear
 * (issue 363).
 */
const PRESS_DEADLINE_MS = 2_000

/**
 * Press a cell's heading until `aria-expanded` says `expanded`, pressing a
 * second time at most, and only when the attribute shows the first press
 * was lost.
 *
 * A press can be lost: Playwright scrolls the heading into view, checks
 * what is under the point it will press, and then sends the mouse event,
 * and the column can move in between (issue 363's trace has the map's block
 * arriving), so the press lands where the heading was and nothing opens.
 * Pressing once and waiting on the group cannot tell that from a slow cell.
 * The attribute can: it is the heading's own state, written by the same
 * render as the group's.
 *
 * Why the attribute is read between the presses and not the press simply
 * repeated: a press that landed late must not be followed by one that
 * undoes it. Whether the second press is made is decided by a read of the
 * attribute taken right before it, after the whole deadline has passed, and
 * the page renders a press's update before it answers a read made after
 * the press was sent, so a press that landed slowly is seen by that read.
 */
async function pressHeading(
  heading: Locator,
  expanded: 'true' | 'false',
  cell: CellId,
): Promise<void> {
  if ((await heading.getAttribute('aria-expanded')) === expanded) return
  await heading.click()
  const landed = await expect(heading)
    .toHaveAttribute('aria-expanded', expanded, { timeout: PRESS_DEADLINE_MS })
    .then(
      () => true,
      () => false,
    )
  if (landed) return
  if ((await heading.getAttribute('aria-expanded')) !== expanded) {
    // Said in the job's log, so a rising rate of lost presses is seen while
    // the retry still covers it, not only once it stops covering it.
    console.log(`openCell: the press on cell ${cell}'s heading was lost; pressing again`)
    await heading.click()
  }
  await expect(
    heading,
    `cell ${cell}'s heading was pressed twice and still does not say aria-expanded="${expanded}"`,
  ).toHaveAttribute('aria-expanded', expanded)
}

/**
 * A cell's panel, opened first if it is collapsed.
 *
 * The contract, in order: press the cell's heading unless it already says
 * `aria-expanded="true"`; assert that it says so, within a short deadline;
 * if it does not, and still does not when read again, press once more and
 * assert it with the expectation's own timeout; and only then wait for the
 * cell's group to be visible. A press that was swallowed by a layout shift
 * is retried; a press that landed is never repeated (`pressHeading` has
 * the reasoning). Deadlines throughout, never a count of turns.
 */
export async function openCell(page: Page, id: CellId): Promise<Locator> {
  await pressHeading(cellHeading(page, id), 'true', id)
  await expect(cell(page, id)).toBeVisible()
  return cell(page, id)
}

/**
 * Collapse a cell, for a spec that asserts what happens once it is closed.
 *
 * The same contract as `openCell`, for `aria-expanded="false"` and the
 * cell's group hidden: press unless the heading already says so, assert
 * the attribute within a short deadline, press again once if it is still
 * unchanged on a fresh read, then wait for the group to be hidden.
 */
export async function closeCell(page: Page, id: CellId): Promise<void> {
  await pressHeading(cellHeading(page, id), 'false', id)
  await expect(cell(page, id)).toBeHidden()
}

/** The engine's status line says it is ready. A project needs one. */
export async function engineReady(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
    timeout: 20_000,
  })
}

/** Create a project on a feed from the Library, and leave it listed. */
export async function createProject(page: Page, feed: string, name: string): Promise<void> {
  await engineReady(page)
  // An added feed's row keeps its "Start a project on" button. A sample
  // city's card opens the sample outright (A5.6-03), laying it out, so a
  // project on a preset is made from New project, its feed chosen by name.
  const dialog = page.getByRole('dialog', { name: 'New project' })
  const fromRow = page
    .getByRole('listitem', { name: feed, exact: true })
    .getByRole('button', { name: `Start a project on ${feed}`, exact: true })
  if ((await fromRow.count()) > 0) {
    await fromRow.click()
  } else {
    await page.getByRole('button', { name: 'New project' }).first().click()
    const escaped = feed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const key = await dialog
      .locator('option')
      .filter({ hasText: new RegExp(`^${escaped}( \\(|$)`) })
      .first()
      .getAttribute('value')
    if (key === null) throw new Error(`no feed named ${feed} in the sheet`)
    await dialog.getByRole('combobox', { name: 'Feed' }).selectOption(key)
  }
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await control(dialog, 'Create', { exact: true }).click()
  await expect(page.getByRole('button', { name: `Open ${name}` })).toBeVisible()
}

/** Open a project that the Library already lists, and wait for its screen. */
export async function openProject(page: Page, name: string): Promise<void> {
  await control(page, `Open ${name}`).click()
  await expect(projectHeading(page)).toHaveText(name)
}

/** Lay out the open project and wait for the run to finish. */
export async function layOut(page: Page): Promise<void> {
  await control(page, /lay out/i).click()
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
}

/** The whole way in: a project on a feed, opened, with a map drawn. */
export async function laidOutProject(page: Page, feed: string, name: string): Promise<void> {
  await createProject(page, feed, name)
  await openProject(page, name)
  await layOut(page)
}

/**
 * A record as the tests that compare one before and after an action read
 * it: without `opened`, which the project screen writes a moment after it
 * opens (A5.6-04). Those tests are about what an edit, a run or a refusal
 * wrote; the opening is not theirs, and a "before" read in that moment
 * would otherwise race it.
 */
export function withoutOpened(record: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...record }
  delete rest.opened
  return rest
}
