// The accessibility pass, the machine half (A6-07, issue 40; constitution
// principle VI; docs/accessibility.md): the window, the Library, Settings
// and the dialogs of the built app against the stand-in engine, checked
// three ways.
//
// A project's own screen is `notebook-a11y.spec.ts`, which A5.5-08 split
// out: the notebook is six cells with an issue each, and six of this
// milestone's open issues have checks to add to it. The machinery both
// halves use is `tests/support/a11y.ts`.
//
// - Labels. Every button, link, textbox, combobox, checkbox, radio, tab,
//   slider and spinbutton in the accessibility tree has a name, read from
//   Playwright's own snapshot of the tree (`ariaSnapshot()`), which pierces
//   the kit's shadow roots as a screen reader does.
// - Keyboard and focus. A Tab walk from the top of the screen, or from the
//   top of an open dialog, reaches every enabled control, and each shows a
//   focus indicator: an outline or a shadow it did not have at rest, on the
//   control or on the kit element that hosts it.
// - Motion. With `prefers-reduced-motion: reduce` emulated, no element, in
//   the document or in an open shadow root, has a CSS animation or a
//   transition that lasts. The design document turns every transition off
//   under reduced motion rather than shortening it to a fade (section 7), so
//   the longest a transition may last is 0s.
//
// And the defects this pass fixed, each where a person meets it: focus
// handed on when the control that held it goes with the press (a layout
// run's buttons, an export's, the service day's, the Library's rows and
// Settings' "Use the default"), a confirmation's Cancel holding focus while
// the action runs, an explanation that Escape dismisses, the colour
// picker's sliders showing the app's focus ring, and a kit button's
// aria-controls relating it to what it opens (issue 121, F6).
//
// Contrast is arithmetic, not a screenshot: tests/unit/contrast.test.ts.
// That test reads token pairs, though, and cannot see which rule wins on an
// element - issue 143 was a component rule reaching past what it was written
// for, so a passing pair was drawn in a colour nothing had paired it with.
// Where the cascade is the question, the measurement belongs here, on the
// element, in both themes.
// The engine's page inside the viewer's frame is the engine's, and is not
// swept here; a Tab walk passes the "Skip past the map" control, then through
// its frame and out again (issue 106).
//
// Every launch has a profile of its own through LEGIBLE_USER_DATA, and the
// stand-in's control file is written before the app starts, because the
// stand-in reads it once.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  PYTHON,
  addedFeed,
  chooserAnswers,
  heading,
  pressWithKeyboard,
  profile,
  requests,
  sweep,
  withApp,
} from '../support/a11y'

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

// ---------------------------------------------------------------------------

test('the Library, its empty state and its three dialogs', async () => {
  test.setTimeout(240_000)
  const p = profile()
  addedFeed(p)
  const zip = join(p.userData, 'Metro de Prueba.zip')
  writeFileSync(zip, 'not read: the add is not submitted')
  await withApp(p, async (page, app) => {
    await expect(heading(page)).toHaveText('Library')
    await expect(page.getByText('No projects yet.', { exact: false })).toBeVisible()
    await expect(page.getByRole('listitem', { name: 'Metro de Prueba' })).toBeVisible()
    await sweep(page, 'Library, empty')

    // The create dialog.
    await page.getByRole('button', { name: 'New project' }).click()
    const create = page.getByRole('dialog', { name: 'New project' })
    await expect(create.getByRole('combobox', { name: 'Feed' })).toBeVisible()
    await sweep(page, 'the create dialog', create)
    await page.keyboard.press('Escape')
    await expect(create).toBeHidden()

    // The add dialog, from a file and from an address.
    await chooserAnswers(app, zip)
    await page.getByRole('button', { name: 'Add feed' }).click()
    const add = page.getByRole('dialog', { name: 'Add a feed' })
    await add.getByRole('button', { name: 'Choose a zip' }).click()
    await expect(add.getByText('Metro de Prueba.zip')).toBeVisible()
    await sweep(page, 'the add dialog, a file chosen', add)
    await add.getByLabel('Or from an address').fill('not an address')
    await add.getByRole('button', { name: 'Add feed' }).click()
    await expect(add.getByRole('alert')).toHaveText(/http/)
    await sweep(page, 'the add dialog, an address refused', add)
    await add.getByRole('button', { name: 'Close' }).click()
    await expect(add).toBeHidden()

    // The remove confirmation.
    await page.getByRole('button', { name: 'Remove Metro de Prueba' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove Metro de Prueba?' })
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await sweep(page, 'the remove confirmation', confirm)
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toBeHidden()

    // A project made from the empty state: the button that opened the
    // dialog goes with the empty state, and focus lands on the new row.
    const fromEmpty = page.locator('.empty').getByRole('button', { name: 'New project' })
    await pressWithKeyboard(fromEmpty)
    const dialog = page.getByRole('dialog', { name: 'New project' })
    await dialog.getByLabel('Name', { exact: true }).fill('Los Angeles')
    await pressWithKeyboard(dialog.getByRole('button', { name: 'Create', exact: true }))
    await expect(page.getByRole('button', { name: 'Open Los Angeles' })).toBeFocused()
    await sweep(page, 'Library, with a project')

    // A removed feed takes its row, and focus goes to the list's heading.
    await pressWithKeyboard(page.getByRole('button', { name: 'Remove Metro de Prueba' }))
    await pressWithKeyboard(
      page.getByRole('dialog', { name: 'Remove Metro de Prueba?' }).getByRole('button', {
        name: 'Remove',
      }),
    )
    await expect(page.getByRole('listitem', { name: 'Metro de Prueba' })).toHaveCount(0)
    // Polled as a description of whatever holds focus, so a failure says
    // where it went rather than only that the heading does not have it.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = document.activeElement
          if (active === null) return 'nothing'
          return active.id !== '' ? `#${active.id}` : active.tagName.toLowerCase()
        }),
      )
      .toBe('#feeds-heading')
  })
})

/** A token's colour as the computed style writes it, `#1a1410` as `rgb(26, 20, 16)`. */
async function tokenRgb(page: Page, token: string): Promise<string> {
  const hex = await page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token,
  )
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

test('a confirmation takes nothing while its action runs, and says so', async () => {
  test.setTimeout(120_000)
  // Slow enough that the presses land while the removal is out.
  const p = profile({ remove_delay_ms: 3_000 })
  addedFeed(p)
  await withApp(p, async (page) => {
    await page.getByRole('button', { name: 'Remove Metro de Prueba' }).click()
    const confirm = page.getByRole('dialog', { name: 'Remove Metro de Prueba?' })
    const remove = confirm.getByRole('button', { name: 'Remove' })
    const cancel = confirm.getByRole('button', { name: 'Cancel' })
    await remove.focus()
    await page.keyboard.press('Enter')

    // Running: both buttons keep their names, say they are unavailable and
    // look it, the pressed one keeps focus, and a sentence says what is
    // happening.
    await expect(remove).toHaveAttribute('aria-disabled', 'true')
    await expect(cancel).toHaveAttribute('aria-disabled', 'true')
    await expect(remove).toBeFocused()
    await expect(confirm.getByRole('status')).toHaveText(
      'Removing Metro de Prueba… It cannot be stopped.',
    )
    // The kit paints a button's fill on its host and its label on the inner
    // button, which inherits it: read both, the label through the shadow root.
    const host = confirm.locator('fig-button[data-unavailable]', { hasText: 'Remove' })
    expect(await host.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      await tokenRgb(page, '--surface-sunken'),
    )
    expect(
      await host.evaluate((el) => {
        const inner = el.shadowRoot?.querySelector('button')
        return inner ? getComputedStyle(inner).color : 'no inner button'
      }),
    ).toBe(await tokenRgb(page, '--text-faint'))

    // A held Enter's repeat, a press on Cancel and the first Escape: all
    // refused, the dialog stays with its sentence.
    await page.keyboard.press('Enter')
    // Forced: Playwright waits for an aria-disabled button to be enabled.
    await cancel.click({ force: true })
    await page.keyboard.press('Escape')
    await expect(confirm).toBeVisible()
    await expect(confirm.getByRole('status')).toHaveText(/It cannot be stopped\.$/)
    await expect(remove).toHaveAttribute('aria-disabled', 'true')

    await expect(confirm).toBeHidden({ timeout: 20_000 })
    await expect(page.getByRole('listitem', { name: 'Metro de Prueba' })).toHaveCount(0)
    expect(requests(p, 'feeds.remove'), 'one removal, whatever the presses').toBe(1)
  })
})

test('a confirmation the platform closes while its action runs lets the next one open, idle', async () => {
  test.setTimeout(120_000)
  const p = profile({ remove_delay_ms: 3_000 })
  addedFeed(p, ['Metro de Prueba', 'Tranvia de Prueba'])
  await withApp(p, async (page) => {
    await page.getByRole('button', { name: 'Remove Metro de Prueba' }).click()
    const first = page.getByRole('dialog', { name: 'Remove Metro de Prueba?' })
    const remove = first.getByRole('button', { name: 'Remove' })
    await remove.focus()
    await page.keyboard.press('Enter')
    await expect(remove).toHaveAttribute('aria-disabled', 'true')
    // The first Escape is refused; the second closes a modal whatever its
    // cancel event says, and the Library is told at once.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(first).toBeHidden()

    // The next confirmation opens idle, and the first removal finishing does
    // not close it.
    await page.getByRole('button', { name: 'Remove Tranvia de Prueba' }).click()
    const second = page.getByRole('dialog', { name: 'Remove Tranvia de Prueba?' })
    await expect(second).toBeVisible()
    await expect(second.getByRole('button', { name: 'Remove' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(second.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(page.getByRole('listitem', { name: 'Metro de Prueba' })).toHaveCount(0, {
      timeout: 20_000,
    })
    await expect(second).toBeVisible()
    await second.getByRole('button', { name: 'Cancel' }).click()
    await expect(second).toBeHidden()
    await expect(page.getByRole('listitem', { name: 'Tranvia de Prueba' })).toBeVisible()
    expect(requests(p, 'feeds.remove'), 'only the first removal was sent').toBe(1)
  })
})

test('Settings, its reset confirmation, and focus after "Use the default"', async () => {
  test.setTimeout(180_000)
  const p = profile()
  const chosen = mkdtempSync(join(tmpdir(), 'legible-cities-a11y-export-'))
  await withApp(p, async (page, app) => {
    await page.getByRole('button', { name: 'Settings' }).click()
    await expect(heading(page)).toHaveText('Settings')
    await expect(page.locator('#engine-folder-size')).not.toHaveText('Measuring…')
    // The Licences section (issue 108) is in the walk: a named region, a
    // definition list, and three buttons unavailable in a development run
    // that keep their place in the Tab order and are described by why.
    const licences = page.getByRole('region', { name: 'Licences' })
    await expect(licences.locator('dt').first()).toBeVisible()
    for (const name of ['Open the notices', 'Show the licence texts', "Open Chromium's licences"]) {
      await expect(licences.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    // By its attribute: an empty status line has no box, so a role query,
    // which skips what is not visible, does not find it before a press.
    await expect(licences.locator('[role="status"]')).toHaveAttribute('aria-live', 'polite')
    await sweep(page, 'Settings')

    await chooserAnswers(app, chosen)
    await page.getByRole('button', { name: 'Choose the export folder' }).click()
    await expect(page.locator('#export-folder-source')).toHaveText('chosen here')
    await pressWithKeyboard(page.getByRole('button', { name: 'Use the default export folder' }))
    await expect(page.locator('#export-folder-source')).toHaveText('the default')
    await expect(page.getByRole('button', { name: 'Choose the export folder' })).toBeFocused()

    await page.getByRole('button', { name: 'Reset engine data' }).click()
    const reset = page.getByRole('dialog', { name: "Reset the engine's data?" })
    await sweep(page, 'the reset confirmation', reset)
    await reset.getByRole('button', { name: 'Cancel' }).click()
    await expect(reset).toBeHidden()
  })
})

test('the first-run dialog, and Settings with the Bundled tools rows', async () => {
  test.setTimeout(180_000)
  // A development run checks what the environment names: an empty folder as
  // the LOOM folder is LOOM missing (specs/026), and the dialog says so.
  const p = profile()
  const emptyLoom = mkdtempSync(join(tmpdir(), 'legible-cities-a11y-loom-'))
  await withApp(
    p,
    async (page) => {
      const dialog = page.getByRole('dialog', { name: /LOOM.* will not run/ })
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByRole('button', { name: 'OK' })).toBeFocused()
      for (const name of ['Copy diagnostics', 'How to install', 'OK'])
        await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible()
      // The details disclosure, closed, is the walk's first stop.
      await expect(dialog.locator('details')).not.toHaveAttribute('open', '')
      await sweep(page, 'the first-run dialog', dialog)

      // Closed from the keyboard, focus is back on the screen it was over.
      await dialog.getByRole('button', { name: 'OK' }).focus()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect
        .poll(() =>
          page.evaluate(() => {
            const active = document.activeElement
            if (active === null) return 'nothing'
            return active.id !== '' ? `#${active.id}` : active.tagName.toLowerCase()
          }),
        )
        .toBe('#library-heading')
      await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
        timeout: 20_000,
      })

      // Settings, the check's rows present: a summary said politely, and a
      // row per tool in the versions list's style.
      await page.getByRole('button', { name: 'Settings' }).click()
      await expect(heading(page)).toHaveText('Settings')
      await expect(page.locator('#engine-folder-size')).not.toHaveText('Measuring…')
      const tools = page.getByRole('region', { name: 'Bundled tools' })
      const summary = tools.getByRole('status')
      await expect(summary).toHaveText('Not every tool the app needs ran.')
      await expect(summary).toHaveAttribute('aria-live', 'polite')
      await expect(tools.locator('dt')).toHaveText(['LOOM tools', 'ffmpeg and ffprobe'])
      await sweep(page, 'Settings, with the Bundled tools rows')
    },
    { env: { SCHEMATIC_LOOM_BIN: emptyLoom }, ready: false },
  )
})

test('the mismatch dialog', async () => {
  const p = profile({ version: '0.1.0' })
  await withApp(
    p,
    async (page) => {
      const dialog = page.getByRole('dialog', { name: 'Engine version mismatch' })
      await expect(dialog).toBeVisible({ timeout: 20_000 })
      await expect(dialog.getByRole('button', { name: 'OK' })).toBeFocused()
      await sweep(page, 'the mismatch dialog', dialog)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    },
    { ready: false },
  )
})

// An icon inside a filled button takes the button's ink, not the ground's.
// Token arithmetic cannot see this: --on-accent on the accent fill passes
// on its own, and the defect was a component rule reaching past what it was
// written for, so what a person saw was a muted glyph on a saturated fill
// (issue 143). Measured on the element, in both themes, because that is
// where the cascade is decided.
//
// The button is found through `.empty`, not by its name: the Library draws
// a second "New project" in the toolbar and hides the empty state's one
// while there are projects, so a bare name could resolve to the button
// that never had this defect. And `seen.label` is the host's colour, not
// the label text's: the kit styles `button, fig-button` together, so the
// host and the inner button carry the same ink and the slotted icon
// inherits it. If the kit ever moved the ink inside its shadow root, this
// test would fail for a reason that has nothing to do with `.empty`.
test('an icon in a filled button is the button’s ink, in both themes', async () => {
  const p = profile()
  await withApp(p, async (page) => {
    const empty = page.locator('.empty')
    const button = empty.locator('fig-button')
    await expect(button).toBeVisible({ timeout: 20_000 })
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      // The theme is not a media query: theme.ts listens for the change and
      // writes data-theme, so the attribute lands a turn after emulateMedia
      // resolves. Without this the light pass can measure the dark theme
      // twice and still agree with itself (design.spec.ts does the same).
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(scheme === 'dark' ? null : 'sepia')

      const seen = await empty.evaluate((block) => {
        const host = block.querySelector('fig-button')
        const icon = host?.querySelector('.icon') ?? null
        const glyph = block.querySelector(':scope > .icon')
        const style = (el: Element | null): string =>
          el === null ? 'missing' : getComputedStyle(el).color
        return {
          label: host === null ? 'missing' : getComputedStyle(host).color,
          icon: style(icon),
          glyph: style(glyph),
          muted: getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim(),
          fill: host === null ? 'missing' : getComputedStyle(host).backgroundColor,
        }
      })

      expect(seen.icon, `${scheme}: the icon in the button`).toBe(seen.label)
      // And the pair it now shares clears the 3.0 a glyph needs, so a later
      // change to --on-accent or --accent cannot quietly sink it.
      expect(
        contrast(seen.icon, seen.fill),
        `${scheme}: ${seen.icon} on ${seen.fill}`,
      ).toBeGreaterThanOrEqual(3)
      // The other half of the rule: it still reaches the block's own glyph,
      // so narrowing the selector cannot have narrowed it away. This is the
      // selector, not the appearance - the glyph is the mark now, and the
      // mark draws from --line-* and takes no colour from here (ADR-044).
      // The rule stays for the day an empty state holds a monochrome one.
      expect(seen.glyph, `${scheme}: the empty state's own glyph`).toBe(rgb(seen.muted))
    }
  })
})

// The mark resolves to the theme's own line colours, in both themes.
// Nothing else proves it paints at all: its six strokes are var() inside
// presentation attributes, and `stroke` has initial value `none`, so a
// renamed token or a typo makes the mark invalid at computed-value time and
// it disappears completely - with the file still on disk, still passing the
// unit test that reads it as text, and still clicked by jobs.spec.ts. This
// also pins the claim that one file follows both themes (ADR-044).
test('the mark paints in the theme\u2019s own line colours, in both themes', async () => {
  const p = profile()
  await withApp(p, async (page) => {
    const mark = page.locator('.app-header .brand .icon svg')
    await expect(mark).toBeVisible({ timeout: 20_000 })
    for (const scheme of ['dark', 'light'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(scheme === 'dark' ? null : 'sepia')

      const seen = await mark.evaluate((svg) => {
        const root = getComputedStyle(document.documentElement)
        const token = (name: string): string => root.getPropertyValue(name).trim()
        return {
          strokes: [...svg.querySelectorAll('path')].map((el) => getComputedStyle(el).stroke),
          want: {
            vermilion: token('--line-vermilion'),
            cobalt: token('--line-cobalt'),
            jade: token('--line-jade'),
            saffron: token('--line-saffron'),
            surface: token('--surface'),
          },
        }
      })
      // Two lines run through, two cross and step down, and the two between
      // them are the ground, which is what makes the crossings read.
      expect(seen.strokes, `${scheme}: six strokes`).toHaveLength(6)
      expect(seen.strokes, `${scheme}: the mark's colours`).toEqual([
        rgb(seen.want.vermilion),
        rgb(seen.want.cobalt),
        rgb(seen.want.surface),
        rgb(seen.want.surface),
        rgb(seen.want.jade),
        rgb(seen.want.saffron),
      ])
      // The failure this exists for: an unresolvable var() computes to none.
      expect(seen.strokes, `${scheme}: nothing fell back to none`).not.toContain('none')
    }
  })
})

/** A `#rrggbb` token as the computed style writes it, `rgb(r, g, b)`. */
function rgb(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) throw new Error(`not a six-digit hex colour: ${hex}`)
  const n = Number.parseInt(m[1], 16)
  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

/**
 * WCAG contrast between two opaque `rgb(r, g, b)` strings, as the computed
 * style writes them. Anything else - `rgba(...)`, a `color()` function - is
 * refused rather than guessed at: a transparent fill read as opaque black
 * would report a large ratio for a pair that was never drawn.
 */
function contrast(a: string, b: string): number {
  const luminance = (colour: string): number => {
    const m = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/.exec(colour)
    if (m === null) throw new Error(`not an opaque rgb colour: ${colour}`)
    const channel = (v: string): number => {
      const c = Number(v) / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3])
  }
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
