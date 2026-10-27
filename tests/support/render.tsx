// One way to render a cell or a panel in a unit test (ADR-059, spec 038 Part
// 2).
//
// A rendered test starts with `// @vitest-environment jsdom` (or is named
// `*.browser.test.tsx` and runs in Chromium) and mounts what it tests
// through React's own client into the document, under `act`. It presses
// with a real `click()` and changes a field with a real `change`, and reads
// what the DOM shows; it does not call a handler a component gave a child.
//
// - `renderCell(cell, state)` draws one of the notebook's six cells, by the
//   adapter `notebook/cells.tsx` maps its id to, under `ProjectProviders`,
//   the one composition of the screen's providers `ProjectView` draws too.
//   The state is completed from one default (`defaultProjectState`, in
//   `project-state.ts`), so a test names only what it changes and builds
//   no `ProjectState` by hand.
// - `renderPanel(element)` draws a component that lives outside the
//   notebook: the export's run, the jobs' live region.
// - `byName(role, name)` finds a control by its role and its accessible
//   name, the names the gate documents quote; it throws, naming what it
//   looked for, when nothing or more than one answers, so a test can never
//   pass over a control that is not there. `press(name)` clicks the button
//   of that name inside `act`.
// - `cleanup()` unmounts whatever is still drawn: `afterEach(cleanup)` in a
//   file that does not unmount each screen itself.
//
// The kit is real here: its script registers the custom elements, and a
// press reaches the inner `<button>` of a `<fig-button>` as it does in the
// app. A jsdom test that hands focus replaces the kit's button with a
// native one (`kit-stubs.ts`), because jsdom does not delegate focus into a
// shadow root.
//
// `window.api` is stubbed with what the cells reach - the engine's state, a
// request that never answers, the subscriptions, the store's record - so no
// cell needs a mock of `engine/runs.ts`. A test replaces any part of it
// through `options.api`; the stub stays in place after an unmount, since a
// change flushed as its panel goes reads the record after the panel is
// gone, and `cleanup()` puts back whatever was there before the first
// stub, so one test's bridge never reaches the next.

import { act, type JSX, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/renderer/src/kit'
import type { Api } from '../../src/shared/api'
import type { ProjectRecord } from '../../src/shared/project/types'
import type { RunSnapshot } from '../../src/renderer/src/engine/layoutRun'
import { CELL_VIEWS } from '../../src/renderer/src/notebook/cells'
import { ProjectProviders, type ProjectState } from '../../src/renderer/src/notebook/context'
import { CELL_LIST, type CellId, type CellState } from '../../src/renderer/src/runGraph'
import { useSnapshot } from '../../src/renderer/src/useSnapshot'
import { BASE, defaultProjectState, nothing, pending, READY, unsubscribed } from './project-state'
import { StandInRun } from './stand-in-run'

export { BASE, defaultProjectState, INSPECTION, READY } from './project-state'

// React's client reads this to know it is driven by `act`.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The bridge, part by part, as far as a test stubs it. */
export type ApiStub = { [Part in keyof Api]?: Partial<Api[Part]> }

/**
 * What the cells reach of the bridge: the engine ready and answering no
 * request yet, nothing to hear, and the store answering `record()` for the
 * project.
 */
export function defaultApi(record: () => ProjectRecord & { readOnly: boolean }): ApiStub {
  return {
    engine: {
      state: async () => READY,
      request: () => ({ id: 'request-1', result: pending() }),
      cancel: async () => undefined,
      onState: unsubscribed,
      onProgress: unsubscribed,
      onLog: unsubscribed,
    },
    projects: { get: async () => record() },
  }
}

/** What `window` held as `api` before the first stub since the last `cleanup`; null when nothing is stubbed. */
let apiBefore: { had: boolean; api: unknown } | null = null

/** The default bridge with a test's parts laid over it, one part at a time. */
function installApi(base: ApiStub, over: ApiStub = {}): void {
  apiBefore ??= { had: 'api' in window, api: (window as { api?: unknown }).api }
  const api: Record<string, unknown> = { ...base }
  for (const [part, methods] of Object.entries(over))
    api[part] = { ...(base[part as keyof Api] ?? {}), ...methods }
  window.api = api as unknown as Api
}

/** Elements of each role a control can have here, by the element that has it implicitly. */
const IMPLICIT: Record<string, string> = {
  button: 'button, fig-button',
  combobox: 'select:not([multiple]):not([size])',
  checkbox: 'input[type="checkbox"]',
  radio: 'input[type="radio"]',
  textbox: 'input:not([type]), input[type="text"], input[type="search"], textarea',
  link: 'a[href]',
  heading: 'h1, h2, h3, h4, h5, h6',
  list: 'ul, ol',
  listitem: 'li',
}

const words = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()

/**
 * An element's accessible name as far as this suite's controls give one:
 * `aria-label`, then what `aria-labelledby` names, then a `<label>` for a
 * field, then its text.
 */
function nameOf(element: Element): string {
  const label = element.getAttribute('aria-label')
  if (label !== null) return words(label)
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null)
    return words(
      labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
        .join(' '),
    )
  if ('labels' in element) {
    const labels = (element as HTMLInputElement).labels
    if (labels !== null && labels.length > 0)
      return words([...labels].map((l) => l.textContent).join(' '))
  }
  return words(element.textContent)
}

/**
 * The control of `role` whose accessible name is `name`, in the document. A
 * `<fig-button>` answers its inner `<button>`, which is what takes a press
 * and focus. It throws when nothing answers, and when more than one does.
 */
export function byName(role: string, name: string, within: ParentNode = document): HTMLElement {
  const selector = [IMPLICIT[role], `[role="${role}"]`].filter(Boolean).join(', ')
  const found = [...within.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => nameOf(element) === name,
  )
  if (found.length === 0) throw new Error(`no ${role} named "${name}" is drawn`)
  if (found.length > 1) throw new Error(`${found.length} of role ${role} are named "${name}"`)
  const [element] = found
  if (element.localName !== 'fig-button') return element
  const inner = element.shadowRoot?.querySelector('button')
  if (inner === null || inner === undefined)
    throw new Error(`the button named "${name}" has no inner button: the kit did not draw it`)
  return inner
}

/** A press of the button named `name`: a real click, as a person's. */
export function press(name: string, within: ParentNode = document): void {
  const button = byName('button', name, within)
  act(() => button.click())
}

/**
 * The answers already on their way arrive, and whatever they start is
 * drawn: a few turns of the microtask queue, inside `act`. No clock moves,
 * so it is the same under fake timers.
 */
export async function answered(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve()
  })
}

export interface RenderOptions {
  /** Parts of the bridge to lay over the default (`defaultApi`). */
  api?: ApiStub
}

export interface CellOptions extends RenderOptions {
  /** The cell's own state, as the run graph derives it; ready unless a test says. */
  cellState?: CellState
  /** Whether the cell is open; it is unless a test says. */
  open?: boolean
  /** The run the cell is drawn with; a fresh one unless a test hands its own. */
  run?: StandInRun
}

interface Mounted {
  /** The element the screen is drawn into, appended to the document's body. */
  host: HTMLElement
  unmount(): void
  /** `byName`, within this screen's host only. */
  byName(role: string, name: string): HTMLElement
  /** `press`, within this screen's host only. */
  press(name: string): void
}

/** Every screen drawn and not yet unmounted, for `cleanup`. */
const drawnNow = new Set<() => void>()

/**
 * Unmounts every screen still drawn, so a test that failed before its own
 * unmount leaves nothing for the next one to find, and puts `window.api`
 * back as it was before the first stub: `afterEach(cleanup)`.
 */
export function cleanup(): void {
  for (const unmount of [...drawnNow]) unmount()
  if (apiBefore === null) return
  const target = window as { api?: unknown }
  if (apiBefore.had) target.api = apiBefore.api
  else delete target.api
  apiBefore = null
}

function mount(element: ReactElement): Mounted & { render(element: ReactElement): void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const unmount = (): void => {
    if (!drawnNow.delete(unmount)) return
    act(() => root.unmount())
    host.remove()
  }
  drawnNow.add(unmount)
  act(() => root.render(element))
  return {
    host,
    render: (next) => act(() => root.render(next)),
    unmount,
    byName: (role, name) => byName(role, name, host),
    press: (name) => press(name, host),
  }
}

export interface RenderedCell extends Mounted {
  /** The cell drawn again with these fields of the state changed, on top of the ones before. */
  rerender(patch?: Partial<ProjectState>): void
  /** The state the cell was last drawn with. */
  readonly state: ProjectState
  /** The run the cell is drawn with. */
  run: StandInRun
}

/**
 * The cell `id` drawn open and ready, with the project screen's state made
 * from `defaultProjectState` and `state` laid over it. The run's snapshot,
 * and whether a layout goes, follow the run as the screen's own hook
 * follows it, unless the state names them. A `run` in the state is drawn in
 * place of the stand-in, for a test that brings a run of another kind.
 */
export function renderCell(
  id: CellId,
  state: Partial<ProjectState> = {},
  options: CellOptions = {},
): RenderedCell {
  const run = options.run ?? new StandInRun()
  const base = defaultProjectState(run)
  const found = CELL_LIST.find((each) => each.id === id)
  if (found === undefined) throw new Error(`no cell is called ${id}`)
  const cell = found
  const View = CELL_VIEWS[id]
  let patch = state
  let drawn: ProjectState = { ...base, ...patch }

  // The cell's element is made once, so a render of the screen reaches the
  // cell only through the state it reads from the provider: what the cell
  // is rendered for is then what that state makes it render for, and not
  // that the harness drew it again.
  const view = (
    <View
      cell={cell}
      state={options.cellState ?? 'ready'}
      open={options.open ?? true}
      onToggle={nothing}
    />
  )

  function Screen({ given }: { given: Partial<ProjectState> }): JSX.Element {
    const snapshot = useSnapshot<RunSnapshot>(given.run ?? run)
    drawn = {
      ...base,
      runSnapshot: snapshot,
      layingOut: snapshot.state === 'running',
      ...given,
    }
    return <ProjectProviders state={drawn}>{view}</ProjectProviders>
  }

  installApi(
    defaultApi(() => drawn.project ?? { ...BASE, readOnly: false }),
    options.api,
  )
  const mounted = mount(<Screen given={patch} />)
  return {
    ...mounted,
    rerender: (next = {}) => {
      patch = { ...patch, ...next }
      mounted.render(<Screen given={patch} />)
    },
    get state() {
      return drawn
    },
    run,
  }
}

export interface RenderedPanel extends Mounted {
  /** The panel drawn again, as given now. */
  rerender(element: ReactElement): void
}

/**
 * `element` drawn into the document on its own, outside the notebook. The
 * bridge is stubbed as `renderCell` stubs it where there is none yet, or
 * where the test hands parts of it; otherwise the one in place is left
 * alone, so a panel drawn beside a cell, or after it has gone, reads what
 * the cell's test answers.
 */
export function renderPanel(element: ReactElement, options: RenderOptions = {}): RenderedPanel {
  if (options.api !== undefined || (window as { api?: Api }).api === undefined)
    installApi(
      defaultApi(() => ({ ...BASE, readOnly: false })),
      options.api,
    )
  const mounted = mount(element)
  return { ...mounted, rerender: (next) => mounted.render(next) }
}
