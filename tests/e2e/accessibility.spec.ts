// The accessibility pass, the machine half (A6-07, issue 40; constitution
// principle VI; docs/accessibility.md): every screen and every dialog of the
// built app against the stand-in engine, checked three ways.
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
// the action runs, an explanation that Escape dismisses, and the colour
// picker's sliders showing the app's focus ring.
//
// Contrast is arithmetic, not a screenshot: tests/unit/contrast.test.ts.
// The engine's page inside the viewer's frame is the engine's, and is not
// swept here; a Tab walk passes through its frame and out again.
//
// Every launch has a profile of its own through LEGIBLE_USER_DATA, and the
// stand-in's control file is written before the app starts, because the
// stand-in reads it once.

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

const repoRoot = resolve(__dirname, '../..')
const fixture = resolve(__dirname, '../fixtures/capture-page.html')
const PYTHON = findPython()

test.skip(PYTHON === null, 'no python3 or python on the PATH to run the stand-in engine')

interface Profile {
  userData: string
  /** The engine's home: the default under the user-data folder. */
  engineHome: string
}

/** A profile with the stand-in's control file in the engine's default home. */
function profile(control: Record<string, unknown> = {}): Profile {
  const userData = mkdtempSync(join(tmpdir(), 'legible-cities-a11y-'))
  const engineHome = join(userData, 'engine')
  mkdirSync(engineHome, { recursive: true })
  writeFileSync(
    join(engineHome, 'fake-engine.json'),
    JSON.stringify({ version: PINNED_ENGINE, map_draws: true, progress_delay_ms: 10, ...control }),
  )
  return { userData, engineHome }
}

/** Feeds a person added, so the Library has rows with Remove on them. */
function addedFeed(p: Profile, names: string[] = ['Metro de Prueba']): void {
  const folder = join(p.engineHome, 'data', 'feeds')
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'user-feeds.json'),
    JSON.stringify(
      names.map((name) => ({
        key: name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[^a-z0-9]+/g, '-'),
        name,
        city: '',
        network: '',
        url: null,
        mode: 'all',
        label_pattern: null,
        label_strip: null,
        agency: null,
        geographic: true,
        notes: [],
        source: 'user',
      })),
    ),
  )
}

/** How many requests of one method the stand-in has read. */
const requests = (p: Profile, method: string): number =>
  readFileSync(join(p.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`)).length

async function withApp(
  p: Profile,
  run: (page: Page, app: ElectronApplication) => Promise<void>,
  { env = {}, ready = true }: { env?: Record<string, string>; ready?: boolean } = {},
): Promise<void> {
  const app = await electron.launch({
    args: ['.'],
    cwd: repoRoot,
    env: {
      ...process.env,
      LEGIBLE_USER_DATA: p.userData,
      LEGIBLE_ENGINE_PYTHON: PYTHON as string,
      PYTHONPATH: FAKE_ENGINE,
      ...env,
    } as Record<string, string>,
    timeout: 30_000,
  })
  const child = app.process()
  try {
    const page = await app.firstWindow()
    // The interface's default theme, and reduced motion for the whole
    // session. Emulated per page, as the colour scheme is (rules/renderer.md);
    // asserted, so a runtime that ignored the emulation would say so here
    // rather than pass the motion checks for the wrong reason.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      'reduced motion is emulated in the Electron page',
    ).toBe(true)
    if (ready)
      await expect(page.getByRole('status', { name: 'Engine' })).toContainText(/ready/i, {
        timeout: 20_000,
      })
    await run(page, app)
  } finally {
    await app.close()
  }
  await expect.poll(() => child.exitCode, { timeout: 10_000 }).not.toBeNull()
}

/** The platform's chooser, answered in the main process so the app's own handler runs. */
async function chooserAnswers(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [answer] })) as never
  }, path)
}

// ---------------------------------------------------------------------------
// The probe: installed in the page, so a walk's bookkeeping holds on to the
// elements themselves rather than to descriptions of them.

interface StepAnswer {
  state: 'none' | 'same' | 'stop' | 'repeat'
  /** Every control expected has been reached. */
  complete: boolean
  /** What holds focus, for the message when the walk does not end. */
  at: string
}

interface Finding {
  missed: string[]
  unringed: string[]
  stops: number
}

type Probe = {
  begin(): number
  step(): StepAnswer
  finish(): Finding
  moving(): string[]
}

function installProbe(): void {
  const w = window as unknown as { __a11y?: Probe }
  if (w.__a11y) return

  const deepActive = (): Element | null => {
    let el: Element | null = document.activeElement
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
    return el
  }
  // A kit button's inner <button> stands for the kit element that hosts it.
  const controlOf = (el: Element): Element => {
    const root = el.getRootNode()
    return root instanceof ShadowRoot ? root.host : el
  }
  const describe = (el: Element): string => {
    const label =
      el.getAttribute('aria-label') ||
      el.getAttribute('label') ||
      el.id ||
      (el.textContent ?? '').trim().slice(0, 40)
    return `${el.tagName.toLowerCase()} "${label}"`
  }
  const shown = (el: Element): boolean => {
    if (el.closest('[inert]')) return false
    const style = getComputedStyle(el)
    return style.visibility !== 'hidden' && el.getClientRects().length > 0
  }
  /**
   * What a person can reach with Tab: in the open modal dialog if there is
   * one, else the page. Not a frame: what a frame holds is its page's, the
   * engine's, and a frame with nothing focusable in it is not a stop at all.
   *
   * The light tree only. Of the kit's elements the app uses, a button's
   * focusable part is in its shadow root and the button is counted by its
   * host; a select's and a text field's are ordinary children of theirs.
   * A kit control focusable only inside a shadow root would be missed
   * here, and none is used (docs/accessibility.md).
   */
  const expected = (): Element[] => {
    const scope: ParentNode = document.querySelector('dialog[open]') ?? document
    const out: Element[] = []
    for (const el of scope.querySelectorAll(
      'a[href], button, input, select, textarea, summary, [tabindex], fig-button',
    )) {
      if (!shown(el) || el.tagName === 'IFRAME') continue
      if (el.tagName === 'FIG-BUTTON') {
        if (!el.hasAttribute('disabled')) out.push(el)
        continue
      }
      if (el.matches(':disabled') || (el as HTMLInputElement).type === 'hidden') continue
      if ((el as HTMLElement).tabIndex < 0) continue
      // A button inside a kit element's light tree is the kit's own.
      if (el.parentElement?.closest('fig-button')) continue
      out.push(el)
    }
    return out
  }
  const ring = (el: Element): { outline: string; shadow: string } => {
    const style = getComputedStyle(el)
    const outline =
      style.outlineStyle === 'none' || parseFloat(style.outlineWidth) === 0
        ? 'none'
        : `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`
    return { outline, shadow: style.boxShadow }
  }
  const chainOf = (deep: Element): Element[] => {
    const chain = [deep]
    const host = controlOf(deep)
    if (host !== deep) chain.push(host)
    if (deep.parentElement) chain.push(deep.parentElement)
    return chain
  }

  let want: Element[] = []
  let visited = new Set<Element>()
  let last: Element | null = null
  let stops: {
    control: Element
    chain: Element[]
    focused: { outline: string; shadow: string }[]
  }[] = []

  w.__a11y = {
    begin() {
      want = expected()
      visited = new Set()
      last = null
      stops = []
      // From the top: a screen's heading starts the sequence, since Chromium
      // carries on from the last focused place even after a blur; a dialog
      // starts from its own first control.
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      const top =
        document.querySelector('dialog[open]') === null ? document.querySelector('h1') : null
      top?.focus()
      return want.length
    },
    step() {
      const complete = (): boolean => want.every((el) => !el.isConnected || visited.has(el))
      const deep = deepActive()
      const where = (): string => (deep === null ? 'nothing' : describe(deep))
      // The body, or a dialog holding focus itself, is no control: focus is
      // between two, or has left the page.
      if (deep === null || deep === document.body || deep.tagName === 'DIALOG')
        return { state: 'none', complete: complete(), at: where() }
      const control = controlOf(deep)
      // A date control's fields, or a frame's own controls, are several
      // presses on one element of this document.
      if (control === last) return { state: 'same', complete: complete(), at: where() }
      if (visited.has(control)) return { state: 'repeat', complete: complete(), at: where() }
      last = control
      visited.add(control)
      const chain = chainOf(deep)
      stops.push({ control, chain, focused: chain.map(ring) })
      return { state: 'stop', complete: complete(), at: where() }
    },
    finish() {
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      const unringed: string[] = []
      for (const stop of stops) {
        // A frame's page is its own; the engine draws its focus.
        if (stop.control.tagName === 'IFRAME' || !stop.control.isConnected) continue
        const rest = stop.chain.map(ring)
        // An outline the control did not have at rest, or a shadow where it
        // had none: a shadow that merely changes does not count, because a
        // kit text field drops its resting edge on focus and would pass
        // with no ring at all.
        const shows = stop.focused.some(
          (focused, i) =>
            (focused.outline !== 'none' && focused.outline !== rest[i].outline) ||
            (focused.shadow !== 'none' && rest[i].shadow === 'none'),
        )
        if (!shows) unringed.push(describe(stop.control))
      }
      const missed = want.filter((el) => el.isConnected && !visited.has(el)).map(describe)
      return { missed, unringed, stops: stops.length }
    },
    moving() {
      const out: string[] = []
      const seconds = (list: string): number =>
        Math.max(
          0,
          ...list
            .split(',')
            .map((t) => t.trim())
            .map((t) => (t.endsWith('ms') ? parseFloat(t) / 1000 : parseFloat(t) || 0)),
        )
      const visit = (root: Document | ShadowRoot): void => {
        for (const animation of root.getAnimations())
          if (animation.playState === 'running') out.push(`a running animation in ${root.nodeName}`)
        for (const el of root.querySelectorAll('*')) {
          for (const pseudo of [null, '::before', '::after']) {
            const style = getComputedStyle(el, pseudo)
            if (style.animationName !== 'none')
              out.push(`${describe(el)}${pseudo ?? ''} animates ${style.animationName}`)
            const lasts = seconds(style.transitionDuration) + seconds(style.transitionDelay)
            if (lasts > 0 && style.transitionProperty !== 'none')
              out.push(`${describe(el)}${pseudo ?? ''} transitions for ${lasts}s`)
          }
          if (el.shadowRoot) visit(el.shadowRoot)
        }
      }
      visit(document)
      return out
    },
  }
}

const CONTROL_ROLES = [
  'button',
  'link',
  'textbox',
  'combobox',
  'checkbox',
  'radio',
  'tab',
  'slider',
  'spinbutton',
]

/** Every control the accessibility tree holds under `scope` has a name. */
async function expectNamed(scope: Locator, where: string): Promise<void> {
  const snapshot = await scope.ariaSnapshot()
  const unnamed = snapshot.split('\n').filter((line) => {
    const m = /^\s*- ([a-z]+)(.*)$/.exec(line)
    if (!m || !CONTROL_ROLES.includes(m[1])) return false
    return !m[2].trimStart().startsWith('"')
  })
  expect(unnamed, `${where}: controls without a name\n${snapshot}`).toEqual([])
}

/** A Tab walk from the top reaches every enabled control, and each shows its focus. */
async function expectTabWalk(page: Page, where: string): Promise<void> {
  await page.evaluate(installProbe)
  const wanted = await page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.begin())
  expect(wanted, `${where}: there are controls to reach`).toBeGreaterThan(0)
  // A deadline, not a count of presses: the walk ends when focus comes back
  // round to a control it has already reached, or leaves the document once
  // every control has been reached (where the window's end of the sequence
  // is, not the page's, is Electron's business). A modal dialog with one
  // control is the one place Tab has nowhere to go: focus stays on that
  // control, which is the walk's whole cycle, and is complete. Anywhere
  // with more than one control, staying put means a date control's fields
  // or a frame's own controls, and the walk goes on.
  const deadline = Date.now() + 20_000
  let ended = false
  const trace: string[] = []
  while (Date.now() < deadline) {
    await page.keyboard.press('Tab')
    const { state, complete, at } = await page.evaluate(() =>
      (window as unknown as { __a11y: Probe }).__a11y.step(),
    )
    trace.push(`${state} ${at}`)
    if (trace.length > 12) trace.shift()
    if (
      state === 'repeat' ||
      (state === 'none' && complete) ||
      (state === 'same' && complete && wanted === 1)
    ) {
      ended = true
      break
    }
  }
  const found = await page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.finish())
  expect(
    ended,
    `${where}: the Tab walk came back round within the deadline; its last presses:\n${trace.join('\n')}`,
  ).toBe(true)
  expect(found.missed, `${where}: controls the Tab walk did not reach`).toEqual([])
  expect(found.unringed, `${where}: controls with no visible focus`).toEqual([])
}

/** With reduced motion, nothing animates and no transition lasts. */
async function expectStill(page: Page, where: string): Promise<void> {
  await page.evaluate(installProbe)
  expect(
    await page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.moving()),
    `${where}: motion under reduced motion`,
  ).toEqual([])
}

async function sweep(page: Page, where: string, scope?: Locator): Promise<void> {
  await expectNamed(scope ?? page.locator('body'), where)
  await expectTabWalk(page, where)
  await expectStill(page, where)
}

const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 })

/** Press a control from the keyboard, as a person using one would. */
async function pressWithKeyboard(control: Locator): Promise<void> {
  await control.focus()
  await control.press('Enter')
}

async function newProjectFromLibrary(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function openLaidOut(page: Page, name: string): Promise<void> {
  await newProjectFromLibrary(page, name)
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(heading(page)).toHaveText(name)
  const layOut = page.getByRole('button', { name: 'Lay out', exact: true })
  await pressWithKeyboard(layOut)
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
}

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

/** A token's colour as the computed style writes it, `#15120f` as `rgb(21, 18, 15)`. */
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
    const dayHeading = page
      .getByRole('region', { name: 'Service day' })
      .getByRole('heading', { name: 'Service day' })
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

test('the project screen: its Map tab, Inspect, the geographic view, the inspector and its dialogs', async () => {
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
    await sweep(page, 'the project, Map tab')
    // A sortable column's header is a target of at least 24px, though its
    // label's line is 16.
    for (const sort of await page.locator('th button.sort').all())
      expect((await sort.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(24)

    // A colour picker open: its two sliders, the hex field, and the ring.
    const colours = page.getByRole('region', { name: 'Line colours' })
    await colours.getByRole('button', { name: 'Choose the colour of line A' }).click()
    const picker = colours.getByRole('group', { name: 'Colour for line A' })
    await expect(picker.getByRole('slider', { name: 'Hue' })).toBeVisible()
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
    await expect(day.getByRole('heading', { name: 'Service day' })).toBeFocused()
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
    await page.getByRole('button', { name: /^Jobs, / }).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByRole('listitem').first()).toBeVisible()
    await sweep(page, 'the inspector')
    await page.keyboard.press('Escape')
  })
})

test('the Export tab, and focus through an export', async () => {
  test.setTimeout(240_000)
  const p = profile({ encode_delay_ms: 30 })
  const exportFolder = join(p.userData, 'exports')
  await withApp(
    p,
    async (page) => {
      await openLaidOut(page, 'Los Angeles')
      const [id] = readdirSync(join(p.engineHome, 'projects'))
      copyFileSync(fixture, join(p.engineHome, 'out', id, 'la-metro-rail.html'))

      await page.getByRole('tab', { name: 'Export' }).click()
      const tab = page.getByRole('tabpanel', { name: 'Export' })
      await expect(tab.getByRole('combobox', { name: 'Preset' })).toBeVisible({ timeout: 20_000 })
      await sweep(page, 'the project, Export tab')

      // Export gives way to Cancel, and Cancel to Reveal: focus follows.
      await pressWithKeyboard(tab.getByRole('button', { name: 'Export', exact: true }))
      await expect(tab.getByText(/^Exported /)).toBeVisible({ timeout: 60_000 })
      await expect(tab.getByRole('button', { name: 'Reveal' })).toBeFocused()
      await sweep(page, 'the project, an export finished')
    },
    { env: { LEGIBLE_EXPORT_FOLDER: exportFolder } },
  )
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
