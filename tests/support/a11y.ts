// The shared machinery of the accessibility pass (A6-07, issue 40), used
// by both halves of it: `tests/e2e/accessibility.spec.ts`, which walks the
// window, the Library, Settings and the dialogs, and
// `tests/e2e/notebook-a11y.spec.ts`, which walks a project's notebook.
//
// It was one file until A5.5-08 split it. Six of this milestone's open
// issues have checks to add to the project screen, and they would all have
// met in the one spec; the machinery is here so that neither half owns it
// and neither has to copy it.
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
// Every launch has a profile of its own through LEGIBLE_USER_DATA, and the
// stand-in's control file is written before the app starts, because the
// stand-in reads it once.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'

export const repoRoot = resolve(__dirname, '../..')
export const fixture = resolve(__dirname, '../fixtures/capture-page.html')
export const PYTHON = findPython()

export interface Profile {
  userData: string
  /** The engine's home: the default under the user-data folder. */
  engineHome: string
}

/** A profile with the stand-in's control file in the engine's default home. */
export function profile(control: Record<string, unknown> = {}): Profile {
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
export function addedFeed(p: Profile, names: string[] = ['Metro de Prueba']): void {
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
export const requests = (p: Profile, method: string): number =>
  readFileSync(join(p.engineHome, 'fake-engine.received'), 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"${method}"`)).length

export async function withApp(
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
export async function chooserAnswers(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [answer] })) as never
  }, path)
}

// ---------------------------------------------------------------------------
// The probe: installed in the page, so a walk's bookkeeping holds on to the
// elements themselves rather than to descriptions of them.

interface StepAnswer {
  state: 'none' | 'same' | 'stop' | 'repeat' | 'frame'
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
  /** Put the walk down on the far side of the frame holding focus. */
  past(): string | null
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
      // A frame is where this document stops being able to say anything.
      // Focus inside one is reported as the <iframe> element and nothing
      // more - the viewer's page runs at an opaque origin and the probe
      // runs out here (ADR-028) - so the presses that walk its own controls
      // all look alike, and what the platform does on the way out is not
      // visible either. It is answered as itself so the walk can step over
      // it deliberately rather than read it as a stop it has seen before.
      if (control.tagName === 'IFRAME') return { state: 'frame', complete: complete(), at: where() }
      // A date control's fields are several presses on one element of this
      // document.
      if (control === last) return { state: 'same', complete: complete(), at: where() }
      if (visited.has(control)) return { state: 'repeat', complete: complete(), at: where() }
      last = control
      visited.add(control)
      const chain = chainOf(deep)
      stops.push({ control, chain, focused: chain.map(ring) })
      return { state: 'stop', complete: complete(), at: where() }
    },
    past() {
      const deep = deepActive()
      if (deep === null || deep.tagName !== 'IFRAME') return null
      // The first control this walk still wants that comes after the frame
      // in the document. `want` is in document order, so the first match is
      // the one Tab would have arrived at had the frame been transparent.
      const after = want.find(
        (el) =>
          el.isConnected &&
          !visited.has(el) &&
          (deep.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      )
      if (after === undefined) return null
      ;(after as HTMLElement).focus?.()
      const landed = deepActive()
      if (landed === null || !want.includes(controlOf(landed))) return null
      const control = controlOf(landed)
      // Recorded as a stop like any other, so its ring is still looked at;
      // the one thing not proved about it is that a press of Tab is what
      // brought focus here, which is the frame's business and not this
      // document's.
      last = control
      visited.add(control)
      const chain = chainOf(landed)
      stops.push({ control, chain, focused: chain.map(ring) })
      return describe(control)
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

export const CONTROL_ROLES = [
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
export async function expectNamed(scope: Locator, where: string): Promise<void> {
  const snapshot = await scope.ariaSnapshot()
  const unnamed = snapshot.split('\n').filter((line) => {
    const m = /^\s*- ([a-z]+)(.*)$/.exec(line)
    if (!m || !CONTROL_ROLES.includes(m[1])) return false
    return !m[2].trimStart().startsWith('"')
  })
  expect(unnamed, `${where}: controls without a name\n${snapshot}`).toEqual([])
}

/**
 * The names of the elements the one button named `name` controls, from
 * Chromium's accessibility tree through the DevTools protocol; none is an
 * empty list. The relation is read there because neither Playwright's
 * snapshot nor its locators expose aria-controls, and a kit button's is an
 * element reference on the button inside its shadow root, with no id to
 * read off the page (issue 121, docs/accessibility.md F6).
 */
export async function controlsOf(page: Page, name: string | RegExp): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page)
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const named = (node: (typeof nodes)[number]): string =>
      typeof node.name?.value === 'string' ? node.name.value : ''
    const buttons = nodes.filter((node) => {
      if (node.ignored || node.role?.value !== 'button') return false
      return typeof name === 'string' ? named(node) === name : name.test(named(node))
    })
    expect(buttons.map(named), `one button named ${String(name)}`).toHaveLength(1)
    const byId = new Map(nodes.map((node) => [node.backendDOMNodeId, node]))
    const controls = buttons[0].properties?.find((property) => property.name === 'controls')
    return (controls?.value.relatedNodes ?? []).map((related) => {
      const node = byId.get(related.backendDOMNodeId)
      return node === undefined ? `(not in the tree: ${related.idref ?? ''})` : named(node)
    })
  } finally {
    await cdp.detach()
  }
}

/** A Tab walk from the top reaches every enabled control, and each shows its focus. */
export async function expectTabWalk(page: Page, where: string): Promise<void> {
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
  let frameIsEnd = false
  const trace: string[] = []
  while (Date.now() < deadline) {
    await page.keyboard.press('Tab')
    const { state, complete, at } = await page.evaluate(() =>
      (window as unknown as { __a11y: Probe }).__a11y.step(),
    )
    trace.push(`${state} ${at}`)
    if (trace.length > 12) trace.shift()
    // A frame is stepped over rather than walked through. What it holds is
    // its page's, the engine's, and the walk could not see it in any case:
    // the viewer's page runs at an opaque origin, so from out here every
    // press inside it reports the same <iframe> element and the press that
    // leaves it reports whatever the platform does next. On macOS that was
    // a control the walk had already reached, which read as the walk coming
    // back round - it ended there and called the 58 controls after the frame
    // unreachable, on a screen where a person reaches them by pressing Tab
    // once more or by using "Skip past the map" (issue 213's neighbourhood;
    // the walk into the frame is asserted on its own in
    // `notebook-a11y.spec.ts`). So focus is put down on the first control
    // after the frame, by hand and in document order. Everything outside a
    // frame is still reached by Tab and still has to show its ring; the one
    // thing no longer proved is that Tab is what crosses the frame's far
    // edge.
    if (state === 'frame' && !frameIsEnd) {
      const landed = await page.evaluate(() =>
        (window as unknown as { __a11y: Probe }).__a11y.past(),
      )
      trace[trace.length - 1] = `frame ${at} -> ${landed ?? 'nothing after it'}`
      // Nothing after it that this walk still wants: stop asking, and let
      // the presses carry on to wherever the platform takes them.
      frameIsEnd = landed === null
      continue
    }
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
export async function expectStill(page: Page, where: string): Promise<void> {
  await page.evaluate(installProbe)
  expect(
    await page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.moving()),
    `${where}: motion under reduced motion`,
  ).toEqual([])
}

export async function sweep(page: Page, where: string, scope?: Locator): Promise<void> {
  await expectNamed(scope ?? page.locator('body'), where)
  await expectTabWalk(page, where)
  await expectStill(page, where)
}

export const heading = (page: Page): Locator => page.getByRole('heading', { level: 1 })

/** Press a control from the keyboard, as a person using one would. */
export async function pressWithKeyboard(control: Locator): Promise<void> {
  await control.focus()
  await control.press('Enter')
}

export async function newProjectFromLibrary(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New project' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'New project' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(dialog).toBeHidden()
}

export async function openLaidOut(page: Page, name: string): Promise<void> {
  await newProjectFromLibrary(page, name)
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(heading(page)).toHaveText(name)
  const layOut = page.getByRole('button', { name: 'Lay out', exact: true })
  await pressWithKeyboard(layOut)
  await expect(page.getByText(/^Laid out/)).toBeVisible({ timeout: 30_000 })
}
