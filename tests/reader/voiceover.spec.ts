// The screen-reader walkthrough (docs/accessibility.md, "Walking it with a
// screen reader"), heard by a script: VoiceOver driven by Guidepup, the
// installed app driven by Playwright (issue 691). One test, one session, one
// `test.step` per walkthrough row, no retries. What each row does and what
// it listens for is in parts.ts; what counts as heard, and the words the
// record is given, are in transcript.ts.
//
//   LEGIBLE_READER_APP=<the installed app> npm run test:reader
//
// LEGIBLE_READER_APP is the `.app` bundle or its executable. Without it, or
// off macOS, the test is skipped. It starts VoiceOver, which takes over
// speech and the keyboard, so it runs on a hosted runner (acceptance.yml's
// `reader` job) after `@guidepup/setup`, and on a person's Mac only when
// LEGIBLE_READER_HERE=1 says they mean it: Guidepup quits their own
// VoiceOver and starts it again at the end. Optional:
//
//   LEGIBLE_READER_OUT   where the transcript and the record copy go
//                        (default reader-results, which git ignores)
//   GITHUB_RUN_ID        the run a clause names; without it the transcript is
//                        written and no clause is
//
// What it writes: `transcript.md` (each row, each action, what was wanted
// and what VoiceOver said, word for word), `transcript.json`, and, where the
// versions were all read, `clauses.md` and `accessibility.md`, the record
// with each clause appended to its row's VoiceOver cell. Heard is not a
// pass: no one listened. The test fails when any scripted row was not heard
// or its script stopped.
//
// The method is the spike's (docs/adr/spikes/gate-tools-on-hosted-macos.md):
// VoiceOver started before the app, one unrecorded warm-up Tab, and every
// action wrapped in `voiceOver.capture()`, which returns what was spoken
// and what VoiceOver's cursor is on once the action has returned.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { voiceOver } from '@guidepup/guidepup'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type ElementHandle,
  type Locator,
  type Page,
} from '@playwright/test'
import { cellGroup, cellHeading, openCell, type CellId as SupportCellId } from '../support/project'
import {
  PARTS,
  PHASES,
  type After,
  type Also,
  type CellId,
  type Ctx,
  type Phase,
  type Said,
} from './parts'
import {
  appendClauses,
  clausesByTable,
  containerWants,
  freshPhrase,
  missing,
  outcomeOf,
  parseSnapshotLine,
  renderTranscript,
  wantText,
  wantsOf,
  type Hearing,
  type PartResult,
  type Reading,
  type RunFacts,
  type State,
  type Want,
} from './transcript'

const repoRoot = resolve(__dirname, '../..')
const APP = process.env.LEGIBLE_READER_APP ?? ''
const OUT = resolve(process.env.LEGIBLE_READER_OUT || join(repoRoot, 'reader-results'))
const PRODUCT = 'Legible Cities'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const LAUNCH_MS = 2 * MINUTE
const READY_MS = 5 * MINUTE
const LAYOUT_MS = 20 * MINUTE
/** How long a focus move or a press is listened to after its capture. */
const HEAR_MS = 4 * SECOND
/** How long focus is given to land where a press sends it. */
const LAND_MS = 10 * SECOND
/** A said sentence is taken once its scope has held still this long. */
const SETTLE_MS = 1_500
const SAID_MS = 30 * SECOND

const here = process.env.CI === 'true' || process.env.LEGIBLE_READER_HERE === '1'
test.skip(
  APP === '' || process.platform !== 'darwin',
  'set LEGIBLE_READER_APP to an installed Legible Cities on macOS',
)
test.skip(
  !here,
  'this starts VoiceOver and takes the keyboard: set LEGIBLE_READER_HERE=1 to run it here',
)

// ---------------------------------------------------------------- the machine

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] ?? ''

function executableOf(path: string): string {
  const absolute = resolve(path)
  return absolute.endsWith('.app') ? join(absolute, 'Contents', 'MacOS', PRODUCT) : absolute
}

/** A short command's first line of output, or null; an argument array, a timeout, no window. */
function firstLine(command: string, args: string[]): string | null {
  const run = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 10 * SECOND,
    windowsHide: true,
  })
  if (run.status !== 0) {
    // Said, so a version missing from the transcript has its reason in the log.
    console.error(
      `${command} ${args.join(' ')}: exit ${String(run.status)}${run.error ? `, ${run.error.message}` : ''}${run.stderr ? `, ${run.stderr.trim()}` : ''}`,
    )
    return null
  }
  return (run.stdout ?? '').split('\n')[0]?.trim() || null
}

/** VoiceOver's own version, from its Info.plist, not from the library that drives it. */
const voiceOverVersion = (): string | null =>
  firstLine('plutil', [
    '-extract',
    'CFBundleShortVersionString',
    'raw',
    '-o',
    '-',
    '/System/Library/CoreServices/VoiceOver.app/Contents/Info.plist',
  ])

function guidepupVersion(): string | null {
  try {
    const manifest = readFileSync(
      join(repoRoot, 'node_modules', '@guidepup', 'guidepup', 'package.json'),
      'utf8',
    )
    return String((JSON.parse(manifest) as { version?: unknown }).version ?? '') || null
  } catch {
    return null
  }
}

/** The environment a person's launch would have: no development switch, no engine pointer. */
function launchEnvironment(exportFolder: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (/^(SCHEMATIC_|LEGIBLE_|PYTHON)/i.test(key) || key === 'ELECTRON_RUN_AS_NODE') continue
    env[key] = value
  }
  env.LEGIBLE_EXPORT_FOLDER = exportFolder
  return env
}

/** acceptance.spec.ts's: shown, raised, focused, focus taken on macOS. */
async function bringToFront(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, app: electronApp }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.moveTop()
    window.focus()
    electronApp.focus({ steal: true })
  })
}

/** One sentence a status, an alert or a live region came to hold, and every element it was inside then. */
interface SaidEntry {
  text: string
  within: Element[]
}

/**
 * Every sentence a status, an alert or a live region has held, in order,
 * with the element that held it and each element it was inside when it was
 * scanned: a sentence that is gone from the screen, or whose sheet has
 * closed, by the time it is listened for is still known, and still known
 * to have been inside that sheet.
 */
async function installRecorder(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await page.evaluate(() => {
    const holder = window as unknown as { __readerSaid?: SaidEntry[] }
    if (holder.__readerSaid !== undefined) return
    const said: SaidEntry[] = []
    holder.__readerSaid = said
    const last = new WeakMap<Element, string>()
    const chain = (element: Element): Element[] => {
      const within: Element[] = []
      let node: Node | null = element
      while (node !== null) {
        if (node instanceof Element) within.push(node)
        node = node instanceof ShadowRoot ? node.host : node.parentNode
      }
      return within
    }
    const scan = (): void => {
      for (const element of document.querySelectorAll(
        '[role="status"], [role="alert"], [aria-live]',
      )) {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text !== '' && last.get(element) !== text) {
          said.push({ text, within: chain(element) })
        }
        last.set(element, text)
      }
    }
    new MutationObserver(scan).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    scan()
  })
}

// ----------------------------------------------------------------- listening

interface Mark {
  log: number
  said: number
}

/**
 * The session: the app's page, everything VoiceOver said in order, and the
 * hearings of the row being run. Guidepup reports VoiceOver's last phrase,
 * and reports it again as new after some 650 ms of polling or after an
 * empty capture, so what one action captured can be the phrase said before
 * it. Every capture is therefore taken against a snapshot of what was last
 * heard just before the action (`freshPhrase`), and a phrase that is that
 * one is not credited to the action. When in doubt a row is not heard.
 */
class Session implements Ctx {
  readonly log: string[] = []
  item = ''
  hearings: Hearing[] = []
  project = ''
  private readonly marks = new Map<string, Mark>()

  constructor(readonly page: Page) {}

  /** The polite line every job's end is said in (App.tsx). */
  get announcer(): Locator {
    return this.page.locator('[data-announces="jobs"]')
  }

  /** What was last heard: the session's last phrase and Guidepup's. */
  private async heardLast(): Promise<string[]> {
    return [this.log.at(-1) ?? '', await voiceOver.lastSpokenPhrase().catch(() => '')]
  }

  /** A phrase VoiceOver said, kept only where it is not what was heard before. */
  private keep(phrase: string, before: readonly string[]): void {
    const fresh = freshPhrase(phrase, before)
    if (fresh !== '') this.log.push(fresh)
  }

  async capture(action: () => Promise<unknown>, full = true): Promise<void> {
    const before = await this.heardLast()
    const got = await voiceOver.capture(action, { capture: full ? true : 'initial' })
    this.keep(got.spokenPhrase, before)
    if (got.itemText !== '') this.item = got.itemText
  }

  /** One look at what VoiceOver says now. */
  poll(): Promise<void> {
    return this.capture(async () => undefined, false)
  }

  private async saidCount(): Promise<number> {
    return this.page.evaluate(
      () => (window as unknown as { __readerSaid?: unknown[] }).__readerSaid?.length ?? 0,
    )
  }

  /**
   * The sentences said inside `scope` since the recorder's entry `from`, by
   * the elements each was inside when it was said. `scope` is the element
   * itself where it was found before the action, so a sheet the action
   * closed still answers for what was said in it.
   */
  private async saidIn(scope: Locator | ElementHandle, from: number): Promise<string[]> {
    const inScope = (root: Element, since: number): string[] =>
      ((window as unknown as { __readerSaid?: SaidEntry[] }).__readerSaid ?? [])
        .slice(since)
        .filter((entry) => entry.within.includes(root))
        .map((entry) => entry.text)
    try {
      if ('elementHandle' in scope) {
        return await scope.evaluate(inScope, from, { timeout: 2 * SECOND })
      }
      return await scope.evaluate(inScope, from)
    } catch {
      return []
    }
  }

  /** Each scope's element as it is now, where it is there, for `saidIn` after the action. */
  private async held(saids: readonly Said[]): Promise<(ElementHandle | null)[]> {
    return Promise.all(
      saids.map((said) => said.scope.elementHandle({ timeout: 500 }).catch(() => null)),
    )
  }

  /** What `said` came to hold since `from`, once it has ended and held still; listening meanwhile. */
  private async sentencesOf(
    said: Said,
    from: number,
    held: ElementHandle | null = null,
  ): Promise<string[]> {
    const deadline = Date.now() + (said.deadlineMs ?? SAID_MS)
    let seen: string[] = []
    let stillSince = Date.now()
    for (;;) {
      const now = await this.saidIn(held ?? said.scope, from)
      if (now.join('\n') !== seen.join('\n')) {
        seen = now
        stillSince = Date.now()
      }
      const ended = said.until === undefined || (await said.until().catch(() => false))
      if (ended && seen.length > 0 && Date.now() - stillSince >= SETTLE_MS) break
      if (Date.now() > deadline) {
        throw new Error(
          `nothing came to be said inside ${said.scope.toString()} within ${Math.round((said.deadlineMs ?? SAID_MS) / SECOND)} s`,
        )
      }
      await this.poll()
    }
    const unique = [...new Set(seen)]
    switch (said.pick ?? 'all') {
      case 'first':
        return unique.slice(0, 1)
      case 'last':
        return unique.slice(-1)
      default:
        return unique
    }
  }

  /** The control focus is on, as the page has it; null where focus is on nothing. */
  async reading(): Promise<Reading | null> {
    const facts = await this.page.evaluate(() => {
      const holder = window as unknown as { __readerFocus?: Element }
      holder.__readerFocus?.removeAttribute('data-reader-focus')
      let el: Element | null = document.activeElement
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
      if (el === null || el === document.body || el === document.documentElement) return null
      el.setAttribute('data-reader-focus', '')
      holder.__readerFocus = el
      const root = el.getRootNode()
      const host = root instanceof ShadowRoot ? root.host : null
      const attr = (name: string): string | null =>
        el?.getAttribute(name) ?? host?.getAttribute(name) ?? null
      const byId = (id: string): Element | null =>
        (root instanceof ShadowRoot ? root.getElementById(id) : null) ?? document.getElementById(id)
      const textOf = (ids: string): string =>
        ids
          .split(/\s+/)
          .map((id) => byId(id)?.textContent ?? '')
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
      const states: string[] = []
      const expanded = attr('aria-expanded')
      if (expanded === 'true') states.push('expanded')
      else if (expanded === 'false') states.push('collapsed')
      if (attr('aria-pressed') === 'true') states.push('pressed')
      const input = el instanceof HTMLInputElement ? el : null
      const isSwitch = attr('role') === 'switch'
      if (input !== null && (input.type === 'checkbox' || input.type === 'radio')) {
        if (isSwitch) states.push(input.checked ? 'on' : 'off')
        else states.push(input.checked ? 'checked' : 'unchecked')
      } else if (attr('aria-checked') !== null) {
        const checked = attr('aria-checked') === 'true'
        states.push(isSwitch ? (checked ? 'on' : 'off') : checked ? 'checked' : 'unchecked')
      }
      if ((el as HTMLButtonElement).disabled === true || attr('aria-disabled') === 'true') {
        states.push('dimmed')
      }
      if (attr('aria-invalid') === 'true') states.push('invalid')
      const current = attr('aria-current')
      if (current !== null && current !== 'false') states.push('current')
      if ((input?.required ?? false) || attr('aria-required') === 'true') states.push('required')
      const sort = el.closest('th')?.getAttribute('aria-sort')
      if (sort === 'ascending' || sort === 'descending') states.push(sort)
      let value: string | null = null
      if (el instanceof HTMLSelectElement) value = el.selectedOptions[0]?.textContent ?? null
      else if (input !== null && input.type === 'range') {
        value = attr('aria-valuetext') ?? input.value
      } else if (input !== null && input.type !== 'checkbox' && input.type !== 'radio') {
        value = input.value
      } else if (el instanceof HTMLTextAreaElement) value = el.value
      else if (attr('aria-valuetext') !== null) value = attr('aria-valuetext')
      const describedBy = attr('aria-describedby')
      const description =
        attr('aria-description') ?? (describedBy === null ? null : textOf(describedBy))
      const level = /^H[1-6]$/.test(el.tagName)
        ? Number(el.tagName.slice(1))
        : attr('aria-level') === null
          ? null
          : Number(attr('aria-level'))
      return {
        states,
        value: value === null ? null : value.replace(/\s+/g, ' ').trim(),
        description: description === null || description === '' ? null : description,
        level,
        fallbackName: attr('aria-label') ?? el.getAttribute('title') ?? '',
      }
    })
    if (facts === null) return null
    const { role, name } = parseSnapshotLine(
      await this.page.locator('[data-reader-focus]').ariaSnapshot({ timeout: 5 * SECOND }),
    )
    return {
      role,
      name: name === '' ? facts.fallbackName : name,
      states: facts.states as State[],
      level: role === 'heading' ? facts.level : null,
      value: facts.value,
      description: facts.description,
    }
  }

  /** The words a container is to be heard by: its role, and its name where it has one. */
  private async containerWants(within: Locator): Promise<Want[]> {
    const { role, name } = parseSnapshotLine(await within.ariaSnapshot({ timeout: 5 * SECOND }))
    return containerWants(role, name)
  }

  private async wantsOfFocus(also: Also = {}): Promise<{ wants: Want[]; on: string }> {
    const reading = await this.reading()
    if (reading === null) throw new Error('focus is on nothing')
    const wants = wantsOf(reading, also)
    if (also.within !== undefined) wants.push(...(await this.containerWants(also.within)))
    for (const word of also.words ?? []) wants.push(wantText(word))
    return { wants, on: reading.name || reading.role }
  }

  /** Whether focus is in `target`: on it, inside it, or inside its shadow root. */
  private focusIn(target: Locator): Promise<boolean> {
    return target
      .evaluate(
        (t) => {
          let el: Element | null = document.activeElement
          while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
          if (el === null) return false
          const host = (el.getRootNode() as ShadowRoot).host ?? null
          return t === el || t.contains(el) || (host !== null && (t === host || t.contains(host)))
        },
        undefined,
        { timeout: 2 * SECOND },
      )
      .catch(() => false)
  }

  /** Hear `wants` among what was said since `from`, listening on to the deadline, and keep the hearing. */
  private async hear(
    action: string,
    wants: Want[],
    from: number,
    deadlineMs = HEAR_MS,
  ): Promise<void> {
    // A hearing that wants nothing is heard whatever was said.
    if (wants.length === 0) throw new Error(`${action}: nothing to listen for`)
    const end = Date.now() + deadlineMs
    let left = missing(this.log.slice(from), wants)
    while (left.length > 0 && Date.now() < end) {
      await this.poll()
      left = missing(this.log.slice(from), wants)
    }
    this.hearings.push({
      action,
      wants: wants.map((w) => w.said),
      spoken: this.log.slice(from),
      item: this.item,
      missing: left.map((w) => w.said),
    })
  }

  /** A hearing of focus that never came: what was to be heard there is what was not. */
  private async notLanded(action: string, target: Locator, from: number): Promise<void> {
    const name = await target
      .ariaSnapshot({ timeout: 2 * SECOND })
      .then((s) => parseSnapshotLine(s).name || parseSnapshotLine(s).role)
      .catch(() => target.toString())
    const where = await this.reading().catch(() => null)
    this.hearings.push({
      action: `${action} (focus went to ${where?.name || where?.role || 'nothing'})`,
      wants: [name],
      spoken: this.log.slice(from),
      item: this.item,
      missing: [name],
    })
  }

  private async onNow(): Promise<string> {
    const reading = await this.reading().catch(() => null)
    return reading === null ? 'nothing' : reading.name || reading.role
  }

  // ----------------------------------------------------------------- Ctx

  async tab(target: Locator, also: Also = {}): Promise<void> {
    await target.waitFor({ state: 'visible', timeout: 30 * SECOND })
    // From the control before it: focus put on it and taken back a step,
    // all heard out before the Tab that is listened to.
    await this.capture(async () => {
      await target.focus()
      await this.page.keyboard.press('Shift+Tab')
    })
    const from = this.log.length
    await this.capture(() => this.page.keyboard.press('Tab'))
    if (!(await this.focusIn(target))) return this.notLanded('Tab', target, from)
    const { wants, on } = await this.wantsOfFocus(also)
    await this.hear(`Tab to ${on}`, wants, from)
  }

  async focus(target: Locator, also: Also = {}): Promise<void> {
    await target.waitFor({ state: 'visible', timeout: 30 * SECOND })
    const from = this.log.length
    await this.capture(() => target.focus())
    const { wants, on } = await this.wantsOfFocus(also)
    await this.hear(`focus put on ${on}`, wants, from)
  }

  async press(key: string, after: After): Promise<void> {
    const action = `${key} on ${await this.onNow()}`
    const from = this.log.length
    const saidFrom = await this.saidCount()
    const saids: readonly Said[] =
      after.said === undefined ? [] : Array.isArray(after.said) ? after.said : [after.said as Said]
    const held = await this.held(saids)
    await this.capture(() => this.page.keyboard.press(key))
    const wants: Want[] = []
    if (after.focus !== undefined) {
      if (after.focus !== true) {
        const target = after.focus
        const end = Date.now() + LAND_MS
        while (!(await this.focusIn(target)) && Date.now() < end) await this.poll()
        if (!(await this.focusIn(target))) return this.notLanded(action, target, from)
      }
      wants.push(...(await this.wantsOfFocus(after.also)).wants)
    }
    if (after.words !== undefined) wants.push(...(await after.words()).map(wantText))
    for (const [at, said] of saids.entries()) {
      wants.push(...(await this.sentencesOf(said, saidFrom, held[at] ?? null)).map(wantText))
    }
    await this.hear(action, wants, from)
  }

  private async walkFrom(
    action: string,
    texts: readonly string[],
    steps: number,
    move: () => Promise<void>,
  ): Promise<void> {
    // An empty term or value would be heard in anything: refused, not skipped.
    const wants = texts.map(wantText)
    if (wants.length === 0) throw new Error(`${action}: nothing to listen for`)
    const from = this.log.length
    for (let step = 0; step < steps; step += 1) {
      const before = await this.heardLast()
      await move()
      this.keep(await voiceOver.lastSpokenPhrase(), before)
      this.item = (await voiceOver.itemText()) || this.item
      if (missing(this.log.slice(from), wants).length === 0) break
    }
    await this.hear(action, wants, from, 0)
  }

  async walk(to: Locator, texts: readonly string[], steps: number): Promise<void> {
    await to.waitFor({ state: 'attached', timeout: 30 * SECOND })
    // VoiceOver's cursor follows focus: focus the last control before
    // `to`, and walk on from there.
    let before = ''
    await this.capture(async () => {
      before = await to.evaluate((target) => {
        // A control Tab could stop on: a native one, a kit control's host
        // (its shadow root delegates focus), or anything given a tabindex.
        const focusable = (el: Element): boolean => {
          const html = el as HTMLElement
          if (html.getClientRects().length === 0) return false
          if ((html as HTMLButtonElement).disabled === true) return false
          if (el.shadowRoot?.delegatesFocus === true) return true
          if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
            return html.tabIndex >= 0
          }
          return html.hasAttribute('tabindex') && html.tabIndex >= 0
        }
        let last: HTMLElement | null = null
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          const el = node as HTMLElement
          if (el === target || target.contains(el)) break
          if (el.contains(target)) continue
          if (focusable(el)) last = el
        }
        if (last === null) return ''
        last.focus()
        return (
          last.getAttribute('aria-label') ?? last.textContent?.trim().slice(0, 40) ?? last.tagName
        )
      })
    })
    if (before === '') throw new Error(`nothing focusable before ${to.toString()} to walk from`)
    await this.walkFrom(`VoiceOver next, from ${before}`, texts, steps, () => voiceOver.next())
  }

  async walkBack(from: Locator, texts: readonly string[], steps: number): Promise<void> {
    await from.waitFor({ state: 'visible', timeout: 30 * SECOND })
    await this.capture(() => from.focus())
    await this.walkFrom(`VoiceOver previous, from ${await this.onNow()}`, texts, steps, () =>
      voiceOver.previous(),
    )
  }

  async mark(name: string): Promise<void> {
    this.marks.set(name, { log: this.log.length, said: await this.saidCount() })
  }

  private markOf(name: string): Mark {
    const mark = this.marks.get(name)
    if (mark === undefined) throw new Error(`no mark "${name}": the row that sets it did not run`)
    return mark
  }

  async listen(since: string, said: Said): Promise<void> {
    const mark = this.markOf(since)
    const wants = (await this.sentencesOf(said, mark.said)).map(wantText)
    await this.hear(`listening since ${since}`, wants, mark.log)
  }

  async landed(target: Locator, since: string, also: Also = {}): Promise<void> {
    const mark = this.markOf(since)
    const end = Date.now() + LAND_MS
    while (!(await this.focusIn(target)) && Date.now() < end) await this.poll()
    if (!(await this.focusIn(target)))
      return this.notLanded(`the end of ${since}`, target, mark.log)
    const { wants, on } = await this.wantsOfFocus(also)
    await this.hear(`focus come to rest on ${on} since ${since}`, wants, mark.log)
  }

  readonly quietly = {
    press: (key: string): Promise<void> => this.capture(() => this.page.keyboard.press(key)),
    fill: (target: Locator, text: string): Promise<void> => this.capture(() => target.fill(text)),
    select: (target: Locator, value: string): Promise<void> =>
      this.capture(() => target.selectOption(value)),
    focus: (target: Locator): Promise<void> => this.capture(() => target.focus()),
    click: (target: Locator): Promise<void> => this.capture(() => target.click()),
  }

  async until(what: string, probe: () => Promise<boolean>, deadlineMs: number): Promise<void> {
    const end = Date.now() + deadlineMs
    while (!(await probe().catch(() => false))) {
      if (Date.now() > end)
        throw new Error(`${what}: not within ${Math.round(deadlineMs / SECOND)} s`)
      await this.poll()
    }
  }

  visible(target: Locator, deadlineMs = 30 * SECOND): Promise<void> {
    return this.until(`${target.toString()} shown`, () => target.isVisible(), deadlineMs)
  }

  async text(target: Locator): Promise<string> {
    return ((await target.innerText({ timeout: 10 * SECOND })) ?? '').replace(/\s+/g, ' ').trim()
  }

  async texts(target: Locator): Promise<string[]> {
    // Empty ones kept: a definition with no value is a finding, not nothing.
    return (await target.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim())
  }

  async description(target: Locator): Promise<string> {
    const text = await target.evaluate((el) => {
      const own = el.getAttribute('aria-description')
      if (own !== null) return own
      const ids = el.getAttribute('aria-describedby') ?? ''
      return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
    })
    const said = text.replace(/\s+/g, ' ').trim()
    if (said === '') throw new Error(`${target.toString()} has no description`)
    return said
  }

  async name(target: Locator): Promise<string> {
    return parseSnapshotLine(await target.ariaSnapshot({ timeout: 10 * SECOND })).name
  }

  cellHeading(id: CellId): Locator {
    return cellHeading(this.page, id as SupportCellId)
  }

  cellGroup(id: CellId): Locator {
    return cellGroup(this.page, id as SupportCellId)
  }

  cellSection(id: CellId): Locator {
    const n = (['data', 'process', 'frame', 'style', 'lines', 'export'] as const).indexOf(id) + 1
    return this.page.locator(`section.cell[data-cell="0${n}"]`)
  }

  async openCell(id: CellId): Promise<void> {
    await this.capture(() => openCell(this.page, id as SupportCellId))
  }
}

// ----------------------------------------------------------------- phases

const libraryHeading = (page: Page): Locator =>
  page.getByRole('heading', { level: 1, name: 'Library' })

async function toLibrary(session: Session): Promise<void> {
  if (await libraryHeading(session.page).isVisible()) return
  await session.quietly.click(session.page.getByRole('button', { name: 'Back to Library' }))
  await session.visible(libraryHeading(session.page))
}

/** What a phase needs before its rows run. */
async function enter(phase: Phase, session: Session): Promise<void> {
  const page = session.page
  switch (phase) {
    case 'library':
    case 'open':
    case 'back':
    case 'settings':
      await toLibrary(session)
      return
    case 'first layout':
      return
    case 'project': {
      // The sample's layout at its end: no Stop, and the map drawn.
      await session.until(
        'the sample laid out and its map drawn',
        async () =>
          (await page.locator('.preview[data-map="drawn"]').count()) > 0 &&
          (await page.getByRole('button', { name: 'Stop', exact: true }).count()) === 0,
        LAYOUT_MS,
      )
      session.project = (await page.getByRole('heading', { level: 1 }).innerText()).trim()
      return
    }
    case 'last': {
      await toLibrary(session)
      await session.quietly.click(
        page.getByRole('button', { name: `Open ${session.project}`, exact: true }),
      )
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(session.project)
      return
    }
  }
}

// ------------------------------------------------------------------- the run

test('the walkthrough, heard with VoiceOver', async () => {
  mkdirSync(OUT, { recursive: true })
  const temp = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'legible-reader-'))
  const results = new Map<string, PartResult>()
  let app: ElectronApplication | null = null
  let started = false
  let facts: RunFacts | null = null
  try {
    await voiceOver.start()
    started = true
    app = await electron.launch({
      executablePath: executableOf(APP),
      args: [`--user-data-dir=${join(temp, 'profile')}`],
      env: launchEnvironment(join(temp, 'exports')),
      timeout: LAUNCH_MS,
    })
    const page = await app.firstWindow({ timeout: LAUNCH_MS })
    await installRecorder(page)
    const session = new Session(page)
    await session.mark('launch')
    await bringToFront(app)
    await session.until(
      'the engine ready and the Library drawn',
      async () =>
        /ready/i.test(await page.getByRole('status', { name: 'Engine' }).innerText()) &&
        (await page.getByRole('heading', { name: 'Sample cities' }).isVisible()),
      READY_MS,
    )
    await bringToFront(app)

    const version = (await app.evaluate(({ app: electronApp }) => electronApp.getVersion())) ?? ''
    const read = {
      voiceOver: voiceOverVersion(),
      macOS: firstLine('sw_vers', ['-productVersion']),
      guidepup: guidepupVersion(),
      app: version,
      run: process.env.GITHUB_RUN_ID ?? '',
    }
    if (Object.values(read).every((v) => v !== null && v !== '')) facts = read as RunFacts
    console.log(`reader run: ${JSON.stringify(read)}`)

    // The spike's one miss was the first phrase after VoiceOver's first
    // start: this Tab is heard and not recorded.
    await session.capture(() => page.keyboard.press('Tab'))
    await session.quietly.focus(page.getByRole('heading', { level: 1 }))

    const ctx: Ctx = session
    for (const phase of PHASES) {
      const parts = PARTS.filter((p) => p.scripted !== 'none' && p.phase === phase)
      if (parts.length === 0) continue
      let entered: string | null = null
      await test.step(`phase: ${phase}`, async () => {
        entered = await enter(phase, session).then(
          () => null,
          (error: unknown) => messageOf(error),
        )
      })
      for (const part of parts) {
        if (part.scripted === 'none') continue
        await test.step(part.row, async () => {
          session.hearings = []
          let error: string | null =
            entered === null ? null : `the ${phase} phase did not begin: ${entered}`
          if (error === null) {
            await bringToFront(app as ElectronApplication).catch(() => undefined)
            error = await part.run(ctx).then(
              () => null,
              (e: unknown) => messageOf(e),
            )
          }
          results.set(part.row, {
            row: part.row,
            table: part.table,
            scripted: part.scripted,
            notScripted: part.scripted === 'part' ? part.notScripted : null,
            hearings: session.hearings,
            error,
          })
          // Whatever a stopped script left open is shut, so the next row starts clean.
          if (error !== null) await session.quietly.press('Escape').catch(() => undefined)
        })
      }
    }
  } finally {
    if (app !== null) await Promise.race([app.close().catch(() => undefined), sleep(30 * SECOND)])
    if (started) await voiceOver.stop().catch(() => undefined)
  }

  // Every row, in the record's order; the unscripted ones said so.
  const ordered: PartResult[] = PARTS.map(
    (part) =>
      results.get(part.row) ?? {
        row: part.row,
        table: part.table,
        scripted: part.scripted,
        notScripted: part.scripted === 'full' ? null : part.notScripted,
        hearings: [],
        error: part.scripted === 'none' ? null : 'not run: the session ended before it',
      },
  )
  writeFileSync(join(OUT, 'transcript.md'), renderTranscript(ordered, facts))
  writeFileSync(
    join(OUT, 'transcript.json'),
    `${JSON.stringify({ facts, rows: ordered }, null, 2)}\n`,
  )
  if (facts !== null) {
    const clauses = clausesByTable(ordered, facts)
    writeFileSync(
      join(OUT, 'clauses.md'),
      ['| Part | Appended to the VoiceOver cell |', '|---|---|']
        .concat([...clauses].map(([table, clause]) => `| ${table} | ${clause} |`))
        .join('\n') + '\n',
    )
    const recordText = readFileSync(join(repoRoot, 'docs', 'accessibility.md'), 'utf8')
    writeFileSync(join(OUT, 'accessibility.md'), appendClauses(recordText, clauses))
  }

  const failed = ordered
    .map((r) => ({ row: r.row, outcome: outcomeOf(r) }))
    .filter(({ outcome }) => outcome.kind === 'not heard' || outcome.kind === 'error')
    .map(({ row, outcome }) => `${row}: ${JSON.stringify(outcome)}`)
  expect(
    failed,
    'rows not heard, or whose script stopped (transcript.md says what was said)',
  ).toEqual([])
})
