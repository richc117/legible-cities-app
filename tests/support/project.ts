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

/** A cell's panel, opened first if it is collapsed. */
export async function openCell(page: Page, id: CellId): Promise<Locator> {
  const heading = cellHeading(page, id)
  if ((await heading.getAttribute('aria-expanded')) !== 'true') await heading.click()
  await expect(cell(page, id)).toBeVisible()
  return cell(page, id)
}

/** Collapse a cell, for a spec that asserts what happens once it is closed. */
export async function closeCell(page: Page, id: CellId): Promise<void> {
  const heading = cellHeading(page, id)
  if ((await heading.getAttribute('aria-expanded')) === 'true') await heading.click()
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
  await page
    .getByRole('listitem', { name: feed, exact: true })
    .getByRole('button', { name: /Start a project/ })
    .click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
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
