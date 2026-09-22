// Where a project's controls live, in one file (A5.5-06, issue 158).
//
// The end-to-end suite is 7,780 lines across 22 files, and nearly every
// assertion about a project reaches its control by walking the screen's
// current shape: a tab strip with Map and Export, a region under a heading,
// a control inside that region. The notebook (ADR-045) moves all of it into
// six cells. Done a spec at a time, every branch of that refactor would edit
// twenty files and a reviewer could not tell a regression from churn.
//
// So the knowledge of *where* a control lives is here, and the specs say
// *what* they expect. Today every function returns exactly what the specs
// reached for before this file existed; when the screen moves, this file
// moves with it and the specs do not change at all.
//
// Two things deliberately do not belong here. A spec asserting the tab
// strip's own behaviour keeps reaching for tabs directly, because that
// assertion is about the tabs and goes when they do (issue 175). And the
// stand-in engine's own helpers stay in `python.ts`: this file knows about
// screens, not about processes.
//
// It lives beside the suite's other helpers in `tests/support/` rather than
// in `tests/e2e/support/`, which issue 158 named, because that is where
// `python.ts`, `store-lines.ts` and `frames.ts` already are.

import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The six cells of the notebook, by the name ADR-045 gives them, and where
 * each one's controls live today. `tab` is the tab a person must be on to
 * see it, and `role`/`name` are the element that holds its controls.
 *
 * Cell 05 holds two panels today, Line colours and Line order, which become
 * two sections of one cell. `cell('lines')` answers the colours; the order
 * is reached with `panel(page, 'Line order')` until they are one.
 */
const CELLS = {
  data: { tab: null, role: 'region', name: 'In the feed' },
  process: { tab: null, role: 'region', name: 'Layout run' },
  frame: { tab: 'Map', role: 'region', name: 'Service day' },
  style: { tab: 'Map', role: 'region', name: 'Theme' },
  lines: { tab: 'Map', role: 'region', name: 'Line colours' },
  // The export's controls are the Export tab's panel itself, not a region
  // inside it; in the notebook it becomes a cell like the others.
  export: { tab: 'Export', role: 'tabpanel', name: 'Export' },
} as const

export type CellId = keyof typeof CELLS

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
 * A cell's panel, without pressing anything: the caller has already made it
 * visible, or is asserting that it is not.
 */
export const cell = (page: Page, id: CellId): Locator =>
  page.getByRole(CELLS[id].role, { name: CELLS[id].name, exact: true })

/**
 * A cell's panel, made visible first. Today that means pressing the tab
 * that holds it; in the notebook it will mean opening the cell.
 */
export async function openCell(page: Page, id: CellId): Promise<Locator> {
  const { tab } = CELLS[id]
  if (tab !== null) {
    const strip = page.getByRole('tab', { name: tab })
    if ((await strip.getAttribute('aria-selected')) !== 'true') await strip.click()
    await expect(page.getByRole('tabpanel', { name: tab })).toBeVisible()
  }
  return cell(page, id)
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
