// The cell's keyboard path in the real app (A5.5-05), walked on the sample
// page at `?cell-preview`, because the notebook it goes in arrives a branch
// later (A5.5-08) and there is no cell on a project's screen yet.
//
// What a unit test cannot see: that the row takes focus and answers Space
// and Enter as a button does, that a collapsed cell's controls are out of
// the Tab order while staying in the document, and that a value typed into
// one survives being collapsed and opened again - which is the rule the
// cell exists to keep.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
const repoRoot = resolve(__dirname, '../..')

// No stand-in engine and no python: the sample page renders in place of
// the app (main.tsx), so nothing here asks the engine anything. A machine
// without python still runs this.

async function withSamplePage(run: (page: Page) => Promise<void>): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'legible-cities-notebook-'))
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: { ...process.env, LEGIBLE_USER_DATA: userData } as Record<string, string>,
    timeout: 30_000,
  })
  try {
    const page = await app.firstWindow()
    // The sample page is a query on the interface's own address; the app
    // renders it in place of the Library (main.tsx). Navigated with goto,
    // not by assigning location inside the page: that destroys the context
    // the assignment is running in, which is a flake waiting to happen.
    await page.goto('app://local/ui/?cell-preview')
    await expect(page.getByRole('heading', { name: 'Cells', level: 1 })).toBeVisible({
      timeout: 20_000,
    })
    await run(page)
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
}

/**
 * The first cell of the `ready` section, by the name its row carries. The
 * name is the row's own contents - number, name, state, then the summary
 * while it shows - so it reads as the row does and has no punctuation of
 * its own.
 */
const firstCell = (page: Page): ReturnType<Page['getByRole']> =>
  page.getByRole('button', { name: /^01 Data ready/ }).first()

test('a cell opens and collapses from its row, by pointer and by keyboard', async () => {
  await withSamplePage(async (page) => {
    const row = firstCell(page)
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'false')

    // A button answers both keys; the row is a button and not a div.
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press(' ')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
  })
})

test('a collapsed cell keeps what was typed into it, and takes it out of the Tab order', async () => {
  await withSamplePage(async (page) => {
    const row = firstCell(page)
    const field = page.getByLabel('A half-typed value').first()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await field.fill('half a word')

    await row.click()
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    // Still in the document, so nothing was lost - and not reachable, so a
    // person cannot Tab into a cell they cannot see.
    await expect(field).toBeHidden()
    await row.focus()
    await page.keyboard.press('Tab')
    // Where focus went, not merely where it did not: a negative assertion
    // here would pass just as well if Tab had done nothing at all.
    await expect(page.getByRole('button', { name: /^02 Process ready/ }).first()).toBeFocused()
    await expect(field).not.toBeFocused()

    await row.focus()
    await page.keyboard.press('Enter')
    await expect(field).toHaveValue('half a word')
  })
})

test('the row says its number, its name and its state as one name', async () => {
  await withSamplePage(async (page) => {
    // One per state, so the words are the cell's and not the section's.
    for (const name of [
      /^01 Data ready/,
      /^02 Process running/,
      /^03 Frame and service day not drawn yet/,
      /^04 Style failed/,
    ]) {
      await expect(page.getByRole('button', { name }).first()).toBeVisible()
    }
    // A collapsed cell's summary is part of what the row says, because the
    // row's name is its contents rather than a string beside them.
    await expect(
      page.getByRole('button', { name: /^02 Process running d1deeb11, made / }).first(),
      'the summary is in the row a person hears',
    ).toBeVisible()
    // And a cell with no summary says only its number, name and state.
    await expect(page.getByRole('button', { name: /^06 Export ready$/ }).first()).toBeVisible()
  })
})

test('a cell row on the sample page is a level below the state it illustrates', async () => {
  await withSamplePage(async (page) => {
    // `CellPreview` draws each state's name as an `h2` and mounts `Cell` at
    // heading level 3, so a row is a child of the state it illustrates and
    // not its sibling (issue 197). Without that prop this page is the flat
    // outline the notebook's own rule forbids - and it is this spec that
    // walks the page, so the check belongs here rather than beside the
    // project screen's own outline in `notebook-a11y.spec.ts`.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.disclosure-heading')].map((h) => h.tagName.toLowerCase()),
    )
    // Asserted before the set, so "every row is an h3" cannot be satisfied
    // by a page that drew no rows at all.
    expect(rows.length, 'the sample page draws cells to look at').toBeGreaterThan(0)
    expect([...new Set(rows)], 'every cell row here is an h3').toEqual(['h3'])
  })
})
