// The label typeface reaches the page, for real (issue 417). The engine
// embeds the face the project chose as `@font-face{src:url(data:...)}` in
// the page, and the policy the project pages are served with has to let
// Chromium load a `data:` font. Without `font-src data:` the load is refused,
// the face's status is `error`, the names fall through to the system face on
// screen and in an export, and nothing else notices: `looks.spec.ts` asserts
// the parameter sent to the engine, and the capture awaits
// `document.fonts.ready`, which resolves on a failed load as on a loaded one.
//
// So this reads the result: the project is the committed BART fixture laid
// out by the real engine at the pin, Label typeface is set to Inter in cell
// 04, and inside the map's frame, then inside cell 06's preview frame, the
// document's font faces must hold `Inter:loaded`.
//
// Mutation the coordinator runs this under: `font-src data:` removed from
// `PROJECT_CSP` (src/main/protocol.ts). The test must fail, with the face's
// status `error` in the list it prints.
//
//   LEGIBLE_ENGINE_PYTHON=<interpreter with the pinned engine> \
//   npx playwright test tests/e2e/typeface.spec.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { PROJECT_ID, PROJECT_NAME, prepareProject, seedHome } from '../support/determinism'
import { openCell, panel } from '../support/project'

const repoRoot = resolve(__dirname, '../..')
const PYTHON = process.env.LEGIBLE_ENGINE_PYTHON ?? ''

test.skip(
  PYTHON === '' || !existsSync(PYTHON),
  'LEGIBLE_ENGINE_PYTHON names no interpreter with the pinned engine; the page is the engine’s own',
)

/** What the map's status region says once the map is drawn (`notebook/Preview.tsx`). */
const MAP_DRAWN = 'The map is drawn.'

/**
 * Every font face of the frame whose address carries the needle, as
 * `family:status`, read after `document.fonts.ready`. No such frame answers
 * an empty list, and so does a read that does not answer within a second: a
 * frame being replaced can take the read and never answer it (issue 232), so
 * that is "not yet" and the caller polls again.
 */
async function faces(app: ElectronApplication, needle: string): Promise<string[]> {
  return app.evaluate(async ({ BrowserWindow }, needle) => {
    const main = BrowserWindow.getAllWindows()[0].webContents.mainFrame
    // Never cell 01's stage view, which is `srcdoc`.
    const frame = main.frames.find(
      (f) => f !== main && f.url !== 'about:srcdoc' && f.url.includes(needle),
    )
    if (!frame) return []
    try {
      const read = frame.executeJavaScript(
        'document.fonts.ready.then(() => [...document.fonts].map((f) => f.family.replace(/["\']/g, "") + ":" + f.status))',
      ) as Promise<string[]>
      const late = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1000))
      return await Promise.race([read, late])
    } catch {
      return []
    }
  }, needle)
}

test('Inter, chosen in cell 04, is loaded in the map’s frame and in cell 06’s preview', async () => {
  test.setTimeout(10 * 60_000)
  const dir = mkdtempSync(join(tmpdir(), 'legible-cities-typeface-'))
  const engineHome = join(dir, 'engine')
  seedHome(engineHome)
  await prepareProject(PYTHON, engineHome)

  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      SCHEMATIC_HOME: engineHome,
      LEGIBLE_USER_DATA: join(dir, 'profile'),
      LEGIBLE_ENGINE_PYTHON: PYTHON,
    } as Record<string, string>,
    timeout: 60_000,
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
      timeout: 150_000,
    })
    await page.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(PROJECT_NAME)
    await expect(page.locator('.preview .preview-status')).toHaveText(MAP_DRAWN, {
      timeout: 30_000,
    })

    await openCell(page, 'style')
    const typeface = panel(page, 'Sizes').getByRole('combobox', {
      name: 'Label typeface',
      exact: true,
    })
    await typeface.selectOption('inter')

    // The choice is written only once the map carries it.
    const recordFile = join(engineHome, 'projects', PROJECT_ID, 'project.json')
    await expect
      .poll(
        () =>
          (JSON.parse(readFileSync(recordFile, 'utf8')) as { style: { labelFont?: string } }).style
            .labelFont,
        { message: 'the map is redrawn with the face', timeout: 60_000 },
      )
      .toBe('inter')
    // The deadline is on what the page shows: the face is loaded, not
    // merely declared (`error` is what a refused load leaves).
    await expect
      .poll(() => faces(app, 'controls=1'), {
        message: 'Inter is loaded in the map’s frame',
        timeout: 30_000,
      })
      .toContain('Inter:loaded')

    await openCell(page, 'export')
    await expect(page.locator('iframe.export-frame')).toHaveCount(1, { timeout: 30_000 })
    await expect
      .poll(() => faces(app, 'frame='), {
        message: 'Inter is loaded in cell 06’s preview',
        timeout: 60_000,
      })
      .toContain('Inter:loaded')
  } finally {
    await app.close()
  }
  // Kept when the test fails, for a person to look at; gone when it passed.
  rmSync(dir, { recursive: true, force: true })
})
