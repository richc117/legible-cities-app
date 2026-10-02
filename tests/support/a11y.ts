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
// - Names said once. No node of that same snapshot has the name of a node
//   it is inside, which a screen reader would say twice on the way in
//   (issue 208). A section named by its own heading is the correct pattern
//   and is not a finding, nor is a heading, a button or a table's cell
//   around what it takes its name from; the rule, its exemptions and the
//   pairs that were decided are `tests/support/a11y-names.ts`. The same
//   snapshot in fact and not only in kind: a sweep takes it once and hands
//   the text to both checks, so on a screen that is moving the two cannot
//   have read different trees.
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
import { join, relative, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { FAKE_ENGINE, PINNED_ENGINE, findPython } from '../support/python'
import { describePair, describeReading, duplicatedNames } from './a11y-names'

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
  /** Move focus to the first wanted control after the frame holding focus, and record nothing. */
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
      // A radio group is one Tab stop: its checked radio, or its first when
      // none is checked; the arrow keys move within it (the new project
      // sheet's "Start from", A5.6-05).
      const radio = el as HTMLInputElement
      if (radio.type === 'radio' && radio.name !== '') {
        const group = [...scope.querySelectorAll('input[type="radio"]')].filter(
          (other) =>
            (other as HTMLInputElement).name === radio.name &&
            !(other as HTMLInputElement).disabled,
        ) as HTMLInputElement[]
        const stop = group.find((other) => other.checked) ?? group[0]
        if (stop !== radio) continue
      }
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
      // Focus is moved and **nothing is recorded**. Where it went is read
      // afterwards by `step()`, from the document, exactly as it is for a
      // press of Tab: taking focus away from a frame crosses a process
      // boundary and does not finish synchronously, so the reading taken
      // here can still be the frame - which is how the first version of
      // this recorded nothing and reported the control it had just focused
      // as unreachable. A probe that marked a control reached because it
      // had asked for it would be worse than that: it would make the sweep
      // lie in the one direction the sweep exists to catch.
      ;(after as HTMLElement).focus?.()
      return describe(after)
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

/**
 * The snapshot of the accessibility tree under a scope, or the text of one
 * already taken. The two checks that read it take either: a sweep takes the
 * snapshot once and hands both the same text, and a test that wants one
 * check alone hands it a locator.
 */
const snapshotOf = async (from: Locator | string): Promise<string> =>
  typeof from === 'string' ? from : from.ariaSnapshot()

/**
 * Every control the accessibility tree holds under `scope` has a name.
 * `scope` is a locator, or the text of a snapshot already taken.
 */
export async function expectNamed(scope: Locator | string, where: string): Promise<void> {
  const snapshot = await snapshotOf(scope)
  const unnamed = snapshot.split('\n').filter((line) => {
    const m = /^\s*- ([a-z]+)(.*)$/.exec(line)
    if (!m || !CONTROL_ROLES.includes(m[1])) return false
    return !m[2].trimStart().startsWith('"')
  })
  expect(unnamed, `${where}: controls without a name\n${snapshot}`).toEqual([])
}

/**
 * Nothing in the accessibility tree under `scope` has the name of something
 * it is inside (issue 208). The rule is `duplicatedNames`, which is pure and
 * has its own unit tests; this hands it the snapshot. `scope` is a locator,
 * or the text of a snapshot already taken.
 *
 * Every role is read and not only `CONTROL_ROLES`: the defect this was
 * written for was a `group` inside a `region`, and neither is a control.
 *
 * **A soft expectation**, the one check of the sweep that is. A repeated
 * name stops nothing that follows it, so the test carries on and fails at
 * its end with every screen's pairs in the one run, where a thrown failure
 * would show the first screen's and hide the rest until that was settled.
 * The message lists every pair as the ancestor's role and name and then the
 * node's, with where it is and the `KNOWN_PAIRS` entry that would exempt
 * it; a line the rule could not read fails here too, since a tree it has
 * stopped seeing is one it cannot pass.
 *
 * **The snapshot is attached to the test and not printed**, which is what
 * "at lines 3 and 4 of the snapshot" is followed in. It is attached as a
 * file, and the message names the file, because the list reporter prints
 * the first 300 characters of an attachment that is text in memory and the
 * path of one that is a file. Only when something was found: a run that
 * passes attaches nothing. So this is called inside a test, as every sweep
 * is.
 */
export async function expectNoDuplicatedNames(
  scope: Locator | string,
  where: string,
): Promise<void> {
  const snapshot = await snapshotOf(scope)
  const reading = duplicatedNames(snapshot)
  // The message is the step's title in a report as well, on a run that
  // passes too, so it says what was checked when there is nothing to list.
  let found = describeReading(reading)
  if (found === '') found = 'no name is repeated inside the element it names'
  else {
    const info = test.info()
    const name = where.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const file = info.outputPath(`${name}.snapshot.txt`)
    writeFileSync(file, snapshot)
    await info.attach(`${where}: the snapshot`, { path: file, contentType: 'text/plain' })
    found += `\nthe snapshot: ${relative(repoRoot, file)}`
  }
  expect
    .soft(
      [
        ...reading.pairs.map(describePair),
        ...reading.unread.map(({ line, text }) => `unread, line ${line}: ${text}`),
      ],
      `${where}: ${found}`,
    )
    .toEqual([])
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
    // back round: it ended there and called the 58 controls after the frame
    // unreachable, on a screen where a person reaches them by pressing Tab
    // once more or by using "Skip past the map". That is the sweep's limit
    // and not the screen's - the frame has sat above the cells since
    // A5.5-08, and the walk into it is asserted on its own in
    // `notebook-a11y.spec.ts`.
    //
    // So focus is put down on the first control after the frame, by hand
    // and in document order. **That is a real reduction in what this sweep
    // proves**, and it is taken deliberately, because a document cannot see
    // into a cross-origin frame and no amount of pressing Tab out here will
    // tell it what happened in there. What is still proved: every control
    // outside a frame is reached by Tab and shows its ring. What is not:
    // that a press of Tab is what crosses a frame's far edge - one control
    // per frame, which on the project screen is cell 01's heading row, and
    // which is still swept for its name and its ring.
    if (state === 'frame' && !frameIsEnd) {
      const aimed = await page.evaluate(() =>
        (window as unknown as { __a11y: Probe }).__a11y.past(),
      )
      if (aimed === null) {
        // Nothing after it that this walk still wants: stop asking, and let
        // the presses carry on to wherever the platform takes them.
        trace[trace.length - 1] = `frame ${at} -> nothing after it`
        frameIsEnd = true
        continue
      }
      // `past()` only moves focus. Where focus actually went is read here,
      // by the same `step()` that reads it after a press, so the walk
      // learns it from the document and not from having asked: focus
      // leaving a frame crosses a process boundary and the first reading
      // can still be the frame. If it never arrives the walk carries on
      // pressing and the control is reported missed, which is the honest
      // answer and not a silent pass.
      //
      // Asked again if it did not arrive: a `focus()` that crosses out of a
      // frame's process can be dropped, and a walk that then goes on
      // pressing Tab from the frame reaches the control after the one it
      // aimed at, which reported the first control of the page as
      // unreachable on three CI runs. Each ask is read the same way, from
      // the document, so a control never counts as reached for having been
      // asked for.
      let arrived: string | null = null
      for (let attempt = 0; attempt < 3 && arrived === null; attempt++) {
        if (attempt > 0)
          await page.evaluate(() => (window as unknown as { __a11y: Probe }).__a11y.past())
        const settle = Date.now() + 2_000
        while (arrived === null && Date.now() < settle) {
          const answer = await page.evaluate(() =>
            (window as unknown as { __a11y: Probe }).__a11y.step(),
          )
          if (answer.state !== 'frame' && answer.state !== 'none') arrived = answer.at
        }
      }
      trace[trace.length - 1] = `frame ${at} -> asked for ${aimed}, reached ${arrived ?? 'nothing'}`
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

/**
 * The interface's two themes, by the colour scheme that chooses each while
 * Settings follows the system, and the `data-theme` `theme.ts` writes for it.
 */
const THEMES = [
  { scheme: 'dark', attribute: null, name: 'Night' },
  { scheme: 'light', attribute: 'sepia', name: 'Parchment' },
] as const

/** The interface in one theme, and only once `theme.ts` has written it: the attribute lands a turn after the emulation. */
async function inTheme(page: Page, theme: (typeof THEMES)[number]): Promise<void> {
  await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: 'reduce' })
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')), {
      message: `the interface is in ${theme.name} (Settings must follow the system for a sweep)`,
    })
    .toBe(theme.attribute)
}

/**
 * Names, each said once, the Tab walk and motion, in both of the interface's
 * themes (A5.6-09):
 * a focus ring or a control that only one theme draws is a defect the other
 * would hide. The session is left in the default theme, Night, as it began.
 */
export async function sweep(page: Page, where: string, scope?: Locator): Promise<void> {
  let failure: unknown = null
  try {
    for (const theme of THEMES) {
      await inTheme(page, theme)
      const here = `${where} (${theme.name})`
      // One snapshot for both checks of it. Two would be two trees on a
      // screen that is moving - a feed being added, a sample downloading -
      // and a name found missing in one could not be looked up in the other.
      const snapshot = await (scope ?? page.locator('body')).ariaSnapshot()
      await expectNamed(snapshot, here)
      await expectNoDuplicatedNames(snapshot, here)
      await expectTabWalk(page, here)
      await expectStill(page, here)
    }
  } catch (error) {
    failure = error
  }
  // Back to Night, as the session began. A failure above is the one worth
  // reading: one here, on a page that has crashed or closed, must not
  // replace it.
  try {
    await inTheme(page, THEMES[0])
  } catch (error) {
    failure ??= error
  }
  if (failure !== null) throw failure
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
